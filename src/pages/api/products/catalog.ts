// GET /api/products/catalog?category=&q=&page=1&limit=24
// Returns paginated product list + category list

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS });
};

export const GET: APIRoute = async ({ locals, url }) => {
  // Auth check
  const userType = locals.userType || '';
  if (!userType) {
    return new Response(JSON.stringify({ error: '未登入' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const key =
    import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const sbHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  const category = url.searchParams.get('category') || '';
  const q = url.searchParams.get('q') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(48, parseInt(url.searchParams.get('limit') || '24'));
  const offset = (page - 1) * limit;

  // Build product query
  let productUrl = `${SUPABASE_URL}/rest/v1/inari_products?is_active=eq.true`;
  if (category) productUrl += `&category=eq.${encodeURIComponent(category)}`;
  if (q)
    productUrl += `&or=(name.ilike.%25${encodeURIComponent(q)}%25,product_name_clean.ilike.%25${encodeURIComponent(q)}%25)`;
  productUrl += `&order=category.asc,name.asc&limit=${limit}&offset=${offset}`;
  productUrl += `&select=id,sku,name,category,unit,sales_price,storage_type,is_air_freight`;

  // Fetch products + count
  const [prodResp, countResp, catResp] = await Promise.all([
    fetch(productUrl, { headers: sbHeaders }),
    fetch(
      productUrl
        .replace(`&limit=${limit}&offset=${offset}`, '&select=id')
        .replace('&order=category.asc,name.asc', ''),
      {
        headers: { ...sbHeaders, Prefer: 'count=exact', Range: '0-0' },
      }
    ),
    fetch(`${SUPABASE_URL}/rest/v1/inari_products?is_active=eq.true&select=category`, {
      headers: sbHeaders,
    }),
  ]);

  const items = prodResp.ok ? await prodResp.json() : [];

  // Get total count from Content-Range header
  const contentRange = countResp.headers.get('Content-Range') || '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? parseInt(totalMatch[1]) : items.length;

  // Get distinct categories
  let categories: string[] = [];
  if (catResp.ok) {
    const catData = await catResp.json();
    categories = [...new Set((catData as { category: string }[]).map((r) => r.category).filter(Boolean))].sort();
  }

  return new Response(
    JSON.stringify({
      items,
      categories,
      total,
      page,
      limit,
      has_more: offset + items.length < total,
    }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
};
