// GET /api/product-knowledge — reads product_knowledge table (food/brand knowledge)
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' } });

export const GET: APIRoute = async ({ url }) => {
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return json({ error: 'Database not configured' }, 500);

  const category = url.searchParams.get('category') || '';
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '200'));

  let endpoint = `${SUPABASE_URL}/rest/v1/product_knowledge?select=*&order=id.asc&limit=${limit}`;
  if (category) endpoint += `&product_category=eq.${encodeURIComponent(category)}`;

  const resp = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });

  if (!resp.ok) return json({ error: await resp.text() }, 500);

  const items = await resp.json();
  return json({ items });
};
