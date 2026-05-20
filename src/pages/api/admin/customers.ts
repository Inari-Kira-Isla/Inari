// GET /api/admin/customers — manager only
// Primary source: inari_customers (197 records)
// Merged with web order stats from inari_customer_orders

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
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

  const search = url.searchParams.get('q') || '';
  const statusFilter = url.searchParams.get('status') || '';  // 'active' | 'inactive' | ''

  // Fetch customers + orders + order items in parallel
  const baseCustomers =
    `${SUPABASE_URL}/rest/v1/inari_customers` +
    `?tenant_id=eq.${TENANT_ID}` +
    `&select=id,customer_code,customer_name,group_name,business_type,payment_type,` +
    `payment_terms_days,credit_limit,salesperson,is_active,status,due_date,collection_method` +
    `&order=customer_code.asc&limit=500`;

  const [custResp, ordersResp, itemsResp] = await Promise.all([
    fetch(baseCustomers, { headers: sbHeaders(key) }),
    fetch(
      `${SUPABASE_URL}/rest/v1/inari_customer_orders` +
      `?tenant_id=eq.${TENANT_ID}` +
      `&select=id,customer_code,status,created_at` +
      `&order=created_at.desc&limit=5000`,
      { headers: sbHeaders(key) }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/inari_customer_order_items` +
      `?tenant_id=eq.${TENANT_ID}` +
      `&select=order_id,amount&limit=20000`,
      { headers: sbHeaders(key) }
    ),
  ]);

  if (!custResp.ok) {
    return new Response(JSON.stringify({ error: 'DB error', detail: await custResp.text() }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const customers: Array<{
    id: number;
    customer_code: string;
    customer_name: string;
    group_name: string | null;
    business_type: string | null;
    payment_type: string | null;
    payment_terms_days: number | null;
    credit_limit: number | null;
    salesperson: string | null;
    is_active: boolean;
    status: string | null;
    due_date: string | null;
    collection_method: string | null;
  }> = await custResp.json();

  // Build order amount map
  const orderAmounts = new Map<number, number>();
  if (itemsResp.ok) {
    const items: Array<{ order_id: number; amount: number | null }> = await itemsResp.json();
    for (const item of items) {
      orderAmounts.set(item.order_id, (orderAmounts.get(item.order_id) || 0) + (item.amount || 0));
    }
  }

  // Aggregate web orders per customer_code
  const orderStats = new Map<string, { order_count: number; total_amount: number; last_order: string; draft_count: number }>();
  if (ordersResp.ok) {
    const orders: Array<{ id: number; customer_code: string; status: string; created_at: string }> = await ordersResp.json();
    for (const o of orders) {
      const code = o.customer_code;
      if (!orderStats.has(code)) {
        orderStats.set(code, { order_count: 0, total_amount: 0, last_order: o.created_at, draft_count: 0 });
      }
      const s = orderStats.get(code)!;
      s.order_count++;
      s.total_amount += orderAmounts.get(o.id) || 0;
      if (o.created_at > s.last_order) s.last_order = o.created_at;
      if (o.status === 'draft') s.draft_count++;
    }
  }

  // Merge
  let result = customers.map(c => {
    const stats = orderStats.get(c.customer_code);
    return {
      ...c,
      web_order_count: stats?.order_count || 0,
      web_total_amount: stats?.total_amount || 0,
      last_web_order: stats?.last_order || null,
      web_draft_count: stats?.draft_count || 0,
    };
  });

  // Filter
  if (statusFilter === 'active') result = result.filter(c => c.is_active);
  if (statusFilter === 'inactive') result = result.filter(c => !c.is_active);

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(c =>
      c.customer_code.toLowerCase().includes(q) ||
      (c.customer_name || '').toLowerCase().includes(q) ||
      (c.group_name || '').toLowerCase().includes(q)
    );
  }

  return new Response(JSON.stringify({ customers: result, total: result.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
