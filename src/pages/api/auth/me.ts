// GET /api/auth/me — returns current user info from JWT

import type { APIRoute } from 'astro';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS });

export const GET: APIRoute = async ({ locals }) => {
  const userType = locals.userType || '';
  if (!userType) {
    return new Response(JSON.stringify({ error: '未登入' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      user_type: locals.userType,
      username: locals.username,
      customer_code: locals.customerCode || null,
      is_staff: locals.isStaff,
    }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
};
