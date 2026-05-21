// GET /api/admin/inventory/legacy-stock — manager+staff
// Returns inari_products that have on_hand > 0 but NO active lots in
// inari_inventory_lots. These are "legacy" stock entries (pre-Phase-2).
// Used by /admin/inventory「未建批次」section to surface existing stock.

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500 });

  const q = url.searchParams.get('q') || '';

  // Fetch products with on_hand > 0 in parallel with SKUs that already have lots
  const productsQs =
    `${SUPABASE_URL}/rest/v1/inari_products` +
    `?tenant_id=eq.${TENANT_ID}` +
    `&is_active=eq.true&on_hand=gt.0` +
    `&select=id,sku,name,category,unit,on_hand,safety_stock,avg_cost,sales_price,storage_type,origin` +
    `&order=on_hand.desc&limit=500`;

  const lotsQs =
    `${SUPABASE_URL}/rest/v1/inari_inventory_lots` +
    `?tenant_id=eq.${TENANT_ID}&status=eq.active&qty_on_hand=gt.0&select=sku`;

  const [pResp, lResp] = await Promise.all([
    fetch(productsQs + (q ? `&or=(sku.ilike.${encodeURIComponent('*' + q + '*')},name.ilike.${encodeURIComponent('*' + q + '*')})` : ''), { headers: sbHeaders(key) }),
    fetch(lotsQs, { headers: sbHeaders(key) }),
  ]);

  if (!pResp.ok) {
    return new Response(JSON.stringify({ error: 'DB error', detail: await pResp.text() }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const products: any[] = await pResp.json();
  const lotSkus = new Set<string>();
  if (lResp.ok) {
    const lots: any[] = await lResp.json();
    for (const l of lots) if (l.sku) lotSkus.add(l.sku);
  }

  // Filter out products that already have lots (lot data is canonical for those)
  const legacyOnly = products.filter(p => !lotSkus.has(p.sku));

  const totalValue = legacyOnly.reduce(
    (s, p) => s + Number(p.on_hand || 0) * Number(p.avg_cost || 0),
    0,
  );

  return new Response(
    JSON.stringify({
      items: legacyOnly,
      total: legacyOnly.length,
      total_value_mop: totalValue,
      with_lots_count: lotSkus.size,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
