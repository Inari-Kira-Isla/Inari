import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' },
  });

export const GET: APIRoute = async ({ locals, params }) => {
  if (locals.userType !== 'staff' && locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = params;

  const custResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customers` +
    `?id=eq.${id}&tenant_id=eq.${TENANT_ID}` +
    `&select=id,customer_code,customer_name,group_name,business_type,payment_type,` +
    `payment_terms_days,credit_limit,salesperson,is_active,status,due_date,collection_method`,
    { headers: sbHeaders(key) }
  );

  if (!custResp.ok) {
    return new Response(JSON.stringify({ error: 'DB error', detail: await custResp.text() }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const customers = await custResp.json();
  if (!customers.length) {
    return new Response(JSON.stringify({ error: '找不到客戶' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const customer = customers[0];

  const ordersResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders` +
    `?customer_code=eq.${encodeURIComponent(customer.customer_code)}&tenant_id=eq.${TENANT_ID}` +
    `&select=id,order_no,status,order_date,created_at,inari_customer_order_items(id,amount)` +
    `&order=created_at.desc&limit=50`,
    { headers: sbHeaders(key) }
  );

  let orders: any[] = [];
  if (ordersResp.ok) {
    const raw = await ordersResp.json();
    orders = raw.map((o: any) => {
      const items: any[] = o.inari_customer_order_items || [];
      const total_amount = items.reduce((s: number, i: any) => s + (i.amount || 0), 0);
      const { inari_customer_order_items: _items, ...rest } = o;
      return { ...rest, total_amount };
    });
  }

  const total_orders = orders.length;
  const total_amount = orders.reduce((s, o) => s + o.total_amount, 0);
  const avg_order_amount = total_orders > 0 ? total_amount / total_orders : 0;
  const last_order_date = orders.length > 0 ? orders[0].created_at : null;
  const draft_count = orders.filter(o => o.status === 'draft').length;

  return new Response(
    JSON.stringify({
      customer,
      orders,
      stats: { total_orders, total_amount, avg_order_amount, last_order_date, draft_count },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
