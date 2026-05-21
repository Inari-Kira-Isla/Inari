// GET /api/admin/sales/top-products?year=2026&limit=20
// Source: RPC top_products_by_year(p_year, limit_n) over qb_sales. Manager-only.
// 6h analytics_cache wrapped.

import type { APIRoute } from 'astro';
import { cachedQuery } from '../../../../lib/cache';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const CACHE_TTL_SEC = 6 * 3600;

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
  const force = url.searchParams.get('force') === '1';

  try {
    const result = await cachedQuery(
      `sales:top-products:${year}:${limit}`,
      'sales',
      CACHE_TTL_SEC,
      async () => {
        const resp = await withTimeout(
          fetch(`${SUPABASE_URL}/rest/v1/rpc/top_products_by_year`, {
            method: 'POST',
            headers: sbHeaders(key),
            body: JSON.stringify({ p_year: year, limit_n: limit }),
          }),
          5000,
        );
        if (!resp.ok) throw new Error(`DB error: ${await resp.text()}`);
        const rows: any[] = await resp.json();
        return rows.map(r => ({
          code: r.item_code,
          name: r.item_name,
          revenue: Number(r.revenue) || 0,
          orders: Number(r.orders) || 0,
          customers: Number(r.customers) || 0,
          pct_of_year: Number(r.pct_of_year) || 0,
        }));
      },
      { force },
    );

    return new Response(
      JSON.stringify({
        items: result.data,
        year,
        source: 'qb_sales via top_products_by_year RPC',
        cache: { hit: result.cached, age_sec: result.cacheAge, status: result.source },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '查詢逾時', detail: (e as Error).message }),
      { status: 504, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
