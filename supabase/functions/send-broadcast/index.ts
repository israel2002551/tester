import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function handleOptions(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

function json(body: Record<string, unknown> | any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(error: any) {
  console.error("Function error:", error);
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("authenticated") ? 401 : message.includes("Admin") ? 403 : 500;
  return json({ error: message }, status);
}

async function readJson(req: Request) {
  return await req.json().catch(() => ({}));
}

async function getAuthedClient(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("Not authenticated");
  }
  return { admin, user: authData.user };
}

async function ensureAdmin(admin: ReturnType<typeof createClient>, user: any) {
  const adminEmails = (Deno.env.get("ADMIN_EMAILS") ?? Deno.env.get("ADMIN_EMAIL") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  const email = String(user.email || "").toLowerCase();
  const { data: profile } = await admin
    .from("profiles")
    .select("role,email")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role === "admin") return;
  if (adminEmails.includes(email)) return;
  throw new Error("Admin access required");
}

type Target = "all" | "buyers" | "sellers" | "service_providers";

type ProfileRow = {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  accounts?: string | null;
};

const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
const fromEmail = Deno.env.get("FROM_EMAIL") ?? "BUYSELL Nigeria <info@updates.buysell-markerplace.com>";

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);
}

function profileMatchesTarget(profile: ProfileRow, target: Target) {
  const role = String(profile.role || "buyer");
  const accounts = String(profile.accounts || "");
  const isSeller = role === "seller" || role === "both" || accounts === "seller" || accounts === "both";
  const isBuyer = role === "buyer" || role === "both" || accounts === "buyer" || accounts === "both";
  const isProvider = role === "service_provider" || accounts === "service_provider";

  if (target === "buyers") return isBuyer;
  if (target === "sellers") return isSeller;
  if (target === "service_providers") return isProvider;
  return isBuyer || isSeller || isProvider;
}

async function countRows(admin: ReturnType<typeof createClient>, table: string, filter?: (query: any) => any) {
  try {
    let query = admin.from(table).select("id", { count: "exact", head: true });
    if (filter) query = filter(query);
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  } catch {
    return 0;
  }
}

async function selectRows<T>(
  admin: ReturnType<typeof createClient>,
  table: string,
  columns: string,
  options: { limit?: number; order?: string; ascending?: boolean; filter?: (query: any) => any } = {},
) {
  try {
    let query = admin.from(table).select(columns);
    if (options.filter) query = options.filter(query);
    if (options.order) query = query.order(options.order, { ascending: options.ascending ?? false });
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as T[];
  } catch {
    return [] as T[];
  }
}

async function getPlatformSnapshot(admin: ReturnType<typeof createClient>) {
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalUsers,
    buyers,
    sellers,
    serviceProviders,
    activeProducts,
    pendingProducts,
    orders,
    recentOrders,
    pendingDisputes,
    pendingKyc,
    pendingReceipts,
    pendingAds,
    recentBroadcasts,
    recentProducts,
  ] = await Promise.all([
    countRows(admin, "profiles"),
    countRows(admin, "profiles", (q) => q.eq("role", "buyer")),
    countRows(admin, "profiles", (q) => q.eq("role", "seller")),
    countRows(admin, "profiles", (q) => q.eq("role", "service_provider")),
    countRows(admin, "products", (q) => q.eq("status", "active")),
    countRows(admin, "products", (q) => q.eq("status", "pending")),
    selectRows<{ total_amount?: number | null; status?: string | null }>(admin, "orders", "total_amount,status", {
      limit: 5000,
      filter: (q) => q.gte("created_at", since30),
    }),
    countRows(admin, "orders", (q) => q.gte("created_at", since7)),
    countRows(admin, "disputes", (q) => q.in("status", ["open", "pending", "in_review"])),
    countRows(admin, "kyc_verifications", (q) => q.in("status", ["pending", "in_review"])),
    countRows(admin, "commission_receipts", (q) => q.eq("status", "pending")),
    countRows(admin, "ads", (q) => q.in("status", ["pending", "pending_payment", "in_review"])),
    selectRows<{ title?: string | null; body?: string | null; created_at?: string | null }>(
      admin,
      "broadcasts",
      "title,body,created_at",
      { limit: 3, order: "created_at" },
    ),
    selectRows<{ name?: string | null; price?: number | null; created_at?: string | null }>(
      admin,
      "products",
      "name,price,created_at",
      { limit: 5, order: "created_at", filter: (q) => q.eq("status", "active") },
    ),
  ]);

  const revenue30 = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const delivered30 = orders.filter((order) => order.status === "delivered").length;
  const pending30 = orders.filter((order) => ["pending", "confirmed", "processing"].includes(String(order.status || ""))).length;

  return {
    generatedAt: new Date().toISOString(),
    totalUsers,
    buyers,
    sellers,
    serviceProviders,
    activeProducts,
    pendingProducts,
    orders30: orders.length,
    recentOrders,
    delivered30,
    pending30,
    revenue30,
    pendingDisputes,
    pendingKyc,
    pendingReceipts,
    pendingAds,
    recentBroadcasts,
    recentProducts,
  };
}

