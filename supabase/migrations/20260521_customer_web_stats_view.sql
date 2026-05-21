-- Phase 1 Day 1: customer view with pre-aggregated web order stats
-- Replaces JS aggregation in /api/admin/customers.ts
-- Per Opus + Codex cross-analysis 2026-05-21

CREATE OR REPLACE VIEW v_customer_with_web_stats AS
SELECT
  c.id,
  c.customer_code,
  c.customer_name,
  c.group_name,
  c.business_type,
  c.payment_type,
  c.payment_terms_days,
  c.credit_limit,
  c.salesperson,
  c.is_active,
  c.status,
  c.due_date,
  c.collection_method,
  c.tenant_id,
  COALESCE(stats.order_count, 0) AS web_order_count,
  COALESCE(stats.total_amount, 0) AS web_total_amount,
  stats.last_order AS last_web_order,
  COALESCE(stats.draft_count, 0) AS web_draft_count
FROM inari_customers c
LEFT JOIN LATERAL (
  SELECT
    COUNT(DISTINCT o.id) AS order_count,
    COALESCE(SUM(i.amount), 0) AS total_amount,
    MAX(o.created_at) AS last_order,
    COUNT(DISTINCT CASE WHEN o.status = 'draft' THEN o.id END) AS draft_count
  FROM inari_customer_orders o
  LEFT JOIN inari_customer_order_items i ON i.order_id = o.id
  WHERE o.tenant_id = c.tenant_id
    AND o.customer_code = c.customer_code
) stats ON true;

COMMENT ON VIEW v_customer_with_web_stats IS
  'Phase 1 Day 1: pre-aggregates web order stats per customer. Replaces JS join in /api/admin/customers.ts. Updated 2026-05-21.';
