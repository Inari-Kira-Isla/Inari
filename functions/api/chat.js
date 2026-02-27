const MINIMAX_API_URL = "https://api.minimax.io/v1/chat/completions";

const BASE_PROMPT = `你是 INARI 網站的客服助手。你的職責是：
- 幫助訪客了解網站內容和服務
- 回答關於 INARI 的問題
- 提供友善、專業的對話體驗
- 如果不確定的問題，誠實告知並建議訪客直接聯繫我們
請用繁體中文回答，保持簡潔有禮。

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

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // 從 D1 讀取知識庫
    let knowledge = "";
    const db = context.env.DB;
    try {
      if (db) {
        const { results } = await db.prepare(
          "SELECT category, question, answer FROM knowledge ORDER BY category, id"
        ).all();

        if (results && results.length > 0) {
          const sections = {};
          for (const row of results) {
            if (!sections[row.category]) {
              sections[row.category] = [];
            }
            sections[row.category].push(row);
          }

          const parts = [];
          for (const [category, rows] of Object.entries(sections)) {
            parts.push(`【${category}】`);
            for (const row of rows) {
              if (row.question) {
                parts.push(`Q: ${row.question}`);
                parts.push(`A: ${row.answer}`);
              } else {
                parts.push(row.answer);
              }
            }
            parts.push("");
          }
          knowledge = parts.join("\n");
        }
      }
    } catch {
      // 知識庫讀取失敗時繼續運作
    }

    const systemPrompt = BASE_PROMPT + knowledge;

    const body = await context.request.json();
    const userMessages = body.messages || [];
    const sessionId = body.session_id || null;

    // 取得最後一條用戶訊息並寫入 D1
    const lastUserMessage = userMessages.length > 0 && userMessages[userMessages.length - 1].role === "user"
      ? userMessages[userMessages.length - 1].content
      : null;

    if (sessionId && lastUserMessage && db) {
      try {
        await db.prepare(
          "INSERT INTO conversations (session_id, role, message) VALUES (?, 'user', ?)"
        ).bind(sessionId, lastUserMessage).run();
      } catch {
        // 寫入失敗不影響聊天功能
      }
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...userMessages,
    ];

    const stream = body.stream !== false;

    const apiResponse = await fetch(MINIMAX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-M2.1",
        messages,
        stream,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return new Response(
        JSON.stringify({ error: "MiniMax API error", details: errorText }),
        { status: apiResponse.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (stream) {
      // 若有 session_id，使用 TransformStream 攔截串流並累積完整回應
      if (sessionId && db) {
        let accumulatedText = "";

        const { readable, writable } = new TransformStream({
          transform(chunk, controller) {
            // 轉發 chunk 給前端
            controller.enqueue(chunk);

            // 累積解碼文字以取得完整回應
            const text = new TextDecoder().decode(chunk, { stream: true });
            const lines = text.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  accumulatedText += delta;
                }
              } catch {
                // 忽略解析錯誤
              }
            }
          },
          async flush(controller) {
            // 串流結束後寫入 AI 回應到 D1（strip think tags）
            const cleanText = stripThinkTags(accumulatedText);
            if (cleanText && sessionId) {
              try {
                await db.prepare(
                  "INSERT INTO conversations (session_id, role, message) VALUES (?, 'assistant', ?)"
                ).bind(sessionId, cleanText).run();
              } catch {
                // 寫入失敗不影響回應
              }
            }
          },
        });

        // 將 API 回應 pipe 進 TransformStream
        apiResponse.body.pipeTo(writable).catch(() => {});

        return new Response(readable, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      // 無 session_id 時直接轉發串流
      return new Response(apiResponse.body, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    const data = await apiResponse.json();

    // 非串流模式也寫入 AI 回應
    if (sessionId && db) {
      try {
        const assistantContent = data.choices?.[0]?.message?.content || "";
        const cleanContent = stripThinkTags(assistantContent);
        if (cleanContent) {
          await db.prepare(
            "INSERT INTO conversations (session_id, role, message) VALUES (?, 'assistant', ?)"
          ).bind(sessionId, cleanContent).run();
        }
      } catch {
        // 寫入失敗不影響回應
      }
    }

    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
}
