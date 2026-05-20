// GET /api/seasonal?month=N
// Returns seasonal seafood items for the given month (defaults to current UTC month)
// Public — no auth required, Cache-Control: max-age=3600

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async ({ url }) => {
  const rawMonth = url.searchParams.get('month');
  const month = rawMonth
    ? Math.min(12, Math.max(1, parseInt(rawMonth, 10)))
    : new Date().getMonth() + 1;

  if (isNaN(month)) {
    return new Response(JSON.stringify({ error: 'Invalid month' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const key =
    import.meta.env.SUPABASE_ANON_KEY ||
    import.meta.env.SUPABASE_SERVICE_KEY;

  if (!key) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const qUrl =
    `${SUPABASE_URL}/rest/v1/inari_seasonal_calendar` +
    `?month=eq.${month}&is_peak=eq.true` +
    `&select=id,item_name_zh,item_name_ja,item_name_en,origin,category,description_zh` +
    `&order=sort_order.asc`;

  try {
    const resp = await fetch(qUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'Query failed' }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const items = await resp.json();
    return new Response(JSON.stringify({ month, items }), {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
};
