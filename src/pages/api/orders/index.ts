// POST /api/orders — create draft order
// GET  /api/orders — list orders (staff: all, b2b: own only)

import type { APIRoute } from 'astro';

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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function generateOrderNo(customerCode: string | null) {
  const d = new Date();
  const datePart = d.toISOString().slice(0, 10).replace(/-/g, '');
  const raw = (customerCode || 'STA').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const code = (raw.slice(0, 4) || 'STA') + Math.random().toString(36).slice(2, 4).toUpperCase();
  return `ORD-${datePart}-${code}`;
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
  const orderDate = body.order_date || todayStr();
  const items = body.items || [];
  const rawText = body.raw_text || '';
  const source = body.source || 'web';

  if (items.length === 0) {
    return new Response(JSON.stringify({ error: '訂單明細不能為空' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const orderNo = generateOrderNo(customerCode);
  const headers = sbHeaders(serviceKey);

  // Insert order header
  const orderPayload: Record<string, unknown> = {
    order_no: orderNo,
    customer_code: customerCode,
    customer_name: customerName,
    order_date: orderDate,
    source,
    status: 'draft',
    raw_text: rawText,
    tenant_id: TENANT_ID,
    ...(body.payment_method ? { payment_method: body.payment_method } : {}),
    ...(body.delivery_date ? { delivery_date: body.delivery_date } : {}),
    ...(body.notes ? { notes: body.notes } : {}),
  };

  const orderResp = await fetch(`${SUPABASE_URL}/rest/v1/inari_customer_orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(orderPayload),
  });

  if (!orderResp.ok) {
    const errText = await orderResp.text();
    return new Response(JSON.stringify({ error: '建立訂單失敗', detail: errText }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const [newOrder] = await orderResp.json();
  const orderId = newOrder.id;

  // Insert order items
  const itemPayloads = items.map((item: Record<string, unknown>) => {
    const qty = item.qty || 0;
    const unit_price = item.suggested_price || item.unit_price || null;
    return {
      order_id: orderId,
      order_no: orderNo,
      product_id: item.product_id || null,
      product_code: item.product_code || null,
      product_name: item.product_name || item.raw || null,
      raw_text: item.raw || null,
      qty,
      unit: item.suggested_unit || item.unit || null,
      unit_price,
      match_confidence: item.match_confidence || 'unmatched',
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
    console.error('Items insert failed:', errText);
  }

  return new Response(
    JSON.stringify({ ok: true, order_no: orderNo, order_id: orderId }),
    { status: 201, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  );
};
