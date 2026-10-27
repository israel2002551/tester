// Admin Telegram alerts that need only TELEGRAM_BOT_TOKEN.
//
// Telegram cannot deliver a message without a recipient chat ID, so instead of
// configuring one by hand an admin sends /start to the bot once. The chat is
// discovered with the bot token (getUpdates) and stored in
// public.telegram_admin_chats, because Telegram keeps updates for only 24h.
//
// Only private chats from usernames in TELEGRAM_ADMIN_USERNAMES are linked;
// otherwise anyone who messages the bot would receive buyer details.
// An explicit TELEGRAM_CHAT_ID / TELEGRAM_ADMIN_CHAT_ID still takes precedence.

export type TelegramResult = { sent: number; failed: number; reason?: string; errors?: string[] };

function env(name: string) {
  return (Deno.env.get(name) ?? "").trim();
}

function botToken() {
  return env("TELEGRAM_BOT_TOKEN");
}

function botId(token: string) {
  const id = token.split(":")[0];
  return /^\d+$/.test(id) ? id : "";
}

function adminUsernames() {
  return env("TELEGRAM_ADMIN_USERNAMES")
    .split(",")
    .map((name) => name.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

async function restRequest(path: string, init: RequestInit = {}) {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase function environment is not configured.");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Could not access linked Telegram chats (${response.status}).`);
  return text ? JSON.parse(text) : null;
}

async function telegram(token: string, method: string, payload: Record<string, unknown> | FormData) {
  // FormData uploads a file; fetch sets the multipart boundary header itself.
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, payload instanceof FormData
    ? { method: "POST", body: payload }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.description || `Telegram ${method} failed with ${response.status}`);
  }
  return body?.result;
}

async function storedChatIds(id: string): Promise<string[]> {
  const rows = await restRequest(`telegram_admin_chats?bot_id=eq.${id}&select=chat_id`);
  return (Array.isArray(rows) ? rows : []).map((row) => String(row.chat_id));
}

/** Links admins who sent /start to the bot. Returns the newly linked chat IDs. */
async function discoverAdminChats(token: string, id: string): Promise<string[]> {
  const allowed = adminUsernames();
  if (!allowed.length) return [];

  // No offset is sent, so updates are only read, never acknowledged.
  const updates = await telegram(token, "getUpdates", { allowed_updates: ["message"], timeout: 0 });
  const chats = new Map<string, string>();
  for (const update of Array.isArray(updates) ? updates : []) {
    const message = update?.message;
    const username = String(message?.from?.username || "").toLowerCase();
    if (message?.chat?.type !== "private" || !String(message?.text || "").startsWith("/start")) continue;
    if (!allowed.includes(username)) continue;
    chats.set(String(message.chat.id), username);
  }
  if (!chats.size) return [];

  await restRequest("telegram_admin_chats?on_conflict=bot_id,chat_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([...chats].map(([chatId, username]) => ({ bot_id: id, chat_id: chatId, username }))),
  });
  await Promise.allSettled([...chats.keys()].map((chatId) => telegram(token, "sendMessage", {
    chat_id: chatId,
    text: "BUYSELL admin alerts are now linked to this chat.",
  })));
  return [...chats.keys()];
}

async function adminChatIds(token: string): Promise<{ chatIds: string[]; reason?: string }> {
  const configured = env("TELEGRAM_CHAT_ID") || env("TELEGRAM_ADMIN_CHAT_ID");
  if (configured) return { chatIds: [configured] };

  const id = botId(token);
  if (!id) return { chatIds: [], reason: "TELEGRAM_BOT_TOKEN is not a valid bot token." };
  const stored = await storedChatIds(id);
  if (stored.length) return { chatIds: stored };

  if (!adminUsernames().length) {
    return { chatIds: [], reason: "Set TELEGRAM_ADMIN_USERNAMES, then send /start to the bot from that account." };
  }
  try {
    const linked = await discoverAdminChats(token, id);
    if (linked.length) return { chatIds: linked };
  } catch (error) {
    // 409 means another process (a webhook or a polling bot) owns this bot's updates.
    const message = error instanceof Error ? error.message : String(error);
    return { chatIds: [], reason: `Could not read the bot's /start messages: ${message}` };
  }
  return { chatIds: [], reason: "No admin has sent /start to the bot yet." };
}

async function deliver(method: string, payloadFor: (chatId: string) => Record<string, unknown> | FormData): Promise<TelegramResult> {
  const token = botToken();
  if (!token) return { sent: 0, failed: 0, reason: "TELEGRAM_BOT_TOKEN is not configured." };

  const { chatIds, reason } = await adminChatIds(token);
  if (!chatIds.length) return { sent: 0, failed: 0, reason };

  const results = await Promise.allSettled(chatIds.map((chatId) => telegram(token, method, payloadFor(chatId))));
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  return { sent: results.length - errors.length, failed: errors.length, ...(errors.length ? { errors } : {}) };
}

/** Sends a Bot API message (sendMessage, sendPhoto, ...) to every linked admin chat. */
export function sendTelegramToAdmins(method: string, payload: Record<string, unknown>): Promise<TelegramResult> {
  return deliver(method, (chatId) => ({ ...payload, chat_id: chatId }));
}

/**
 * Uploads a file with sendPhoto or sendDocument to every linked admin chat.
 * Use this for private files: Telegram cannot download a URL that needs auth.
 */
export function sendTelegramFileToAdmins(
  method: "sendPhoto" | "sendDocument",
  file: Blob,
  filename: string,
  fields: Record<string, string> = {},
): Promise<TelegramResult> {
  return deliver(method, (chatId) => {
    const form = new FormData();
    form.set("chat_id", chatId);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set(method === "sendPhoto" ? "photo" : "document", file, filename);
    return form;
  });
}
