-- Phase 2 Inventory v2 — fix1: idempotency key suffix for multi-lot pick
-- 2026-05-21
-- Bug: FEFO pick generates one movement per lot, but they shared the same
-- idempotency_key → unique violation. Fix: suffix with lot id; check with prefix.

CREATE OR REPLACE FUNCTION inventory_pick_fefo(
  p_tenant_id UUID,
  p_sku TEXT,
  p_qty NUMERIC,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id BIGINT DEFAULT NULL,
  p_reference_no TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user TEXT DEFAULT 'system',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;
