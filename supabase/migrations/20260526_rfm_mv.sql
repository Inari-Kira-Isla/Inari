-- T4: Customer RFM Materialized View
-- Segments customers by Recency / Frequency / Monetary using qb_sales
-- Refreshed monthly by ai.inari.rfm-monthly LaunchAgent (1st of month 06:00)

-- ── Base RFM scores ────────────────────────────────────────────────────────
-- Recency: days since last purchase (lower = better → score 5)
-- Frequency: distinct invoice count
-- Monetary: total spend (amount)

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_customer_rfm AS
WITH ref_date AS (
  SELECT CURRENT_DATE AS today
),
customer_metrics AS (
  SELECT
    s.customer_code,
    MAX(s.txn_date)                                        AS last_purchase_date,
    (SELECT today FROM ref_date) - MAX(s.txn_date)         AS recency_days,
    COUNT(DISTINCT s.invoice_no)                           AS frequency,
    SUM(s.amount)                                          AS monetary
  FROM qb_sales s
  WHERE s.is_void   = false
    AND s.is_return = false
    AND s.customer_code IS NOT NULL
  GROUP BY s.customer_code
),
percentiles AS (
  SELECT
    PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY recency_days DESC) AS r_p20,
    PERCENTILE_CONT(0.40) WITHIN GROUP (ORDER BY recency_days DESC) AS r_p40,
    PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY recency_days DESC) AS r_p60,
    PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY recency_days DESC) AS r_p80,
    PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY frequency)         AS f_p20,
    PERCENTILE_CONT(0.40) WITHIN GROUP (ORDER BY frequency)         AS f_p40,
    PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY frequency)         AS f_p60,
    PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY frequency)         AS f_p80,
    PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY monetary)          AS m_p20,
    PERCENTILE_CONT(0.40) WITHIN GROUP (ORDER BY monetary)          AS m_p40,
    PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY monetary)          AS m_p60,
    PERCENTILE_CONT(0.80) WITHIN GROUP (ORDER BY monetary)          AS m_p80
  FROM customer_metrics
),
scored AS (
  SELECT
    cm.*,
    -- R score: fewer days = more recent = higher score
    CASE
      WHEN cm.recency_days <= p.r_p20 THEN 5
      WHEN cm.recency_days <= p.r_p40 THEN 4
      WHEN cm.recency_days <= p.r_p60 THEN 3
      WHEN cm.recency_days <= p.r_p80 THEN 2
      ELSE 1
    END AS r_score,
    CASE
      WHEN cm.frequency >= p.f_p80 THEN 5
      WHEN cm.frequency >= p.f_p60 THEN 4
      WHEN cm.frequency >= p.f_p40 THEN 3
      WHEN cm.frequency >= p.f_p20 THEN 2
      ELSE 1
    END AS f_score,
    CASE
      WHEN cm.monetary >= p.m_p80 THEN 5
      WHEN cm.monetary >= p.m_p60 THEN 4
      WHEN cm.monetary >= p.m_p40 THEN 3
      WHEN cm.monetary >= p.m_p20 THEN 2
      ELSE 1
    END AS m_score
  FROM customer_metrics cm, percentiles p
),
segmented AS (
  SELECT
    s.*,
    CASE
      WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
      WHEN f_score >= 4 AND r_score >= 2                   THEN 'Loyal'
      WHEN r_score >= 4 AND f_score = 1                    THEN 'New'
      WHEN r_score >= 4 AND f_score <= 3                   THEN 'Potential'
      WHEN r_score <= 2 AND f_score >= 4                   THEN 'Cannot Lose'
      WHEN r_score <= 2 AND m_score >= 4                   THEN 'Cannot Lose'
      WHEN r_score <= 2 AND f_score <= 2                   THEN 'Lost'
      ELSE 'At Risk'
    END AS segment
  FROM scored s
)
SELECT
  customer_code,
  last_purchase_date,
  recency_days,
  frequency,
  monetary::numeric(14,2)  AS monetary,
  r_score,
  f_score,
  m_score,
  (r_score + f_score + m_score)::integer AS rfm_total,
  segment,
  NOW()                     AS refreshed_at
FROM segmented;

-- UNIQUE index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS mv_customer_rfm_pkey
  ON mv_customer_rfm (customer_code);

-- Regular indexes for dashboard queries
CREATE INDEX IF NOT EXISTS mv_customer_rfm_segment
  ON mv_customer_rfm (segment);

CREATE INDEX IF NOT EXISTS mv_customer_rfm_monetary
  ON mv_customer_rfm (monetary DESC);

-- Grant read access
GRANT SELECT ON mv_customer_rfm TO authenticated;
GRANT SELECT ON mv_customer_rfm TO anon;
