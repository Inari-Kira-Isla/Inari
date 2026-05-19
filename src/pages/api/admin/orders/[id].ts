// PATCH /api/admin/orders/[id] — update order status
// Staff and manager only
// Transitions: draft→confirmed, confirmed→invoiced, draft|confirmed→cancelled

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

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

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  const userType = locals.userType || '';
  if (userType !== 'staff' && userType !== 'manager') {
    return json({ error: '無權限' }, 401);
  }

  const serviceKey =
    import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const id = params.id;
  if (!id) return json({ error: '缺少訂單 ID' }, 400);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {}
  const newStatus = body.status as string;

  if (!['confirmed', 'invoiced', 'cancelled'].includes(newStatus)) {
    return json({ error: '無效狀態' }, 400);
  }

  const getResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${TENANT_ID}&select=id,status,order_no`,
    { headers: sbHeaders(serviceKey) }
  );
  const orders: Record<string, unknown>[] = getResp.ok ? await getResp.json() : [];
  const order = orders[0];
  if (!order) return json({ error: '訂單不存在' }, 404);

  if (order.status === 'invoiced') return json({ error: '已開單訂單不可修改' }, 400);
  if (order.status === 'cancelled') return json({ error: '已取消訂單不可修改' }, 400);
  if (newStatus === 'invoiced' && order.status !== 'confirmed') {
    return json({ error: '只有已確認訂單可標記開單' }, 400);
  }

  const patch: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(newStatus === 'confirmed' ? { confirmed_at: new Date().toISOString() } : {}),
  };

  const patchResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${TENANT_ID}`,
    { method: 'PATCH', headers: sbHeaders(serviceKey), body: JSON.stringify(patch) }
  );
  if (!patchResp.ok) return json({ error: '更新失敗', detail: await patchResp.text() }, 500);

  const updated: Record<string, unknown>[] = await patchResp.json();
  return json({
    ok: true,
    order_no: updated?.[0]?.order_no || order.order_no,
    status: newStatus,
  });
};
