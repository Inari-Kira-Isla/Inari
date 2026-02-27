const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) {
      return new Response(
        JSON.stringify({ error: "Database not configured" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(context.request.url);
    const sessionId = url.searchParams.get("session_id");

    if (sessionId) {
      // Get full conversation for a specific session
      const { results } = await db.prepare(
        "SELECT id, session_id, role, message, created_at FROM conversations WHERE session_id = ? ORDER BY id ASC"
      ).bind(sessionId).all();

      return new Response(
        JSON.stringify({ messages: results || [] }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    } else {
      // List all sessions with summary info
      const { results } = await db.prepare(`
        SELECT
          session_id,
          COUNT(*) as message_count,
          MAX(created_at) as last_message_at,
          MIN(created_at) as first_message_at
        FROM conversations
        GROUP BY session_id
        ORDER BY last_message_at DESC
      `).all();

      // For each session, get the first user message as preview
      const sessions = [];
      for (const row of (results || [])) {
        const previewResult = await db.prepare(
          "SELECT message FROM conversations WHERE session_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1"
        ).bind(row.session_id).first();

        sessions.push({
          session_id: row.session_id,
          message_count: row.message_count,
          last_message_at: row.last_message_at,
          first_message_at: row.first_message_at,
          preview: previewResult ? previewResult.message : "",
        });
      }

      // Get total count
      const totalResult = await db.prepare(
        "SELECT COUNT(DISTINCT session_id) as total FROM conversations"
      ).first();

      return new Response(
        JSON.stringify({ sessions, total: totalResult ? totalResult.total : 0 }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}

export async function onRequestDelete(context) {
  try {
    const db = context.env.DB;
    if (!db) {
      return new Response(
        JSON.stringify({ error: "Database not configured" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(context.request.url);
    const sessionId = url.searchParams.get("session_id");

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    await db.prepare("DELETE FROM conversations WHERE session_id = ?").bind(sessionId).run();

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}
