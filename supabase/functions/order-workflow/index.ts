import { sendTelegramToAdmins } from "../_shared/telegram.ts";

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

// The signed-in user behind the request (JWT verification is on for this function).
async function requestUserId(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return "";
  const response = await fetch(`${requireEnv("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"), Authorization: authorization },
  });
  if (!response.ok) return "";
  const user = await response.json().catch(() => null);
  return typeof user?.id === "string" ? user.id : "";
}

type SourcingItem = { title?: string; url?: string; quantity?: number; variant?: string };

function formatSourcingTelegram(row: Record<string, any>, sellerName: string) {
  const items: SourcingItem[] = Array.isArray(row.items) ? row.items : [];
  const total = Number(row.estimate?.total_ngn || 0);
  return [
    "New 1688 sourcing request",
    `Request: ${String(row.id).slice(0, 6).toUpperCase()}`,
    `Seller: ${sellerName}`,
    `WhatsApp: ${row.contact || "-"}`,
    `Deliver to: ${row.destination || "-"}`,
    `Links: ${items.length}`,
    total ? `Seller's service estimate: NGN ${total.toLocaleString("en-NG")}` : "",
    "",
    ...items.slice(0, 20).map((item, index) =>
      `${index + 1}. ${item.title || "Product"} x${item.quantity || 1}${item.variant ? ` (${item.variant})` : ""}\n${item.url || ""}`
    ),
    items.length > 20 ? `...and ${items.length - 20} more` : "",
    row.note ? `\nNote: ${row.note}` : "",
    "",
    "Quote it in the admin panel: 1688 Requests.",
  ].filter(Boolean).join("\n");
}

async function sendTelegram(text: string) {
  try {
    const result = await sendTelegramToAdmins("sendMessage", { text, disable_web_page_preview: false });
    if (result.sent) return "sent";
    return result.failed ? "failed" : "not_configured";
  } catch (error) {
    console.error("order-workflow Telegram error:", error instanceof Error ? error.message : error);
    return "failed";
  }
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

    // Telegram alert for a new row in public.sourcing_requests, sent by its seller
    // right after saving it (20261103000000_sourcing_requests.sql).
    if (action === "sourcing_alert") {
      const userId = await requestUserId(request);
      if (!userId) return jsonResponse({ error: "Sign in to send a sourcing request." }, 401);
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
        return jsonResponse({ error: "A request id is required." }, 400);
      }
      const [row] = await supabaseRest(`sourcing_requests?id=eq.${body.id}&seller_id=eq.${userId}&select=*`, { method: "GET" });
      if (!row) return jsonResponse({ error: "Request not found" }, 404);
      // Only for new requests, so a page reload cannot repeat the alert later.
      if (Date.now() - new Date(row.created_at).getTime() > 10 * 60 * 1000) return jsonResponse({ telegram: "skipped" });
      const [profile] = await supabaseRest(`profiles?id=eq.${userId}&select=name,store_name`, { method: "GET" });
      const telegram = await sendTelegram(formatSourcingTelegram(row, profile?.store_name || profile?.name || "A seller"));
      return jsonResponse({ telegram });
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
