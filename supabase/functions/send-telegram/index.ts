const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Telegram Bot API, called directly with the bot token (TELEGRAM_BOT_TOKEN).
const TELEGRAM_API = 'https://api.telegram.org';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }
    const botApi = `${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}`;

    const body = await req.json();

    // Support getUpdates action to discover chat IDs
    if (body.action === 'getUpdates') {
      const response = await fetch(`${botApi}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      });
      const data = await response.json();
      return new Response(
        JSON.stringify(data),
        { status: response.ok ? 200 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const chatIds = parseChatIds(Deno.env.get('TELEGRAM_OWNER_CHAT_ID'));
    if (chatIds.length === 0) {
      throw new Error('TELEGRAM_OWNER_CHAT_ID is not configured');
    }

    const { title, message } = body;

    if (!title || !message) {
      return new Response(
        JSON.stringify({ error: 'title and message are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const text = `🔔 <b>${escapeHtml(title)}</b>\n\n${escapeHtml(message)}`;

    const results = await sendToChats(botApi, chatIds, text);
    if (!results.some((r) => r.ok)) {
      throw new Error(`Telegram API call failed for every chat: ${JSON.stringify(results)}`);
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error sending Telegram message:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * TELEGRAM_OWNER_CHAT_ID may hold one chat id or several separated by commas
 * (people who have pressed Start on the bot, and/or group ids like -1001234567890).
 */
function parseChatIds(raw: string | undefined): string[] {
  return (raw ?? '').split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
}

/** Send one message to every chat; a failure for one chat doesn't stop the others. */
async function sendToChats(botApi: string, chatIds: string[], text: string) {
  return Promise.all(chatIds.map(async (chatId) => {
    try {
      const response = await fetch(`${botApi}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
      const data = await response.json();
      if (!response.ok) console.error(`Telegram send to ${chatId} failed:`, JSON.stringify(data));
      return { chat_id: chatId, ok: response.ok, message_id: data.result?.message_id, error: response.ok ? undefined : data.description };
    } catch (error) {
      console.error(`Telegram send to ${chatId} failed:`, error);
      return { chat_id: chatId, ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }));
}
