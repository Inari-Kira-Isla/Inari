-- Phase 1 Day 3.1: extend analytics_cache.cache_type CHECK to include Inari types
-- The table is shared with CloudPipe (original types: regional, industry, merchant_ranking).
-- We add 'sales', 'inari_analytics', 'inari_health' for Hermes-Inari use.

ALTER TABLE analytics_cache DROP CONSTRAINT IF EXISTS analytics_cache_cache_type_check;

ALTER TABLE analytics_cache ADD CONSTRAINT analytics_cache_cache_type_check
  CHECK (cache_type = ANY (ARRAY[
    'regional', 'industry', 'merchant_ranking',
    'sales', 'inari_analytics', 'inari_health'
  ]::text[]));

-- Index for fast key lookup (UNIQUE already covers this but add expires_at for GC)
CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires
  ON analytics_cache(expires_at);
