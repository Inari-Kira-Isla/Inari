// PATCH /api/admin/orders/:id — update order status
// Staff and manager only
// Transitions: draft→confirmed, confirmed→invoiced, draft|confirmed→cancelled

const SUPABASE_URL = "https://cqartwwsbxnjjatmndtt.supabase.co";
const TENANT_ID = "b15d5a02-764c-4353-ad40-07b901d9f321";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function sbHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function isAdmin(request) {
  const t = request.headers.get("X-User-Type") || "";
  return t === "staff" || t === "manager";
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPatch(context) {
  if (!isAdmin(context.request)) return json({ error: "無權限" }, 401);

  const serviceKey = context.env.SUPABASE_SERVICE_KEY || context.env.SUPABASE_ANON_KEY;
  const id = context.params.id;
  if (!id) return json({ error: "缺少訂單 ID" }, 400);

  let body = {};
  try { body = await context.request.json(); } catch {}
  const newStatus = body.status;

  if (!["confirmed", "invoiced", "cancelled"].includes(newStatus)) {
    return json({ error: "無效狀態" }, 400);
  }

  const getResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${TENANT_ID}&select=id,status,order_no`,
    { headers: sbHeaders(serviceKey) }
  );
  const [order] = getResp.ok ? await getResp.json() : [];
  if (!order) return json({ error: "訂單不存在" }, 404);

  if (order.status === "invoiced") return json({ error: "已開單訂單不可修改" }, 400);
  if (order.status === "cancelled") return json({ error: "已取消訂單不可修改" }, 400);
  if (newStatus === "invoiced" && order.status !== "confirmed") {
    return json({ error: "只有已確認訂單可標記開單" }, 400);
  }

  const patch = {
    status: newStatus,
    updated_at: new Date().toISOString(),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(newStatus === "confirmed" ? { confirmed_at: new Date().toISOString() } : {}),
  };

  const patchResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${TENANT_ID}`,
    { method: "PATCH", headers: sbHeaders(serviceKey), body: JSON.stringify(patch) }
  );
  if (!patchResp.ok) return json({ error: "更新失敗", detail: await patchResp.text() }, 500);

  const [updated] = await patchResp.json();
  return json({ ok: true, order_no: updated?.order_no || order.order_no, status: newStatus });
}
