// GET /api/admin/orders?date=&status=&customer=&limit=200
// Staff and manager only — returns orders with embedded items and computed total

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

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const GET: APIRoute = async ({ locals, url }) => {
  const userType = locals.userType || '';
  if (userType !== 'staff' && userType !== 'manager') {
    return json({ error: '無權限' }, 401);
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const date = url.searchParams.get('date') || '';
  const status = url.searchParams.get('status') || '';
  const customer = url.searchParams.get('customer') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500);

  let q =
    `${SUPABASE_URL}/rest/v1/inari_customer_orders` +
    `?tenant_id=eq.${TENANT_ID}` +
    `&order=created_at.desc&limit=${limit}` +
    `&select=id,order_no,customer_code,customer_name,status,order_date,source,` +
    `payment_method,delivery_date,notes,created_at,confirmed_at,` +
    `inari_customer_order_items(id,product_code,product_name,qty,unit,unit_price,amount,match_confidence)`;

  if (date) q += `&order_date=eq.${encodeURIComponent(date)}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  if (customer) q += `&customer_name=ilike.${encodeURIComponent('*' + customer + '*')}`;

  const resp = await fetch(q, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    return json({ error: await resp.text() }, 500);
  }

  const raw: any[] = await resp.json();

  // Compute total_amount from items (column doesn't exist on orders table)
  const orders = raw.map(o => ({
    ...o,
    total_amount: (o.inari_customer_order_items || []).reduce(
      (s: number, i: any) => s + (i.amount || 0),
      0
    ),
  }));

  return json({ orders });
};
