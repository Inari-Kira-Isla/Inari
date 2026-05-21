-- Phase 1 Day 1: indexes from Codex code review 2026-05-21
-- Targets the hot paths in admin APIs

-- ── inari_customer_orders ───────────────────────────────────────────
-- For customer detail page (customer_code + recency)
CREATE INDEX IF NOT EXISTS idx_co_tenant_customer_created
  ON inari_customer_orders(tenant_id, customer_code, created_at DESC);

-- For analytics date-range scans (excludes cancelled)
CREATE INDEX IF NOT EXISTS idx_co_tenant_date_active
  ON inari_customer_orders(tenant_id, order_date)
  WHERE status != 'cancelled';

-- ── inari_customer_order_items ──────────────────────────────────────
-- For order detail page + customer aggregation
CREATE INDEX IF NOT EXISTS idx_coi_tenant_order
  ON inari_customer_order_items(tenant_id, order_id);

-- ── inari_products ──────────────────────────────────────────────────
-- For products list sort
CREATE INDEX IF NOT EXISTS idx_products_active_cat_name
  ON inari_products(is_active, category, name);

-- ── pg_trgm for ILIKE search ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON inari_products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON inari_customers USING gin (customer_name gin_trgm_ops);
