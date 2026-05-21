// GET /api/admin/sales/monthly?months=24
// Source: mv_monthly_summary (qb_sales 10-year history). Manager-only.
// 6h analytics_cache wrapped.

import type { APIRoute } from 'astro';
import { cachedQuery } from '../../../../lib/cache';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const CACHE_TTL_SEC = 6 * 3600; // 6h

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

  const months = Math.min(parseInt(url.searchParams.get('months') || '24'), 120);
  const force = url.searchParams.get('force') === '1';

  try {
    const result = await cachedQuery(
      `sales:monthly:${months}`,
      'sales',
      CACHE_TTL_SEC,
      async () => {
        const resp = await withTimeout(
          fetch(
            `${SUPABASE_URL}/rest/v1/mv_monthly_summary` +
              `?select=yr,mo,yr_mo,revenue,orders,customers,skus,avg_order_value,return_amount` +
              `&order=yr.desc,mo.desc&limit=${months}`,
            { headers: sbHeaders(key) },
          ),
          3000,
        );
        if (!resp.ok) throw new Error(`DB error: ${await resp.text()}`);
        const rows: any[] = await resp.json();
        return rows.slice().reverse().map(r => ({
          month: r.yr_mo,
          year: r.yr,
          revenue: Number(r.revenue) || 0,
          orders: Number(r.orders) || 0,
          customers: Number(r.customers) || 0,
          skus: Number(r.skus) || 0,
          avg_order_value: Number(r.avg_order_value) || 0,
        }));
      },
      { force },
    );

    return new Response(
      JSON.stringify({
        items: result.data,
        source: 'mv_monthly_summary',
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
