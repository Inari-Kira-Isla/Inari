const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// GET /api/knowledge - 列出所有知識（可用 ?category= 篩選）
export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("Database not configured", 500);

    const url = new URL(context.request.url);
    const category = url.searchParams.get("category");

    let stmt;
    if (category) {
      stmt = db.prepare(
        "SELECT id, category, question, answer, created_at, updated_at FROM knowledge WHERE category = ? ORDER BY id"
      ).bind(category);
    } else {
      stmt = db.prepare(
        "SELECT id, category, question, answer, created_at, updated_at FROM knowledge ORDER BY category, id"
      );
    }

    const { results } = await stmt.all();
    return jsonResponse({ items: results });
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

// POST /api/knowledge - 新增知識
export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("Database not configured", 500);

    const body = await context.request.json();
    const { category, question, answer } = body;

    if (!category || !answer) {
      return errorResponse("category 和 answer 為必填欄位");
    }

    const result = await db.prepare(
      "INSERT INTO knowledge (category, question, answer) VALUES (?, ?, ?)"
    ).bind(category, question || null, answer).run();

    return jsonResponse({ ok: true, id: result.meta.last_row_id }, 201);
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

// PUT /api/knowledge - 更新知識
export async function onRequestPut(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("Database not configured", 500);

    const body = await context.request.json();
    const { id, category, question, answer } = body;

    if (!id) return errorResponse("id 為必填");
    if (!category || !answer) {
      return errorResponse("category 和 answer 為必填欄位");
    }

    const result = await db.prepare(
      "UPDATE knowledge SET category = ?, question = ?, answer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(category, question || null, answer, id).run();

    if (result.meta.changes === 0) {
      return errorResponse("找不到指定的知識條目", 404);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

// DELETE /api/knowledge - 刪除知識
export async function onRequestDelete(context) {
  try {
    const db = context.env.DB;
    if (!db) return errorResponse("Database not configured", 500);

    const url = new URL(context.request.url);
    let id = url.searchParams.get("id");

    if (!id) {
      try {
        const body = await context.request.json();
        id = body.id;
      } catch {
        // ignore
      }
    }

    if (!id) return errorResponse("id 為必填");

    const result = await db.prepare(
      "DELETE FROM knowledge WHERE id = ?"
    ).bind(id).run();

    if (result.meta.changes === 0) {
      return errorResponse("找不到指定的知識條目", 404);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}
