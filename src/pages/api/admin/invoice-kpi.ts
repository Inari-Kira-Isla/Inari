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
      // v2：改讀 v_kpi_summary 單行 view（口徑#2 未收+partial、真逾期按真實收款排期、Asia/Macau）。
      // 修正舊版 3 個錯：①sumQuery client-side 加總撞 PostgREST 1000 行封頂致本月開單少報
      //                  ②逾期靠 days_overdue（全表=0）永遠 0  ③未收漏 partial。
      'inari:invoice-kpi:v2',
      'inari_analytics',
      CACHE_TTL_SEC,
      async () => {
        const rows = await withTimeout(
          fetch(`${SUPABASE_URL}/rest/v1/v_kpi_summary`, { headers }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          }),
          4000,
        );
        const k = (rows && rows[0]) || {};
        const n = (v: any) => Number(v) || 0;
        return {
          today_amount: n(k.today_billed),
          mtd_amount: n(k.mtd_billed),
          unpaid_count: n(k.unpaid_count),
          unpaid_amount: n(k.outstanding_total),
          overdue_count: n(k.overdue_count),
          overdue_amount: n(k.overdue_amount),
          due_this_month: n(k.due_this_month),
          latest_invoice_date: k.latest_invoice_date || null,
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
