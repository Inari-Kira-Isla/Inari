import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const TENANT_ID = 'b15d5a02-764c-4353-ad40-07b901d9f321';

function sbHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function managerOnly(locals: App.Locals) {
  return locals.userType !== 'manager';
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS' },
  });

export const GET: APIRoute = async ({ locals }) => {
  if (managerOnly(locals)) {
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

  const [suppResp, quotesResp] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/inari_suppliers` +
      `?select=id,supplier_name,contact_person,phone,email,address,payment_terms,notes,is_active` +
      `&order=id.asc`,
      { headers: sbHeaders(key) }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/inari_supplier_quotes` +
      `?select=id,supplier_id,product_id,product_name,unit_price,unit,spec,quote_date` +
      `&order=supplier_id.asc,product_name.asc&limit=2000`,
      { headers: sbHeaders(key) }
    ),
  ]);

  if (!suppResp.ok) {
    return new Response(JSON.stringify({ error: 'DB error', detail: await suppResp.text() }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const suppliers: any[] = await suppResp.json();
  const quotesBySupplier = new Map<number, any[]>();

  if (quotesResp.ok) {
    const quotes: any[] = await quotesResp.json();
    for (const q of quotes) {
      if (!quotesBySupplier.has(q.supplier_id)) quotesBySupplier.set(q.supplier_id, []);
      quotesBySupplier.get(q.supplier_id)!.push(q);
    }
  }

  const result = suppliers.map(s => ({
    ...s,
    quotes: quotesBySupplier.get(s.id) || [],
    quote_count: (quotesBySupplier.get(s.id) || []).length,
  }));

  return new Response(JSON.stringify({ suppliers: result }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: APIRoute = async ({ locals, request }) => {
  if (managerOnly(locals)) {
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

  const body = await request.json();
  const { id, contact_person, phone, email, address, payment_terms, notes } = body;

  if (!id) {
    return new Response(JSON.stringify({ error: 'id 為必填' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const patch: Record<string, any> = {};
  if (contact_person !== undefined) patch.contact_person = contact_person;
  if (phone !== undefined) patch.phone = phone;
  if (email !== undefined) patch.email = email;
  if (address !== undefined) patch.address = address;
  if (payment_terms !== undefined) patch.payment_terms = payment_terms;
  if (notes !== undefined) patch.notes = notes;

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_suppliers?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(key), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    }
  );

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
