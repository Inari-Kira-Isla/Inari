-- Phase 2 Inventory v2 — Sprint 1 T2+T3: RPC functions
-- 2026-05-21
-- All functions return JSON for easy consumption from PostgREST.

-- ╭──────────────────────────────────────────────────────────────────────╮
-- │ T2: inventory_receive — atomic INSERT lot + movement                 │
-- ╰──────────────────────────────────────────────────────────────────────╯
CREATE OR REPLACE FUNCTION inventory_receive(
  p_tenant_id UUID,
  p_sku TEXT,
  p_lot_no TEXT,
  p_qty NUMERIC,
  p_unit_cost_mop NUMERIC,
  p_received_date DATE DEFAULT CURRENT_DATE,
  p_expiry_date DATE DEFAULT NULL,
  p_storage_location TEXT DEFAULT NULL,
  p_quality_grade TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user TEXT DEFAULT 'system',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lot_id BIGINT;
  v_movement_id BIGINT;
  v_product_id BIGINT;
  v_existing_movement_id BIGINT;
BEGIN
  -- Idempotency: if same key already exists, return its result
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_movement_id
    FROM inari_inventory_movements
    WHERE tenant_id = p_tenant_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      SELECT lot_id INTO v_lot_id
      FROM inari_inventory_movements
      WHERE id = v_existing_movement_id;
      RETURN json_build_object(
        'ok', true,
        'idempotent', true,
        'lot_id', v_lot_id,
        'movement_id', v_existing_movement_id
      );
    END IF;
  END IF;

  -- Validate sku exists
  SELECT id INTO v_product_id
  FROM inari_products
  WHERE tenant_id = p_tenant_id AND sku = p_sku
  LIMIT 1;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'SKU not found: %', p_sku USING ERRCODE = '23503';
  END IF;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive (got %)', p_qty USING ERRCODE = '22023';
  END IF;
  IF p_unit_cost_mop < 0 THEN
    RAISE EXCEPTION 'unit_cost_mop must be non-negative' USING ERRCODE = '22023';
  END IF;

  -- INSERT lot
  INSERT INTO inari_inventory_lots (
    tenant_id, lot_no, sku, product_id,
    received_date, expiry_date,
    qty_received, qty_on_hand, qty_reserved,
    unit_cost_mop, status, storage_location, quality_grade, notes
  ) VALUES (
    p_tenant_id, p_lot_no, p_sku, v_product_id,
    p_received_date, p_expiry_date,
    p_qty, p_qty, 0,
    p_unit_cost_mop, 'active', p_storage_location, p_quality_grade, p_notes
  )
  RETURNING id INTO v_lot_id;

  -- INSERT movement
  INSERT INTO inari_inventory_movements (
    tenant_id, lot_id, movement_type,
    qty_change, qty_before, qty_after,
    unit_cost, total_cost_impact,
    movement_date, notes, created_by, idempotency_key
  ) VALUES (
    p_tenant_id, v_lot_id, 'receive',
    p_qty, 0, p_qty,
    p_unit_cost_mop, p_qty * p_unit_cost_mop,
    p_received_date, p_notes, p_user, p_idempotency_key
  )
  RETURNING id INTO v_movement_id;

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'lot_id', v_lot_id,
    'movement_id', v_movement_id,
    'lot_no', p_lot_no,
    'sku', p_sku,
    'qty', p_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory_receive(
  UUID, TEXT, TEXT, NUMERIC, NUMERIC, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;

-- ╭──────────────────────────────────────────────────────────────────────╮
-- │ T3: inventory_pick_fefo — FEFO pick with row-level lock              │
-- ╰──────────────────────────────────────────────────────────────────────╯
CREATE OR REPLACE FUNCTION inventory_pick_fefo(
  p_tenant_id UUID,
  p_sku TEXT,
  p_qty NUMERIC,
  p_reference_type TEXT DEFAULT NULL,   -- e.g. 'order'
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
BEGIN
  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT json_agg(json_build_object(
      'lot_id', lot_id,
      'movement_id', id,
      'qty', qty_change * -1
    )) INTO v_existing
    FROM inari_inventory_movements
    WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN json_build_object('ok', true, 'idempotent', true, 'allocations', v_existing);
    END IF;
  END IF;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive' USING ERRCODE = '22023';
  END IF;

  -- Pre-flight: check total available before locking (cheap)
  SELECT COALESCE(SUM(qty_on_hand - qty_reserved), 0) INTO v_total_available
  FROM inari_inventory_lots
  WHERE tenant_id = p_tenant_id AND sku = p_sku
    AND status = 'active' AND qty_on_hand > 0;

  IF v_total_available < p_qty THEN
    RAISE EXCEPTION 'Insufficient stock for SKU % — need %, have %',
      p_sku, p_qty, v_total_available
      USING ERRCODE = 'P0001';
  END IF;

  -- FEFO loop with row-level lock
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

    -- UPDATE lot
    UPDATE inari_inventory_lots
    SET qty_on_hand = qty_on_hand - v_pick_qty,
        status = CASE WHEN (qty_on_hand - v_pick_qty) = 0 THEN 'consumed' ELSE status END,
        updated_at = now()
    WHERE id = v_lot.id;

    -- INSERT movement
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
      CURRENT_DATE, p_notes, p_user, p_idempotency_key
    )
    RETURNING id INTO v_movement_id;

    v_allocations := v_allocations || jsonb_build_object(
      'lot_id', v_lot.id,
      'lot_no', v_lot.lot_no,
      'qty', v_pick_qty,
      'expiry_date', v_lot.expiry_date,
      'movement_id', v_movement_id
    );
    v_remaining := v_remaining - v_pick_qty;
  END LOOP;

  IF v_remaining > 0 THEN
    -- Should not happen due to pre-flight check, but defensive
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

GRANT EXECUTE ON FUNCTION inventory_pick_fefo(
  UUID, TEXT, NUMERIC, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;
