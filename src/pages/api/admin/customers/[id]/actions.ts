// GET /api/admin/customers/[id]/actions — 該客戶追收記錄（近6個月）
// [id] 為 canon_code 或 customer_code
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);
}

export const GET: APIRoute = async ({ locals, params }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const canonCode = params.id;
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const sinceStr = since.toISOString().slice(0, 10);

  try {
    const r = await withTimeout(
      fetch(
        `${SUPABASE_URL}/rest/v1/inari_collection_actions` +
        `?canon_code=eq.${encodeURIComponent(canonCode)}` +
        `&tenant_id=eq.${TENANT_ID}` +
        `&action_date=gte.${sinceStr}` +
        `&order=action_date.desc,created_at.desc` +
        `&select=id,action_date,method,notes,promised_date,created_by`,
        { headers: sbHeaders(key) }
      ),
      5000
    );
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const rows = await r.json();
    return new Response(JSON.stringify({ rows }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
