// POST /api/voice/parse
// Body: {text: "三文魚20公斤105蚊", customer_code?: "SJZ"}
// Returns parsed order items with product matches

const SUPABASE_URL = "https://cqartwwsbxnjjatmndtt.supabase.co";
const MINIMAX_API_URL = "https://api.minimax.io/anthropic/v1/messages";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PARSE_PROMPT = `你是稻荷環球食品的訂單解析器。
從以下客戶語音/文字中，提取訂單明細。

規則：
1. 識別商品名稱、數量、單位、單價
2. 數量單位：kg/公斤、盒、包、條、片、件
3. 輸出 JSON 格式（不要有其他文字）

輸出格式：
{"items":[{"raw":"原文","product_guess":"猜測商品名","qty":數字,"unit":"單位","unit_price":數字或null}]}

範例輸入：三文魚20公斤105蚊 海膽5盒
範例輸出：{"items":[{"raw":"三文魚20公斤105蚊","product_guess":"三文魚","qty":20,"unit":"kg","unit_price":105},{"raw":"海膽5盒","product_guess":"海膽","qty":5,"unit":"盒","unit_price":null}]}`;

async function callMiniMax(apiKey, text) {
  const resp = await fetch(MINIMAX_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "MiniMax-M2.5",
      system: PARSE_PROMPT,
      messages: [{ role: "user", content: text }],
      max_tokens: 512,
    }),
  });
  if (!resp.ok) throw new Error(`MiniMax error ${resp.status}`);
  const data = await resp.json();
  const raw = (data.content || []).find((b) => b.type === "text")?.text || "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  return JSON.parse(jsonMatch[0]);
}

async function matchProducts(items, serviceKey) {
  const enriched = [];
  for (const item of items) {
    const guess = item.product_guess || item.raw || "";
    const kwUrl = `${SUPABASE_URL}/rest/v1/inari_product_keywords?keyword=ilike.%${encodeURIComponent(guess)}%&select=sku,keyword&limit=3`;
    const prodUrl = `${SUPABASE_URL}/rest/v1/inari_products?or=(name.ilike.%${encodeURIComponent(guess)}%,product_name_clean.ilike.%${encodeURIComponent(guess)}%)&is_active=eq.true&select=id,sku,name,unit,sales_price&limit=3`;

    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    };

    const [kwResp, prodResp] = await Promise.all([
      fetch(kwUrl, { headers }),
      fetch(prodUrl, { headers }),
    ]);

    const kwRows = kwResp.ok ? await kwResp.json() : [];
    const prodRows = prodResp.ok ? await prodResp.json() : [];

    let matched = null;
    let confidence = "unmatched";

    if (kwRows.length > 0) {
      const sku = kwRows[0].sku;
      const pUrl = `${SUPABASE_URL}/rest/v1/inari_products?sku=eq.${encodeURIComponent(sku)}&select=id,sku,name,unit,sales_price&limit=1`;
      const pResp = await fetch(pUrl, { headers });
      const pRows = pResp.ok ? await pResp.json() : [];
      if (pRows.length > 0) { matched = pRows[0]; confidence = "keyword"; }
    }

    if (!matched && prodRows.length > 0) {
      matched = prodRows[0];
      confidence = "fuzzy";
    }

    enriched.push({
      ...item,
      product_code: matched?.sku || null,
      product_name: matched?.name || null,
      product_id: matched?.id || null,
      suggested_unit: matched?.unit || item.unit,
      suggested_price: item.unit_price ?? matched?.sales_price ?? null,
      match_confidence: confidence,
    });
  }
  return enriched;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const text = (body.text || "").trim();

    if (!text) {
      return new Response(JSON.stringify({ error: "請提供語音文字" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const apiKey = context.env.MINIMAX_API_KEY;
    const serviceKey = context.env.SUPABASE_SERVICE_KEY || context.env.SUPABASE_ANON_KEY;

    // Parse text with MiniMax
    let parsed = { items: [] };
    if (apiKey) {
      try {
        parsed = await callMiniMax(apiKey, text);
      } catch (e) {
        // Fallback: treat whole text as single unmatched item
        parsed = { items: [{ raw: text, product_guess: text, qty: null, unit: null, unit_price: null }] };
      }
    } else {
      parsed = { items: [{ raw: text, product_guess: text, qty: null, unit: null, unit_price: null }] };
    }

    // Match each item to products in Supabase
    const enrichedItems = serviceKey
      ? await matchProducts(parsed.items, serviceKey)
      : parsed.items.map((i) => ({ ...i, match_confidence: "unmatched" }));

    return new Response(
      JSON.stringify({ ok: true, items: enrichedItems, raw_text: text }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "解析失敗", message: err.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}
