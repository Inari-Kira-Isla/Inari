-- ===== 冪等 reset：先清 TEST-* =====
DELETE FROM inari_customer_order_items WHERE product_code LIKE 'TEST-%'
   OR order_no IN (SELECT order_no FROM inari_customer_orders WHERE customer_code='TEST-UAT');
DELETE FROM inari_customer_orders WHERE customer_code='TEST-UAT';
DELETE FROM inari_inventory_lots WHERE sku LIKE 'TEST-%';
DELETE FROM qb_sales WHERE customer_code='TEST-UAT';
DELETE FROM inari_products WHERE sku LIKE 'TEST-%';
DELETE FROM inari_qr_tokens WHERE customer_code='TEST-UAT';
DELETE FROM inari_customers WHERE customer_code='TEST-UAT';

-- ===== TEST 客戶 =====
INSERT INTO inari_customers (tenant_id, customer_code, customer_name, is_active, status, payment_type, price_tier)
VALUES ('b15d5a02-764c-4353-ad40-07b901d9f321','TEST-UAT','【測試】UAT客戶',true,'active','現金','standard');

-- ===== 3 個 TEST 商品 =====
INSERT INTO inari_products (sku, name, status, on_hand, unit, avg_cost, sales_price, storage_type)
VALUES
 ('TEST-A01','【測試】急凍甜蝦TEST(1kg)','active',100,'kg',88,150,'冷凍'),
 ('TEST-A02','【測試】牡丹蝦TEST(1kg)','active',100,'kg',200,300,'冷凍'),
 ('TEST-A03','【測試】赤貝片TEST(1盒)','active',100,'盒',40,60,'冷凍');

-- ===== TEST lot（自帶庫存 100，FEFO 只扣呢啲）=====
INSERT INTO inari_inventory_lots (tenant_id, lot_no, sku, product_id, received_date, expiry_date, qty_received, qty_on_hand, qty_reserved, unit_cost_mop, status)
SELECT 'b15d5a02-764c-4353-ad40-07b901d9f321','LOT-TEST-'||p.sku, p.sku, p.id, CURRENT_DATE, DATE '2027-12-31', 100, 100, 0, p.avg_cost, 'active'
FROM inari_products p WHERE p.sku LIKE 'TEST-%';

-- ===== qb_sales TEST 歷史（撐 chips + 引擎撞得到）=====
INSERT INTO qb_sales (txn_date, invoice_no, customer_code, item_code, qty, uom, unit_price, amount, is_void, is_return, source_file, source_row)
VALUES
 (CURRENT_DATE - 20,'INV-TESTUAT-1','TEST-UAT','TEST-A01',3,'kg',150,450,false,false,'TEST_UAT',1),
 (CURRENT_DATE - 12,'INV-TESTUAT-2','TEST-UAT','TEST-A01',2,'kg',150,300,false,false,'TEST_UAT',2),
 (CURRENT_DATE - 8 ,'INV-TESTUAT-3','TEST-UAT','TEST-A02',1,'kg',300,300,false,false,'TEST_UAT',3),
 (CURRENT_DATE - 5 ,'INV-TESTUAT-4','TEST-UAT','TEST-A03',4,'盒',60 ,240,false,false,'TEST_UAT',4),
 (CURRENT_DATE - 3 ,'INV-TESTUAT-5','TEST-UAT','TEST-A01',1,'kg',150,150,false,false,'TEST_UAT',5);

-- ===== 驗證 =====
SELECT 'customer' k, count(*) n FROM inari_customers WHERE customer_code='TEST-UAT'
UNION ALL SELECT 'products', count(*) FROM inari_products WHERE sku LIKE 'TEST-%'
UNION ALL SELECT 'lots', count(*) FROM inari_inventory_lots WHERE sku LIKE 'TEST-%'
UNION ALL SELECT 'qb_sales', count(*) FROM qb_sales WHERE customer_code='TEST-UAT'
UNION ALL SELECT 'orderbook_items_TEST', count(*) FROM v_orderbook_items WHERE item_code LIKE 'TEST-%'
UNION ALL SELECT 'orderbook_cust_items', count(*) FROM v_orderbook_customer_items WHERE customer_code='TEST-UAT';
