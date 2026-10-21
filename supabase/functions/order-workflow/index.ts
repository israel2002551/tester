const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OrderPayload = {
  id?: string;
  name?: string;
  contact?: string;
  destination?: string;
  request?: string;
  status?: string;
  adminPin?: string;
};

const allowedStatuses = new Set([
  "Submitted",
  "Checking price",
  "Awaiting payment",
  "Ordered",
  "At China warehouse",
  "Shipped",
  "Delivered",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function assertAdmin(pin?: string) {
  const expected = Deno.env.get("ADMIN_PIN");
  if (!expected || pin !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function supabaseRest(path: string, init: RequestInit = {}) {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Supabase REST request failed");
  }
  return data;
}

function formatTelegramOrder(order: Record<string, string>) {
  return [
    "New 1688 order request",
    `Order ID: ${order.id}`,
    `Name: ${order.name}`,
    `Contact: ${order.contact}`,
    `Destination: ${order.destination}`,
    `Status: ${order.status}`,
    "",
    order.request,
  ].join("\n");
}

async function sendTelegram(text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return "not_configured";

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) return "failed";
  return "sent";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "create_order";

    if (action === "create_order") {
      const payload = body as OrderPayload;
      if (!payload.name || !payload.contact || !payload.destination || !payload.request) {
        return jsonResponse({ error: "Missing required order fields" }, 400);
      }

      const [order] = await supabaseRest("orders", {
        method: "POST",
        body: JSON.stringify({
          name: payload.name,
          contact: payload.contact,
          destination: payload.destination,
          request: payload.request,
          status: "Submitted",
          telegram_result: "pending",
        }),
      });

      const telegramResult = await sendTelegram(formatTelegramOrder(order));
      const [updated] = await supabaseRest(`orders?id=eq.${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ telegram_result: telegramResult }),
      });

      return jsonResponse({ order: updated });
    }

    if (action === "list_orders") {
      const adminError = assertAdmin(body.adminPin);
      if (adminError) return adminError;
      const orders = await supabaseRest("orders?select=*&order=created_at.desc", { method: "GET" });
      return jsonResponse({ orders });
    }

    if (action === "update_status") {
      const adminError = assertAdmin(body.adminPin);
      if (adminError) return adminError;
      if (!body.id || !allowedStatuses.has(body.status)) {
        return jsonResponse({ error: "Invalid order status update" }, 400);
      }
      const [order] = await supabaseRest(`orders?id=eq.${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: body.status }),
      });
      return jsonResponse({ order });
    }

    if (action === "delete_order") {
      const adminError = assertAdmin(body.adminPin);
      if (adminError) return adminError;
      if (!body.id) return jsonResponse({ error: "Missing order ID" }, 400);
      await supabaseRest(`orders?id=eq.${body.id}`, { method: "DELETE" });
      return jsonResponse({ ok: true });
    }

    if (action === "resend_telegram") {
      const adminError = assertAdmin(body.adminPin);
      if (adminError) return adminError;
      if (!body.id) return jsonResponse({ error: "Missing order ID" }, 400);
      const [order] = await supabaseRest(`orders?id=eq.${body.id}&select=*`, { method: "GET" });
      if (!order) return jsonResponse({ error: "Order not found" }, 404);
      const telegramResult = await sendTelegram(formatTelegramOrder(order));
      const [updated] = await supabaseRest(`orders?id=eq.${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ telegram_result: telegramResult }),
      });
      return jsonResponse({ order: updated });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
