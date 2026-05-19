// GET /api/admin/orders?date=&status=&customer=&limit=50
// Staff and manager only

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

export const GET: APIRoute = async ({ locals, url }) => {
  const userType = locals.userType || '';
  if (userType !== 'staff' && userType !== 'manager') {
    return json({ error: '無權限' }, 401);
  }

  const serviceKey =
    import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const date = url.searchParams.get('date') || '';
  const status = url.searchParams.get('status') || '';
  const customer = url.searchParams.get('customer') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  let q = `${SUPABASE_URL}/rest/v1/inari_customer_orders?tenant_id=eq.${TENANT_ID}&order=created_at.desc&limit=${limit}&select=*,inari_customer_order_items(*)`;
  if (date) q += `&order_date=eq.${encodeURIComponent(date)}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  if (customer) q += `&customer_name=ilike.${encodeURIComponent('*' + customer + '*')}`;

  const resp = await fetch(q, { headers: sbHeaders(serviceKey) });
  const orders = resp.ok ? await resp.json() : [];
  return json({ orders });
};
