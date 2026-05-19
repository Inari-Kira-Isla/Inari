// POST /api/login — legacy single-password login

import type { APIRoute } from 'astro';

const COOKIE_NAME = 'inari_auth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const password = body.password || '';
  const expectedPassword = import.meta.env.SITE_PASSWORD || 'inari2026';

  if (password !== expectedPassword) {
    return new Response(JSON.stringify({ error: '密碼錯誤' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const token = btoa(expectedPassword);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
    },
  });
};
