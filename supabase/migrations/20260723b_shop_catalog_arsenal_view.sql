-- 商城前台目錄專用view：武器庫(有真實銷售 sd/qb)∩is_active，帶埋image_url等前台顯示欄位。
-- Why: /api/products/catalog.ts、/api/order/catalog.ts 之前直查 inari_products?is_active=eq.true，
-- 冇濾「有冇真實銷售」，令彈藥庫(v_ammo,供應商未賣候選,129筆)混入客戶商城；亦冇select image_url，
-- 前台卡片一直用emoji佔位，從未讀過DB圖片。呢個view唔改v_arsenal（避免影響SKU_BUILD_SOP/成本會計用途），
-- 獨立開一個商城專用view。
create or replace view v_shop_catalog as
select
  p.id,
  p.sku,
  p.name,
  p.category,
  p.unit,
  p.sales_price,
  p.storage_type,
  p.is_air_freight,
  p.origin,
  p.image_url
from inari_products p
where p.is_active
  and (
    exists (select 1 from inari_sales_details s where s.product_id = p.id)
    or exists (select 1 from qb_sales q where q.item_code = p.sku)
  );

comment on view v_shop_catalog is '商城前台目錄(B2B /shop/catalog + B2C /order)專用：武器庫(有sd/qb銷售)∩is_active，含image_url。2026-07-23建立。';

insert into inari_schema_registry (table_name, domain, status, safe_to_use, authority_note)
values (
  'v_shop_catalog',
  'product',
  'active',
  'yes',
  '商城前台目錄專用(武器庫∩is_active)，供/api/products/catalog.ts與/api/order/catalog.ts使用，唔好再直查inari_products?is_active俾前台'
)
on conflict (table_name) do update set
  domain = excluded.domain,
  status = excluded.status,
  safe_to_use = excluded.safe_to_use,
  authority_note = excluded.authority_note;
