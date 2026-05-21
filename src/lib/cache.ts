// analytics_cache wrapper — read-through cache backed by Supabase table.
// Table: analytics_cache (id uuid, cache_key text, cache_type text,
//                         data jsonb, created_at timestamptz, expires_at timestamptz)
// Phase 1 Day 3.1 — 2026-05-21

const SUPABASE_URL = 'https://cqartwwsbxnjjatmndtt.supabase.co';

function sbHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function getKey(): string | null {
  const k = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  return k || null;
}

export interface CachedResult<T> {
  data: T;
  cached: boolean;
  cacheAge?: number;          // seconds since cache write
  source?: string;            // 'cache' | 'fresh' | 'stale-fallback'
}

interface CacheRow {
  cache_key: string;
  cache_type: string;
  data: unknown;
  created_at: string;
  expires_at: string;
}

/**
 * Read-through cache. Returns cached data if fresh, else runs `query()`
 * and writes the result. On query failure, returns stale cache if available.
 */
export async function cachedQuery<T>(
  key: string,
  cacheType: string,
  ttlSec: number,
  query: () => Promise<T>,
  options?: { force?: boolean; staleOnError?: boolean },
): Promise<CachedResult<T>> {
  const sbKey = getKey();
  if (!sbKey) {
    const data = await query();
    return { data, cached: false, source: 'fresh-no-cache' };
  }
  const headers = sbHeaders(sbKey);
  const force = options?.force === true;
  const staleOnError = options?.staleOnError !== false; // default true

  // 1. Try cache hit (unless forced)
  let staleRow: CacheRow | null = null;
  if (!force) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/analytics_cache?cache_key=eq.${encodeURIComponent(key)}&select=*&limit=1`,
        { headers },
      );
      if (resp.ok) {
        const rows: CacheRow[] = await resp.json();
        if (rows.length > 0) {
          const row = rows[0];
          const expiresAt = new Date(row.expires_at).getTime();
          const createdAt = new Date(row.created_at).getTime();
          const age = Math.round((Date.now() - createdAt) / 1000);
          if (expiresAt > Date.now()) {
            return { data: row.data as T, cached: true, cacheAge: age, source: 'cache' };
          }
          staleRow = row;
        }
      }
    } catch {
      // Cache check failed — fall through to query
    }
  }

  // 2. Run fresh query
  try {
    const data = await query();
    // 3. Write cache (fire-and-forget; don't block response)
    void writeCache(key, cacheType, data, ttlSec, headers);
    return { data, cached: false, source: 'fresh' };
  } catch (e) {
    if (staleOnError && staleRow) {
      const createdAt = new Date(staleRow.created_at).getTime();
      const age = Math.round((Date.now() - createdAt) / 1000);
      return { data: staleRow.data as T, cached: true, cacheAge: age, source: 'stale-fallback' };
    }
    throw e;
  }
}

async function writeCache(
  key: string,
  cacheType: string,
  data: unknown,
  ttlSec: number,
  headers: Record<string, string>,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    // Upsert via PostgREST: POST with Prefer: resolution=merge-duplicates
    // requires UNIQUE constraint on cache_key (verified — analytics_cache has it)
    await fetch(`${SUPABASE_URL}/rest/v1/analytics_cache?on_conflict=cache_key`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        cache_key: key,
        cache_type: cacheType,
        data,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
      }),
    });
  } catch {
    // Silent fail — cache write is best-effort
  }
}

/** Invalidate a cache entry. */
export async function invalidateCache(key: string): Promise<void> {
  const sbKey = getKey();
  if (!sbKey) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/analytics_cache?cache_key=eq.${encodeURIComponent(key)}`,
      { method: 'DELETE', headers: sbHeaders(sbKey) },
    );
  } catch {}
}
