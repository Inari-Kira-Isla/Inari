// GET/POST/PUT/DELETE /api/knowledge
// Table: inari_knowledge_items
// Columns: id, domain, title, source_type, key_insight, action_for_inari,
//          tags (array), relevance_score, author_or_source, url, pub_year,
//          gap_ref, md_file_path, created_at

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

function sbKey() {
  return import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY || '';
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const key = sbKey();
    if (!key) return errorResponse('Database not configured', 500);

    const domain = url.searchParams.get('domain') || url.searchParams.get('category') || '';
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    let endpoint =
      `${SUPABASE_URL}/rest/v1/inari_knowledge_items` +
      `?select=id,domain,title,source_type,key_insight,action_for_inari,tags,relevance_score,created_at` +
      `&order=domain.asc,relevance_score.desc&limit=${limit}&offset=${offset}`;

    if (domain) endpoint += `&domain=eq.${encodeURIComponent(domain)}`;

    const resp = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });

    if (!resp.ok) return errorResponse(`Query failed: ${await resp.text()}`, 500);

    const items = await resp.json();
    return jsonResponse({ items });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const key = sbKey();
    if (!key) return errorResponse('Database not configured', 500);

    const body = await request.json();
    const { domain, title, key_insight, action_for_inari, source_type, relevance_score, tags } = body;

    if (!domain || !title || !action_for_inari) {
      return errorResponse('domain、title 和 action_for_inari 為必填欄位');
    }

    const payload: Record<string, unknown> = {
      domain,
      title,
      action_for_inari,
      key_insight: key_insight || null,
      source_type: source_type || null,
      relevance_score: relevance_score ? parseInt(relevance_score) : 3,
      tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map((t: string) => t.trim()).filter(Boolean) : []),
    };

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inari_knowledge_items`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) return errorResponse(`Insert failed: ${await resp.text()}`, 500);

    const [row] = await resp.json();
    return jsonResponse({ ok: true, id: row?.id }, 201);
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};

export const PUT: APIRoute = async ({ request }) => {
  try {
    const key = sbKey();
    if (!key) return errorResponse('Database not configured', 500);

    const body = await request.json();
    const { id, domain, title, key_insight, action_for_inari, source_type, relevance_score, tags } = body;

    if (!id) return errorResponse('id 為必填');
    if (!domain || !title || !action_for_inari) {
      return errorResponse('domain、title 和 action_for_inari 為必填欄位');
    }

    const patch: Record<string, unknown> = {
      domain,
      title,
      action_for_inari,
      key_insight: key_insight || null,
      source_type: source_type || null,
      relevance_score: relevance_score ? parseInt(relevance_score) : 3,
      tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map((t: string) => t.trim()).filter(Boolean) : []),
    };

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inari_knowledge_items?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });

    if (!resp.ok) return errorResponse(`Update failed: ${await resp.text()}`, 500);

    const rows = await resp.json();
    if (!rows || rows.length === 0) return errorResponse('找不到指定的知識條目', 404);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};

export const DELETE: APIRoute = async ({ url, request }) => {
  try {
    const key = sbKey();
    if (!key) return errorResponse('Database not configured', 500);

    let id = url.searchParams.get('id');
    if (!id) {
      try { id = (await request.json()).id; } catch { /* ignore */ }
    }
    if (!id) return errorResponse('id 為必填');

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inari_knowledge_items?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    });

    if (!resp.ok) return errorResponse(`Delete failed: ${await resp.text()}`, 500);

    const rows = await resp.json();
    if (!rows || rows.length === 0) return errorResponse('找不到指定的知識條目', 404);

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};
