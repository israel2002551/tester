import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const messageRow = body.record
    if (!messageRow) throw new Error("No payload record captured from database event trigger.")

    const senderId = messageRow.sender_id;
    const receiverId = messageRow.receiver_id;
    const rawContent = messageRow.content || "";

    // 1. Fetch the sender's details to build a personalized banner message
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("name, store_name")
      .eq("id", senderId)
      .maybeSingle()

    const senderDisplayName = senderProfile?.store_name || senderProfile?.name || "A BUYSELL User";

    // 2. Extract internal configuration credentials securely from environment memory
    const appId = Deno.env.get('ONESIGNAL_APP_ID')
    const restApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY')

    if (!appId || !restApiKey) {
      throw new Error("OneSignal credentials are missing from Supabase vault setup.")
    }

    // 3. TARGET USER DEVICES DYNAMICALLY VIA THEIR SUPABASE USER ID
    // OneSignal links device tokens to custom 'External IDs'. We use the receiver's UUID.
    const oneSignalPayload = {
      app_id: appId,
      target_channel: "push",
      include_aliases: {
        external_id: [receiverId] 
      },
      headings: {
        en: "✉️ New Message on BUYSELL"
      },
      contents: {
        en: `${senderDisplayName}: "${rawContent.substring(0, 60)}..."`
      },
      // Appends custom parameters so clicking the notification opens the exact chat box layout
      data: {
        chatPartnerId: senderId
      },
      url: `https://buysell-marketplace.com?chat=${senderId}` 
    }

    const dispatchResponse = await fetch("https://onesignal.com/api/v1/notifications", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${restApiKey}`
      },
      body: JSON.stringify(oneSignalPayload)
    })

    const dispatchResult = await dispatchResponse.json()

    return new Response(JSON.stringify({ success: true, response: dispatchResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    })
  }
})