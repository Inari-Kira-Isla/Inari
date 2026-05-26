-- Phase 2 Inventory v2 — Sprint 2 schema guard
-- 2026-05-26
--
-- Sprint 1 already includes the full inari_inventory_movements.movement_type
-- CHECK set ('scrap' and 'expired' are already present), so this migration only
-- adds the product-level guard used by recalc_on_hand / init_from_product flow.

ALTER TABLE inari_products
  ADD COLUMN IF NOT EXISTS inventory_v2_active BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_v2_active
  ON inari_products(tenant_id, sku)
  WHERE inventory_v2_active = true;

COMMENT ON COLUMN inari_products.inventory_v2_active IS
  'Sprint 2 guard flag for inventory v2. Only SKUs initialized from product legacy on_hand should be eligible for recalc_on_hand sync.';
