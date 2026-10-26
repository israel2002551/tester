import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

export async function readJson(req: Request) {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

export async function getAuthedClient(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) throw new Error("Missing authorization header")

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function environment is not configured")

  const token = authHeader.replace("Bearer ", "")
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) throw new Error("Unauthorized")

  return { admin, user }
}

export async function ensureAdmin(admin: any, user: any) {
  const adminEmail = Deno.env.get("ADMIN_EMAIL") || "israelefe093@gmail.com"
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,email")
    .eq("id", user.id)
    .single()

  // Compare the verified sign-in email; profiles.email is written by the browser.
  const callerEmail = String(user?.email || "").trim().toLowerCase()
  if (error || profile?.role !== "admin" || callerEmail !== adminEmail.trim().toLowerCase()) {
    throw new Error("Forbidden: Admin access required")
  }
}

export function handleOptions(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  return null
}

export function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed"
  console.error(message)
  return json({ error: message }, 400)
}

