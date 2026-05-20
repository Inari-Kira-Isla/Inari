// POST /api/voice/parse
// Body: {text: "蠔場\n大八爪1只\n3L甜蝦1盒", customer_code?: "SJZ"}
// Returns parsed order items + optional customer history draft

import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';
const MINIMAX_API_URL = 'https://api.minimax.io/anthropic/v1/messages';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Recognise "1只", "3L", "2kg" etc. at any position in the line
const QTY_UNIT_RE =
  /(\d+(?:\.\d+)?)\s*(只|個|盒|包|條|片|kg|公斤|g|克|箱|袋|瓶|罐|件|尾|頭|塊|打|桶|卷|支|枝|串|碗|份)/i;

// ── Local line-by-line parser (fallback when AI unavailable) ──
function parseTextLocally(text: string): { items: Record<string, unknown>[] } {
  const lines = text
    .split(/[\n,，、；;]/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: Record<string, unknown>[] = [];
  for (const line of lines) {
    const m = line.match(QTY_UNIT_RE);
    if (m) {
      const qty = parseFloat(m[1]);
      const unit = m[2];
      const productGuess = line.replace(m[0], '').replace(/[^一-龥a-zA-Z0-9()（）]/g, ' ').trim() || line;
      items.push({ raw: line, product_guess: productGuess, qty, unit, unit_price: null });
    } else if (line.length > 0 && line.length <= 25) {
      // Short line without explicit qty — likely a product or customer name
      items.push({ raw: line, product_guess: line, qty: 1, unit: '件', unit_price: null });
    }
  }
  return {
    items: items.length > 0 ? items : [{ raw: text, product_guess: text, qty: 1, unit: '件', unit_price: null }],
  };
}

// ── Detect if first line is a customer name (no qty/unit, ≤15 chars) ──
function extractCustomerHint(text: string): { customerHint: string; productText: string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && !QTY_UNIT_RE.test(lines[0]) && lines[0].length <= 15) {
    return { customerHint: lines[0], productText: lines.slice(1).join('\n') };
  }
  return { customerHint: '', productText: text };
}

// ── AI parse via MiniMax ──
const PARSE_PROMPT = `你是稻荷環球食品的訂單解析器。
從以下客戶語音/文字中提取每一行的訂單明細。
注意：第一行可能是客戶名稱（非商品），請跳過。

規則：
1. 每行獨立解析為一個商品項目
2. 識別商品名稱、數量、單位、單價
3. 數量單位：kg/公斤、盒、包、條、片、只、件 等
4. 輸出 JSON（不要有其他文字）

格式：{"items":[{"raw":"原文","product_guess":"商品名","qty":數字,"unit":"單位","unit_price":數字或null}]}

範例輸入：
蠔場
大八爪1只
3L甜蝦1盒

範例輸出：{"items":[{"raw":"大八爪1只","product_guess":"大八爪","qty":1,"unit":"只","unit_price":null},{"raw":"3L甜蝦1盒","product_guess":"3L甜蝦","qty":1,"unit":"盒","unit_price":null}]}`;

async function callMiniMax(
  apiKey: string,
  text: string
): Promise<{ items: Record<string, unknown>[] }> {
  const resp = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.5',
      system: PARSE_PROMPT,
      messages: [{ role: 'user', content: text }],
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`MiniMax error ${resp.status}`);
  const data = await resp.json();
  const raw =
    (data.content || []).find((b: { type: string; text?: string }) => b.type === 'text')?.text || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  return JSON.parse(jsonMatch[0]);
}

