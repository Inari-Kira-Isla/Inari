// GET/POST/PUT/DELETE /api/knowledge
// Note: This endpoint originally used Cloudflare D1.
// On Vercel, D1 is not available. This endpoint returns a not-implemented response
// unless SUPABASE_SERVICE_KEY is set and a Supabase-backed knowledge table is used instead.
// For now, returning graceful errors to avoid breaking existing callers.

import type { APIRoute } from 'astro';

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

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

// GET /api/knowledge — list knowledge items
export const GET: APIRoute = async ({ url }) => {
  try {
    const serviceKey =
      import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
    if (!serviceKey) {
      return errorResponse('Database not configured', 500);
    }

    const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
    const category = url.searchParams.get('category');
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    let endpoint = `${SUPABASE_URL}/rest/v1/inari_knowledge_items?select=id,category,question,answer,created_at,updated_at&order=category.asc,id.asc&limit=${limit}&offset=${offset}`;
    if (category) {
      endpoint += `&category=eq.${encodeURIComponent(category)}`;
    }

    const resp = await fetch(endpoint, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      return errorResponse(`Query failed: ${await resp.text()}`, 500);
    }

    const items = await resp.json();
    return jsonResponse({ items });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};

// POST /api/knowledge — add knowledge item
export const POST: APIRoute = async ({ request }) => {
  try {
    const serviceKey =
      import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
    if (!serviceKey) {
      return errorResponse('Database not configured', 500);
    }

    const body = await request.json();
    const { category, question, answer } = body;

    if (!category || !answer) {
      return errorResponse('category 和 answer 為必填欄位');
    }

    const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inari_knowledge_items`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ category, question: question || null, answer }),
    });

    if (!resp.ok) {
      return errorResponse(`Insert failed: ${await resp.text()}`, 500);
    }

    const [row] = await resp.json();
    return jsonResponse({ ok: true, id: row?.id }, 201);
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};

// PUT /api/knowledge — update knowledge item
export const PUT: APIRoute = async ({ request }) => {
  try {
    const serviceKey =
      import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
    if (!serviceKey) {
      return errorResponse('Database not configured', 500);
    }

    const body = await request.json();
    const { id, category, question, answer } = body;

    if (!id) return errorResponse('id 為必填');
    if (!category || !answer) {
      return errorResponse('category 和 answer 為必填欄位');
    }

    const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/inari_knowledge_items?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          category,
          question: question || null,
          answer,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!resp.ok) {
      return errorResponse(`Update failed: ${await resp.text()}`, 500);
    }

    const rows = await resp.json();
    if (!rows || rows.length === 0) {
      return errorResponse('找不到指定的知識條目', 404);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};

// DELETE /api/knowledge?id=xxx
export const DELETE: APIRoute = async ({ url, request }) => {
  try {
    const serviceKey =
      import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
    if (!serviceKey) {
      return errorResponse('Database not configured', 500);
    }

    let id = url.searchParams.get('id');

    if (!id) {
      try {
        const body = await request.json();
        id = body.id;
      } catch {
        // ignore
      }
    }

    if (!id) return errorResponse('id 為必填');

    const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/inari_knowledge_items?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
      }
    );

    if (!resp.ok) {
      return errorResponse(`Delete failed: ${await resp.text()}`, 500);
    }

    const rows = await resp.json();
    if (!rows || rows.length === 0) {
      return errorResponse('找不到指定的知識條目', 404);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
};
