// POST /api/order — B2C guest 下單(免login,Joe 2026-07-23拍板)
// GET  /api/order?order_no=&phone= — guest 查詢自己張訂單(免login,用order_no+電話兩者都啱先俾睇)
//
// 故意獨立於 /api/orders(B2B,要求 locals.userType 已登入)——B2C 完全冇 session/customer_code
// 概念,寫死喺呢個獨立endpoint方便日後審計/修改唔會兩邊互相影響(Joe 2026-07-23拍板:B2C同B2B
// 完全分開命名空間)。訂單一律落 order_type='b2c'/customer_code=NULL/status='draft'——同B2B同一條
// 規矩:客戶提交後只落draft,要職員喺/admin/orders人手核對先可以confirm,唔會未經核實就扣庫存
// (見 shop/checkout.astro 註解、supabase/migrations/20260526_order_fulfillment_trigger.sql)。
import type { APIRoute } from 'astro';

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

function generateOrderNo() {
  const d = new Date();
  const datePart = d.toISOString().slice(0, 10).replace(/-/g, '');
  const code = 'B2C' + Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${datePart}-${code}`;
}

function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
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

  const orderNo = generateOrderNo();
  const headers = sbHeaders(serviceKey);

  const orderPayload: Record<string, unknown> = {
    order_no: orderNo,
    order_type: 'b2c',
    customer_code: null,
    customer_name: guestName,
    guest_name: guestName,
    guest_phone: guestPhone,
    guest_delivery_address: guestAddress,
    order_date: new Date().toISOString().slice(0, 10),
    source: 'web',
    status: 'draft',
    payment_method: paymentMethod,
    ...(deliveryDate ? { delivery_date: deliveryDate } : {}),
    ...(notes ? { notes } : {}),
    ...(receiptUrl ? { payment_receipt_url: receiptUrl } : {}),
    tenant_id: TENANT_ID,
  };

  const orderResp = await fetch(`${SUPABASE_URL}/rest/v1/inari_customer_orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(orderPayload),
  });

  if (!orderResp.ok) {
    const errText = await orderResp.text();
    return jsonError('建立訂單失敗:' + errText, 500);
  }

  const [newOrder] = await orderResp.json();
  const orderId = newOrder.id;

  const itemPayloads = items.map((item: Record<string, unknown>) => {
    const qty = Number(item.qty) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    return {
      order_id: orderId,
      order_no: orderNo,
      product_id: item.product_id || null,
      product_code: item.sku || item.product_code || null,
      product_name: item.product_name || null,
      qty,
      unit: item.unit || null,
      unit_price: unitPrice,
      amount: qty * unitPrice,
      match_confidence: 'catalog',
      tenant_id: TENANT_ID,
    };
  });

  const itemsResp = await fetch(`${SUPABASE_URL}/rest/v1/inari_customer_order_items`, {
    method: 'POST',
    headers,
    body: JSON.stringify(itemPayloads),
  });

  if (!itemsResp.ok) {
    const errText = await itemsResp.text();
    console.error('B2C order items insert failed:', errText);
    try {
      const deleteResp = await fetch(
        `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${orderId}`,
        { method: 'DELETE', headers: sbHeaders(serviceKey) }
      );
      if (!deleteResp.ok) {
        const deleteErrText = await deleteResp.text();
        console.error('B2C order header cleanup failed:', deleteErrText);
      }
    } catch (deleteError) {
      console.error('B2C order header cleanup failed:', deleteError);
    }
    return jsonError('訂單明細建立失敗，請重新落單或聯絡客服', 500);
  }

  return new Response(JSON.stringify({ ok: true, order_no: orderNo, order_id: orderId }), {
    status: 201,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};
