import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha1(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME") ?? "";
    const apiKey = Deno.env.get("CLOUDINARY_API_KEY") ?? "";
    const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET") ?? "";
    if (!supabaseUrl || !anonKey || !cloudName || !apiKey || !apiSecret) {
      throw new Error("Cloudinary upload signing is not configured.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const resourceType = body.kind === "video" ? "video" : body.kind === "image" ? "image" : null;
    if (!resourceType) return json({ error: "Media kind must be image or video." }, 400);

    const folder = `buysell/products/${authData.user.id}/${resourceType}s`;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sha1(`folder=${folder}&timestamp=${timestamp}${apiSecret}`);

    return json({ cloud_name: cloudName, api_key: apiKey, timestamp, folder, signature, resource_type: resourceType });
  } catch (error) {
    console.error("cloudinary-sign-upload error:", error);
    return json({ error: error instanceof Error ? error.message : "Could not sign Cloudinary upload." }, 400);
  }
});
