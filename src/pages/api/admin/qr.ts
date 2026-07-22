// POST /api/admin/qr  { customer_code }
// 銷售員/員工喺客戶頁生成該客戶嘅 QR 免密碼登入碼。
// staff-only(locals.isStaff)。簽 purpose=qr token → 寫 inari_qr_tokens(可撤銷) → 回 QR dataURL。
export const prerender = false;
import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { signQRToken } from '../../../lib/jwt';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const DEFAULT_DAYS = 180;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals?.isStaff) return json({ error: '需要員工權限' }, 403);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const customer_code = (body.customer_code || '').trim();
  if (!customer_code) return json({ error: '缺 customer_code' }, 400);

  const secret = import.meta.env.JWT_SECRET;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!secret || !serviceKey) return json({ error: '伺服器設定錯誤' }, 500);

  const jti = crypto.randomUUID();
  const sub = `qr_${customer_code}`;
  const exp = Math.floor(Date.now() / 1000) + DEFAULT_DAYS * 24 * 3600;
  const token = await signQRToken(customer_code, jti, sub, exp, secret);

  // 寫撤銷登記
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/inari_qr_tokens`, {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      jti, customer_code, label: `qr ${customer_code}`,
      expires_at: new Date(exp * 1000).toISOString(),
    }),
  });
  if (!ins.ok) return json({ error: '寫入失敗', detail: await ins.text() }, 500);

  // 2026-07-23 UAT 揪出：Vercel serverless function 入面 request.url 唔反映真實對外域名
  // (實測回傳 https://localhost)，令生成嘅 QR 對客戶手機嚟講係死路。改用 Host/X-Forwarded-* header，
  // request.url 之origin 淨做最後 fallback（本地 dev 環境可能冇呢啲 header）。
  const fwdHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
  const base = fwdHost ? `${fwdProto}://${fwdHost}` : new URL(request.url).origin;
  const url = `${base}/api/auth/retail/qr?t=${token}`;
  const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 2 });

  return json({ ok: true, customer_code, url, dataUrl, jti, expires: new Date(exp * 1000).toISOString() });
};
