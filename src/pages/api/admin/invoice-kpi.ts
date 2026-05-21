// GET /api/admin/invoice-kpi — manager-only
// Returns dashboard KPIs from inari_daily_invoices (4,684 rows).
// 5 min cache.

import type { APIRoute } from 'astro';
import { cachedQuery } from '../../../lib/cache';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const CACHE_TTL_SEC = 5 * 60; // 5min — invoices update frequently

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

async function countQuery(url: string, headers: Record<string, string>): Promise<number> {
  const r = await fetch(url, { headers: { ...headers, Prefer: 'count=exact' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  await r.text();
  const cr = r.headers.get('content-range') || '0/0';
  return parseInt(cr.split('/').pop() || '0');
}

async function sumQuery(url: string, headers: Record<string, string>, field: string): Promise<number> {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows: any[] = await r.json();
  return rows.reduce((s, x) => s + (Number(x[field]) || 0), 0);
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

  const force = url.searchParams.get('force') === '1';
  const headers = sbHeaders(key);

  try {
    const result = await cachedQuery(
      'inari:invoice-kpi:v1',
      'inari_analytics',
      CACHE_TTL_SEC,
      async () => {
        const today = new Date().toISOString().slice(0, 10);
        const monthStart = today.slice(0, 8) + '01';

        // 4 parallel mini-queries — each scoped to a date range, very fast with idx_invoices_outstanding & date
        const [todayAmt, mtdAmt, unpaidCount, overdueCount] = await withTimeout(
          Promise.all([
            sumQuery(
              `${SUPABASE_URL}/rest/v1/inari_daily_invoices?invoice_date=eq.${today}&select=amount`,
              headers, 'amount',
            ),
            sumQuery(
              `${SUPABASE_URL}/rest/v1/inari_daily_invoices?invoice_date=gte.${monthStart}&select=amount`,
              headers, 'amount',
            ),
            countQuery(
              `${SUPABASE_URL}/rest/v1/inari_daily_invoices?status=eq.未收&select=id&limit=1`,
              headers,
            ),
            countQuery(
              `${SUPABASE_URL}/rest/v1/inari_daily_invoices?status=eq.未收&days_overdue=gt.0&select=id&limit=1`,
              headers,
            ),
          ]),
          4000,
        );

        return {
          today_amount: todayAmt,
          mtd_amount: mtdAmt,
          unpaid_count: unpaidCount,
          overdue_count: overdueCount,
          as_of: new Date().toISOString(),
        };
      },
      { force },
    );

    return new Response(
      JSON.stringify({
        ...result.data,
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
