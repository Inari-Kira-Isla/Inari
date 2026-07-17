// POST /api/orders/resolve  { text }
// 確定性訂單解析引擎(order-side QNL)。customer_code 只從已驗證 session(locals) 攞,永不信 client。
// 亂單文字 → 逐行撞「客戶近3年慣買 SKU」消歧(opencc簡繁+核心品名+歷史頻率),
// 命中=history / 全局fallback=fuzzy / 都冇=unmatched。取代 MiniMax /api/voice/parse。
// port 自 tools/qnl/order_resolve.py(gh-pages 版已驗證 89%)。
export const prerender = false;
import type { APIRoute } from 'astro';
import * as OpenCC from 'opencc-js';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const trad = OpenCC.Converter({ from: 'cn', to: 'hk' });

const CN_NUM: Record<string, number> = { 零:0,一:1,兩:2,两:2,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };
const UOM = ['條','包','盒','箱','板','隻','只','斤','合','塊','块','件','片','樽','支','kg'];
const UOM_ALT = UOM.slice().sort((a,b)=>b.length-a.length).map(u=>u.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
const SIZE = /(\d*[SLM]碼?|\dS|\dL|\d+g|\d+頭|\d+-\d+|特大|大粒|大條|中條)/;
const NOISE = ['急凍','冷凍','冷藏','冰鮮','刺身用','刺身','本格','調味','味付','壽司牌','牌','裝','中國','日本','挪威','越南','泰國','俄羅斯','加拿大','韓國','臺灣','台灣','北海道','青森','宮崎','石川','廣島','三重','京都','德島','愛知','愛媛','高知','香川','鹿兒島','鳥取','長崎','宮城','岩手'];

function cnToInt(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s);
  if (s in CN_NUM) return CN_NUM[s];
  if (s.length === 2 && s[0] in CN_NUM && s[1] === '十') return CN_NUM[s[0]] * 10;
  if (s[0] === '十' && s.length === 2) return 10 + (CN_NUM[s[1]] || 0);
  return null;
}
function coreReduce(name: string): string {
  let s = trad(name || '');
  s = s.replace(/[（(][^（()）]*[)）]/g, '');
  s = s.replace(/\d+\.?\d*\s*(kg|KG|g|G|pcs?|pk|box|包|盒|箱|片|條|隻|克|尾|玉)/g, '');
  s = s.replace(/[*/xX×\-—\d\s（()）]/g, '');
  for (const n of NOISE) s = s.split(trad(n)).join('');
  return s.trim();
}
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bg = (s: string) => { const m = new Map<string, number>(); for (let i=0;i<s.length-1;i++){const g=s.substr(i,2);m.set(g,(m.get(g)||0)+1);} return m; };
  const A = bg(a), B = bg(b); let inter=0, ta=0, tb=0;
  A.forEach((v,k)=>{ta+=v; if(B.has(k)) inter+=Math.min(v,B.get(k)!);}); B.forEach(v=>tb+=v);
  return 2*inter/(ta+tb);
}
function sim(a: string, b: string): number {
  a = coreReduce(a); b = coreReduce(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length,b.length) >= 2 && (a.includes(b)||b.includes(a))) return 0.72;
  return dice(a, b);
}
const freq = (c: any) => parseFloat(c.n_times || c.revenue_3y || 0);
function bestMatch(token: string, cands: any[], size: string | null): [any, number] {
  let best: any = null, bs = 0;
  for (const c of cands) {
    let s = sim(token, c.item_name);
    if (size && trad(c.item_name).includes(size.replace('碼',''))) s = Math.min(1, s + 0.1);
    if (s > bs + 1e-6 || (best && Math.abs(s-bs) <= 0.05 && freq(c) > freq(best))) { best = c; bs = s; }
  }
  return [best, bs];
}
function parseLine(raw: string) {
  let t = trad(raw.normalize('NFKC').trim());
  t = t.replace(/[（(][^)）]*現金[^)）]*[)）]|現金/g, '');
  if (!t || /取消|更正|加$/.test(t)) return { raw, token: null as string|null, qty: null as number|null, uom: null as string|null, size: null as string|null };
  let qty: number|null = null, uom: string|null = null;
  let m = t.match(new RegExp('([0-9]+|[一二兩两三四五六七八九十]+)\\s*(' + UOM_ALT + ')'));
  if (m) { qty = cnToInt(m[1]); uom = m[2]; }
  else { const m2 = t.match(/[x×]?\s*([0-9]+)\s*(條|隻|盒|包|板)?/); if (m2) { qty = parseInt(m2[1]); uom = m2[2] || null; } }
  const ms = t.match(SIZE); const size = ms ? ms[0] : null;
  let name = t;
  name = name.replace(new RegExp('([0-9]+|[一二兩两三四五六七八九十]+)\\s*(' + UOM_ALT + ')', 'g'), '');
  name = name.replace(/[0-9.]+\/?(kg|KG|公斤)?/g, '').replace(new RegExp(SIZE.source, 'g'), '').replace(/[x×@()（）,，。.\s/]+/g, '');
  return { raw, token: name.trim() || null, qty, uom, size };
}

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
  const globN = (glob || []).map((x: any) => ({ item_code: x.item_code, item_name: x.display_name, revenue_3y: x.revenue_3y, last_uom: x.last_uom, last_price: x.last_price }));

  const items: any[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (!p.token) { items.push({ product_name: raw.trim(), qty: p.qty || 1, unit: p.uom || '件', match_confidence: 'unmatched', suggested_price: 0 }); continue; }
    let [hc, hs] = bestMatch(p.token, hist, p.size);
    if (hc && hs >= 0.45) {
      items.push({ product_code: hc.item_code, product_name: hc.item_name, qty: p.qty || 1, unit: p.uom || hc.last_uom || '件', suggested_unit: hc.last_uom, suggested_price: Number(hc.last_price) || 0, match_confidence: 'history', hist_times: hc.n_times });
    } else {
      let [gc, gs] = bestMatch(p.token, globN, p.size);
      if (gc && gs >= 0.6) items.push({ product_code: gc.item_code, product_name: gc.item_name, qty: p.qty || 1, unit: p.uom || gc.last_uom || '件', suggested_price: Number(gc.last_price) || 0, match_confidence: 'fuzzy' });
      else items.push({ product_name: p.token, qty: p.qty || 1, unit: p.uom || '件', match_confidence: 'unmatched', suggested_price: 0 });
    }
  }
  return new Response(JSON.stringify({ ok: true, customer_code: code, items }), { headers: { 'Content-Type': 'application/json' } });
};
