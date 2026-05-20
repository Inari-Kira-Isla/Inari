// POST /api/auth/logout — clears all auth cookies

import type { APIRoute } from 'astro';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CLEAR_COOKIES = [
  'inari_auth_v3=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
  'inari_auth_v2=; Path=/; Secure; SameSite=Strict; Max-Age=0',
  'inari_auth=; Path=/; Secure; SameSite=Strict; Max-Age=0',
].join(', ');

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS });

export const POST: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Set-Cookie': CLEAR_COOKIES,
    },
  });
};
