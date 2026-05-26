import type { APIRoute } from 'astro';
import { invalidateCache } from '../../../../lib/cache';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function extractRpcErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === 'string') return parsed.message;
    if (typeof parsed?.error === 'string') return parsed.error;
    if (typeof parsed?.details === 'string') return parsed.details;
  } catch {
    // fall through to raw text
  }
  return text || 'scrap failed';
}

export const POST: APIRoute = async ({ locals, request }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return jsonResponse({ error: '權限不足' }, 403);
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) {
    return jsonResponse({ error: '缺少 Supabase key' }, 500);
  }

  let body: {
    lot_id?: number;
    reason?: string;
    notes?: string;
    idempotency_key?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json body' }, 400);
  }

  if (typeof body.lot_id !== 'number' || !Number.isFinite(body.lot_id)) {
    return jsonResponse({ error: 'missing lot_id' }, 400);
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const allowedReasons = ['damaged', 'expired', 'quality', 'other'];
  if (!reason) {
    return jsonResponse({ error: 'missing reason' }, 400);
  }
  if (!allowedReasons.includes(reason)) {
    return jsonResponse({ error: 'invalid reason' }, 400);
  }

  try {
    const lotLookup = await fetch(
      `${SUPABASE_URL}/rest/v1/inari_inventory_lots?id=eq.${body.lot_id}&tenant_id=eq.${TENANT_ID}&select=sku`,
      { headers: sbHeaders(key) },
    );

    if (!lotLookup.ok) {
      return jsonResponse({ error: 'lot lookup failed' }, 500);
    }

    const lots = (await lotLookup.json()) as Array<{ sku?: string }>;
    if (!lots?.length || typeof lots[0]?.sku !== 'string' || !lots[0].sku) {
      return jsonResponse({ error: 'lot not found' }, 404);
    }

    const sku = lots[0].sku;

    const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/inventory_scrap`, {
      method: 'POST',
      headers: sbHeaders(key),
      body: JSON.stringify({
        p_tenant_id: TENANT_ID,
        p_lot_id: body.lot_id,
        p_reason: reason,
        p_notes: body.notes ?? null,
        p_idempotency_key: body.idempotency_key ?? null,
      }),
    });

    const rpcText = await rpcResponse.text();

    if (!rpcResponse.ok) {
      return jsonResponse({ error: extractRpcErrorMessage(rpcText) }, 400);
    }

    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/recalc_on_hand`, {
        method: 'POST',
        headers: sbHeaders(key),
        body: JSON.stringify({ p_tenant_id: TENANT_ID, p_sku: sku }),
      });
    } catch (e) {
      console.warn('[recalc_on_hand] failed (non-fatal):', e);
    }

    void invalidateCache('inventory:summary:');

    return new Response(rpcText, {
      status: 200,
      headers: {
        'Content-Type': rpcResponse.headers.get('content-type') || 'application/json; charset=utf-8',
      },
    });
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : 'unexpected error' },
      500,
    );
  }
};
