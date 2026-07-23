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

  // v_shop_catalog = 武器庫(有sd/qb銷售)∩is_active，唔再直查inari_products（會漏濾彈藥庫候選貨）
  let baseFilter = `${SUPABASE_URL}/rest/v1/v_shop_catalog?id=not.is.null`;
  if (category) baseFilter += `&category=eq.${encodeURIComponent(category)}`;
  if (q) baseFilter += `&or=(name.ilike.%25${encodeURIComponent(q)}%25,sku.ilike.%25${encodeURIComponent(q)}%25)`;

  const productUrl =
    baseFilter +
    `&order=category.asc,name.asc&limit=${limit}&offset=${offset}` +
    `&select=id,sku,name,category,unit,sales_price,storage_type,is_air_freight,image_url`;

  // Use Prefer: count=exact on product query to get total — eliminates separate count request
  const [prodResp, catResp] = await Promise.all([
    fetch(productUrl, {
      headers: { ...sbHeaders, Prefer: 'count=exact' },
    }),
    // Categories only needed on first page load
    page === 1
      ? fetch(`${SUPABASE_URL}/rest/v1/v_shop_catalog?select=category`, {
          headers: sbHeaders,
        })
      : Promise.resolve(null),
  ]);

  const items = prodResp.ok ? await prodResp.json() : [];

  // Total from Content-Range: 0-23/649
  const contentRange = prodResp.headers.get('Content-Range') || '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? parseInt(totalMatch[1]) : items.length;

  let categories: string[] = [];
  if (catResp && catResp.ok) {
    const catData = await catResp.json();
    categories = [
      ...new Set(
        (catData as { category: string }[]).map((r) => r.category).filter(Boolean)
      ),
    ].sort();
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
    {
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=120',
      },
    }
  );
};
