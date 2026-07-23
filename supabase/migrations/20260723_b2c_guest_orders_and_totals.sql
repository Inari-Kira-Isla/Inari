-- 2026-07-23 /omni-audit：稻荷商城 B2B/B2C 雙軌下單
-- Part A：訂單總額由頭到尾冇計過（orders.astro 讀 o.amount / account/index.astro 讀 o.total_amount，
--         兩個欄都唔存在於 inari_customer_orders，一直顯示 MOP 0 / "—"）——加返 total_amount 欄，
--         用 trigger 喺 inari_customer_order_items 變動時自動重算，唔靠 app 層記得寫（呼應本專案
--         已多次撞過「app層自己維護衍生值，多個入口漏一個」嘅教訓，DB trigger 做單一維護點）。
-- Part B：B2C guest 下單（免密碼，Joe 2026-07-23 拍板：唔建 customer master row，訂單表直接存
--         guest 欄位，customer_code 留 NULL）。

-- ── A. total_amount 自動維護 ──────────────────────────────────────────────
ALTER TABLE inari_customer_orders ADD COLUMN IF NOT EXISTS total_amount numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION fn_recalc_order_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_order_id bigint;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  UPDATE inari_customer_orders
     SET total_amount = COALESCE((
           SELECT SUM(COALESCE(i.amount, i.qty * i.unit_price, 0))
           FROM inari_customer_order_items i
           WHERE i.order_id = v_order_id
         ), 0)
   WHERE id = v_order_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_order_total ON inari_customer_order_items;
CREATE TRIGGER trg_recalc_order_total
  AFTER INSERT OR UPDATE OR DELETE ON inari_customer_order_items
  FOR EACH ROW
  EXECUTE FUNCTION fn_recalc_order_total();

-- 一次性回填現存訂單（07-23查證 production 呢兩表皆 0 行，此步為將來安全網，非本次實際生效）
UPDATE inari_customer_orders o
   SET total_amount = COALESCE((
         SELECT SUM(COALESCE(i.amount, i.qty * i.unit_price, 0))
         FROM inari_customer_order_items i WHERE i.order_id = o.id
       ), 0);

-- ── B. B2C guest 下單支援欄位 ──────────────────────────────────────────────
ALTER TABLE inari_customer_orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'b2b',
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS guest_phone text,
  ADD COLUMN IF NOT EXISTS guest_delivery_address text,
  ADD COLUMN IF NOT EXISTS payment_receipt_url text;

ALTER TABLE inari_customer_orders DROP CONSTRAINT IF EXISTS inari_customer_orders_order_type_check;
ALTER TABLE inari_customer_orders ADD CONSTRAINT inari_customer_orders_order_type_check
  CHECK (order_type = ANY (ARRAY['b2b', 'b2c']));

-- customer_code 本身已經 nullable（guest 訂單 order_type='b2c' 時 customer_code 留 NULL，
-- guest_name/guest_phone/guest_delivery_address 代替客戶主檔嘅名/聯絡/地址）。

CREATE INDEX IF NOT EXISTS idx_customer_orders_type
  ON inari_customer_orders(tenant_id, order_type, created_at DESC);

-- 07-23 一併補：inari_qr_tokens 手足表都有 RLS，獨欠佢冧咗（見 map.md 第五節#4），
-- 現行 app 全走 service_role key未受影響，此為 defense-in-depth 補漏，唔改變任何現行行為。
ALTER TABLE inari_qr_tokens ENABLE ROW LEVEL SECURITY;

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'inari_customer_orders'
  AND column_name IN ('total_amount', 'order_type', 'guest_name', 'guest_phone', 'guest_delivery_address', 'payment_receipt_url')
ORDER BY column_name;
