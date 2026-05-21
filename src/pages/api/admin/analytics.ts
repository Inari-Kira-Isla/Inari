// GET /api/admin/analytics — manager only
// 2026-05-21 rewrite: reads materialized views (mv_monthly_summary / mv_yearly_summary)
// + RPC top_products_by_year for the full 10-year qb_sales history.
// Falls back to web orders only when MVs unreachable.

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)),
  ]);
}

async function safeJson<T>(p: Promise<Response>, fallback: T): Promise<T> {
  try {
    const r = await p;
    if (!r.ok) return fallback;
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

export const GET: APIRoute = async ({ locals }) => {
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
  const headers = sbHeaders(key);
  const year = new Date().getFullYear();

  // 6 months of mv_monthly_summary (last 12 actually — chart looks better)
  const monthlyPromise = withTimeout(
    fetch(
      `${SUPABASE_URL}/rest/v1/mv_monthly_summary?select=yr,mo,yr_mo,revenue,orders,customers,skus,avg_order_value&order=yr.desc,mo.desc&limit=12`,
      { headers },
    ),
    3000,
    'mv_monthly',
  );

  // Full yearly summary (≤ 12 rows)
  const yearlyPromise = withTimeout(
    fetch(
      `${SUPABASE_URL}/rest/v1/mv_yearly_summary?select=yr,revenue,orders,customers,skus,avg_order_value&order=yr.desc`,
      { headers },
    ),
    3000,
    'mv_yearly',
  );

  // Top 10 products this year via RPC (uses qb_sales 614K rows safely)
  const topPromise = withTimeout(
    fetch(`${SUPABASE_URL}/rest/v1/rpc/top_products_by_year`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_year: year, limit_n: 10 }),
    }),
    5000,
    'top_products',
  );

  const [monthlyRaw, yearlyRaw, topRaw] = await Promise.all([
    safeJson<any[]>(monthlyPromise, []),
    safeJson<any[]>(yearlyPromise, []),
    safeJson<any[]>(topPromise, []),
  ]);

  // Normalize to the shape the chart page expects
  const monthly = (monthlyRaw || [])
    .slice()
    .reverse() // oldest → newest for the chart
    .map((m: any) => ({
      month: m.yr_mo,
      revenue: Number(m.revenue) || 0,
      order_count: Number(m.orders) || 0,
      customers: Number(m.customers) || 0,
    }));

  const yearly = (yearlyRaw || []).map((y: any) => ({
    year: y.yr,
    revenue: Number(y.revenue) || 0,
    orders: Number(y.orders) || 0,
    customers: Number(y.customers) || 0,
  }));

  const top_products = (topRaw || []).map((p: any) => ({
    code: p.item_code,
    name: p.item_name,
    revenue: Number(p.revenue) || 0,
    qty: Number(p.orders) || 0,
    customers: Number(p.customers) || 0,
    pct: Number(p.pct_of_year) || 0,
  }));

  // KPI rollups derived from MVs (no need to scan orders)
  const last6Months = monthly.slice(-6);
  const totalRevenue = last6Months.reduce((s, m) => s + m.revenue, 0);
  const confirmedOrders = last6Months.reduce((s, m) => s + m.order_count, 0);
  const activeCustomers =
    last6Months.length > 0 ? Math.max(...last6Months.map(m => m.customers)) : 0;

  return new Response(
    JSON.stringify({
      monthly,
      yearly,
      top_products,
      activeCustomers,
      totalRevenue,
      confirmedOrders,
      source: 'mv_monthly_summary + mv_yearly_summary + top_products_by_year (qb_sales 10yr)',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
