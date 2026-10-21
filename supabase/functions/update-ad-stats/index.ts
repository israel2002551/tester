import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fail, handleOptions, json, readJson } from "../_shared/common.ts";

serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function environment is not configured");
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = await readJson(req);
    const field = body.type === "click" ? "clicks" : "views";
    const { data: ad, error: fetchError } = await admin.from("advertisements").select(field).eq("id", body.adId).single();
    if (fetchError) throw fetchError;
    const { error } = await admin.from("advertisements").update({
      [field]: Number(ad?.[field] || 0) + 1
    }).eq("id", body.adId);
    if (error) throw error;
    return json({
      success: true
    });
  } catch (error) {
    return fail(error);
  }
});