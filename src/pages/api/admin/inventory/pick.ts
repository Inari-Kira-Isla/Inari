// POST /api/admin/inventory/pick — manager+staff
// Body: { sku, qty, reference_type?, reference_id?, reference_no?, notes?,
//         idempotency_key? }
// Calls RPC inventory_pick_fefo.

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
  if (!body) {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    sku, qty,
    reference_type, reference_id, reference_no,
    notes, idempotency_key,
  } = body;

  if (!sku || !qty) {
    return new Response(JSON.stringify({ error: '缺必填欄位（sku, qty）' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rpcBody = {
    p_tenant_id: TENANT_ID,
    p_sku: String(sku),
    p_qty: Number(qty),
    p_reference_type: reference_type || null,
    p_reference_id: reference_id || null,
    p_reference_no: reference_no || null,
    p_notes: notes || null,
    p_user: locals.username || 'admin',
    p_idempotency_key: idempotency_key || null,
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/inventory_pick_fefo`, {
    method: 'POST',
    headers: sbHeaders(key),
    body: JSON.stringify(rpcBody),
  });

  const text = await resp.text();
  if (!resp.ok) {
    let detail = text;
    let status = resp.status;
    try {
      const obj = JSON.parse(text);
      detail = obj.message || text;
      if (detail.includes('Insufficient stock')) status = 422;
    } catch {}
    return new Response(
      JSON.stringify({ error: detail }),
      { status, headers: { 'Content-Type': 'application/json' } },
    );
  }

  void invalidateCache(`inventory:summary:`);
  // Sync legacy on_hand mirror (best-effort, non-fatal on failure).
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/recalc_on_hand`, {
      method: 'POST',
      headers: sbHeaders(key),
      body: JSON.stringify({
        p_tenant_id: TENANT_ID,
        p_sku: body.sku,
      }),
    });
  } catch (e) {
    console.warn('[recalc_on_hand] failed (non-fatal):', e);
  }
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
