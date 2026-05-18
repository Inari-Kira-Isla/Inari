// POST /api/cart/sync — sync client cart to Supabase (fire-and-forget backup)
// Not critical path — client localStorage is source of truth

const SUPABASE_URL = "https://cqartwwsbxnjjatmndtt.supabase.co";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  // Always return 200 — cart sync is best-effort, never block UI
  try {
    const userType = context.request.headers.get("X-User-Type") || "";
    if (!userType) {
      return new Response(JSON.stringify({ ok: true, skipped: "not logged in" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await context.request.json();
    const { session_id, items } = body;

    if (!session_id || !Array.isArray(items)) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Note: inari_cart table may not exist yet in Supabase
    // If it fails, we just return ok anyway
    const key = context.env.SUPABASE_SERVICE_KEY || context.env.SUPABASE_ANON_KEY;
    if (key && items.length > 0) {
      const customer_code = context.request.headers.get("X-Customer-Code") || null;
      const TENANT_ID = "b15d5a02-764c-4353-ad40-07b901d9f321";

      // Delete old cart items for this session
      await fetch(
        `${SUPABASE_URL}/rest/v1/inari_cart?session_id=eq.${encodeURIComponent(session_id)}&tenant_id=eq.${TENANT_ID}`,
        {
          method: "DELETE",
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        }
      ).catch(() => {});

      // Insert fresh items
      const payload = items.map((item) => ({
        session_id,
        customer_code,
        product_id: item.product_id || null,
        sku: item.sku,
        product_name: item.product_name,
        qty: item.qty,
        unit: item.unit,
        unit_price: item.unit_price,
        tenant_id: TENANT_ID,
      }));

      await fetch(`${SUPABASE_URL}/rest/v1/inari_cart`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  } catch {
    // Always succeed
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
