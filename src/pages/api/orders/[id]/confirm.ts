// PATCH /api/orders/[id]/confirm — confirm a draft order

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
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

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const PATCH: APIRoute = async ({ locals, request, params }) => {
  const userType = locals.userType || 'unknown';
  if (userType === 'unknown') {
    return json({ error: '未登入' }, 401);
  }

  const id = params.id;
  const serviceKey =
    import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const headers = sbHeaders(serviceKey);
  const orderUrl = `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${encodeURIComponent(id!)}&tenant_id=eq.${TENANT_ID}&select=*`;

  const orderResp = await fetch(orderUrl, { headers });
  if (!orderResp.ok) {
    return json({ error: '讀取訂單失敗', detail: await orderResp.text() }, 500);
  }

  const [order] = await orderResp.json();
  if (!order) {
    return json({ error: '訂單不存在' }, 404);
  }

  // 07-21 Joe拍板：客戶落單後必須人手核對先可以「確認」（開單前把關），
  // 呢個endpoint唔再准客戶自己confirm自己張單——只留staff/manager用（同 /api/admin/orders/[id] 同一套授權）。
  const isStaff = userType === 'staff' || userType === 'manager';
  if (!isStaff) {
    return json({ error: '訂單需由職員人手確認，客戶不可自行確認' }, 403);
  }

  if (order.status !== 'draft') {
    return json({ error: '訂單不是草稿狀態' }, 400);
  }

  const body = await parseBody(request);
  const updatePayload = {
    status: 'confirmed',
    payment_method: body.payment_method || null,
    delivery_date: body.delivery_date || null,
    notes: body.notes || null,
    confirmed_at: new Date().toISOString(),
  };

  const updateResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders?id=eq.${encodeURIComponent(id!)}&status=eq.draft&tenant_id=eq.${TENANT_ID}`,
    { method: 'PATCH', headers, body: JSON.stringify(updatePayload) }
  );

  if (!updateResp.ok) {
    return json({ error: '確認訂單失敗', detail: await updateResp.text() }, 500);
  }

  const [updated] = await updateResp.json();
  if (!updated) {
    return json({ error: '訂單不是草稿狀態' }, 400);
  }

  return json({ ok: true, order_no: updated.order_no, status: 'confirmed' });
};
