// POST /api/orders/resolve  { text }
// 確定性訂單解析引擎(order-side QNL)。customer_code 只從已驗證 session(locals) 攞,永不信 client。
// 亂單文字 → 逐行撞「客戶近3年慣買 SKU」消歧(opencc簡繁+核心品名+歷史頻率),
// 命中=history / 全局fallback=fuzzy / 都冇=unmatched。取代 MiniMax /api/voice/parse。
// 純比對邏輯抽咗去 src/lib/order-engine.ts(可單元測);呢度只負責抓 DB(hist/glob)。
export const prerender = false;
import type { APIRoute } from 'astro';
import { matchLines, type Candidate } from '../../../lib/order-engine';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

async function pgGet(pathq: string, key: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathq}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return r.ok ? r.json() : [];
}

export const POST: APIRoute = async ({ request, locals }) => {
  const code = (locals as any)?.customerCode || '';
  if (!code) return new Response(JSON.stringify({ error: '未識別客戶(請用 QR 或帳戶登入)' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let text = '';
  try { text = ((await request.json()).text || '').trim(); } catch { /* */ }
  if (!text) return new Response(JSON.stringify({ error: '缺內容' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const [hist, glob] = await Promise.all([
    pgGet(`v_orderbook_customer_items?customer_code=eq.${encodeURIComponent(code)}&select=item_code,item_name,n_times,last_uom,last_price&order=n_times.desc`, key),
    pgGet(`v_orderbook_items?select=item_code,display_name,revenue_3y,last_uom,last_price&limit=1000`, key),
  ]);
  const globN: Candidate[] = (glob || []).map((x: any) => ({ item_code: x.item_code, item_name: x.display_name, revenue_3y: x.revenue_3y, last_uom: x.last_uom, last_price: x.last_price }));

  const items = matchLines(text, (hist || []) as Candidate[], globN);
  return new Response(JSON.stringify({ ok: true, customer_code: code, items }), { headers: { 'Content-Type': 'application/json' } });
};
