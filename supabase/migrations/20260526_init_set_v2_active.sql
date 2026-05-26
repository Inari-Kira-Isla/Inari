-- Patch inventory_init_from_product so successful initialization marks the SKU
-- as inventory v2 active.
-- 2026-05-26

CREATE OR REPLACE FUNCTION inventory_init_from_product(
  p_tenant_id UUID,
  p_sku TEXT,
  p_expiry_date DATE DEFAULT NULL,
  p_storage_location TEXT DEFAULT NULL,
  p_user TEXT DEFAULT 'system'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_product RECORD;
  v_lot_id BIGINT;
  v_movement_id BIGINT;
  v_lot_no TEXT;
  v_today DATE := CURRENT_DATE;
BEGIN
  SELECT id, on_hand, avg_cost, name INTO v_product
  FROM inari_products
  WHERE tenant_id = p_tenant_id AND sku = p_sku
  LIMIT 1;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'SKU not found: %', p_sku USING ERRCODE = '23503';
  END IF;
  IF v_product.on_hand IS NULL OR v_product.on_hand <= 0 THEN
    RAISE EXCEPTION 'SKU % has no on_hand stock to initialize', p_sku USING ERRCODE = '22023';
  END IF;

  -- Idempotency: if an OPENING lot already exists for this SKU today, return it
  SELECT id INTO v_lot_id
  FROM inari_inventory_lots
  WHERE tenant_id = p_tenant_id
    AND sku = p_sku
    AND lot_no LIKE 'OPENING-' || p_sku || '-%'
  LIMIT 1;
  IF v_lot_id IS NOT NULL THEN
    -- Mark product as inventory v2 active so recalc_on_hand will manage it.
    UPDATE inari_products
    SET inventory_v2_active = true
    WHERE tenant_id = p_tenant_id AND sku = p_sku;

    RETURN json_build_object(
      'ok', true,
      'idempotent', true,
      'lot_id', v_lot_id,
      'message', 'opening lot already exists'
    );
  END IF;

  -- Generate lot_no: OPENING-{SKU}-{YYYYMMDD}
  v_lot_no := 'OPENING-' || p_sku || '-' || to_char(v_today, 'YYYYMMDD');

  -- Insert lot
  INSERT INTO inari_inventory_lots (
    tenant_id, lot_no, sku, product_id,
    received_date, expiry_date,
    qty_received, qty_on_hand, qty_reserved,
    unit_cost_mop, status,
    storage_location, notes
  ) VALUES (
    p_tenant_id, v_lot_no, p_sku, v_product.id,
    v_today, p_expiry_date,
    v_product.on_hand, v_product.on_hand, 0,
    COALESCE(v_product.avg_cost, 0), 'active',
    p_storage_location,
    'Auto-initialized from inari_products.on_hand on ' || v_today::text
  )
  RETURNING id INTO v_lot_id;

  -- Insert opening-balance movement
  INSERT INTO inari_inventory_movements (
    tenant_id, lot_id, movement_type,
    qty_change, qty_before, qty_after,
    unit_cost, total_cost_impact,
    reference_type, reference_no,
    movement_date, notes, created_by, idempotency_key
  ) VALUES (
    p_tenant_id, v_lot_id, 'receive',
    v_product.on_hand, 0, v_product.on_hand,
    COALESCE(v_product.avg_cost, 0),
    v_product.on_hand * COALESCE(v_product.avg_cost, 0),
    'opening_balance', v_lot_no,
    v_today, 'opening balance migrated from inari_products.on_hand',
    p_user, 'opening-' || p_sku || '-' || v_today::text
  )
  RETURNING id INTO v_movement_id;

  -- Mark product as inventory v2 active so recalc_on_hand will manage it.
  UPDATE inari_products
  SET inventory_v2_active = true
  WHERE tenant_id = p_tenant_id AND sku = p_sku;

  -- Note: we DO NOT zero out inari_products.on_hand here — keep both as
  -- dual source so that the legacy column still reflects total for now.
  -- A separate trigger or background job can sync going forward.

  RETURN json_build_object(
    'ok', true,
    'idempotent', false,
    'lot_id', v_lot_id,
    'lot_no', v_lot_no,
    'qty', v_product.on_hand,
    'unit_cost_mop', COALESCE(v_product.avg_cost, 0),
    'product_name', v_product.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory_init_from_product(UUID, TEXT, DATE, TEXT, TEXT)
  TO authenticated, service_role;

-- Test:
-- 1) Initialize a SKU with legacy on_hand > 0 and verify inventory_v2_active flips true.
--    SELECT inventory_init_from_product('<tenant_uuid>', '<sku>');
--    SELECT inventory_v2_active
--    FROM inari_products
--    WHERE tenant_id = '<tenant_uuid>' AND sku = '<sku>';
--
-- 2) Run the function again for the same SKU and verify the idempotent path also keeps
--    inventory_v2_active = true while returning the existing OPENING lot.
