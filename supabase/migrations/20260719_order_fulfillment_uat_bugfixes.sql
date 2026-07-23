-- 07-19 UAT: 3 bugs found and hotfixed directly on the live DB (function/constraint layer,
-- no migration file at the time). This migration documents the CURRENT LIVE STATE as of
-- 2026-07-21 (verified via `pg_get_functiondef` / `pg_get_constraintdef` against the linked
-- project cqartwwsbxnjjatmndtt) so `supabase db reset` / new environments match production.
-- It is NOT re-applying a change — the DB already runs this code; this just backfills version
-- control.
--
-- Bug 1: fn_order_fulfillment picked stock per order-item ROW instead of per product_code.
--        Two rows with the same SKU on one order produced two idempotency keys
--        (order_no-sku, order_no-sku) that collided/under-deducted stock. Fixed by grouping
--        order items by product_code and SUM(qty) before calling inventory_pick_fefo.
-- Bug 2: fn_order_fulfillment read the success flag off inventory_pick_fefo's result as
--        result->>'success', but inventory_pick_fefo actually returns 'ok'. Every call was
--        therefore treated as failed, mis-flagging orders as stock_alert. Fixed to read 'ok'.
-- Bug 3: inari_customer_order_items.match_confidence CHECK constraint didn't allow the
--        'history' / 'keyword' match strategies added to the SKU-matching pipeline, so those
--        rows failed to insert/update. Fixed by widening the CHECK constraint.

-- ── Bug 1 + Bug 2: fn_order_fulfillment ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_order_fulfillment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_item         RECORD;
  v_result       JSON;
  v_success      BOOLEAN;
  v_stock_issues TEXT[] := '{}';
  v_idempotency  TEXT;
BEGIN
  IF NEW.status <> 'confirmed' OR OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- BUG-1 修:按 product_code 合計 qty(同 SKU 多行合成一次扣,避免冪等鍵碰撞漏扣)
  FOR v_item IN
    SELECT product_code,
           SUM(qty)          AS qty,
           MAX(product_name) AS product_name
    FROM   inari_customer_order_items
    WHERE  order_id = NEW.id
      AND  product_code IS NOT NULL
      AND  qty IS NOT NULL AND qty > 0
    GROUP BY product_code
  LOOP
    v_idempotency := NEW.order_no || '-' || v_item.product_code;

    BEGIN
      v_result := inventory_pick_fefo(
        p_tenant_id       => NEW.tenant_id,
        p_sku             => v_item.product_code,
        p_qty             => v_item.qty,
        p_reference_type  => 'order',
        p_reference_id    => NEW.id,
        p_reference_no    => NEW.order_no,
        p_notes           => '訂單確認自動扣庫存',
        p_user            => 'system',
        p_idempotency_key => v_idempotency
      );
      -- BUG-2 修:pick_fefo 成功欄叫 'ok' 唔係 'success'
      v_success := COALESCE((v_result->>'ok')::BOOLEAN, false);
    EXCEPTION WHEN OTHERS THEN
      v_success := false;
      v_result  := json_build_object('message', SQLERRM);
    END;

    IF NOT v_success THEN
      v_stock_issues := array_append(
        v_stock_issues,
        v_item.product_code || ' (' || COALESCE(v_item.product_name, '') || '): '
          || COALESCE(v_result->>'message', '庫存不足')
      );
    END IF;
  END LOOP;

  IF array_length(v_stock_issues, 1) > 0 THEN
    NEW.status := 'stock_alert';
    NEW.notes  := COALESCE(NEW.notes || E'\n', '')
                  || '[庫存警示 ' || NOW()::date || '] '
                  || array_to_string(v_stock_issues, ' | ');
  ELSE
    NEW.confirmed_at := NOW();
  END IF;

  RETURN NEW;
END;
$function$;

-- Re-attach in case the function was ever dropped/recreated without CREATE OR REPLACE
-- (no-op if the trigger already points here — kept idempotent like the original migration).
DROP TRIGGER IF EXISTS trg_order_fulfillment ON inari_customer_orders;
CREATE TRIGGER trg_order_fulfillment
  BEFORE UPDATE ON inari_customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_order_fulfillment();

