-- Phase 2 Inventory v2 — T2: recalc_on_hand RPC
-- 2026-05-26
--
-- Recompute inari_products.on_hand as the sum of qty_on_hand across all
-- active lots for the SKU, but only when inventory_v2_active = true.

CREATE OR REPLACE FUNCTION recalc_on_hand(
  p_tenant_id UUID,
  p_sku TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_lot RECORD;
  v_new_on_hand NUMERIC := 0;
  v_lot_count BIGINT := 0;
BEGIN
  -- Lock and verify the product row first so the guard and update are stable.
  SELECT id, inventory_v2_active
  INTO v_product
  FROM inari_products
  WHERE tenant_id = p_tenant_id
    AND sku = p_sku
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'SKU not found: %', p_sku USING ERRCODE = '23503';
  END IF;

  IF NOT COALESCE(v_product.inventory_v2_active, false) THEN
    RETURN json_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'not_v2_active'
    );
  END IF;

  -- Lock active lots and compute the refreshed on_hand value.
  FOR v_lot IN
    SELECT id, qty_on_hand
    FROM inari_inventory_lots
    WHERE tenant_id = p_tenant_id
      AND sku = p_sku
      AND status = 'active'
    FOR UPDATE
  LOOP
    v_new_on_hand := v_new_on_hand + COALESCE(v_lot.qty_on_hand, 0);
    v_lot_count := v_lot_count + 1;
  END LOOP;

  UPDATE inari_products
  SET on_hand = v_new_on_hand,
      updated_at = now()
  WHERE id = v_product.id;

  RETURN json_build_object(
    'ok', true,
    'sku', p_sku,
    'new_on_hand', v_new_on_hand,
    'lot_count', v_lot_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION recalc_on_hand(UUID, TEXT)
  TO authenticated, service_role;

-- Test:
-- 1) Positive case: v2_active=true SKU with active lots
-- SELECT recalc_on_hand(
--   '00000000-0000-0000-0000-000000000001',
--   'SKU-V2-001'
-- );
-- Expect JSON with ok=true, skipped absent/false, new_on_hand equal to the
-- SUM(qty_on_hand) of active lots, and lot_count equal to active lot count.
--
-- 2) Skip case: v2_active=false SKU
-- SELECT recalc_on_hand(
--   '00000000-0000-0000-0000-000000000001',
--   'SKU-LEGACY-001'
-- );
-- Expect JSON: {"ok":true,"skipped":true,"reason":"not_v2_active"}
--
-- 3) not_exists case: missing SKU
-- SELECT recalc_on_hand(
--   '00000000-0000-0000-0000-000000000001',
--   'SKU-MISSING-001'
-- );
-- Expect exception SQLSTATE 23503 (foreign_key_violation).
