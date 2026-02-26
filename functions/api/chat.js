const MINIMAX_API_URL = "https://api.minimax.io/v1/chat/completions";

const SYSTEM_PROMPT = `你是 INARI 網站的客服助手。你的職責是：
- 幫助訪客了解網站內容和服務
- 回答關於 INARI 的問題
- 提供友善、專業的對話體驗
- 如果不確定的問題，誠實告知並建議訪客直接聯繫我們
請用繁體中文回答，保持簡潔有禮。`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

    const body = await context.request.json();
    const userMessages = body.messages || [];

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
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
      return new Response(apiResponse.body, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    const data = await apiResponse.json();
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
