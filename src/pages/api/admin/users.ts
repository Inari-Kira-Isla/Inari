// GET /api/admin/users   — list all users
// POST /api/admin/users  — create user
// PUT /api/admin/users   — update user (id in body)

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const GET: APIRoute = async ({ locals }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403 });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_users?select=id,username,user_type,customer_code,is_active,created_at&order=created_at.desc`,
    { headers: sbHeaders(key) }
  );
  const users = resp.ok ? await resp.json() : [];
  return new Response(JSON.stringify({ users }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403 });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const body = await request.json();
  const { username, password, user_type, customer_code } = body;

  if (!username || !password || !user_type) {
    return new Response(JSON.stringify({ error: '缺少必填欄位' }), { status: 400 });
  }

  const web_password = await sha256(password);
  const payload = { username, web_password, user_type, customer_code: customer_code || null, is_active: true };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/inari_users`, {
    method: 'POST',
    headers: sbHeaders(key),
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.text();
    if (err.includes('duplicate') || err.includes('unique')) {
      return new Response(JSON.stringify({ error: '用戶名已存在' }), { status: 409 });
    }
    return new Response(JSON.stringify({ error: '建立失敗', detail: err }), { status: 500 });
  }

  const [user] = await resp.json();
  return new Response(JSON.stringify({ ok: true, user }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

export const PUT: APIRoute = async ({ locals, request }) => {
  if (locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), { status: 403 });
  }
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const body = await request.json();
  const { id, user_type, customer_code, is_active, password } = body;

  if (!id) return new Response(JSON.stringify({ error: '缺少 id' }), { status: 400 });

  const patch: Record<string, unknown> = {};
  if (user_type !== undefined) patch.user_type = user_type;
  if (customer_code !== undefined) patch.customer_code = customer_code || null;
  if (is_active !== undefined) patch.is_active = is_active;
  if (password) patch.web_password = await sha256(password);

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_users?id=eq.${id}`,
    { method: 'PATCH', headers: sbHeaders(key), body: JSON.stringify(patch) }
  );

  if (!resp.ok) {
    return new Response(JSON.stringify({ error: '更新失敗' }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};
