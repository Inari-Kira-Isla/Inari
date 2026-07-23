// GET /api/order/catalog?category=&q=&page=1&limit=24
// 公開商品目錄(B2C guest,免login) — 同 /api/products/catalog 查詢邏輯一致,
// 但故意獨立成新檔:B2B 版有 locals.userType 檢查唔畀未登入用,呢個版本一開始就係
// 設計俾未登入訪客用,兩個endpoint分開先唔會日後改動B2B版時漏噉B2C（或者反過來）。
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

export const GET: APIRoute = async ({ url }) => {
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
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

  let baseFilter = `${SUPABASE_URL}/rest/v1/inari_products?is_active=eq.true`;
  if (category) baseFilter += `&category=eq.${encodeURIComponent(category)}`;
  if (q) baseFilter += `&or=(name.ilike.%25${encodeURIComponent(q)}%25,sku.ilike.%25${encodeURIComponent(q)}%25)`;

  // 零售目錄:淨曝露顯示必須嘅欄位,唔帶price_floor/standard_price等內部定價基準
  const productUrl =
    baseFilter +
    `&order=category.asc,name.asc&limit=${limit}&offset=${offset}` +
    `&select=id,sku,name,category,unit,sales_price,storage_type,is_air_freight`;

  const [prodResp, catResp] = await Promise.all([
    fetch(productUrl, { headers: { ...sbHeaders, Prefer: 'count=exact' } }),
    page === 1
      ? fetch(`${SUPABASE_URL}/rest/v1/inari_products?is_active=eq.true&select=category`, { headers: sbHeaders })
      : Promise.resolve(null),
  ]);

  const items = prodResp.ok ? await prodResp.json() : [];

  const contentRange = prodResp.headers.get('Content-Range') || '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? parseInt(totalMatch[1]) : items.length;

  let categories: string[] = [];
  if (catResp && catResp.ok) {
    const catData = await catResp.json();
    categories = [...new Set((catData as { category: string }[]).map((r) => r.category).filter(Boolean))].sort();
  }

  return new Response(
    JSON.stringify({ items, categories, total, page, limit, has_more: offset + items.length < total }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
};
