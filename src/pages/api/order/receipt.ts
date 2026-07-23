// POST /api/order/receipt — B2C guest 銀行轉帳備款相片上傳(免login)
// Body: { order_no, guest_phone, image_base64 }
// 用 order_no+guest_phone 兩者都啱做輕量授權(同GET /api/order嘅lookup同一原則),
// 防止亂估order_no格式就可以幫第二張唔相關嘅訂單上傳/覆蓋相片。
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const BUCKET = 'commerce-images';
const MAX_BASE64_LEN = 6_000_000; // ~4.5MB解碼後,防止濫用上傳超大檔

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonError(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request }) => {
  const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError('請求格式錯誤');
  }

  const orderNo = String(body.order_no || '').trim();
  const guestPhone = String(body.guest_phone || '').trim();
  const imageBase64 = String(body.image_base64 || '');

  if (!orderNo || !guestPhone) return jsonError('請提供訂單編號同電話');
  if (!imageBase64.startsWith('data:image/')) return jsonError('圖片格式錯誤');
  if (imageBase64.length > MAX_BASE64_LEN) return jsonError('圖片過大,請壓縮後再試');

  // 核實訂單真係屬於呢個電話(輕量授權,同GET lookup同一原則)
  const checkUrl =
    `${SUPABASE_URL}/rest/v1/inari_customer_orders` +
    `?order_no=eq.${encodeURIComponent(orderNo)}&guest_phone=eq.${encodeURIComponent(guestPhone)}&order_type=eq.b2c&select=id&limit=1`;
  const checkResp = await fetch(checkUrl, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const rows = checkResp.ok ? await checkResp.json() : [];
  if (!rows.length) return jsonError('搵唔到對應訂單', 404);

  const commaIdx = imageBase64.indexOf(',');
  const buffer = Buffer.from(imageBase64.slice(commaIdx + 1), 'base64');
  const objectPath = `order-receipts/${orderNo}.jpg`;

  const uploadResp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    return jsonError('上傳失敗:' + errText, 500);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;

  await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customer_orders?order_no=eq.${encodeURIComponent(orderNo)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ payment_receipt_url: publicUrl }),
    }
  );

  return new Response(JSON.stringify({ ok: true, url: publicUrl }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};
