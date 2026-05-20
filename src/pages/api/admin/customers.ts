// GET /api/admin/customers — manager only
// Aggregates customer data from inari_customer_orders

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403 });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const search = url.searchParams.get('q') || '';

  // Fetch all orders to aggregate per customer
  let ordersUrl =
    `${SUPABASE_URL}/rest/v1/inari_customer_orders` +
    `?tenant_id=eq.${TENANT_ID}` +
    `&select=customer_code,customer_name,status,total_amount,created_at,order_date` +
    `&order=created_at.desc&limit=2000`;

  const resp = await fetch(ordersUrl, { headers: sbHeaders(key) });
  if (!resp.ok) {
    return new Response(JSON.stringify({ error: 'DB error' }), { status: 500 });
  }
  const orders: Array<{
    customer_code: string;
    customer_name: string;
    status: string;
    total_amount: number | null;
    created_at: string;
    order_date: string;
  }> = await resp.json();

  // Aggregate per customer
  const map = new Map<string, {
    customer_code: string;
    customer_name: string;
    order_count: number;
    total_amount: number;
    last_order: string;
    draft_count: number;
  }>();

  for (const o of orders) {
    const code = o.customer_code || 'UNKNOWN';
    if (!map.has(code)) {
      map.set(code, {
        customer_code: code,
        customer_name: o.customer_name || code,
        order_count: 0,
        total_amount: 0,
        last_order: o.created_at,
        draft_count: 0,
      });
    }
    const c = map.get(code)!;
    c.order_count++;
    c.total_amount += o.total_amount || 0;
    if (o.created_at > c.last_order) c.last_order = o.created_at;
    if (o.status === 'draft') c.draft_count++;
  }

  let customers = Array.from(map.values())
    .sort((a, b) => b.total_amount - a.total_amount);

  if (search) {
    const q = search.toLowerCase();
    customers = customers.filter(
      c => c.customer_code.toLowerCase().includes(q) ||
           c.customer_name.toLowerCase().includes(q)
    );
  }

  return new Response(
    JSON.stringify({ customers, total: customers.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
