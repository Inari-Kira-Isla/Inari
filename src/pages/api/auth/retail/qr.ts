// GET /api/auth/retail/qr?t=<qr_token>
// QR 免密碼登入交換：驗簽名 token → 查撤銷表 → 發 wholesale session cookie → 302 去落單頁。
// 安全（Fable P1 護欄）：token 簽名+過期(verifyJWT)+DB可撤銷+綁死單一 customer_code。
// QR token 長效(印/存),但只用嚟換一個短效 session,唔直接做 session。
import type { APIRoute } from 'astro';
import { signJWT, verifyJWT, makeTokenExpiry } from '../../../../lib/jwt';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const COOKIE_NAME = 'inari_auth_v3';
const LOGIN = '/shop/login';

function fail(reason: string) {
  return new Response(null, { status: 302, headers: { Location: `${LOGIN}?err=${reason}` } });
}

export const GET: APIRoute = async ({ request }) => {
  const t = new URL(request.url).searchParams.get('t') || '';
  const jwtSecret = import.meta.env.JWT_SECRET;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!t || !jwtSecret || !serviceKey) return fail('qr_config');

  // 1. 驗簽名 + 過期（verifyJWT 已檢 exp/iss/簽名）
  const payload = (await verifyJWT(t, jwtSecret)) as any;
  if (!payload || payload.purpose !== 'qr' || !payload.customer_code || !payload.jti) {
    return fail('qr_invalid');
  }

  // 2. DB 撤銷檢查（token 有效但可能被人手撤銷）
  const qUrl =
    `${SUPABASE_URL}/rest/v1/inari_qr_tokens?jti=eq.${encodeURIComponent(payload.jti)}` +
    `&select=jti,revoked,expires_at,use_count&limit=1`;
  const resp = await fetch(qUrl, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!resp.ok) return fail('qr_check');
  const rec = (await resp.json())?.[0];
  if (!rec || rec.revoked) return fail('qr_revoked');
  if (rec.expires_at && new Date(rec.expires_at).getTime() < Date.now()) return fail('qr_expired');

  // 3. 發 wholesale session（短效；customer_code 由已驗證 token 帶,永不信 client）
  const session = await signJWT(
    {
      sub: payload.sub,
      username: payload.username || `qr_${payload.customer_code}`,
      user_type: 'wholesale',
      customer_code: payload.customer_code,
      exp: makeTokenExpiry('wholesale'),
    },
    jwtSecret
  );

  // 4. 記錄使用（fire-and-forget,唔阻登入）
  fetch(`${SUPABASE_URL}/rest/v1/inari_qr_tokens?jti=eq.${encodeURIComponent(payload.jti)}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ last_used_at: new Date().toISOString(), use_count: (rec.use_count ?? 0) + 1 }),
  }).catch(() => {});

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/shop/order/new',
      'Set-Cookie': `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
    },
  });
};
