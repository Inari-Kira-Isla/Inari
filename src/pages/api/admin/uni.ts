// GET /api/admin/uni — manager/staff only, 海膽商品圖片+價格資料(inari_uni_images)
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: '伺服器設定錯誤' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sbHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'count=exact',
  };

  const q = url.searchParams.get('q') || '';
  const species = url.searchParams.get('species') || ''; // bafun | murasaki
  const grade = url.searchParams.get('grade') || '';
  const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '500'));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));

  const filter =
    `${SUPABASE_URL}/rest/v1/inari_uni_images?order=species.asc,brand.asc,spec_grams.desc&limit=${limit}&offset=${offset}` +
    (species ? `&species=eq.${encodeURIComponent(species)}` : '') +
    (grade ? `&grade=eq.${encodeURIComponent(grade)}` : '') +
    (q
      ? `&or=(brand.ilike.%25${encodeURIComponent(q)}%25,species_ja.ilike.%25${encodeURIComponent(q)}%25,notes.ilike.%25${encodeURIComponent(q)}%25,quote_no.ilike.%25${encodeURIComponent(q)}%25)`
      : '');

  const select =
    'id,quote_no,brand,species,species_ja,scientific_name,origin_region,form,spec_grams,grade,color_tone,alum_status,price_jpy,image_type,public_url,validation_status,notes,created_at';

  const resp = await fetch(`${filter}&select=${select}`, { headers: sbHeaders });
  if (!resp.ok) {
    return new Response(JSON.stringify({ error: 'DB error', detail: await resp.text() }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = await resp.json();
  const total = resp.headers.get('content-range')?.split('/')?.[1] ?? String(rows.length);

  return new Response(JSON.stringify({ rows, total: Number(total) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
