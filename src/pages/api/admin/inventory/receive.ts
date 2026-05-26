// POST /api/admin/inventory/receive — manager+staff
// Body: { sku, lot_no, qty, unit_cost_mop, received_date?, expiry_date?,
//         storage_location?, quality_grade?, notes?, idempotency_key? }
// Calls RPC inventory_receive.

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
    sku, lot_no, qty, unit_cost_mop,
    received_date, expiry_date,
    storage_location, quality_grade, notes,
    idempotency_key,
  } = body;

  if (!sku || !lot_no || !qty || unit_cost_mop == null) {
    return new Response(
      JSON.stringify({ error: '缺必填欄位（sku, lot_no, qty, unit_cost_mop）' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const rpcBody = {
    p_tenant_id: TENANT_ID,
    p_sku: String(sku),
    p_lot_no: String(lot_no),
    p_qty: Number(qty),
    p_unit_cost_mop: Number(unit_cost_mop),
    p_received_date: received_date || new Date().toISOString().slice(0, 10),
    p_expiry_date: expiry_date || null,
    p_storage_location: storage_location || null,
    p_quality_grade: quality_grade || null,
    p_notes: notes || null,
    p_user: locals.username || 'admin',
    p_idempotency_key: idempotency_key || null,
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/inventory_receive`, {
    method: 'POST',
    headers: sbHeaders(key),
    body: JSON.stringify(rpcBody),
  });

  const text = await resp.text();
  if (!resp.ok) {
    // Surface DB error message cleanly
    let detail = text;
    try { detail = JSON.parse(text).message || text; } catch {}
    return new Response(
      JSON.stringify({ error: detail }),
      { status: resp.status, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Invalidate summary cache so next read is fresh
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
