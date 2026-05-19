// POST /api/chat
// Mode 1: CloudPipe Customer AI (with OpenClaw memory)
// Mode 2: Direct MiniMax call (fallback)
// Note: D1 conversation storage is not available on Vercel — conversations are stateless

import type { APIRoute } from 'astro';

const MINIMAX_API_URL = 'https://api.minimax.io/anthropic/v1/messages';

// CloudPipe Customer AI endpoint (via Cloudflare Tunnel)
// Set CLOUDPIPE_URL env var to enable
const CLOUDPIPE_ENABLED = true;

const BASE_PROMPT = `你是稻荷環球食品（INARI Global Food Ltd.）的 AI 客服助手。
專營高品質海膽（日本/加拿大產），服務對象為澳門及港澳餐廳採購。
回覆風格：專業、親切、簡潔。以繁體中文回覆。
如不確定答案，請誠實告知，不要捏造資訊。

以下是你的知識庫，請根據這些資訊回答問題：
`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

// === Mode 1: via CloudPipe Customer AI (with OpenClaw memory) ===
async function callCloudPipe(
  cloudpipeUrl: string,
  message: string,
  sessionId: string,
  customerId: string | null
): Promise<string> {
  const resp = await fetch(`${cloudpipeUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      session_id: sessionId,
      customer_id: customerId || sessionId,
      channel: 'web',
      learn: true,
    }),
  });

  if (!resp.ok) throw new Error(`CloudPipe error: ${resp.status}`);
  const data = await resp.json();
  return data.reply || '';
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const userMessages: { role: string; content: string }[] = body.messages || [];
    const sessionId: string = body.session_id || `web-${Date.now()}`;
    const stream: boolean = body.stream !== false;

    const lastUserMessage =
      userMessages.length > 0 && userMessages[userMessages.length - 1].role === 'user'
        ? userMessages[userMessages.length - 1].content
        : null;

    if (!lastUserMessage) {
      return new Response(JSON.stringify({ error: 'No user message' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const cloudpipeUrl = import.meta.env.CLOUDPIPE_URL;

    // === Mode 1: CloudPipe Customer AI ===
    if (CLOUDPIPE_ENABLED && cloudpipeUrl) {
      try {
        const reply = await callCloudPipe(cloudpipeUrl, lastUserMessage, sessionId, null);
        const cleanReply = stripThinkTags(reply);

        if (stream) {
          const sseBody = `data: ${JSON.stringify({ choices: [{ delta: { content: cleanReply } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sseBody, {
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            },
          });
        }

        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: cleanReply } }],
          }),
          { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        // CloudPipe failed — fall through to MiniMax
        console.error('CloudPipe fallback:', (e as Error).message);
      }
    }

    // === Mode 2: Direct MiniMax call (fallback) ===
    const apiKey = import.meta.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // D1 knowledge base is not available on Vercel — use base prompt only
    const systemPrompt = BASE_PROMPT;
    const chatMessages = userMessages.filter((m) => m.role !== 'system');

    const apiResponse = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        system: systemPrompt,
        messages: chatMessages,
        max_tokens: 1024,
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      return new Response(JSON.stringify({ error: 'MiniMax API error', details: errorText }), {
        status: apiResponse.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const data = await apiResponse.json();
    const assistantContent =
      (data.content || []).find((b: { type: string; text?: string }) => b.type === 'text')?.text ||
      '';
    const cleanContent = stripThinkTags(assistantContent);

    if (stream) {
      const sseBody = `data: ${JSON.stringify({ choices: [{ delta: { content: cleanContent } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sseBody, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: cleanContent } }],
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: (err as Error).message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
};
