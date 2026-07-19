// 訂單解析引擎(order-side QNL)— 純比對邏輯,唔碰 DB。
// 由 src/pages/api/orders/resolve.ts inline 版抽出,行為逐字保持一致(gh-pages 已驗 89%)。
// 分離目的:endpoint 負責抓 DB(hist/glob),呢度負責純函式比對 → 單元測可餵合成數據,唔使打 DB、唔污染 prod。
// 正本邏輯:tools/qnl/order_resolve.py。三 port(Py/JS/TS)要 parity。
import * as OpenCC from 'opencc-js';

const trad = OpenCC.Converter({ from: 'cn', to: 'hk' });

const CN_NUM: Record<string, number> = { 零:0,一:1,兩:2,两:2,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10 };
const UOM = ['條','包','盒','箱','板','隻','只','斤','合','塊','块','件','片','樽','支','kg'];
const UOM_ALT = UOM.slice().sort((a,b)=>b.length-a.length).map(u=>u.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
const SIZE = /(\d*[SLM]碼?|\dS|\dL|\d+g|\d+頭|\d+-\d+|特大|大粒|大條|中條)/;
const NOISE = ['急凍','冷凍','冷藏','冰鮮','刺身用','刺身','本格','調味','味付','壽司牌','牌','裝','中國','日本','挪威','越南','泰國','俄羅斯','加拿大','韓國','臺灣','台灣','北海道','青森','宮崎','石川','廣島','三重','京都','德島','愛知','愛媛','高知','香川','鹿兒島','鳥取','長崎','宮城','岩手'];

// 比對閾值(單一真源;R1 優化時掃呢組)
export const THRESHOLDS = {
  history: 0.45,    // Stage1 歷史命中門檻
  fuzzy: 0.6,       // Stage2 全局 fuzzy 門檻
  containment: 0.72,// 核心品名含入分(變體<相等)
  sizeBonus: 0.1,   // size 命中加分
  tieWindow: 0.05,  // 平手 tie-break 頻率窗
} as const;

export function cnToInt(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s);
  if (s in CN_NUM) return CN_NUM[s];
  if (s.length === 2 && s[0] in CN_NUM && s[1] === '十') return CN_NUM[s[0]] * 10;
  if (s[0] === '十' && s.length === 2) return 10 + (CN_NUM[s[1]] || 0);
  return null;
}

export function coreReduce(name: string): string {
  let s = trad(name || '');
  s = s.replace(/[（(][^（()）]*[)）]/g, '');
  s = s.replace(/\d+\.?\d*\s*(kg|KG|g|G|pcs?|pk|box|包|盒|箱|片|條|隻|克|尾|玉)/g, '');
  s = s.replace(/[*/xX×\-—\d\s（()）]/g, '');
  for (const n of NOISE) s = s.split(trad(n)).join('');
  return s.trim();
}

export function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bg = (s: string) => { const m = new Map<string, number>(); for (let i=0;i<s.length-1;i++){const g=s.substr(i,2);m.set(g,(m.get(g)||0)+1);} return m; };
  const A = bg(a), B = bg(b); let inter=0, ta=0, tb=0;
  A.forEach((v,k)=>{ta+=v; if(B.has(k)) inter+=Math.min(v,B.get(k)!);}); B.forEach(v=>tb+=v);
  return 2*inter/(ta+tb);
}

export function sim(a: string, b: string): number {
  a = coreReduce(a); b = coreReduce(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length,b.length) >= 2 && (a.includes(b)||b.includes(a))) return THRESHOLDS.containment;
  return dice(a, b);
}

export const freq = (c: any) => parseFloat(c.n_times || c.revenue_3y || 0);

export function bestMatch(token: string, cands: any[], size: string | null): [any, number] {
  let best: any = null, bs = 0;
  for (const c of cands) {
    let s = sim(token, c.item_name);
    if (size && trad(c.item_name).includes(size.replace('碼',''))) s = Math.min(1, s + THRESHOLDS.sizeBonus);
    if (s > bs + 1e-6 || (best && Math.abs(s-bs) <= THRESHOLDS.tieWindow && freq(c) > freq(best))) { best = c; bs = s; }
  }
  return [best, bs];
}

export interface ParsedLine { raw: string; token: string | null; qty: number | null; uom: string | null; size: string | null; }

export function parseLine(raw: string): ParsedLine {
  let t = trad(raw.normalize('NFKC').trim());
  t = t.replace(/[（(][^)）]*現金[^)）]*[)）]|現金/g, '');
  if (!t || /取消|更正|加$/.test(t)) return { raw, token: null, qty: null, uom: null, size: null };
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

export interface Candidate { item_code: string; item_name: string; n_times?: number; revenue_3y?: number; last_uom?: string; last_price?: number; }
export interface ResolvedItem {
  product_code?: string; product_name: string; qty: number; unit: string;
  suggested_unit?: string; suggested_price: number;
  match_confidence: 'history' | 'fuzzy' | 'unmatched'; hist_times?: number;
}

// 純核心:一段亂單文字 × 客戶歷史候選(hist) × 全局候選(glob) → 逐行結果。
// endpoint 從 DB 抓 hist/glob 後叫呢個;測試餵合成 hist/glob。
export function matchLines(text: string, hist: Candidate[], glob: Candidate[]): ResolvedItem[] {
  const items: ResolvedItem[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (!p.token) { items.push({ product_name: raw.trim(), qty: p.qty || 1, unit: p.uom || '件', match_confidence: 'unmatched', suggested_price: 0 }); continue; }
    let [hc, hs] = bestMatch(p.token, hist, p.size);
    if (hc && hs >= THRESHOLDS.history) {
      items.push({ product_code: hc.item_code, product_name: hc.item_name, qty: p.qty || 1, unit: p.uom || hc.last_uom || '件', suggested_unit: hc.last_uom, suggested_price: Number(hc.last_price) || 0, match_confidence: 'history', hist_times: hc.n_times });
    } else {
      let [gc, gs] = bestMatch(p.token, glob, p.size);
      if (gc && gs >= THRESHOLDS.fuzzy) items.push({ product_code: gc.item_code, product_name: gc.item_name, qty: p.qty || 1, unit: p.uom || gc.last_uom || '件', suggested_price: Number(gc.last_price) || 0, match_confidence: 'fuzzy' });
      else items.push({ product_name: p.token, qty: p.qty || 1, unit: p.uom || '件', match_confidence: 'unmatched', suggested_price: 0 });
    }
  }
  return items;
}
