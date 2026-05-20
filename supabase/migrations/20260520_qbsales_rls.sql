-- T08: Lock qb_sales to SELECT only
-- 614,269 historical records from QBpro — never allow writes via API

ALTER TABLE qb_sales ENABLE ROW LEVEL SECURITY;

-- Allow SELECT for authenticated service_role and staff/manager via app layer
-- (service_role bypasses RLS anyway, but this ensures no accidental writes)
CREATE POLICY "qb_sales_select_only"
  ON qb_sales
  FOR SELECT
  USING (true);

-- Explicitly block write operations (no INSERT/UPDATE/DELETE policies)
-- Any attempt via anon/authenticated key returns 42501
