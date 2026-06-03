// GET /api/admin/uni-prices — manager/staff only, 海膽報價歷史比對
// 移植 inari_quote_compare.py:正規化(品牌/白赤/克數)→ 跨 quote_date 時間線 → 最新 vs 上版漲跌
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const GRADE_TAGS = ['極上SP', '大極上SP', '大極上', '極上', '無添加', '無排', 'SP', '上並び', '並び', '横排', 'A並び', 'A', 'B'];

type Quote = { brand_id: string | null; product_name: string; spec: string; unit_price: number | null; quote_date: string; notes: string };

function normalize(r: Quote) {
  const text = `${r.product_name || ''} ${r.spec || ''} ${r.notes || ''}`;
  const wm = text.match(/(\d{2,4})\s*g/);
  const weight = wm ? parseInt(wm[1]) : null;
  const color = text.includes('白') ? '白' : text.includes('赤') ? '赤' : null;
  const grade = GRADE_TAGS.find((g) => text.includes(g)) || null;
  return { brand_id: r.brand_id, color, weight, grade };
}

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const sb = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // 拉海膽報價 + 品牌名
  const [qResp, bResp] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/inari_supplier_quotes?product_name=ilike.%25${encodeURIComponent('海膽')}%25&select=brand_id,product_name,spec,unit_price,currency,quote_date,notes&order=quote_date.asc&limit=1000`, { headers: sb }),
    fetch(`${SUPABASE_URL}/rest/v1/inari_brands?select=id,name_ja&limit=1000`, { headers: sb }),
  ]);
  if (!qResp.ok) return new Response(JSON.stringify({ error: 'DB error', detail: await qResp.text() }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const quotes: Quote[] = await qResp.json();
  const brands: { id: string; name_ja: string }[] = bResp.ok ? await bResp.json() : [];
  const bname = new Map(brands.map((b) => [b.id, b.name_ja]));

  // 分組(brand_id|color|weight)→ 時間線
  const groups = new Map<string, { brand: string | null; color: string | null; weight: number | null; grade: string | null; tl: { date: string; price: number }[] }>();
  for (const r of quotes) {
    const n = normalize(r);
    const k = `${n.brand_id}|${n.color}|${n.weight}`;
    if (!groups.has(k)) groups.set(k, { brand: n.brand_id ? bname.get(n.brand_id) || null : null, color: n.color, weight: n.weight, grade: n.grade, tl: [] });
    if (r.unit_price != null) groups.get(k)!.tl.push({ date: r.quote_date, price: Number(r.unit_price) });
  }

  // 最新 vs 上一版(不同日期)
  const out: any[] = [];
  for (const g of groups.values()) {
    const priced = g.tl.sort((a, b) => a.date.localeCompare(b.date));
    // 取最後兩個不同日期
    const dedup: { date: string; price: number }[] = [];
    const seen = new Set<string>();
    for (let i = priced.length - 1; i >= 0 && dedup.length < 2; i--) {
      if (!seen.has(priced[i].date)) { seen.add(priced[i].date); dedup.push(priced[i]); }
    }
    if (dedup.length < 2) continue;
    const [cur, prev] = dedup;
    if (!prev.price) continue;
    const pct = ((cur.price - prev.price) / prev.price) * 100;
    out.push({
      brand: g.brand || '(無品牌)', color: g.color, weight: g.weight, grade: g.grade,
      prev_date: prev.date, prev_price: prev.price, cur_date: cur.date, cur_price: cur.price,
      pct: Math.round(pct * 10) / 10, timeline: priced,
    });
  }
  out.sort((a, b) => b.pct - a.pct);

  const up = out.filter((o) => o.pct > 0).length;
  const down = out.filter((o) => o.pct < 0).length;
  return new Response(JSON.stringify({ rows: out, summary: { total: out.length, up, down } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
