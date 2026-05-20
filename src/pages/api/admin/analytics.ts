// GET /api/admin/analytics — manager only
// Returns: monthly revenue (6 months), top 10 products, customer activity summary

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const GET: APIRoute = async ({ locals }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403 });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;

  // Fetch last 6 months of orders (non-cancelled)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const since = sixMonthsAgo.toISOString().slice(0, 10);

  const [ordersResp, itemsResp] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/inari_customer_orders` +
      `?tenant_id=eq.${TENANT_ID}&status=neq.cancelled&order_date=gte.${since}` +
      `&select=order_date,total_amount,status,customer_code&limit=2000`,
      { headers: sbHeaders(key) }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/inari_customer_order_items` +
      `?tenant_id=eq.${TENANT_ID}&select=product_name,product_code,qty,unit_price&limit=5000`,
      { headers: sbHeaders(key) }
    ),
  ]);

  const orders: Array<{ order_date: string; total_amount: number | null; status: string; customer_code: string }> =
    ordersResp.ok ? await ordersResp.json() : [];

  const items: Array<{ product_name: string | null; product_code: string | null; qty: number | null; unit_price: number | null }> =
    itemsResp.ok ? await itemsResp.json() : [];

  // Monthly revenue (last 6 months)
  const monthMap = new Map<string, { revenue: number; order_count: number }>();
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap.set(key, { revenue: 0, order_count: 0 });
  }
  for (const o of orders) {
    const month = o.order_date?.slice(0, 7);
    if (month && monthMap.has(month)) {
      const m = monthMap.get(month)!;
      m.revenue += o.total_amount || 0;
      m.order_count++;
    }
  }
  const monthly = Array.from(monthMap.entries()).map(([month, data]) => ({ month, ...data }));

  // Top 10 products by revenue
  const prodMap = new Map<string, { name: string; code: string; qty: number; revenue: number }>();
  for (const item of items) {
    const code = item.product_code || item.product_name || 'UNKNOWN';
    const name = item.product_name || code;
    if (!prodMap.has(code)) {
      prodMap.set(code, { name, code, qty: 0, revenue: 0 });
    }
    const p = prodMap.get(code)!;
    p.qty += item.qty || 0;
    p.revenue += (item.qty || 0) * (item.unit_price || 0);
  }
  const top_products = Array.from(prodMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Customer activity
  const custSet = new Set(orders.map(o => o.customer_code).filter(Boolean));
  const activeCustomers = custSet.size;
  const totalRevenue = orders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const confirmedOrders = orders.filter(o => o.status === 'confirmed' || o.status === 'invoiced').length;

  return new Response(
    JSON.stringify({ monthly, top_products, activeCustomers, totalRevenue, confirmedOrders }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
