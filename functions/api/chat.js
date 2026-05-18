const MINIMAX_API_URL = "https://api.minimax.io/anthropic/v1/messages";

// CloudPipe Customer AI 端點（透過 Cloudflare Tunnel 公開）
// 設定好 Tunnel 後，把 CLOUDPIPE_URL 填入 Cloudflare Pages 環境變數
const CLOUDPIPE_ENABLED = true; // 改為 false 退回直接呼叫 MiniMax

const BASE_PROMPT = `你是稻荷環球食品（INARI Global Food Ltd.）的 AI 客服助手。
專營高品質海膽（日本/加拿大產），服務對象為澳門及港澳餐廳採購。
回覆風格：專業、親切、簡潔。以繁體中文回覆。
如不確定答案，請誠實告知，不要捏造資訊。

以下是你的知識庫，請根據這些資訊回答問題：
`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function stripThinkTags(text) {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// === 模式一：透過 CloudPipe Customer AI（帶 OpenClaw 記憶）===
async function callCloudPipe(cloudpipeUrl, message, sessionId, customerId) {
  const resp = await fetch(`${cloudpipeUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      customer_id: customerId || sessionId,
      channel: "web",
      learn: true, // 自動學習，寫回 OpenClaw 知識庫
    }),
  });

  if (!resp.ok) throw new Error(`CloudPipe error: ${resp.status}`);
  const data = await resp.json();
  return data.reply || "";
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const userMessages = body.messages || [];
    const sessionId = body.session_id || `web-${Date.now()}`;
    const stream = body.stream !== false;

    const lastUserMessage = userMessages.length > 0 && userMessages[userMessages.length - 1].role === "user"
      ? userMessages[userMessages.length - 1].content
      : null;

    if (!lastUserMessage) {
      return new Response(JSON.stringify({ error: "No user message" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const db = context.env.DB;
    const cloudpipeUrl = context.env.CLOUDPIPE_URL;

    // === 模式一：CloudPipe Customer AI ===
    if (CLOUDPIPE_ENABLED && cloudpipeUrl) {
      try {
        const reply = await callCloudPipe(cloudpipeUrl, lastUserMessage, sessionId, null);
        const cleanReply = stripThinkTags(reply);

        // 若有 D1，同步寫入對話紀錄
        if (db && sessionId) {
          try {
            await db.prepare("INSERT INTO conversations (session_id, role, message) VALUES (?, 'user', ?)").bind(sessionId, lastUserMessage).run();
            await db.prepare("INSERT INTO conversations (session_id, role, message) VALUES (?, 'assistant', ?)").bind(sessionId, cleanReply).run();
          } catch { /* 寫入失敗不影響回應 */ }
        }

        // 若前端要求串流，模擬 SSE 格式
        if (stream) {
          const words = cleanReply;
          const sseBody = `data: ${JSON.stringify({ choices: [{ delta: { content: words } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sseBody, {
            headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          });
        }

        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: cleanReply } }]
        }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

      } catch (e) {
        // CloudPipe 失敗時退回直接呼叫 MiniMax
        console.error("CloudPipe fallback:", e.message);
      }
    }

    // === 模式二：直接呼叫 MiniMax（備用）===
    const apiKey = context.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // 從 D1 讀取知識庫
    let knowledge = "";
    if (db) {
      try {
        const { results } = await db.prepare(
          "SELECT category, question, answer FROM knowledge ORDER BY category, id"
        ).all();
        if (results?.length > 0) {
          const sections = {};
          for (const row of results) {
            if (!sections[row.category]) sections[row.category] = [];
            sections[row.category].push(row);
          }
          const parts = [];
          for (const [category, rows] of Object.entries(sections)) {
            parts.push(`【${category}】`);
            for (const row of rows) {
              if (row.question) { parts.push(`Q: ${row.question}`); parts.push(`A: ${row.answer}`); }
              else parts.push(row.answer);
            }
            parts.push("");
          }
          knowledge = parts.join("\n");
        }
      } catch { /* 知識庫讀取失敗時繼續 */ }
    }

    const systemPrompt = BASE_PROMPT + knowledge;
    const system = systemPrompt;
    const chatMessages = userMessages.filter(m => m.role !== "system");

    if (db && sessionId && lastUserMessage) {
      try {
        await db.prepare("INSERT INTO conversations (session_id, role, message) VALUES (?, 'user', ?)").bind(sessionId, lastUserMessage).run();
      } catch { /* 寫入失敗不影響 */ }
    }

    const apiResponse = await fetch(MINIMAX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "MiniMax-M2.5",
        system,
        messages: chatMessages,
        max_tokens: 1024,
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return new Response(JSON.stringify({ error: "MiniMax API error", details: errorText }),
        { status: apiResponse.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    const data = await apiResponse.json();
    const assistantContent = (data.content || []).find(b => b.type === "text")?.text || "";
    const cleanContent = stripThinkTags(assistantContent);

    if (db && sessionId && cleanContent) {
      try {
        await db.prepare("INSERT INTO conversations (session_id, role, message) VALUES (?, 'assistant', ?)").bind(sessionId, cleanContent).run();
      } catch { /* 寫入失敗不影響 */ }
    }

    if (stream) {
      const sseBody = `data: ${JSON.stringify({ choices: [{ delta: { content: cleanContent } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sseBody, {
        headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: cleanContent } }]
    }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
}