// ── Match each item to inari_products ──
async function matchProducts(
  items: Record<string, unknown>[],
  serviceKey: string
): Promise<Record<string, unknown>[]> {
  const enriched = [];
  for (const item of items) {
    const guess = (item.product_guess as string) || (item.raw as string) || '';
    const kwUrl = `${SUPABASE_URL}/rest/v1/inari_product_keywords?keyword=ilike.*${encodeURIComponent(guess)}*&select=sku,keyword&limit=3`;
    const prodUrl =
      `${SUPABASE_URL}/rest/v1/inari_products` +
      `?or=(name.ilike.*${encodeURIComponent(guess)}*,sku.ilike.*${encodeURIComponent(guess)}*)` +
      `&is_active=eq.true&select=id,sku,name,unit,sales_price&limit=3`;

    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const [kwResp, prodResp] = await Promise.all([
      fetch(kwUrl, { headers }),
      fetch(prodUrl, { headers }),
    ]);

    const kwRows: { sku: string }[] = kwResp.ok ? await kwResp.json() : [];
    const prodRows: Record<string, unknown>[] = prodResp.ok ? await prodResp.json() : [];

    let matched: Record<string, unknown> | null = null;
    let confidence = 'unmatched';

    if (kwRows.length > 0) {
      const sku = kwRows[0].sku;
      const pResp = await fetch(
        `${SUPABASE_URL}/rest/v1/inari_products?sku=eq.${encodeURIComponent(sku)}&select=id,sku,name,unit,sales_price&limit=1`,
        { headers }
      );
      const pRows: Record<string, unknown>[] = pResp.ok ? await pResp.json() : [];
      if (pRows.length > 0) { matched = pRows[0]; confidence = 'keyword'; }
    }

    if (!matched && prodRows.length > 0) {
      matched = prodRows[0];
      confidence = 'fuzzy';
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

// ── Load customer history from qb_sales ──
async function getCustomerHistory(
  customerHint: string,
  serviceKey: string
): Promise<{
  customer_code: string;
  customer_name: string;
  last_order_date: string;
  history_items: Record<string, unknown>[];
}> {
  const empty = { customer_code: '', customer_name: '', last_order_date: '', history_items: [] };
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // 1. Find customer by name
  const custResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_customers` +
      `?customer_name=ilike.*${encodeURIComponent(customerHint)}*` +
      `&is_active=eq.true&select=customer_code,customer_name&limit=3`,
    { headers }
  );
  const customers: { customer_code: string; customer_name: string }[] = custResp.ok
    ? await custResp.json()
    : [];
  if (!customers.length) return empty;

  const { customer_code, customer_name } = customers[0];

  // 2. Get most recent order date
  const latestResp = await fetch(
    `${SUPABASE_URL}/rest/v1/qb_sales?customer_code=eq.${customer_code}` +
      `&select=txn_date&order=txn_date.desc&limit=1`,
    { headers }
  );
  const latestRows: { txn_date: string }[] = latestResp.ok ? await latestResp.json() : [];
  if (!latestRows.length) return { ...empty, customer_code, customer_name };

  const last_order_date = latestRows[0].txn_date;

  // 3. Get all distinct items from that date
  const histResp = await fetch(
    `${SUPABASE_URL}/rest/v1/qb_sales?customer_code=eq.${customer_code}` +
      `&txn_date=eq.${last_order_date}&select=item_code,amount`,
    { headers }
  );
  const histRows: { item_code: string; amount: number }[] = histResp.ok
    ? await histResp.json()
    : [];
  if (!histRows.length) return { customer_code, customer_name, last_order_date, history_items: [] };

  // Deduplicate by item_code, keep first amount
  const skuMap = new Map<string, number>();
  for (const r of histRows) {
    if (!skuMap.has(r.item_code)) skuMap.set(r.item_code, r.amount);
  }
  const skus = [...skuMap.keys()];

  // 4. Fetch product info for those SKUs
  const prodsResp = await fetch(
    `${SUPABASE_URL}/rest/v1/inari_products?sku=in.(${skus.map(encodeURIComponent).join(',')})` +
      `&select=sku,name,unit,sales_price`,
    { headers }
  );
  const products: { sku: string; name: string; unit: string; sales_price: number }[] =
    prodsResp.ok ? await prodsResp.json() : [];

  const history_items = products.map((p) => ({
    raw: p.name,
    product_code: p.sku,
    product_name: p.name,
    product_id: null,
    suggested_unit: p.unit,
    suggested_price: p.sales_price,
    qty: 1,
    unit: p.unit,
    match_confidence: 'history' as const,
    last_order_date,
    last_amount: skuMap.get(p.sku),
  }));

  return { customer_code, customer_name, last_order_date, history_items };
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = (body.text || '').trim();
    if (!text) {
      return new Response(JSON.stringify({ error: '請提供語音文字' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = import.meta.env.MINIMAX_API_KEY;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;

    // Detect customer hint from first line
    const { customerHint, productText } = extractCustomerHint(text);

    // Parse product lines: try AI first, fall back to local line parser
    let parsed: { items: Record<string, unknown>[] } = { items: [] };
    const textToParse = productText || text;

    if (apiKey) {
      try {
        parsed = await callMiniMax(apiKey, textToParse);
        // Validate AI returned multiple items for multi-line input
        const lineCount = textToParse.split('\n').filter(Boolean).length;
        if (lineCount > 1 && parsed.items.length === 1) {
          // AI collapsed lines — fall back to local parser
          parsed = parseTextLocally(textToParse);
        }
      } catch {
        parsed = parseTextLocally(textToParse);
      }
    } else {
      parsed = parseTextLocally(textToParse);
    }

    // Match items to products in Supabase
    const enrichedItems = serviceKey
      ? await matchProducts(parsed.items, serviceKey)
      : parsed.items.map((i) => ({ ...i, match_confidence: 'unmatched' }));

    // Load customer history if customer hint detected
    let customerInfo: {
      customer_code: string;
      customer_name: string;
      last_order_date: string;
      history_items: Record<string, unknown>[];
    } = { customer_code: '', customer_name: '', last_order_date: '', history_items: [] };

    if (customerHint && serviceKey) {
      customerInfo = await getCustomerHistory(customerHint, serviceKey);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        items: enrichedItems,
        raw_text: text,
        customer_hint: customerHint,
        customer_code: customerInfo.customer_code,
        customer_name: customerInfo.customer_name,
        last_order_date: customerInfo.last_order_date,
        history_items: customerInfo.history_items,
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: '解析失敗', message: (err as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
};
