-- Phase 2 Inventory v2 — T3: inventory_adjust RPC
-- 2026-05-26
-- Single-lot adjustment for damage / shrinkage / correction / other.

CREATE OR REPLACE FUNCTION inventory_adjust(
  p_tenant_id UUID,
  p_lot_id BIGINT,
  p_qty_delta NUMERIC,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_user TEXT DEFAULT 'system',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lot RECORD;
  v_existing RECORD;
  v_new_qty NUMERIC;
  v_movement_id BIGINT;
BEGIN
  -- Idempotency: exact key match for a single-lot operation.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT m.id, m.lot_id, m.qty_before, m.qty_after, m.qty_change, l.status
      INTO v_existing
    FROM inari_inventory_movements m
    JOIN inari_inventory_lots l
      ON l.id = m.lot_id
    WHERE m.tenant_id = p_tenant_id
      AND m.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN json_build_object(
        'ok', true,
        'idempotent', true,
        'movement_id', v_existing.id,
        'lot_id', v_existing.lot_id,
        'old_qty', v_existing.qty_before,
        'new_qty', v_existing.qty_after,
        'delta', v_existing.qty_change,
        'lot_status', v_existing.status
      );
    END IF;
  END IF;

  -- Reason whitelist.
  IF p_reason IS NULL OR p_reason NOT IN ('damage', 'shrinkage', 'correction', 'other') THEN
    RAISE EXCEPTION 'invalid reason: %', p_reason USING ERRCODE = '22023';
  END IF;

  -- No-op guard.
  IF p_qty_delta = 0 THEN
    RAISE EXCEPTION 'no-op: qty_delta must be non-zero' USING ERRCODE = '22023';
  END IF;

  -- Lock the lot row before any quantity mutation.
  SELECT id, qty_on_hand, qty_received, unit_cost_mop, status
    INTO v_lot
  FROM inari_inventory_lots
  WHERE tenant_id = p_tenant_id
    AND id = p_lot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lot not found' USING ERRCODE = '23503';
  END IF;

  IF v_lot.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'lot not active' USING ERRCODE = '22023';
  END IF;

  IF ABS(p_qty_delta) > v_lot.qty_received THEN
    RAISE EXCEPTION 'adjust delta too large, use scrap instead' USING ERRCODE = '22023';
  END IF;

  v_new_qty := v_lot.qty_on_hand + p_qty_delta;

  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'insufficient stock: lot has %, cannot subtract %',
      v_lot.qty_on_hand, ABS(p_qty_delta)
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE inari_inventory_lots
  SET qty_on_hand = v_new_qty,
      status = CASE WHEN v_new_qty = 0 THEN 'consumed' ELSE status END,
      updated_at = now()
  WHERE id = v_lot.id;

  INSERT INTO inari_inventory_movements (
    tenant_id, lot_id, movement_type,
    qty_change, qty_before, qty_after,
    unit_cost, total_cost_impact,
    reference_type, reference_no,
    movement_date, notes, created_by, idempotency_key
  ) VALUES (
    p_tenant_id, v_lot.id, 'adjust',
    p_qty_delta, v_lot.qty_on_hand, v_new_qty,
    v_lot.unit_cost_mop, p_qty_delta * v_lot.unit_cost_mop,
    'adjust', p_reason,
    CURRENT_DATE, p_notes, p_user, p_idempotency_key
  )
  RETURNING id INTO v_movement_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'lot_id', v_lot.id,
    'movement_id', v_movement_id,
    'old_qty', v_lot.qty_on_hand,
    'new_qty', v_new_qty,
    'delta', p_qty_delta,
    'lot_status', CASE WHEN v_new_qty = 0 THEN 'consumed' ELSE v_lot.status END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory_adjust(
  UUID, BIGINT, NUMERIC, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;

-- Test:
-- 1) Idempotent repeat returns existing movement result.
--    SELECT inventory_adjust(
--      '00000000-0000-0000-0000-000000000001',
--      12345,
--      -2,
--      'damage',
--      'broken on inspection',
--      'tester',
--      'adjust-12345-001'
--    );
--    -- Run the same call again and confirm idempotent = true.
--
-- 2) Invalid reason raises 22023.
--    SELECT inventory_adjust(
--      '00000000-0000-0000-0000-000000000001',
--      12345,
--      -1,
--      'bad_reason',
--      NULL,
--      'tester',
--      'adjust-12345-002'
--    );
--
-- 3) Zero delta raises 22023.
--    SELECT inventory_adjust(
--      '00000000-0000-0000-0000-000000000001',
--      12345,
--      0,
--      'correction',
--      NULL,
--      'tester',
--      'adjust-12345-003'
--    );
--
-- 4) Missing lot raises 23503.
--    SELECT inventory_adjust(
--      '00000000-0000-0000-0000-000000000001',
--      999999,
--      -1,
--      'damage',
--      NULL,
--      'tester',
--      'adjust-999999-001'
--    );
--
-- 5) Non-active lot raises 22023.
--    -- Precondition: lot 12346 exists with status != 'active'.
--    SELECT inventory_adjust(
--      '00000000-0000-0000-0000-000000000001',
--      12346,
--      -1,
--      'damage',
--      NULL,
--      'tester',
--      'adjust-12346-001'
--    );
--
-- 6) Oversized delta / insufficient stock edge cases.
--    -- 6a) ABS(delta) > qty_received raises 22023.
--    SELECT inventory_adjust(
--      '00000000-0000-0000-0000-000000000001',
--      12345,
--      -999,
--      'damage',
--      NULL,
--      'tester',
--      'adjust-12345-004'
--    );
--    -- 6b) Negative result raises P0001.
--    SELECT inventory_adjust(
--      '00000000-0000-0000-0000-000000000001',
--      12345,
--      -5,
--      'correction',
--      NULL,
--      'tester',
--      'adjust-12345-005'
--    );
