-- T6: pg_cron jobs for daily Materialized View refresh
-- Replaces Mac LaunchAgent ai.inari.refresh-mvs as primary scheduler
-- Runs at 18:00 UTC = 02:00 MOP time (UTC+8)
-- LaunchAgent kept as fallback (will skip if pg_cron ran within 30 min)

-- Remove existing jobs if re-running this migration
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname LIKE 'inari-refresh-%';

-- ── 6 Materialized Views ──────────────────────────────────────────────────
SELECT cron.schedule(
  'inari-refresh-mv-monthly-summary',
  '0 18 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_summary$$
);

SELECT cron.schedule(
  'inari-refresh-mv-yearly-summary',
  '5 18 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_yearly_summary$$
);

SELECT cron.schedule(
  'inari-refresh-mv-product-lifecycle-v2',
  '10 18 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_lifecycle_v2$$
);

SELECT cron.schedule(
  'inari-refresh-mv-product-analysis',
  '15 18 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_analysis$$
);

SELECT cron.schedule(
  'inari-refresh-mv-product-lifecycle',
  '20 18 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_lifecycle$$
);

SELECT cron.schedule(
  'inari-refresh-mv-kg-region-summary',
  '25 18 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_kg_region_industry_summary$$
);

-- ── RFM MV refresh (monthly, 1st of month 17:00 UTC = 01:00 MOP) ─────────
SELECT cron.schedule(
  'inari-refresh-mv-customer-rfm',
  '0 17 1 * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_rfm$$
);

-- Verify
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'inari-%';
