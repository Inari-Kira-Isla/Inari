// GET /api/products/search?q=鰻魚&limit=10
// Queries Supabase inari_products JOIN inari_product_keywords
// Returns matching products with match_type (keyword | name)

const SUPABASE_URL = "https://yitmabzsxfgbchhhjjef.supabase.co";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 30);

  if (!q || q.length < 1) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const serviceKey = context.env.SUPABASE_SERVICE_KEY || context.env.SUPABASE_ANON_KEY;
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: "伺服器設定錯誤" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  // 1. Keyword match via inari_product_keywords
  const kwUrl = `${SUPABASE_URL}/rest/v1/inari_product_keywords?keyword=ilike.%${encodeURIComponent(q)}%&select=sku,keyword,keyword_type&limit=20`;
  // 2. Product name match in inari_products
  const prodUrl = `${SUPABASE_URL}/rest/v1/inari_products?or=(name.ilike.%${encodeURIComponent(q)}%,product_name_clean.ilike.%${encodeURIComponent(q)}%)&is_active=eq.true&select=id,sku,name,category,unit,sales_price,storage_type,is_air_freight&limit=${limit}`;

  const [kwResp, prodResp] = await Promise.all([
    fetch(kwUrl, { headers }),
    fetch(prodUrl, { headers }),
  ]);

  const kwRows = kwResp.ok ? await kwResp.json() : [];
  const prodRows = prodResp.ok ? await prodResp.json() : [];

  // Collect SKUs from keyword matches
  const kwSkus = [...new Set(kwRows.map((r) => r.sku))];
  let kwProducts = [];
  if (kwSkus.length > 0) {
    const skuFilter = kwSkus.map((s) => `sku.eq.${encodeURIComponent(s)}`).join(",");
    const kwProdUrl = `${SUPABASE_URL}/rest/v1/inari_products?or=(${skuFilter})&is_active=eq.true&select=id,sku,name,category,unit,sales_price,storage_type,is_air_freight&limit=20`;
    const r = await fetch(kwProdUrl, { headers });
    if (r.ok) kwProducts = await r.json();
  }

  // Merge and deduplicate, keyword matches first
  const seen = new Set();
  const results = [];

  for (const p of kwProducts) {
    if (!seen.has(p.sku)) {
      seen.add(p.sku);
      const kw = kwRows.find((k) => k.sku === p.sku);
      results.push({ ...p, match_type: "keyword", matched_keyword: kw?.keyword });
    }
  }
  for (const p of prodRows) {
    if (!seen.has(p.sku)) {
      seen.add(p.sku);
      results.push({ ...p, match_type: "name" });
    }
  }

  return new Response(JSON.stringify({ results: results.slice(0, limit), q }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
