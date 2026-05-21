// GET /api/admin/inventory/lots — manager+staff
// Source: inari_inventory_lots (raw batch list)
// Query params: sku, status, expiring_in_days, q (SKU/name search), limit, offset

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

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

  const sku = url.searchParams.get('sku') || '';
  const status = url.searchParams.get('status') || 'active';
  const expiring = url.searchParams.get('expiring_in_days');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));

  let qs =
    `?tenant_id=eq.${TENANT_ID}` +
    `&select=*` +
    `&order=expiry_date.asc.nullslast,received_date.asc,id` +
    `&limit=${limit}&offset=${offset}`;

  if (status !== 'all') qs += `&status=eq.${status}`;
  if (sku) qs += `&sku=eq.${encodeURIComponent(sku)}`;
  if (expiring) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + parseInt(expiring));
    qs += `&expiry_date=lte.${cutoff.toISOString().slice(0, 10)}`;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inari_inventory_lots${qs}`, {
      headers: { ...sbHeaders(key), Prefer: 'count=exact' },
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'DB error', detail: await resp.text() }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const lots = await resp.json();
    const total = parseInt(resp.headers.get('content-range')?.split('/').pop() || '0');
    return new Response(
      JSON.stringify({ items: lots, total, limit, offset }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '查詢失敗', detail: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
