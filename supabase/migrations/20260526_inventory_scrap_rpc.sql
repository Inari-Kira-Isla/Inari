-- Phase 2 Inventory v2 — T5: inventory_scrap RPC
-- 2026-05-26
--
-- Purpose:
-- Scrap an entire lot atomically. The lot is terminated, qty_on_hand is set
-- to 0, and a scrap movement is written with movement_type='scrap'.

CREATE OR REPLACE FUNCTION inventory_scrap(
  p_tenant_id UUID,
  p_lot_id BIGINT,
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
  v_existing_movement RECORD;
  v_movement_id BIGINT;
  v_scrap_qty NUMERIC;
  v_target_status TEXT;
  v_value_written_off NUMERIC;
BEGIN
  -- Idempotency: exact key match for this single-lot operation.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT
      m.id AS movement_id,
      m.lot_id,
      m.qty_change,
      m.unit_cost,
      m.reference_no,
      l.status AS lot_status,
      l.qty_on_hand AS lot_qty_on_hand
    INTO v_existing_movement
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
        'lot_id', v_existing_movement.lot_id,
        'movement_id', v_existing_movement.movement_id,
        'scrap_qty', ABS(v_existing_movement.qty_change),
        'reason', v_existing_movement.reference_no,
        'new_status', v_existing_movement.lot_status,
        'value_written_off', ABS(v_existing_movement.qty_change) * v_existing_movement.unit_cost
      );
    END IF;
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN ('damaged', 'expired', 'quality', 'other') THEN
    RAISE EXCEPTION 'reason must be one of damaged, expired, quality, other'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_lot
  FROM inari_inventory_lots
  WHERE tenant_id = p_tenant_id
    AND id = p_lot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lot not found: %', p_lot_id
      USING ERRCODE = '23503';
  END IF;

  IF v_lot.status <> 'active' THEN
    RAISE EXCEPTION 'lot already terminated (status=%)', v_lot.status
      USING ERRCODE = '22023';
  END IF;

  IF v_lot.qty_on_hand = 0 THEN
    RAISE EXCEPTION 'lot is empty, nothing to scrap'
      USING ERRCODE = '22023';
  END IF;

  v_scrap_qty := v_lot.qty_on_hand;
  v_target_status := CASE p_reason
    WHEN 'damaged' THEN 'damaged'
    WHEN 'expired' THEN 'expired'
    WHEN 'quality' THEN 'damaged'
    WHEN 'other' THEN 'damaged'
  END;
  v_value_written_off := v_scrap_qty * v_lot.unit_cost_mop;

  UPDATE inari_inventory_lots
  SET qty_on_hand = 0,
      status = v_target_status,
      updated_at = now()
  WHERE id = v_lot.id;

  INSERT INTO inari_inventory_movements (
    tenant_id, lot_id, movement_type,
    qty_change, qty_before, qty_after,
    unit_cost, total_cost_impact,
    reference_type, reference_no,
    movement_date, notes, created_by, idempotency_key
  ) VALUES (
    p_tenant_id, v_lot.id, 'scrap',
    -v_scrap_qty, v_scrap_qty, 0,
    v_lot.unit_cost_mop, -v_value_written_off,
    'scrap', p_reason,
    CURRENT_DATE, p_notes, p_user, p_idempotency_key
  )
  RETURNING id INTO v_movement_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'lot_id', v_lot.id,
    'movement_id', v_movement_id,
    'scrap_qty', v_scrap_qty,
    'reason', p_reason,
    'new_status', v_target_status,
    'value_written_off', v_value_written_off
  );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory_scrap(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;

-- Test:
-- 1) damaged -> damaged
-- SELECT inventory_scrap(
--   '00000000-0000-0000-0000-000000000001',
--   101,
--   'damaged',
--   'box crushed',
--   'tester',
--   'scrap-101-damaged'
-- );
--
-- 2) expired -> expired
-- SELECT inventory_scrap(
--   '00000000-0000-0000-0000-000000000001',
--   102,
--   'expired',
--   'past date',
--   'tester',
--   'scrap-102-expired'
-- );
--
-- 3) quality -> damaged
-- SELECT inventory_scrap(
--   '00000000-0000-0000-0000-000000000001',
--   103,
--   'quality',
--   'failed inspection',
--   'tester',
--   'scrap-103-quality'
-- );
--
-- 4) other -> damaged
-- SELECT inventory_scrap(
--   '00000000-0000-0000-0000-000000000001',
--   104,
--   'other',
--   'misc loss',
--   'tester',
--   'scrap-104-other'
-- );
--
-- 5) already terminated
-- SELECT inventory_scrap(
--   '00000000-0000-0000-0000-000000000001',
--   105,
--   'damaged',
--   NULL,
--   'tester',
--   'scrap-105-terminated'
-- );
--
-- 6) qty = 0
-- SELECT inventory_scrap(
--   '00000000-0000-0000-0000-000000000001',
--   106,
--   'damaged',
--   NULL,
--   'tester',
--   'scrap-106-empty'
-- );
