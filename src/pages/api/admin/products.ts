// GET /api/admin/products — manager only, full product list for admin UI
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
  const category = url.searchParams.get('category') || '';
  // status: 'active' (default) | 'inactive' | 'all'
  const status = url.searchParams.get('status') || 'active';
  const limit = Math.min(700, parseInt(url.searchParams.get('limit') || '700'));

  let filter = `${SUPABASE_URL}/rest/v1/inari_products?order=is_active.desc,category.asc,name.asc&limit=${limit}`;
  filter += `&select=id,sku,name,category,unit,sales_price,storage_type,is_air_freight,origin,is_active,stock_qty,stock_unit,stock_min_qty`;
  if (status === 'active')   filter += `&is_active=eq.true`;
  if (status === 'inactive') filter += `&is_active=eq.false`;
  // status === 'all' → no filter
  if (category) filter += `&category=eq.${encodeURIComponent(category)}`;
  if (q) filter += `&or=(name.ilike.%25${encodeURIComponent(q)}%25,sku.ilike.%25${encodeURIComponent(q)}%25)`;

  const resp = await fetch(filter, { headers: sbHeaders });
  if (!resp.ok) {
    return new Response(JSON.stringify({ error: 'DB error', detail: await resp.text() }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const products = await resp.json();
  const contentRange = resp.headers.get('Content-Range') || '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? parseInt(totalMatch[1]) : products.length;

  return new Response(JSON.stringify({ products, total }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// PATCH /api/admin/products — toggle is_active (manager) or update stock_qty (staff+manager)
export const PATCH: APIRoute = async ({ locals, request }) => {
  if (locals.userType !== 'manager' && locals.userType !== 'staff') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const body = await request.json();
  const { id, is_active, stock_qty, stock_unit, stock_notes } = body;

  if (!id) {
    return new Response(JSON.stringify({ error: 'id 為必填' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // is_active toggle requires manager
  if (typeof is_active === 'boolean' && locals.userType !== 'manager') {
    return new Response(JSON.stringify({ error: '權限不足' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const patch: Record<string, any> = {};
  if (typeof is_active === 'boolean') patch.is_active = is_active;
  if (stock_qty !== undefined) patch.stock_qty = stock_qty;
  if (stock_unit !== undefined) patch.stock_unit = stock_unit;
  if (stock_notes !== undefined) patch.stock_notes = stock_notes;

  if (!Object.keys(patch).length) {
    return new Response(JSON.stringify({ error: '無可更新欄位' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/inari_products?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });

  if (!resp.ok) {
    return new Response(JSON.stringify({ error: await resp.text() }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
