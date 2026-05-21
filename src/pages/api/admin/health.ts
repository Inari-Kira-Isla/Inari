// GET /api/admin/health — manager-only system health check
// Phase 1 Day 3.2 — 2026-05-21
// Total budget: 5s; each check 1.5-2s with Promise.race timeout.

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

interface CheckResult {
  status: 'ok' | 'degraded' | 'fail';
  latency_ms?: number;
  detail?: string;
  data?: any;
}

async function check(label: string, ms: number, fn: () => Promise<any>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const data = await withTimeout(fn(), ms);
    return { status: 'ok', latency_ms: Date.now() - start, data };
  } catch (e) {
    return {
      status: 'fail',
      latency_ms: Date.now() - start,
      detail: (e as Error).message,
    };
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
    return new Response(
      JSON.stringify({
        ok: false,
        timestamp: new Date().toISOString(),
        checks: { config: { status: 'fail', detail: 'no SUPABASE key' } },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const headers = sbHeaders(key);
  const t0 = Date.now();

  // Run all checks in parallel
  const [
    dbPing,
    qbSales,
    products,
    orders,
    mvs,
    analyticsCache,
  ] = await Promise.all([
    // 1. DB ping — fetch a single row from a small table
    check('db', 1500, async () => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/inari_users?select=id&limit=1`,
        { headers },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    }),

    // 2. qb_sales reachability (via mv_monthly_summary, never scan raw table)
    check('qb_sales', 2000, async () => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/mv_monthly_summary?select=yr_mo,revenue&order=yr.desc,mo.desc&limit=1`,
        { headers },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json();
      return { latest_month: rows[0]?.yr_mo || null, revenue: rows[0]?.revenue || 0 };
    }),

    // 3. inari_products count
    check('inari_products', 1500, async () => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/inari_products?select=id&limit=1`,
        { headers: { ...headers, Prefer: 'count=exact' } },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const count = parseInt(r.headers.get('content-range')?.split('/')[1] || '0');
      return { count };
    }),

    // 4. inari_customer_orders + drafts
    check('inari_customer_orders', 1500, async () => {
      const [allResp, draftResp] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/inari_customer_orders?select=id&limit=1`, {
          headers: { ...headers, Prefer: 'count=exact' },
        }),
        fetch(`${SUPABASE_URL}/rest/v1/inari_customer_orders?status=eq.draft&select=id&limit=1`, {
          headers: { ...headers, Prefer: 'count=exact' },
        }),
      ]);
      const total = parseInt(allResp.headers.get('content-range')?.split('/')[1] || '0');
      const drafts = parseInt(draftResp.headers.get('content-range')?.split('/')[1] || '0');
      return { count: total, drafts };
    }),

    // 5. MV freshness — query pg_stat_user_tables via RPC if available,
    //    otherwise just confirm the MVs return data
    check('mvs', 2000, async () => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/mv_yearly_summary?select=yr&order=yr.desc&limit=1`,
        { headers },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json();
      return { latest_year_in_mv: rows[0]?.yr || null };
    }),

    // 6. analytics_cache health — count of non-expired keys
    check('analytics_cache', 1500, async () => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/analytics_cache?select=cache_key&expires_at=gt.${new Date().toISOString()}`,
        { headers: { ...headers, Prefer: 'count=exact' } },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const count = parseInt(r.headers.get('content-range')?.split('/')[1] || '0');
      return { fresh_entries: count };
    }),
  ]);

  const total_latency = Date.now() - t0;
  const failures = [dbPing, qbSales, products, orders, mvs, analyticsCache].filter(
    c => c.status !== 'ok',
  );
  const ok = failures.length === 0;

  return new Response(
    JSON.stringify({
      ok,
      timestamp: new Date().toISOString(),
      total_latency_ms: total_latency,
      checks: {
        db: dbPing,
        qb_sales: qbSales,
        inari_products: products,
        inari_customer_orders: orders,
        mvs,
        analytics_cache: analyticsCache,
      },
      summary: ok
        ? 'All systems operational'
        : `${failures.length}/6 checks failed`,
    }),
    {
      status: ok ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
};
