-- UAT TEST-UAT fixture 清理（測完跑，一鍵清乾淨，全部 TEST- 標籤，零碰真數據）
-- 跑法: SUPABASE_ACCESS_TOKEN=$(python3 ~/vault/vault.py get supabase pat) \
--        supabase db query --linked --workdir /tmp/supabase-inari --file <此檔>
-- 對應 seed: scripts/uat_test_fixture_seed.sql

-- 1. FEFO 造嘅 TEST 庫存異動
DELETE FROM inari_inventory_movements
 WHERE reference_no LIKE 'ORD-%-TEST%'
    OR lot_id IN (SELECT id FROM inari_inventory_lots WHERE sku LIKE 'TEST-A%');
-- 2. 訂單明細 + 表頭
DELETE FROM inari_customer_order_items
 WHERE product_code LIKE 'TEST-A%'
    OR order_no IN (SELECT order_no FROM inari_customer_orders WHERE customer_code='TEST-UAT');
DELETE FROM inari_customer_orders WHERE customer_code='TEST-UAT';
-- 3. TEST 庫存批次
DELETE FROM inari_inventory_lots WHERE sku LIKE 'TEST-A%';
-- 4. TEST 銷售史（撐 chips/引擎嗰啲）
DELETE FROM qb_sales WHERE customer_code='TEST-UAT';
-- 5. TEST 商品
DELETE FROM inari_products WHERE sku LIKE 'TEST-A%';
-- 6. QR token + 客戶
DELETE FROM inari_qr_tokens WHERE customer_code='TEST-UAT';
DELETE FROM inari_customers WHERE customer_code='TEST-UAT';

-- 驗證全清
SELECT 'customers' k, count(*) n FROM inari_customers WHERE customer_code='TEST-UAT'
UNION ALL SELECT 'products', count(*) FROM inari_products WHERE sku LIKE 'TEST-A%'
UNION ALL SELECT 'lots', count(*) FROM inari_inventory_lots WHERE sku LIKE 'TEST-A%'
UNION ALL SELECT 'qb_sales', count(*) FROM qb_sales WHERE customer_code='TEST-UAT'
UNION ALL SELECT 'orders', count(*) FROM inari_customer_orders WHERE customer_code='TEST-UAT';
