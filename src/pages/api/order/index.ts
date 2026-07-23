// POST /api/order — B2C guest 下單(免login,Joe 2026-07-23拍板)
// GET  /api/order?order_no=&phone= — guest 查詢自己張訂單(免login,用order_no+電話兩者都啱先俾睇)
//
// 故意獨立於 /api/orders(B2B,要求 locals.userType 已登入)——B2C 完全冇 session/customer_code
// 概念,寫死喺呢個獨立endpoint方便日後審計/修改唔會兩邊互相影響(Joe 2026-07-23拍板:B2C同B2B
// 完全分開命名空間)。訂單一律落 order_type='b2c'/customer_code=NULL/status='draft'——同B2B同一條
// 規矩:客戶提交後只落draft,要職員喺/admin/orders人手核對先可以confirm,唔會未經核實就扣庫存
// (見 shop/checkout.astro 註解、supabase/migrations/20260526_order_fulfillment_trigger.sql)。
import type { APIRoute } from 'astro';
import { createOrder } from '../../../lib/order-service';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';
const GUEST_PAYMENT_METHODS = new Set(['現金', '銀行轉帳']);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function postgrestValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS_HEADERS });

export const GET: APIRoute = async ({ url }) => {
  const orderNo = (url.searchParams.get('order_no') || '').trim();
  const phone = (url.searchParams.get('phone') || '').trim();
  if (!orderNo || !phone) return jsonError('請提供訂單編號同電話');

  const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const q =
    `${SUPABASE_URL}/rest/v1/inari_customer_orders` +
    `?order_no=eq.${encodeURIComponent(orderNo)}&guest_phone=eq.${encodeURIComponent(phone)}&order_type=eq.b2c` +
    `&select=*,items:inari_customer_order_items(*)&limit=1`;
  const resp = await fetch(q, { headers: sbHeaders(serviceKey) });
  const rows = resp.ok ? await resp.json() : [];
  if (!rows.length) return jsonError('搵唔到訂單,請核對訂單編號同落單電話', 404);

  return new Response(JSON.stringify({ order: rows[0] }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError('請求格式錯誤');
  }

  const guestName = String(body.guest_name || '').trim();
  const guestPhone = String(body.guest_phone || '').trim();
  const guestAddress = String(body.guest_delivery_address || '').trim();
  const paymentMethod = String(body.payment_method || '').trim();
  const deliveryDate = body.delivery_date || null;
  const notes = String(body.notes || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const receiptUrl = body.payment_receipt_url ? String(body.payment_receipt_url) : null;

  if (!guestName) return jsonError('請填寫收貨人姓名');
  if (!/^[0-9+\-\s]{6,20}$/.test(guestPhone)) return jsonError('請填寫有效聯絡電話');
  if (!guestAddress) return jsonError('請填寫送貨地址');
  if (!GUEST_PAYMENT_METHODS.has(paymentMethod)) return jsonError('付款方式只支援「現金」或「銀行轉帳」');
  if (items.length === 0) return jsonError('訂單明細不能為空');

  const headers = sbHeaders(serviceKey);
  const itemRefs = items.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      item: row,
      productId: String(row.product_id || '').trim(),
      sku: String(row.sku || row.product_code || '').trim(),
    };
  });

  if (itemRefs.some(({ productId, sku }) => !productId && !sku)) {
    return jsonError('訂單商品資料不完整');
  }

  // 價錢必須同公開商品目錄用同一權威來源。request 入面嘅 unit_price/line_total
  // 只係前台顯示快照，絕對唔可以直接落單。
  const catalogFilters = [
    ...new Set(itemRefs.flatMap(({ productId, sku }) => [
      ...(productId ? [`id.eq.${postgrestValue(productId)}`] : []),
      ...(sku ? [`sku.eq.${postgrestValue(sku)}`] : []),
    ])),
  ];
  const catalogParams = new URLSearchParams({
    select: 'id,sku,name,unit,sales_price',
    or: `(${catalogFilters.join(',')})`,
  });
  const catalogResp = await fetch(
    `${SUPABASE_URL}/rest/v1/v_shop_catalog?${catalogParams}`,
    { headers },
  );

  if (!catalogResp.ok) {
    const errText = await catalogResp.text();
    console.error('B2C authoritative catalog lookup failed:', errText);
    return jsonError('讀取商品價格失敗，請稍後再試', 502);
  }

  const catalogRows = await catalogResp.json() as Record<string, unknown>[];
  const catalogById = new Map(
    catalogRows.map((row) => [String(row.id), row]),
  );
  const catalogBySku = new Map(
    catalogRows.map((row) => [String(row.sku), row]),
  );
  const pricedItems = itemRefs.map(({ item, productId, sku }) => {
    const product = catalogById.get(productId) || catalogBySku.get(sku);
    const qty = Number(item.qty);
    const unitPrice = Number(product?.sales_price);
    return { item, product, qty, unitPrice };
  });

  if (pricedItems.some(({ product }) => !product)) {
    return jsonError('訂單內有商品已下架或不存在');
  }
  if (pricedItems.some(({ qty }) => !Number.isFinite(qty) || qty <= 0)) {
    return jsonError('商品數量必須大於 0');
  }
  if (pricedItems.some(({ unitPrice }) => !Number.isFinite(unitPrice) || unitPrice < 0)) {
    return jsonError('訂單內有商品暫未設定有效售價');
  }

  const result = await createOrder({
    serviceKey,
    orderType: 'b2c',
    customerCode: null,
    customerName: guestName,
    items: pricedItems.map(({ product, qty, unitPrice }) => ({
      productId: product!.id,
      productCode: product!.sku,
      productName: product!.name,
      qty,
      unit: product!.unit,
      unitPrice,
    })),
    paymentMethod,
    deliveryDate,
    notes,
    guestInfo: {
      name: guestName,
      phone: guestPhone,
      deliveryAddress: guestAddress,
      paymentReceiptUrl: receiptUrl,
    },
  });

  if (!result.ok && result.stage === 'header') {
    return jsonError('建立訂單失敗:' + result.detail, 500);
  }
  if (!result.ok) {
    return jsonError('訂單明細建立失敗，請重新落單或聯絡客服', 500);
  }

  return new Response(JSON.stringify({ ok: true, order_no: result.orderNo, order_id: result.orderId }), {
    status: 201,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};
