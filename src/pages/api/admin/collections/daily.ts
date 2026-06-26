// GET /api/admin/collections/daily — 每日收款工作板（manager only）
// 四個 Tab：現金待收 / 月結應收 / 逾期追收 / 支票到期
// 資料來源：v_daily_followup（v_collection_tracking + inari_collection_actions）
//           inari_collections（支票）

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);
}
const num = (v: any) => parseFloat(v || '0') || 0;

function macauToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Macau' });
}
function macauDatePlus(days: number): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Macau' }));
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// POST /api/admin/collections/daily — 寫入追收記錄
export const POST: APIRoute = async ({ locals, request }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: '格式錯誤' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { canon_code, customer_name, invoice_ref, method, notes, promised_date } = body;
  if (!canon_code || !method) {
    return new Response(JSON.stringify({ error: '必填：canon_code, method' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const payload = {
    tenant_id: TENANT_ID,
    canon_code,
    customer_name: customer_name || null,
    invoice_ref: invoice_ref || null,
    action_date: macauToday(),
    method,
    notes: notes || null,
    promised_date: promised_date || null,
    created_by: (locals as any).userEmail || 'manager',
  };

  const r = await withTimeout(
    fetch(`${SUPABASE_URL}/rest/v1/inari_collection_actions`, {
      method: 'POST',
      headers: { ...sbHeaders(key), Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    }),
    5000
  );
  if (!r.ok) {
    const err = await r.text();
    return new Response(JSON.stringify({ error: `寫入失敗: ${err}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const data = await r.json();
  return new Response(JSON.stringify({ ok: true, id: data[0]?.id }), { headers: { 'Content-Type': 'application/json' } });
};

export const GET: APIRoute = async ({ locals }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const rest = `${SUPABASE_URL}/rest/v1`;
  const get = async (path: string) => {
    const r = await withTimeout(fetch(`${rest}/${path}`, { headers: sbHeaders(key) }), 5000);
    if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  const chequeDeadline = macauDatePlus(30);

  try {
    const [followup, cheques, freshness] = await Promise.all([
      // v_daily_followup：所有未收（含上次追收記錄）
      get('v_daily_followup?select=canon_code,customer_name,salesperson,slot,inv_ym,expect_ym,outstanding,n_inv,bucket,last_action_date,last_action_method,last_action_notes,promised_date,last_action_by'),
      // 支票：未兌現 + 30天內到期
      get(`inari_collections?select=id,customer_code,customer_name,amount,cheque_no,cheque_bank,cheque_due_date,cheque_status,invoice_no&cheque_status=eq.待兌現&cheque_due_date=lte.${chequeDeadline}&order=cheque_due_date.asc`),
      // 數據新鮮度
      get('inari_daily_invoices?select=invoice_date&order=invoice_date.desc&limit=1'),
    ]);

    // Tab 1：現金/轉帳待收（本月到期 + 槽='現金即收'；逾期現金也含）
    const cashTab = followup
      .filter((r: any) => r.slot === '現金即收' && (r.bucket === '本月到期' || r.bucket === '逾期·要追' || r.bucket === '現金·需即收'))
      .sort((a: any, b: any) => num(b.outstanding) - num(a.outstanding));

    // Tab 2：月結應收（本月到期，非現金即收）
    const monthlyTab = followup
      .filter((r: any) => r.slot !== '現金即收' && r.bucket === '本月到期')
      .sort((a: any, b: any) => {
        const slotOrder = ['15號', '25號', '次結', '延後2月', '岫收', '未設'];
        return slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot) || num(b.outstanding) - num(a.outstanding);
      });

    // Tab 3：逾期追收（所有逾期，按金額排）
    const overdueTab = followup
      .filter((r: any) => r.bucket === '逾期·要追')
      .sort((a: any, b: any) => num(b.outstanding) - num(a.outstanding));

    // 統計
    const sumAmt = (arr: any[]) => arr.reduce((s: number, r: any) => s + num(r.outstanding), 0);

    return new Response(JSON.stringify({
      meta: {
        generated_at: new Date().toISOString(),
        latest_invoice: freshness[0]?.invoice_date || null,
        cheque_window_days: 30,
      },
      cash: {
        count: cashTab.length,
        total: sumAmt(cashTab),
        rows: cashTab,
      },
      monthly: {
        count: monthlyTab.length,
        total: sumAmt(monthlyTab),
        rows: monthlyTab,
      },
      overdue: {
        count: overdueTab.length,
        total: sumAmt(overdueTab),
        rows: overdueTab,
      },
      cheques: {
        count: cheques.length,
        total: cheques.reduce((s: number, r: any) => s + num(r.amount), 0),
        rows: cheques,
      },
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
