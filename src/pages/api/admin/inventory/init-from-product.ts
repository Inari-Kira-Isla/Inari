// POST /api/admin/inventory/init-from-product — manager+staff
// Body: { sku, expiry_date?, storage_location? }
// Converts inari_products.on_hand → opening lot via RPC.

import type { APIRoute } from 'astro';
import { invalidateCache } from '../../../../lib/cache';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const POST: APIRoute = async ({ locals, request }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500 });

  const body = await request.json().catch(() => null);
  if (!body || !body.sku) {
    return new Response(JSON.stringify({ error: '缺 sku' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const rpcBody = {
    p_tenant_id: TENANT_ID,
    p_sku: String(body.sku),
    p_expiry_date: body.expiry_date || null,
    p_storage_location: body.storage_location || null,
    p_user: locals.username || 'admin',
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/inventory_init_from_product`, {
    method: 'POST',
    headers: sbHeaders(key),
    body: JSON.stringify(rpcBody),
  });

  const text = await resp.text();
  if (!resp.ok) {
    let detail = text;
    try { detail = JSON.parse(text).message || text; } catch {}
    return new Response(JSON.stringify({ error: detail }), {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  void invalidateCache(`inventory:summary:`);
  return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
};
