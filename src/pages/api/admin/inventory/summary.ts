// GET /api/admin/inventory/summary — manager+staff
// Source: v_inventory_summary (SKU-level rollup of active lots)
// 30s analytics_cache TTL

import type { APIRoute } from 'astro';
import { cachedQuery } from '../../../../lib/cache';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';
const CACHE_TTL_SEC = 30;

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500 });

  const force = url.searchParams.get('force') === '1';
  const q = url.searchParams.get('q') || '';

  try {
    const result = await cachedQuery(
      `inventory:summary:${q}`,
      'inari_analytics',
      CACHE_TTL_SEC,
      async () => {
        let qs = `?tenant_id=eq.${TENANT_ID}&order=days_until_earliest_expiry.asc.nullslast`;
        if (q) {
          const pat = encodeURIComponent('*' + q + '*');
          qs += `&or=(sku.ilike.${pat},product_name.ilike.${pat})`;
        }
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/v_inventory_summary${qs}`,
          { headers: sbHeaders(key) },
        );
        if (!resp.ok) throw new Error(`DB error: ${await resp.text()}`);
        return await resp.json();
      },
      { force },
    );

    return new Response(
      JSON.stringify({
        items: result.data,
        cache: { hit: result.cached, age_sec: result.cacheAge, status: result.source },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '查詢失敗', detail: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
