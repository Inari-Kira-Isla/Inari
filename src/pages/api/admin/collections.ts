// GET /api/admin/collections — 收款儀表板主 feed（manager only）
// F3 本月各時段可收 + F2 近3月銷售×收款方式 + E1 到期/逾期 + E2 現金流預測 + E3 業務員績效
// 全部讀 S1 預聚合 view（v_collection_schedule / v_sales_by_paytype / v_ar_aging），並行查詢。
// M2 status / M4 Asia-Macau 已釘喺 view；M6 錯誤外露 + 數據新鮮度。

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);
}
const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v || '0')) || 0;

// Asia/Macau 本月/上月（前端顯示口徑與 view 一致）
function macauYM(offset = 0): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Macau' }));
  now.setMonth(now.getMonth() + offset);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const SLOT_ORDER = ['15號', '25號', '次結', '延後2月', '岫收', '現金即收', '未設'];

export const GET: APIRoute = async ({ locals }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const rest = `${SUPABASE_URL}/rest/v1`;
  const get = async (path: string) => {
    const r = await withTimeout(fetch(`${rest}/${path}`, { headers: sbHeaders(key) }), 5000);
    if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  try {
    const since6 = macauYM(-6);
    const [schedule, paytype, aging, custMeta, latest] = await Promise.all([
      get('v_collection_schedule?select=canon_code,customer_code,customer_name,slot,salesperson,collectible_this_month,total_outstanding'),
      get(`v_sales_by_paytype?ym=gte.${since6}&select=ym,payment_type,amount`),
      get('v_ar_aging?select=customer_code,customer_name,total_outstanding,overdue_1_30,overdue_31_60,overdue_60_plus,max_days_overdue,payment_type&total_outstanding=gt.0'),
      get('inari_customers?select=salesperson,collection_rate_pct,avg_collection_delay_days&is_active=eq.true'),
      get('inari_daily_invoices?select=invoice_date&order=invoice_date.desc&limit=1'),
    ]);

    // ---- F3 本月各時段可收 ----
    const slotMap: Record<string, { count: number; collectible: number; customers: any[] }> = {};
    for (const s of SLOT_ORDER) slotMap[s] = { count: 0, collectible: 0, customers: [] };
    for (const r of schedule) {
      const slot = slotMap[r.slot] ? r.slot : '未設';
      const amt = num(r.collectible_this_month);
      slotMap[slot].count++;
      slotMap[slot].collectible += amt;
      if (amt > 0.5) slotMap[slot].customers.push({ code: r.customer_code, name: r.customer_name, amount: Math.round(amt), salesperson: r.salesperson });
    }
    for (const s of SLOT_ORDER) slotMap[s].customers.sort((a, b) => b.amount - a.amount);
    const slots = SLOT_ORDER.map((s) => ({ slot: s, count: slotMap[s].count, collectible: Math.round(slotMap[s].collectible), customers: slotMap[s].customers }));
    const due15 = Math.round(slotMap['15號'].collectible);
    const due25 = Math.round(slotMap['25號'].collectible);

    // ---- F2 近3月銷售 × 收款方式 ----
    const months = [macauYM(-2), macauYM(-1), macauYM(0)];
    const PT = ['月結', '過數', '現金'];
    const sales3m = months.map((ym) => {
      const row: any = { ym, 月結: 0, 過數: 0, 現金: 0, total: 0 };
      for (const p of paytype) {
        if (p.ym !== ym) continue;
        const t = PT.includes(p.payment_type) ? p.payment_type : null;
        const a = num(p.amount);
        if (t) row[t] += a;
        row.total += a;
      }
      for (const k of [...PT, 'total']) row[k] = Math.round(row[k]);
      return row;
    });

    // ---- E1 到期 / 逾期 ----
    const overdueBuckets = { '1-30': 0, '31-60': 0, '60+': 0 };
    let overdueTotal = 0;
    const overdueList: any[] = [];
    for (const a of aging) {
      const b1 = num(a.overdue_1_30), b2 = num(a.overdue_31_60), b3 = num(a.overdue_60_plus);
      overdueBuckets['1-30'] += b1; overdueBuckets['31-60'] += b2; overdueBuckets['60+'] += b3;
      const od = b1 + b2 + b3;
      if (od > 0) { overdueTotal += od; overdueList.push({ code: a.customer_code, name: a.customer_name, overdue: Math.round(od), max_days: num(a.max_days_overdue), payment_type: a.payment_type }); }
    }
    overdueList.sort((a, b) => b.overdue - a.overdue);
    const e1 = {
      buckets: { '1-30': Math.round(overdueBuckets['1-30']), '31-60': Math.round(overdueBuckets['31-60']), '60+': Math.round(overdueBuckets['60+']) },
      overdue_total: Math.round(overdueTotal),
      top: overdueList.slice(0, 20),
    };

    // ---- E2 現金流預測（trailing-3m run-rate × slot 佔比，標示為估算）----
    const runRate = sales3m.reduce((s, m) => s + m.total, 0) / (sales3m.length || 1);
    const slotShareBase = slots.filter((s) => ['15號', '25號', '次結', '延後2月'].includes(s.slot));
    const shareTotal = slotShareBase.reduce((s, x) => s + x.collectible, 0) || 1;
    const forecast = [1, 2, 3].map((k) => {
      const ym = macauYM(k);
      const total = Math.round(runRate);
      const by_slot = slotShareBase.map((s) => ({ slot: s.slot, amount: Math.round((runRate * s.collectible) / shareTotal) }));
      return { ym, total, by_slot, estimate: true };
    });

    // ---- E3 業務員收款績效 ----
    const spOut: Record<string, { outstanding: number; customers: number }> = {};
    for (const r of schedule) {
      const sp = r.salesperson || '未分配';
      (spOut[sp] ||= { outstanding: 0, customers: 0 });
      spOut[sp].outstanding += num(r.total_outstanding);
      spOut[sp].customers++;
    }
    const spMetric: Record<string, { rate: number[]; delay: number[] }> = {};
    for (const c of custMeta) {
      const sp = c.salesperson || '未分配';
      (spMetric[sp] ||= { rate: [], delay: [] });
      if (c.collection_rate_pct != null) spMetric[sp].rate.push(num(c.collection_rate_pct));
      if (c.avg_collection_delay_days != null) spMetric[sp].delay.push(num(c.avg_collection_delay_days));
    }
    const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    const salesperson = Object.keys(spOut).map((sp) => ({
      salesperson: sp,
      customers: spOut[sp].customers,
      outstanding: Math.round(spOut[sp].outstanding),
      collection_rate_pct: round1(avg(spMetric[sp]?.rate || [])),
      avg_delay_days: round1(avg(spMetric[sp]?.delay || [])),
    })).sort((a, b) => b.outstanding - a.outstanding);

    const freshness = {
      latest_invoice_date: latest?.[0]?.invoice_date || null,
      generated_at: new Date().toISOString(),
      this_month: macauYM(0),
    };

    return new Response(JSON.stringify({
      freshness, this_month: macauYM(0), due15, due25,
      slots, sales3m, e1, forecast, salesperson,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    // M6 零靜默失敗：錯誤如實回傳，前端顯示紅字而非假 0
    return new Response(JSON.stringify({ error: '查詢失敗', detail: (e as Error).message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};

function round1(v: number | null) { return v == null ? null : Math.round(v * 10) / 10; }
