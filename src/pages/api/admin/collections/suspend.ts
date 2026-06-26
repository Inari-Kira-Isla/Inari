// PATCH /api/admin/collections/suspend — 標記/解除停供（manager only）
// body: { canon_code, is_suspended, note? }
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);
}

export const PATCH: APIRoute = async ({ locals, request }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: '格式錯誤' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { canon_code, is_suspended } = body;
  if (!canon_code || typeof is_suspended !== 'boolean') {
    return new Response(JSON.stringify({ error: '必填：canon_code, is_suspended(boolean)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // 更新 inari_customers — 用 canon_code 對應（可能一對多，需找出所有 raw codes）
  const rest = `${SUPABASE_URL}/rest/v1`;
  const get = async (path: string) => {
    const r = await withTimeout(fetch(`${rest}/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }), 5000);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  };

  try {
    // 找出所有屬於該 canon 的 customer_code
    const mapped = await get(`inari_code_canon_map?canon_code=eq.${encodeURIComponent(canon_code)}&select=raw_code`);
    const codes = mapped.length
      ? mapped.map((m: any) => m.raw_code)
      : [canon_code];

    // PATCH inari_customers for all matching codes
    await Promise.all(codes.map((code: string) =>
      withTimeout(
        fetch(`${rest}/inari_customers?customer_code=eq.${encodeURIComponent(code)}`, {
          method: 'PATCH',
          headers: sbHeaders(key),
          body: JSON.stringify({ is_suspended }),
        }),
        5000
      )
    ));

    return new Response(JSON.stringify({ ok: true, canon_code, is_suspended }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
