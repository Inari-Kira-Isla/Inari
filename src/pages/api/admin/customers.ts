// GET /api/admin/customers — manager only
// 2026-05-21 rewrite: reads v_customer_with_web_stats (single query,
// pre-aggregated). Replaces the JS join that read 5K orders + 20K items.

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

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
  if (!key) {
    return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const search = url.searchParams.get('q') || '';
  const statusFilter = url.searchParams.get('status') || ''; // 'active' | 'inactive' | ''

  // Build query against the view (server-side filter pushdown)
  let q =
    `${SUPABASE_URL}/rest/v1/v_customer_with_web_stats` +
    `?tenant_id=eq.${TENANT_ID}` +
    `&order=customer_code.asc&limit=500`;

  if (statusFilter === 'active') q += `&is_active=eq.true`;
  if (statusFilter === 'inactive') q += `&is_active=eq.false`;

  if (search) {
    const pat = encodeURIComponent('*' + search + '*');
    // PostgREST OR filter — trigram indexes cover name/code search
    q += `&or=(customer_code.ilike.${pat},customer_name.ilike.${pat},group_name.ilike.${pat})`;
  }

  try {
    const resp = await withTimeout(fetch(q, { headers: sbHeaders(key) }), 5000);
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'DB error', detail: await resp.text() }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const customers: any[] = await resp.json();

    return new Response(JSON.stringify({ customers, total: customers.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '查詢逾時或失敗', detail: (e as Error).message }),
      { status: 504, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
