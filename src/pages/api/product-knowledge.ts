// GET /api/product-knowledge — unified knowledge API (product_knowledge + zukan + food_md)
import type { APIRoute } from 'astro';

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' },
  });

// Unified shape
interface KnowledgeItem {
  id: string;
  source: 'product_knowledge' | 'zukan' | 'food_md';
  category: string;
  title: string;
  content: string;
  extra: string;
}

export const GET: APIRoute = async ({ url }) => {
  const key = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  if (!key) return json({ error: 'Database not configured' }, 500);

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  const fetchSB = async (path: string) => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    return resp.json();
  };

  // ── Single item detail mode ───────────────────────────────────────────
  const idParam = url.searchParams.get('id') || '';
  if (idParam) {
    const [src, rawId] = idParam.split('_', 2);
    if (!rawId) return json({ error: 'invalid id' }, 400);
    try {
      if (src === 'pk') {
        const [row] = await fetchSB(`product_knowledge?select=*&id=eq.${rawId}&limit=1`);
        return json({ item: row || null });
      }
      if (src === 'zukan') {
        const [row] = await fetchSB(`inari_zukan_species?select=*&id=eq.${rawId}&limit=1`);
        return json({ item: row || null });
      }
      if (src === 'food') {
        const [row] = await fetchSB(`inari_food_knowledge?select=*&id=eq.${rawId}&limit=1`);
        return json({ item: row || null });
      }
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
    return json({ error: 'unknown source' }, 400);
  }

  const sourceParam = url.searchParams.get('source') || 'all';
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const categoryFilter = url.searchParams.get('category') || '';
  // Per-source server-side pagination
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500'), 500);

  // Determine which sources to fetch
  const wantPK = sourceParam === 'all' || sourceParam === 'product_knowledge';
  const wantZukan = sourceParam === 'all' || sourceParam === 'zukan';
  const wantFood = sourceParam === 'all' || sourceParam === 'food_md';

  // Push category filter to server when only one source is requested
  // (cross-source: pk uses `category`, zukan uses `category`, food uses `category` — all same column name)
  const catFilterSql = categoryFilter
    ? `&category=eq.${encodeURIComponent(categoryFilter)}`
    : '';

  const promises: Promise<any[]>[] = [
    wantPK
      ? fetchSB(`product_knowledge?select=id,item_code,item_name,category,subcategory,notes,peak_seasons,grade_system&order=id.asc&limit=${limit}${catFilterSql}`)
      : Promise.resolve([]),
    wantZukan
      ? fetchSB(`inari_zukan_species?select=id,name_ja,scientific_name,category,taste,season,market_note,importance,knowledge_level&order=id.asc&limit=${limit}${catFilterSql}`)
      : Promise.resolve([]),
    wantFood
      ? fetchSB(`inari_food_knowledge?select=id,filename,title,content,category,source_dir&order=id.asc&limit=${limit}${catFilterSql}`)
      : Promise.resolve([]),
  ];

  let [pkRows, zukanRows, foodRows] = await Promise.all(promises.map(p => p.catch(() => [])));

  // ── Normalise into unified shape ────────────────────────────────────────
  const pkItems: KnowledgeItem[] = (pkRows as any[]).map((r: any) => {
    const seasons = Array.isArray(r.peak_seasons) ? r.peak_seasons.join(', ') : '';
    const content = [r.notes, seasons].filter(Boolean).join(' | ');
    return {
      id: `pk_${r.id}`,
      source: 'product_knowledge',
      category: r.category || '',
      title: r.item_name || r.item_code || '',
      content,
      extra: r.subcategory || '',
    };
  });

  const zukanItems: KnowledgeItem[] = (zukanRows as any[]).map((r: any) => {
    const parts = [r.taste, r.season, r.market_note].filter(Boolean);
    return {
      id: `zukan_${r.id}`,
      source: 'zukan',
      category: r.category || '',
      title: r.name_ja || '',
      content: parts.join(' | '),
      extra: r.scientific_name || '',
    };
  });

  const foodItems: KnowledgeItem[] = (foodRows as any[]).map((r: any) => ({
    id: `food_${r.id}`,
    source: 'food_md',
    category: r.category || '',
    title: r.title || r.filename || '',
    content: (r.content || '').slice(0, 300),
    extra: r.source_dir || '',
  }));

  let items: KnowledgeItem[] = [...pkItems, ...zukanItems, ...foodItems];

  // categoryFilter is now applied server-side per source above; no need to
  // re-filter client-side. Search remains client-side because it spans 4 cols.
  if (q) {
    items = items.filter(
      i =>
        i.category.toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.extra.toLowerCase().includes(q),
    );
  }

  return json({ items });
};
