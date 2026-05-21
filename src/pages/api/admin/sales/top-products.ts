// GET /api/admin/sales/top-products?year=2026&limit=20
// Source: RPC top_products_by_year(p_year, limit_n) over qb_sales. Manager-only.

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500 });

  const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()));
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

  try {
    const resp = await withTimeout(
      fetch(`${SUPABASE_URL}/rest/v1/rpc/top_products_by_year`, {
        method: 'POST',
        headers: sbHeaders(key),
        body: JSON.stringify({ p_year: year, limit_n: limit }),
      }),
      5000,
    );
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'DB error', detail: await resp.text() }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const rows: any[] = await resp.json();
    const items = rows.map(r => ({
      code: r.item_code,
      name: r.item_name,
      revenue: Number(r.revenue) || 0,
      orders: Number(r.orders) || 0,
      customers: Number(r.customers) || 0,
      pct_of_year: Number(r.pct_of_year) || 0,
    }));
    return new Response(JSON.stringify({ items, year, source: 'qb_sales via top_products_by_year RPC' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '查詢逾時', detail: (e as Error).message }),
      { status: 504, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
