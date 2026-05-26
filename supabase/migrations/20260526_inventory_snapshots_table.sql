-- Phase 2 Inventory v2 — daily inventory snapshots table
-- 2026-05-26
--
-- Purpose:
-- Store one row per tenant × SKU × snapshot_date for daily inventory reporting,
-- trend analysis, and downstream LaunchAgent writes (T11).
--
-- Retention guidance:
-- Archive rows older than 18 months to keep the hot table small while
-- preserving enough history for operational and trend analysis.

CREATE TABLE IF NOT EXISTS inari_inventory_snapshots (
  snapshot_date DATE NOT NULL,
  tenant_id UUID NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT,
  category TEXT,
  storage_type TEXT,
  lot_count INTEGER NOT NULL DEFAULT 0,
  total_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  total_value_mop NUMERIC(14,2) NOT NULL DEFAULT 0,
  expiring_7d_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  earliest_expiry DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, tenant_id, sku)
);

COMMENT ON TABLE inari_inventory_snapshots IS
  'Daily SKU-level inventory snapshots for Phase 2 reporting and trend analysis. Recommend archiving rows older than 18 months.';

ALTER TABLE inari_inventory_snapshots ENABLE ROW LEVEL SECURITY;

-- Align with Sprint 1 lots/movements pattern: gate via inari_is_accounting_or_manager() helper.
-- service_role bypasses RLS by default, no explicit policy needed for the snapshot LaunchAgent writer.
DROP POLICY IF EXISTS inari_accounting_manager_all ON inari_inventory_snapshots;
CREATE POLICY inari_accounting_manager_all
  ON inari_inventory_snapshots
  FOR ALL
  USING (inari_is_accounting_or_manager())
  WITH CHECK (inari_is_accounting_or_manager());

GRANT SELECT ON inari_inventory_snapshots TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON inari_inventory_snapshots TO service_role;

CREATE INDEX IF NOT EXISTS idx_snapshots_date_brin
  ON inari_inventory_snapshots USING BRIN (snapshot_date);

CREATE INDEX IF NOT EXISTS idx_snapshots_sku_date
  ON inari_inventory_snapshots(tenant_id, sku, snapshot_date DESC);
