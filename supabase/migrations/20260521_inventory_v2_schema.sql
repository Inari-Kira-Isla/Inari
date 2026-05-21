-- Phase 2 Inventory v2 — Sprint 1 T1: schema constraints + views
-- 2026-05-21 — Hermes-Inari plan
--
-- Changes:
-- 1. CHECK constraints on lots (qty non-negative, qty_received positive)
-- 2. CHECK constraint on movements.movement_type (allowed values)
-- 3. idempotency_key column on movements (UNIQUE per tenant)
-- 4. v_inventory_summary recreated with days_until_expiry and earliest_lot_no
-- 5. v_inventory_value_by_category (F: 庫存價值報表)

-- ── 1. Constraints on inari_inventory_lots ─────────────────────────────
ALTER TABLE inari_inventory_lots
  DROP CONSTRAINT IF EXISTS chk_lots_qty_on_hand_nonneg;
ALTER TABLE inari_inventory_lots
  ADD CONSTRAINT chk_lots_qty_on_hand_nonneg CHECK (qty_on_hand >= 0);

ALTER TABLE inari_inventory_lots
  DROP CONSTRAINT IF EXISTS chk_lots_qty_reserved_nonneg;
ALTER TABLE inari_inventory_lots
  ADD CONSTRAINT chk_lots_qty_reserved_nonneg CHECK (qty_reserved >= 0);

ALTER TABLE inari_inventory_lots
  DROP CONSTRAINT IF EXISTS chk_lots_qty_received_pos;
ALTER TABLE inari_inventory_lots
  ADD CONSTRAINT chk_lots_qty_received_pos CHECK (qty_received > 0);

ALTER TABLE inari_inventory_lots
  DROP CONSTRAINT IF EXISTS chk_lots_status;
ALTER TABLE inari_inventory_lots
  ADD CONSTRAINT chk_lots_status
    CHECK (status IN ('active', 'consumed', 'expired', 'damaged', 'returned'));

-- ── 2. Constraints on inari_inventory_movements ────────────────────────
ALTER TABLE inari_inventory_movements
  DROP CONSTRAINT IF EXISTS chk_movements_type;
ALTER TABLE inari_inventory_movements
  ADD CONSTRAINT chk_movements_type
    CHECK (movement_type IN (
      'receive', 'pick', 'adjust', 'transfer', 'scrap', 'expired', 'return', 'count'
    ));

-- ── 3. Idempotency column ─────────────────────────────────────────────
ALTER TABLE inari_inventory_movements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_movements_idem
  ON inari_inventory_movements(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Helpful indexes for inventory hot paths
CREATE INDEX IF NOT EXISTS idx_lots_tenant_sku_status
  ON inari_inventory_lots(tenant_id, sku, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_lots_expiry_fefo
  ON inari_inventory_lots(tenant_id, sku, expiry_date NULLS LAST, received_date)
  WHERE status = 'active' AND qty_on_hand > 0;

CREATE INDEX IF NOT EXISTS idx_movements_lot
  ON inari_inventory_movements(lot_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_movements_ref
  ON inari_inventory_movements(reference_type, reference_id)
  WHERE reference_type IS NOT NULL;

-- ── 4. v_inventory_summary recreated with extras ───────────────────────
DROP VIEW IF EXISTS v_inventory_summary CASCADE;
CREATE VIEW v_inventory_summary AS
SELECT
  l.tenant_id,
  l.sku,
  p.name AS product_name,
  p.category,
  p.storage_type,
  COUNT(DISTINCT l.id) AS lot_count,
  SUM(l.qty_on_hand) AS total_on_hand,
  SUM(l.qty_reserved) AS total_reserved,
  SUM(l.qty_on_hand - l.qty_reserved) AS available_qty,
  AVG(l.unit_cost_mop) AS avg_cost_mop,
  SUM(l.qty_on_hand * l.unit_cost_mop) AS stock_value_mop,
  MIN(l.expiry_date) AS earliest_expiry,
  MIN(l.expiry_date) - CURRENT_DATE AS days_until_earliest_expiry,
  -- Earliest lot info (for FEFO preview)
  (
    SELECT l2.lot_no
    FROM inari_inventory_lots l2
    WHERE l2.tenant_id = l.tenant_id AND l2.sku = l.sku
      AND l2.status = 'active' AND l2.qty_on_hand > 0
    ORDER BY l2.expiry_date NULLS LAST, l2.received_date
    LIMIT 1
  ) AS next_pick_lot_no
FROM inari_inventory_lots l
LEFT JOIN inari_products p ON p.sku = l.sku AND p.tenant_id = l.tenant_id
WHERE l.status = 'active' AND l.qty_on_hand > 0
GROUP BY l.tenant_id, l.sku, p.name, p.category, p.storage_type;

COMMENT ON VIEW v_inventory_summary IS
  'Phase 2 Inventory v2: SKU-level rollup of active lots with stock value and earliest expiry. Replaces 2026-04 version.';

-- ── 5. v_inventory_value_by_category (F擴增) ───────────────────────────
CREATE OR REPLACE VIEW v_inventory_value_by_category AS
SELECT
  l.tenant_id,
  COALESCE(p.category, '未分類') AS category,
  COALESCE(p.storage_type, '未指定') AS storage_type,
  COUNT(DISTINCT l.sku) AS sku_count,
  COUNT(DISTINCT l.id) AS lot_count,
  SUM(l.qty_on_hand) AS total_qty,
  SUM(l.qty_on_hand * l.unit_cost_mop) AS total_value_mop
FROM inari_inventory_lots l
LEFT JOIN inari_products p ON p.sku = l.sku AND p.tenant_id = l.tenant_id
WHERE l.status = 'active' AND l.qty_on_hand > 0
GROUP BY l.tenant_id, p.category, p.storage_type
ORDER BY total_value_mop DESC NULLS LAST;

COMMENT ON VIEW v_inventory_value_by_category IS
  'Phase 2 F-feature: stock value broken down by product category × storage type.';
