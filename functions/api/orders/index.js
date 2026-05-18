// POST /api/orders — create draft order
// GET  /api/orders — list orders (staff: all, b2b: own only)

const SUPABASE_URL = "https://cqartwwsbxnjjatmndtt.supabase.co";
const TENANT_ID = "b15d5a02-764c-4353-ad40-07b901d9f321";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sbHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function getUserContext(request) {
  return {
    user_type: request.headers.get("X-User-Type") || "unknown",
    username: request.headers.get("X-Username") || "",
    customer_code: request.headers.get("X-Customer-Code") || null,
    role: request.headers.get("X-User-Role") || "",
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function generateOrderNo(customerCode) {
  const d = new Date();
  const datePart = d.toISOString().slice(0, 10).replace(/-/g, "");
  const code = (customerCode || "UNK").toUpperCase().slice(0, 6);
  return `ORD-${datePart}-${code}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const ctx = getUserContext(context.request);
  if (ctx.user_type === "unknown") {
    return new Response(JSON.stringify({ error: "未登入" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const serviceKey = context.env.SUPABASE_SERVICE_KEY || context.env.SUPABASE_ANON_KEY;
  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

  let ordersUrl = `${SUPABASE_URL}/rest/v1/inari_customer_orders?tenant_id=eq.${TENANT_ID}&order=created_at.desc&limit=${limit}&select=*`;

  // B2B/B2C: only own orders
  if (ctx.user_type !== "staff" && ctx.customer_code) {
    ordersUrl += `&customer_code=eq.${encodeURIComponent(ctx.customer_code)}`;
  }

  const resp = await fetch(ordersUrl, { headers: sbHeaders(serviceKey) });
  const orders = resp.ok ? await resp.json() : [];

  return new Response(JSON.stringify({ orders }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const ctx = getUserContext(context.request);
  if (ctx.user_type === "unknown") {
    return new Response(JSON.stringify({ error: "未登入" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const serviceKey = context.env.SUPABASE_SERVICE_KEY || context.env.SUPABASE_ANON_KEY;
  const body = await context.request.json();

  const customerCode = body.customer_code || ctx.customer_code || "UNKNOWN";
  const orderDate = body.order_date || todayStr();
  const items = body.items || [];
  const rawText = body.raw_text || "";
  const source = body.source || "web";

  if (items.length === 0) {
    return new Response(JSON.stringify({ error: "訂單明細不能為空" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const orderNo = generateOrderNo(customerCode);
  const headers = sbHeaders(serviceKey);

  // Insert order header
  const orderPayload = {
    order_no: orderNo,
    customer_code: customerCode,
    customer_name: body.customer_name || customerCode,
    order_date: orderDate,
    source,
    status: "draft",
    raw_text: rawText,
    tenant_id: TENANT_ID,
    ...(body.payment_method ? { payment_method: body.payment_method } : {}),
    ...(body.delivery_date ? { delivery_date: body.delivery_date } : {}),
    ...(body.notes ? { notes: body.notes } : {}),
  };

  const orderResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders`,
    { method: "POST", headers, body: JSON.stringify(orderPayload) }
  );

  if (!orderResp.ok) {
    const errText = await orderResp.text();
    return new Response(JSON.stringify({ error: "建立訂單失敗", detail: errText }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const [newOrder] = await orderResp.json();
  const orderId = newOrder.id;

  // Insert order items
  const itemPayloads = items.map((item) => {
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
      amount: unit_price ? qty * unit_price : null,
      match_confidence: item.match_confidence || "unmatched",
      tenant_id: TENANT_ID,
    };
  });

  await fetch(`${SUPABASE_URL}/rest/v1/inari_customer_order_items`, {
    method: "POST",
    headers,
    body: JSON.stringify(itemPayloads),
  });

  return new Response(
    JSON.stringify({ ok: true, order_no: orderNo, order_id: orderId }),
    { status: 201, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}