function buildEmailHtml(params: {
  title: string;
  message: string;
  target: Target;
  snapshot: Awaited<ReturnType<typeof getPlatformSnapshot>>;
}) {
  const { title, message, target, snapshot } = params;
  const broadcasts = snapshot.recentBroadcasts.length
    ? snapshot.recentBroadcasts.map((item) => `<li><strong>${esc(item.title || "Update")}</strong>: ${esc(item.body || "")}</li>`).join("")
    : "<li>No recent admin broadcasts.</li>";
  const products = snapshot.recentProducts.length
    ? snapshot.recentProducts.map((item) => `<li>${esc(item.name || "Product")} - ${money(item.price)}</li>`).join("")
    : "<li>No recent active products.</li>";

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7f4;font-family:Arial,sans-serif;color:#18251c">
    <div style="max-width:640px;margin:0 auto;padding:24px">
      <div style="background:#0b2a17;color:#fff;padding:20px;border-radius:10px 10px 0 0">
        <h1 style="margin:0;font-size:22px">BUYSELL Nigeria</h1>
        <p style="margin:6px 0 0;color:#d7f3df;font-size:13px">Website update for ${esc(target.replaceAll("_", " "))}</p>
      </div>
      <div style="background:#fff;padding:22px;border:1px solid #e3e7dc;border-top:0">
        <h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>
        <p style="font-size:15px;line-height:1.6;white-space:pre-line">${esc(message)}</p>

        <h3 style="margin:24px 0 10px;font-size:16px">What is happening on the website</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px;border-bottom:1px solid #edf0e8">Total users</td><td style="padding:8px;border-bottom:1px solid #edf0e8;text-align:right"><strong>${snapshot.totalUsers}</strong></td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #edf0e8">Buyers / Sellers / Service providers</td><td style="padding:8px;border-bottom:1px solid #edf0e8;text-align:right"><strong>${snapshot.buyers} / ${snapshot.sellers} / ${snapshot.serviceProviders}</strong></td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #edf0e8">Active products</td><td style="padding:8px;border-bottom:1px solid #edf0e8;text-align:right"><strong>${snapshot.activeProducts}</strong></td></tr>
        </table>

        <h3 style="margin:24px 0 10px;font-size:16px">Recent notices</h3>
        <ul style="font-size:14px;line-height:1.6;padding-left:18px">${broadcasts}</ul>

        <h3 style="margin:24px 0 10px;font-size:16px">New active products</h3>
        <ul style="font-size:14px;line-height:1.6;padding-left:18px">${products}</ul>
      </div>
      <div style="background:#f0f4ed;color:#6b746d;padding:14px;border-radius:0 0 10px 10px;font-size:12px;text-align:center">
        Sent by BUYSELL Nigeria. Generated ${esc(new Date(snapshot.generatedAt).toLocaleString("en-NG"))}.
      </div>
    </div>
  </body>
</html>`;
}

function buildEmailText(params: {
  title: string;
  message: string;
  target: Target;
  snapshot: Awaited<ReturnType<typeof getPlatformSnapshot>>;
}) {
  const { title, message, target, snapshot } = params;
  return `${title}

${message}

Website update for ${target}:
- Total users: ${snapshot.totalUsers}
- Buyers / Sellers / Service providers: ${snapshot.buyers} / ${snapshot.sellers} / ${snapshot.serviceProviders}
- Active products: ${snapshot.activeProducts}

BUYSELL Nigeria`;
}

async function sendEmailBatch(batch: { from: string; to: string; subject: string; html: string; text: string; }[]) {
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batch),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend batch failed: ${JSON.stringify(data)}`);
  return data;
}

function missingColumn(error: any) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  const quoted = text.match(/'([^']+)' column/i) || text.match(/column "([^"]+)"/i);
  return quoted?.[1] || "";
}

serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    // 1. Authenticate the user and verify admin permission against the updated list
    const { admin, user } = await getAuthedClient(req);
    await ensureAdmin(admin, user);
    
    const body = await readJson(req);

    // 2. Build the sanitized insertion payload
    const updates: Record<string, any> = {
      title: body.title,
      body: body.body,
      target: body.target || "all",
      type: body.type || "info",
      created_by: user.id, // Will be dropped gracefully if missing from the schema cache
      created_at: new Date().toISOString()
    };

    let broadcastId: string | undefined = undefined;

    // 3. Schema healing loop - dynamically adapts to your table configuration
    let inserted = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const { error, data } = await admin
        .from("broadcasts")
        .insert(updates)
        .select("id")
        .maybeSingle();

      if (!error) {
        broadcastId = data?.id;
        inserted = true;
        break;
      }

      const column = missingColumn(error);
      if (!column || !(column in updates)) throw error;

      console.warn(`[BROADCAST SCHEMA MATCH HEAL] Removing unavailable table column: ${column}`);
      delete updates[column];
    }

    if (!inserted) {
      throw new Error("Could not execute database broadcast insertion with available columns");
    }

    // 4. Send emails to matched profiles
    const target = (["all", "buyers", "sellers", "service_providers"].includes(String(body.target))
      ? String(body.target)
      : "all") as Target;
    
    const title = String(body.title || "Latest update from BUYSELL Nigeria").trim();
    
    // Support both body.body and body.message as the content body
    const rawMessage = body.body || body.message || "Here is the latest activity summary from the BUYSELL marketplace.";
    const message = String(rawMessage).trim();
    
    const subject = String(body.subject || title).trim();
    const dryRun = body.dry_run === true; 
    const maxRecipients = Math.min(Math.max(Number(body.max_recipients || 500), 1), 2000);

    const [profiles, snapshot] = await Promise.all([
      selectRows<ProfileRow>(admin, "profiles", "id,email,name,role,accounts", { limit: 5000 }),
      getPlatformSnapshot(admin),
    ]);

    const recipients = profiles
      .filter((profile) => profile.email && profileMatchesTarget(profile, target))
      .filter((profile, index, arr) => arr.findIndex((other) => other.email?.toLowerCase() === profile.email?.toLowerCase()) === index)
      .slice(0, maxRecipients);

    const html = buildEmailHtml({ title, message, target, snapshot });
    const text = buildEmailText({ title, message, target, snapshot });

    if (dryRun) {
      return json({
        success: true,
        broadcast_id: broadcastId,
        dry_run: true,
        target,
        recipient_count: recipients.length,
        sample_recipients: recipients.slice(0, 10).map((profile) => profile.email),
        snapshot,
      });
    }

    if (!resendApiKey) {
      return json({ error: "RESEND_API_KEY is not configured." }, 500);
    }

    const results: any[] = [];
    const failures: any[] = [];

    if (recipients.length > 0) {
      // Chunk recipients in groups of 100 (Resend batch API limit)
      const chunkSize = 100;
      for (let i = 0; i < recipients.length; i += chunkSize) {
        const chunk = recipients.slice(i, i + chunkSize);
        
        const batchPayload = chunk.map((recipient) => ({
          from: fromEmail,
          to: String(recipient.email),
          subject,
          html,
          text,
        }));

        try {
          const result = await sendEmailBatch(batchPayload);
          // Resend returns an array under `data` containing each email's ID or failure
          const resList = Array.isArray(result?.data) ? result.data : [];
          chunk.forEach((recipient, idx) => {
            const resItem = resList[idx];
            if (resItem?.id) {
              results.push({ email: recipient.email, id: resItem.id });
            } else {
              failures.push({
                email: recipient.email,
                error: resItem?.error?.message || resItem?.error || "Send failed without details"
              });
            }
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          chunk.forEach((recipient) => {
            failures.push({ email: recipient.email, error: errorMessage });
          });
        }

        // Delay 1 second between batches to stay safe from Resend's 10 reqs/sec limit
        if (i + chunkSize < recipients.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    return json({
      success: true,
      broadcast_id: broadcastId,
      target,
      sent: results.length,
      failed: failures.length,
      failures: failures.slice(0, 20),
      snapshot,
    }, failures.length ? 207 : 200);

  } catch (error) {
    return fail(error);
  }
});
