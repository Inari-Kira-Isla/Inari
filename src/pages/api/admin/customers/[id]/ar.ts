// GET /api/admin/customers/:id/ar — 單客逐月應收 + 商業圖像(F1) + E4 流失預警（manager + staff）
// id = customer_code（URL-encoded）。讀 v_collection_schedule(canon) / v_monthly_ar / v_customer_business_profile / v_ar_aging / health。

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);
}
const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v || '0')) || 0;

export const GET: APIRoute = async ({ locals, params }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const code = decodeURIComponent(params.id || '').trim();
  if (!code) {
    return new Response(JSON.stringify({ error: '缺客戶代碼' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const rest = `${SUPABASE_URL}/rest/v1`;
  const enc = encodeURIComponent(code);
  const get = async (path: string) => {
    const r = await withTimeout(fetch(`${rest}/${path}`, { headers: sbHeaders(key) }), 5000);
    if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  try {
    const [sched, profile, aging, health] = await Promise.all([
      get(`v_collection_schedule?customer_code=eq.${enc}&select=canon_code,customer_code,customer_name,slot,due_date,collection_lag,total_outstanding,collectible_this_month&limit=1`),
      get(`v_customer_business_profile?customer_code=eq.${enc}&select=*&limit=1`),
      get(`v_ar_aging?customer_code=eq.${enc}&select=total_outstanding,overdue_1_30,overdue_31_60,overdue_60_plus,max_days_overdue&limit=1`),
      get(`inari_customer_health_scores?customer_code=eq.${enc}&select=snapshot_date,rfm_segment,rfm_recency,churn_risk_level,churn_risk_score,overall_health_score,recommended_actions&order=snapshot_date.desc&limit=1`),
    ]);

    if (!sched?.[0] && !profile?.[0]) {
      // M7 空狀態：唔存在 → 明確 404 而非假資料
      return new Response(JSON.stringify({ error: '查無此客戶', code }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const canon = sched?.[0]?.canon_code || code;

    // 逐月應收（近 12 月）
    const monthly = await get(`v_monthly_ar?canon_code=eq.${encodeURIComponent(canon)}&select=ym,billed,collected,outstanding,n_inv&order=ym.desc&limit=12`);
    const ar_history = monthly.map((m: any) => ({
      ym: m.ym, billed: Math.round(num(m.billed)), collected: Math.round(num(m.collected)),
      outstanding: Math.round(num(m.outstanding)), n_inv: m.n_inv,
    }));

    // E4 流失預警：現成 churn_risk_level 為主 + 逾期/落單下滑加碼
    const agg = aging?.[0] || {};
    const maxDays = num(agg.max_days_overdue);
    const hs = health?.[0] || {};
    const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const LABEL = ['low', 'medium', 'high'];
    let lvl = RANK[String(hs.churn_risk_level || '').toLowerCase()] ?? 0;
    const reasons: string[] = [];
    if (hs.churn_risk_level) reasons.push(`健康模型評級 ${hs.churn_risk_level}`);
    // 近3月 vs 前3月開單比較（monthly 已 desc）
    const billedDesc = monthly.map((m: any) => num(m.billed));
    const recent3 = billedDesc.slice(0, 3).reduce((s: number, x: number) => s + x, 0);
    const prior3 = billedDesc.slice(3, 6).reduce((s: number, x: number) => s + x, 0);
    const declinePct = prior3 > 0 ? Math.round(((prior3 - recent3) / prior3) * 100) : null;
    if (maxDays > 60) { lvl = Math.max(lvl, 2); reasons.push(`逾期 ${maxDays} 日`); }
    else if (maxDays > 30) { lvl = Math.max(lvl, 1); reasons.push(`逾期 ${maxDays} 日`); }
    if (declinePct != null && declinePct >= 40) { lvl = Math.max(lvl, 2); reasons.push(`落單較前季 ↓${declinePct}%`); }
    else if (declinePct != null && declinePct >= 20) { lvl = Math.max(lvl, 1); reasons.push(`落單 ↓${declinePct}%`); }

    const churn = {
      risk: LABEL[lvl], reasons,
      max_days_overdue: maxDays, decline_pct: declinePct,
      churn_risk_score: hs.churn_risk_score ?? null, overall_health_score: hs.overall_health_score ?? null,
      rfm_segment: hs.rfm_segment || null, recommended_actions: hs.recommended_actions || null,
    };

    return new Response(JSON.stringify({
      code, canon,
      schedule: sched?.[0] || null,
      profile: profile?.[0] || null,
      aging: agg,
      ar_history,
      churn,
      freshness: { generated_at: new Date().toISOString(), health_snapshot: hs.snapshot_date || null },
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: '查詢失敗', detail: (e as Error).message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
