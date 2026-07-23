// POST /api/orders — create draft order
// GET  /api/orders — list orders (staff: all, b2b: own only)

import type { APIRoute } from 'astro';
import { createOrder } from '../../../lib/order-service';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const GET: APIRoute = async ({ locals, request, url }) => {
  const userType = locals.userType || 'unknown';
  if (userType === 'unknown') {
    return new Response(JSON.stringify({ error: '未登入' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const serviceKey =
    import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  // items:inari_customer_order_items(*) — PostgREST embed 用 FK(order_id) 拎返明細,
  // 07-23修:呢個embed之前一直冇做,orders.astro/account/index.astro 兩個頁面早已寫好讀
  // `o.items`/`o.total_amount` 嘅render code,但API從未提供過,一直顯示空/MOP 0。
  let ordersUrl = `${SUPABASE_URL}/rest/v1/inari_customer_orders?tenant_id=eq.${TENANT_ID}&order=created_at.desc&limit=${limit}&select=*,items:inari_customer_order_items(*)`;

  // B2B/B2C: only own orders
  if (userType !== 'staff' && locals.customerCode) {
    ordersUrl += `&customer_code=eq.${encodeURIComponent(locals.customerCode)}`;
  }

  const resp = await fetch(ordersUrl, { headers: sbHeaders(serviceKey) });
  const orders = resp.ok ? await resp.json() : [];

  return new Response(JSON.stringify({ orders }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const userType = locals.userType || 'unknown';
  if (userType === 'unknown') {
    return new Response(JSON.stringify({ error: '未登入' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const serviceKey =
    import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const body = await request.json();

  // 只有 staff/manager 先可代客戶指定 customer_code;B2B/B2C 客戶一律鎖死自己 session 個 code,
  // 忽略 client 傳嘅值(否則可冒名幫別家客戶落單=IDOR 寫入)。
  const isStaff = userType === 'staff' || userType === 'manager';
  const customerCode = (isStaff && body.customer_code) ? body.customer_code : (locals.customerCode || 'UNKNOWN');
  const customerName = (isStaff && body.customer_name) ? body.customer_name : customerCode;
  const orderDate = body.order_date;
  const items = body.items || [];
  const rawText = body.raw_text || '';
  const source = body.source || 'web';

  if (items.length === 0) {
    return new Response(JSON.stringify({ error: '訂單明細不能為空' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const result = await createOrder({
    serviceKey,
    orderType: 'b2b',
    customerCode,
    customerName,
    items: items.map((item: Record<string, unknown>) => ({
      productId: item.product_id,
      productCode: item.product_code,
      productName: item.product_name || item.raw,
      rawText: item.raw,
      qty: item.qty,
      unit: item.suggested_unit || item.unit,
      unitPrice: item.suggested_price || item.unit_price,
      matchConfidence: item.match_confidence,
    })),
    orderDate,
    source,
    rawText,
    paymentMethod: body.payment_method,
    deliveryDate: body.delivery_date,
    notes: body.notes,
  });

  if (!result.ok && result.stage === 'header') {
    return new Response(JSON.stringify({ error: '建立訂單失敗', detail: result.detail }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (!result.ok) {
    return new Response(
      JSON.stringify({ error: '訂單明細建立失敗，請重新落單或聯絡客服' }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, order_no: result.orderNo, order_id: result.orderId }),
    { status: 201, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  );
};
