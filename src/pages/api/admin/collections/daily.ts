// GET /api/admin/collections/daily — 每日收款工作板（manager only）
// Tab1=現結逐張(v_cash_invoice_detail) / Tab2=月結應收 / Tab3=逾期 / Tab4=支票 / Tab5=停供候選
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

// POST — 寫入追收記錄
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

  const r = await withTimeout(
    fetch(`${SUPABASE_URL}/rest/v1/inari_collection_actions`, {
      method: 'POST',
      headers: { ...sbHeaders(key), Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: TENANT_ID, canon_code,
        customer_name: customer_name || null, invoice_ref: invoice_ref || null,
        action_date: macauToday(), method,
        notes: notes || null, promised_date: promised_date || null,
        created_by: (locals as any).userEmail || 'manager',
      }),
    }),
    5000
  );
  if (!r.ok) return new Response(JSON.stringify({ error: `寫入失敗: ${await r.text()}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const data = await r.json();
  return new Response(JSON.stringify({ ok: true, id: data[0]?.id }), { headers: { 'Content-Type': 'application/json' } });
};

// GET — 每日工作板
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
    const [followup, cashInvoices, cheques, suspendRows, freshness] = await Promise.all([
      // v_daily_followup：月結/逾期 tab 使用
      get('v_daily_followup?select=canon_code,customer_name,salesperson,slot,inv_ym,expect_ym,outstanding,n_inv,bucket,last_action_date,last_action_method,last_action_notes,promised_date,last_action_by'),
      // v_cash_invoice_detail：Tab1 現結逐張發票
      get('v_cash_invoice_detail?select=invoice_no,invoice_date,canon_code,customer_code,customer_name,salesperson,payment_type,amount,status,days_overdue,last_action_date,last_action_method,last_action_notes,promised_date&order=days_overdue.desc,amount.desc'),
      // 支票：30天內到期
      get(`inari_collections?select=id,customer_code,customer_name,amount,cheque_no,cheque_bank,cheque_due_date,cheque_status,invoice_no&cheque_status=eq.待兌現&cheque_due_date=lte.${chequeDeadline}&order=cheque_due_date.asc`),
      // 停供候選（上月或更早仍未收的月結客）
      get('v_suspend_candidates?select=canon_code,customer_name,salesperson,due_date,is_suspended,earliest_unpaid_date,total_overdue,invoice_count,months_overdue'),
      // 數據新鮮度
      get('inari_daily_invoices?select=invoice_date&order=invoice_date.desc&limit=1'),
    ]);

    // Tab 2：月結應收（本月到期，非現金即收）
    const monthlyTab = followup
      .filter((r: any) => r.slot !== '現金即收' && r.bucket === '本月到期')
      .sort((a: any, b: any) => {
        const slotOrder = ['15號', '25號', '次結', '延後2月', '岫收', '未設'];
        const ia = slotOrder.indexOf(a.slot); const ib = slotOrder.indexOf(b.slot);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || num(b.outstanding) - num(a.outstanding);
      });

    // Tab 3：逾期追收（所有逾期，按金額）
    const overdueTab = followup
      .filter((r: any) => r.bucket === '逾期·要追')
      .sort((a: any, b: any) => num(b.outstanding) - num(a.outstanding));

    const sumAmt = (arr: any[], key = 'outstanding') => arr.reduce((s: number, r: any) => s + num(r[key]), 0);

    return new Response(JSON.stringify({
      meta: {
        generated_at: new Date().toISOString(),
        latest_invoice: freshness[0]?.invoice_date || null,
        cheque_window_days: 30,
      },
      cash: {
        count: cashInvoices.length,
        total: sumAmt(cashInvoices, 'amount'),
        rows: cashInvoices,
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
      suspend: {
        count: suspendRows.length,
        total: sumAmt(suspendRows, 'total_overdue'),
        rows: suspendRows,
      },
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
