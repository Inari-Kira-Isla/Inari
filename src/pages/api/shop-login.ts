// POST /api/shop-login
// Supports username+password (B2B/B2C/staff)
// Queries Supabase inari_users, verifies SHA-256 web_password
// Sets inari_auth_v2 cookie with user context

import type { APIRoute } from 'astro';

const COOKIE_NAME = 'inari_auth_v2';
const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const username = (body.username || '').trim();
    const password = body.password || '';

    if (!username || !password) {
      return new Response(JSON.stringify({ error: '請輸入用戶名和密碼' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const serviceKey =
      import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;

    if (!serviceKey) {
      return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Query inari_users by username
    const queryUrl = `${SUPABASE_URL}/rest/v1/inari_users?username=eq.${encodeURIComponent(username)}&is_active=eq.true&select=id,username,role,user_type,customer_code,web_password&limit=1`;
    const resp = await fetch(queryUrl, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: '查詢失敗' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const users = await resp.json();
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ error: '用戶名或密碼錯誤' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const user = users[0];
    const storedHash = user.web_password || '';

    // Format: $sha256$<hex>
    if (!storedHash.startsWith('$sha256$')) {
      return new Response(JSON.stringify({ error: '帳戶未設定網頁密碼，請聯繫管理員' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const expected = storedHash.slice('$sha256$'.length);
    const provided = await sha256Hex(password);

    if (provided !== expected) {
      return new Response(JSON.stringify({ error: '用戶名或密碼錯誤' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Build session token (7 days)
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const session = {
      v: 2,
      id: user.id,
      username: user.username,
      user_type: user.user_type || 'staff',
      role: user.role || 'staff',
      customer_code: user.customer_code || null,
      exp,
    };
    const token = btoa(JSON.stringify(session));

    return new Response(
      JSON.stringify({
        ok: true,
        user_type: session.user_type,
        username: session.username,
        customer_code: session.customer_code,
      }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; Secure; SameSite=Strict; Max-Age=604800`,
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: '系統錯誤', message: (err as Error).message }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }
};
