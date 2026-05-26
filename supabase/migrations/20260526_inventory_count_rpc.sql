-- Phase 2 Inventory v2 — T4: inventory_count RPC
-- 2026-05-26
--
-- Purpose:
-- Record a physical count against a single lot, compute the delta against the
-- current on-hand quantity, and always write a movement row for auditability.

CREATE OR REPLACE FUNCTION inventory_count(
  p_tenant_id UUID,
  p_lot_id BIGINT,
  p_qty_counted NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_user TEXT DEFAULT 'system',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot RECORD;
  v_existing RECORD;
  v_delta NUMERIC;
  v_movement_id BIGINT;
  v_lot_status TEXT;
  v_lot_updated BOOLEAN := false;
BEGIN
  -- Idempotency: exact key match for this single-lot operation.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT
      m.id,
      m.lot_id,
      m.qty_before,
      m.qty_after,
      m.qty_change,
      l.status AS lot_status
    INTO v_existing
    FROM inari_inventory_movements m
    LEFT JOIN inari_inventory_lots l
      ON l.id = m.lot_id
    WHERE m.tenant_id = p_tenant_id
      AND m.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'ok', true,
        'idempotent', true,
        'lot_id', v_existing.lot_id,
        'movement_id', v_existing.id,
        'old_qty', v_existing.qty_before,
        'new_qty', v_existing.qty_after,
        'delta', v_existing.qty_change,
        'lot_status', v_existing.lot_status,
        'lot_updated', (v_existing.qty_before IS DISTINCT FROM v_existing.qty_after)
      );
    END IF;
  END IF;

  IF p_qty_counted IS NULL OR p_qty_counted < 0 THEN
    RAISE EXCEPTION 'qty_counted must be non-negative (got %)', p_qty_counted
      USING ERRCODE = '22023';
  END IF;

  -- Lock the lot row before any inventory mutation.
  SELECT id, qty_on_hand, unit_cost_mop, status
    INTO v_lot
  FROM inari_inventory_lots
  WHERE tenant_id = p_tenant_id
    AND id = p_lot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lot not found: %', p_lot_id
      USING ERRCODE = '23503';
  END IF;

  IF v_lot.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'lot not active (status=%)', v_lot.status
      USING ERRCODE = '22023';
  END IF;

  v_delta := p_qty_counted - v_lot.qty_on_hand;
  v_lot_status := v_lot.status;

  IF v_delta <> 0 THEN
    v_lot_updated := true;
    v_lot_status := CASE
      WHEN p_qty_counted = 0 THEN 'consumed'
      ELSE v_lot.status
    END;

    UPDATE inari_inventory_lots
    SET qty_on_hand = p_qty_counted,
        status = v_lot_status,
        updated_at = now()
    WHERE id = v_lot.id;
  END IF;

  INSERT INTO inari_inventory_movements (
    tenant_id, lot_id, movement_type,
    qty_change, qty_before, qty_after,
    unit_cost, total_cost_impact,
    reference_type, reference_no, reference_id,
    movement_date, notes, created_by, idempotency_key
  ) VALUES (
    p_tenant_id, v_lot.id, 'count',
    v_delta, v_lot.qty_on_hand, p_qty_counted,
    v_lot.unit_cost_mop, v_delta * v_lot.unit_cost_mop,
    'count', NULL, NULL,
    CURRENT_DATE, p_notes, p_user, p_idempotency_key
  )
  RETURNING id INTO v_movement_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'lot_id', v_lot.id,
    'movement_id', v_movement_id,
    'old_qty', v_lot.qty_on_hand,
    'new_qty', p_qty_counted,
    'delta', v_delta,
    'lot_status', v_lot_status,
    'lot_updated', v_lot_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory_count(
  UUID, BIGINT, NUMERIC, TEXT, TEXT, TEXT
) TO authenticated, service_role;

-- Test:
-- 1) delta > 0 (counted qty greater than on_hand)
--    SELECT inventory_count(
--      '00000000-0000-0000-0000-000000000001',
--      201,
--      15,
--      'cycle count overage',
--      'tester',
--      'count-201-plus'
--    );
--
-- 2) delta < 0 (counted qty less than on_hand)
--    SELECT inventory_count(
--      '00000000-0000-0000-0000-000000000001',
--      202,
--      7,
--      'cycle count shortage',
--      'tester',
--      'count-202-minus'
--    );
--
-- 3) delta = 0 still writes a movement row
--    SELECT inventory_count(
--      '00000000-0000-0000-0000-000000000001',
--      203,
--      10,
--      'count matched exactly',
--      'tester',
--      'count-203-zero'
--    );
--    -- Expect: movement inserted even though delta = 0, with lot_updated = false.
--
-- 4) invalid case: negative counted quantity
--    SELECT inventory_count(
--      '00000000-0000-0000-0000-000000000001',
--      204,
--      -1,
--      'invalid negative count',
--      'tester',
--      'count-204-invalid'
--    );
