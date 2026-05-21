// POST /api/auth/login
// Replaces /api/shop-login with HS256 JWT + HttpOnly cookie
// Body: { username, password }

import type { APIRoute } from 'astro';
import { signJWT, makeTokenExpiry } from '../../../lib/jwt';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const COOKIE_NAME = 'inari_auth_v3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const username = (body.username || '').trim();
    const password = body.password || '';

    if (!username || !password) {
      return new Response(JSON.stringify({ error: '請輸入用戶名和密碼' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
    const jwtSecret = import.meta.env.JWT_SECRET;

    if (!serviceKey || !jwtSecret) {
      return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const qUrl =
      `${SUPABASE_URL}/rest/v1/inari_users` +
      `?username=eq.${encodeURIComponent(username)}&is_active=eq.true` +
      `&select=id,username,user_type,customer_code,web_password&limit=1`;

    const resp = await fetch(qUrl, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: '查詢失敗' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const users = await resp.json();
    if (!users?.length) {
      return new Response(JSON.stringify({ error: '用戶名或密碼錯誤' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const user = users[0];
    const stored = user.web_password || '';

    if (!stored.startsWith('$sha256$')) {
      return new Response(JSON.stringify({ error: '帳戶未設定網頁密碼，請聯繫管理員' }), {
        status: 403,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (await sha256Hex(password) !== stored.slice('$sha256$'.length)) {
      return new Response(JSON.stringify({ error: '用戶名或密碼錯誤' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const userType = (user.user_type || 'staff') as 'staff' | 'manager' | 'wholesale';
    const token = await signJWT(
      {
        sub: user.id,
        username: user.username,
        user_type: userType,
        customer_code: user.customer_code ?? null,
        exp: makeTokenExpiry(userType),
      },
      jwtSecret
    );

    const maxAge = userType === 'manager' ? 8 * 3600 : 7 * 24 * 3600;

    return new Response(
      JSON.stringify({ ok: true, user_type: userType, username: user.username, customer_code: user.customer_code }),
      {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: '系統錯誤', message: (err as Error).message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
};
