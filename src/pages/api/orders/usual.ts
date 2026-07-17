// GET /api/orders/usual  → 該登入客戶近3年慣用貨(top 20)。customer_code 只從 session(locals)。
// 畀落單頁一入嚟就帶出客戶常買貨,㩒數量即落單(源頭乾淨結構化)。
export const prerender = false;
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

export const GET: APIRoute = async ({ locals }) => {
  const code = (locals as any)?.customerCode || '';
  if (!code) return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } });

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/v_orderbook_customer_items?customer_code=eq.${encodeURIComponent(code)}` +
    `&select=item_code,item_name,n_times,last_uom,last_price&order=n_times.desc&limit=20`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const rows = r.ok ? await r.json() : [];
  const items = (rows || []).map((x: any) => ({
    product_code: x.item_code, product_name: x.item_name,
    unit: x.last_uom || '件', suggested_price: Number(x.last_price) || 0,
    n_times: x.n_times, match_confidence: 'history',
  }));
  return new Response(JSON.stringify({ customer_code: code, items }), { headers: { 'Content-Type': 'application/json' } });
};
