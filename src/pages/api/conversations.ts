// GET/DELETE /api/conversations
// Note: Originally used Cloudflare D1 for conversation storage.
// On Vercel, conversation history is not persisted (stateless).
// Returns empty results gracefully.

import type { APIRoute } from 'astro';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id');

  if (sessionId) {
    // No persistent storage on Vercel — return empty conversation
    return new Response(JSON.stringify({ messages: [] }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } else {
    // Return empty sessions list
    return new Response(JSON.stringify({ sessions: [], total: 0 }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'session_id is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // No-op on Vercel (no persistent conversation storage)
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};