-- ── inventory_pick_fefo (unchanged by the 3 bugs, included for completeness /
--    to keep the function that fn_order_fulfillment depends on in version control) ────────
CREATE OR REPLACE FUNCTION public.inventory_pick_fefo(
  p_tenant_id uuid,
  p_sku text,
  p_qty numeric,
  p_reference_type text DEFAULT NULL::text,
  p_reference_id bigint DEFAULT NULL::bigint,
  p_reference_no text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_user text DEFAULT 'system'::text,
  p_idempotency_key text DEFAULT NULL::text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_remaining NUMERIC := p_qty;
  v_lot RECORD;
  v_pick_qty NUMERIC;
  v_allocations JSONB := '[]'::JSONB;
  v_total_available NUMERIC;
  v_movement_id BIGINT;
  v_existing JSON;
  v_key_prefix TEXT;
BEGIN
  -- Idempotency: any movement with same prefix means this op already ran
  IF p_idempotency_key IS NOT NULL THEN
    v_key_prefix := p_idempotency_key || ':';
    SELECT json_agg(json_build_object(
      'lot_id', lot_id,
      'movement_id', id,
      'qty', -qty_change
    )) INTO v_existing
    FROM inari_inventory_movements
    WHERE tenant_id = p_tenant_id
      AND idempotency_key LIKE v_key_prefix || '%';
    IF v_existing IS NOT NULL THEN
      RETURN json_build_object('ok', true, 'idempotent', true, 'allocations', v_existing);
    END IF;
  END IF;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(qty_on_hand - qty_reserved), 0) INTO v_total_available
  FROM inari_inventory_lots
  WHERE tenant_id = p_tenant_id AND sku = p_sku
    AND status = 'active' AND qty_on_hand > 0;

  IF v_total_available < p_qty THEN
    RAISE EXCEPTION 'Insufficient stock for SKU % — need %, have %',
      p_sku, p_qty, v_total_available
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_lot IN
    SELECT id, lot_no, qty_on_hand, qty_reserved, unit_cost_mop, expiry_date
    FROM inari_inventory_lots
    WHERE tenant_id = p_tenant_id AND sku = p_sku
      AND status = 'active' AND qty_on_hand > 0
    ORDER BY expiry_date NULLS LAST, received_date, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_pick_qty := LEAST(v_lot.qty_on_hand - v_lot.qty_reserved, v_remaining);
    IF v_pick_qty <= 0 THEN CONTINUE; END IF;

    UPDATE inari_inventory_lots
    SET qty_on_hand = qty_on_hand - v_pick_qty,
        status = CASE WHEN (qty_on_hand - v_pick_qty) = 0 THEN 'consumed' ELSE status END,
        updated_at = now()
    WHERE id = v_lot.id;

    INSERT INTO inari_inventory_movements (
      tenant_id, lot_id, movement_type,
      qty_change, qty_before, qty_after,
      unit_cost, total_cost_impact,
      reference_type, reference_no, reference_id,
      movement_date, notes, created_by, idempotency_key
    ) VALUES (
      p_tenant_id, v_lot.id, 'pick',
      -v_pick_qty, v_lot.qty_on_hand, v_lot.qty_on_hand - v_pick_qty,
      v_lot.unit_cost_mop, -v_pick_qty * v_lot.unit_cost_mop,
      p_reference_type, p_reference_no, p_reference_id,
      CURRENT_DATE, p_notes, p_user,
      -- Suffix idempotency key per lot so multiple allocations don't collide
      CASE WHEN p_idempotency_key IS NULL THEN NULL
           ELSE p_idempotency_key || ':lot' || v_lot.id::TEXT END
    )
    RETURNING id INTO v_movement_id;

    v_allocations := v_allocations || jsonb_build_object(
      'lot_id', v_lot.id,
      'lot_no', v_lot.lot_no,
      'qty', v_pick_qty,
      'expiry_date', v_lot.expiry_date,
      'unit_cost_mop', v_lot.unit_cost_mop,
      'movement_id', v_movement_id
    );
    v_remaining := v_remaining - v_pick_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Could not allocate full qty — % remaining', v_remaining
      USING ERRCODE = 'P0001';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'sku', p_sku,
    'total_picked', p_qty,
    'allocations', v_allocations
  );
END;
$function$;

-- ── Bug 3: inari_customer_order_items.match_confidence CHECK constraint ────────────────
-- Live constraint definition (verified 2026-07-21):
--   CHECK ((match_confidence = ANY (ARRAY['exact','alias','fuzzy','unmatched','history','keyword'])))
ALTER TABLE inari_customer_order_items
  DROP CONSTRAINT IF EXISTS inari_customer_order_items_match_confidence_check;
ALTER TABLE inari_customer_order_items
  ADD CONSTRAINT inari_customer_order_items_match_confidence_check
  CHECK (match_confidence = ANY (ARRAY['exact','alias','fuzzy','unmatched','history','keyword']));
