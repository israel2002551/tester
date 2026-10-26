// supabase/functions/admin-action/index.ts
// Deploy to Supabase: Dashboard → Edge Functions → New → paste this code
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-set by Supabase)
// Optional env vars: ADMIN_EMAIL (comma-separated list of emails)
//
// This edge function uses the service_role key to bypass RLS,
// allowing the admin to modify ANY user's profile, orders, disputes, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function missingColumn(error: any) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`
  const quoted = text.match(/'([^']+)' column/i) || text.match(/column "([^"]+)"/i)
  return quoted?.[1] || ''
}

async function insertReferralEarning(adminClient: any, payload: Record<string, unknown>) {
  const insertPayload = { ...payload }

  for (let attempt = 0; attempt < 12; attempt++) {
    const { error } = await adminClient.from('referrals').upsert(insertPayload, { onConflict: 'referrer_id,referred_id' })
    if (!error) return

    const column = missingColumn(error)
    if (!column || !(column in insertPayload)) throw error
    delete insertPayload[column]
  }

  throw new Error('Could not create referral earning with the available referrals table columns')
}

async function awardSellerActivationReferral(adminClient: any, sellerId: string) {
  if (!sellerId) return

  const { data: seller, error } = await adminClient
    .from('profiles')
    .select('id,name,email,referred_by')
    .eq('id', sellerId)
    .maybeSingle()
  if (error) throw error

  const referralCode = String(seller?.referred_by || '').trim()
  if (!referralCode) return

  const referrerQuery = adminClient
    .from('profiles')
    .select('id')
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(referralCode)
  const { data: referrer, error: referrerError } = uuidLike
    ? await referrerQuery.or(`referral_code.eq.${referralCode},id.eq.${referralCode}`).maybeSingle()
    : await referrerQuery.eq('referral_code', referralCode).maybeSingle()
  if (referrerError) throw referrerError
  if (!referrer?.id || referrer.id === sellerId) return

  const amount = Number(Deno.env.get('AFFILIATE_REWARD_NAIRA') || '5000')
  await insertReferralEarning(adminClient, {
    referrer_id: referrer.id,
    referred_id: sellerId,
    referred_name: seller?.name || 'New Seller',
    referred_email: seller?.email || '',
    source: 'seller_activation',
    amount,
    paid: false,
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Verify the caller is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Extract JWT and verify user
    const token = authHeader.replace('Bearer ', '')
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized: ' + (authError?.message || 'No user'))

    // 2. Verify the caller is an admin
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role, email')
      .eq('id', user.id)
      .single()

    // Split the ADMIN_EMAIL environment variable into an array of allowed emails
    const adminEmailsEnv = Deno.env.get('ADMIN_EMAIL') || 'israelefe093@gmail.com'
    const allowedAdmins = adminEmailsEnv.split(',').map(email => email.trim().toLowerCase())
    
    // Check the verified sign-in email (not the user-editable profile copy)
    // is in the list AND their database role is 'admin'
    const callerEmail = String(user.email || '').trim().toLowerCase()
    const isAdmin = Boolean(callerEmail) &&
                    allowedAdmins.includes(callerEmail) &&
                    profile?.role === 'admin'

    // Allow self-updates for commission payment (non-admin)
    const { action, target_id, data: actionData } = await req.json()
    const isSelfCommission = action === 'toggle_commission' && target_id === user.id

    if (!isAdmin && !isSelfCommission) {
      throw new Error('Forbidden: Admin access required')
    }

    if (!isAdmin && isSelfCommission) {
      const reference = actionData?.payment_reference
      if (!reference) throw new Error('Missing Paystack payment reference')

      const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')
      if (!paystackSecret) throw new Error('PAYSTACK_SECRET_KEY is not configured')

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      })
      const verification = await verifyRes.json()
      const expectedAmount = Number(Deno.env.get('COMMISSION_AMOUNT_KOBO') || '500000')

      if (
        !verifyRes.ok ||
        verification?.data?.status !== 'success' ||
        Number(verification?.data?.amount) !== expectedAmount ||
        verification?.data?.customer?.email !== user.email
      ) {
        throw new Error('Commission payment could not be verified')
      }
    }

    // 3. Execute the admin action using service_role (bypasses RLS)
    let result: any = { success: true }

    switch (action) {
      // ── PROFILE / COMMISSION ──
      case 'toggle_commission': {
        const paidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        const updateData = isAdmin
          ? { ...(actionData || {}) }
          : { commission_paid: true, is_suspended: false, trial_end: paidUntil }
        if (updateData.commission_paid === true && !updateData.trial_end) updateData.trial_end = paidUntil
        if (updateData.commission_paid === true && updateData.is_suspended === undefined) updateData.is_suspended = false
        delete updateData.updated_at
        const { error } = await adminClient
          .from('profiles')
          .update(updateData)
          .eq('id', target_id)
        if (error) throw error
        if (updateData.commission_paid === true) {
          await awardSellerActivationReferral(adminClient, target_id)
        }
        break
      }

      // ── MASS SUSPEND SELLERS ──
      case 'mass_suspend': {
        const { target_ids, pause_table } = actionData
        // Pause products or gigs
        if (pause_table === 'products') {
          await adminClient.from('products').update({ status: 'paused' }).in('seller_id', target_ids)
        } else if (pause_table === 'service_gigs') {
          await adminClient.from('service_gigs').update({ status: 'paused' }).in('provider_id', target_ids)
        }
        // Mark profiles as suspended
        const { error } = await adminClient
          .from('profiles')
          .update({ is_suspended: true })
          .in('id', target_ids)
        if (error) throw error
        result.suspended_count = target_ids.length
        break
      }

      // ── DEACTIVATE USER ──
      case 'deactivate_user': {
        const { error: profileError } = await adminClient.from('profiles')
          .update({ is_suspended: true, commission_paid: false })
          .eq('id', target_id)
        if (profileError) throw profileError
        const { error: productsError } = await adminClient.from('products').update({ status: 'paused' }).eq('seller_id', target_id)
        if (productsError) throw productsError
        await adminClient.from('service_gigs').update({ status: 'paused' }).eq('provider_id', target_id)
        break
      }

      // ── REACTIVATE USER ──
      case 'reactivate_user': {
        const { error: profileError } = await adminClient.from('profiles')
          .update({
            commission_paid: true,
            is_suspended: false,
            trial_end: actionData?.trial_end || new Date(Date.now() + 30*86400000).toISOString()
          })
          .eq('id', target_id)
        if (profileError) throw profileError
        // Sold-out listings stay paused until the seller restocks them.
        const { error: productsError } = await adminClient.from('products')
          .update({ status: 'active' })
          .eq('seller_id', target_id)
          .neq('stock_quantity', 0)
        if (productsError) throw productsError
        await adminClient.from('service_gigs').update({ status: 'active' }).eq('provider_id', target_id)
        break
      }

      // ── GRANT COMMISSION ──
      case 'grant_commission': {
        const paidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        await adminClient.from('profiles')
          .update({ commission_paid: true, is_suspended: false, trial_end: paidUntil })
          .eq('id', target_id)
        await adminClient.from('products').update({ status: 'active' }).eq('seller_id', target_id)
        await awardSellerActivationReferral(adminClient, target_id)
        break
      }

      // ── DELETE SELLER ──
      case 'delete_seller': {
        await adminClient.from('products').delete().eq('seller_id', target_id)
        await adminClient.from('service_gigs').delete().eq('provider_id', target_id)
        await adminClient.from('profiles').delete().eq('id', target_id)
        break
      }

      // ── UPDATE ORDER ──
      case 'update_order': {
        const updateData: any = { status: actionData.status, updated_at: new Date().toISOString() }
        if (actionData.status === 'delivered') updateData.delivered_at = new Date().toISOString()
        if (actionData.status === 'shipped') updateData.shipped_at = new Date().toISOString()
        const { error } = await adminClient
          .from('orders')
          .update(updateData)
          .eq('id', target_id)
        if (error) throw error
        await adminClient.from('order_tracking').insert({
          order_id: target_id,
          status: actionData.status,
          note: actionData.note || `Admin marked order ${actionData.status}`,
          updated_by: user.id,
        })
        break
      }

      // ── RESOLVE DISPUTE ──
      case 'resolve_dispute': {
        const { error } = await adminClient
          .from('disputes')
          .update({ status: 'resolved', resolved_at: new Date().toISOString() })
          .eq('id', target_id)
        if (error) throw error
        break
      }

      // ── REFUND DISPUTE ──
      case 'refund_dispute': {
        await adminClient.from('disputes')
          .update({ status: 'refunded', resolved_at: new Date().toISOString() })
          .eq('id', target_id)
        if (actionData?.order_id) {
          await adminClient.from('orders')
            .update({ status: 'refunded', updated_at: new Date().toISOString() })
            .eq('id', actionData.order_id)
        }
        break
      }

      // ── APPROVE/REJECT WITHDRAWAL ──
      case 'pay_withdrawal': {
        const { error } = await adminClient
          .from('withdrawals')
          .update({ status: 'paid', paid_at: new Date().toISOString(), processed_at: new Date().toISOString() })
          .eq('id', target_id)
        if (error) throw error
        break
      }
      case 'reject_withdrawal': {
        const { error } = await adminClient
          .from('withdrawals')
          .update({ status: 'rejected', reject_reason: actionData?.reason || 'Rejected by admin', processed_at: new Date().toISOString() })
          .eq('id', target_id)
        if (error) throw error
        break
      }

      // ── APPROVE/REJECT KYC ──
      case 'approve_kyc': {
        let userId = actionData?.user_id
        if (!userId) {
          const { data: kycRow } = await adminClient
            .from('kyc_verifications')
            .select('user_id')
            .eq('id', target_id)
            .single()
          userId = kycRow?.user_id
        }
        if (!userId) throw new Error('KYC user not found')
        await adminClient.from('kyc_verifications')
          .update({ status: 'approved', reviewed_at: new Date().toISOString() })
          .eq('id', target_id)
        await adminClient.from('profiles')
          .update({ kyc_status: 'approved', kyc_verified: true })
          .eq('id', userId)
        break
      }
      case 'reject_kyc': {
        let userId2 = actionData?.user_id
        if (!userId2) {
          const { data: kycRow } = await adminClient
            .from('kyc_verifications')
            .select('user_id')
            .eq('id', target_id)
            .single()
          userId2 = kycRow?.user_id
        }
        if (!userId2) throw new Error('KYC user not found')
        await adminClient.from('kyc_verifications')
          .update({ status: 'rejected', admin_note: actionData?.reason || '', reviewed_at: new Date().toISOString() })
          .eq('id', target_id)
        await adminClient.from('profiles')
          .update({ kyc_status: 'rejected', kyc_verified: false })
          .eq('id', userId2)
        break
      }

      // ── APPROVE/REJECT COMMISSION RECEIPT ──
      case 'approve_receipt': {
        const sellerId = actionData?.seller_id
        await adminClient.from('commission_receipts')
          .update({ status: 'approved', reviewed_at: new Date().toISOString() })
          .eq('id', target_id)
        if (sellerId) {
          const paidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          await adminClient.from('profiles')
            .update({ commission_paid: true, is_suspended: false, trial_end: paidUntil })
            .eq('id', sellerId)
          await awardSellerActivationReferral(adminClient, sellerId)
        }
        break
      }
      case 'reject_receipt': {
        await adminClient.from('commission_receipts')
          .update({ status: 'rejected', admin_note: actionData?.reason || '', reviewed_at: new Date().toISOString() })
          .eq('id', target_id)
        break
      }

      // ── EXTEND TRIAL ──
      case 'extend_trial': {
        const currentEnd = actionData?.current_end ? new Date(actionData.current_end) : new Date()
        const newEnd = new Date(currentEnd.getTime() + 30 * 24 * 60 * 60 * 1000)
        const { error } = await adminClient.from('profiles')
          .update({ trial_end: newEnd.toISOString() })
          .eq('id', target_id)
        if (error) throw error
        break
      }

      // ── APPROVE AD ──
      case 'approve_ad': {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        const updates = [
          { status: 'active', payment_verified: true, expires_at: expiresAt, updated_at: new Date().toISOString() },
          { status: 'active', payment_status: 'paid', expires_at: expiresAt, updated_at: new Date().toISOString() },
          { status: 'active', expires_at: expiresAt, updated_at: new Date().toISOString() },
          { status: 'active', expires_at: expiresAt },
        ]
        let lastError: any = null
        for (const update of updates) {
          const { error } = await adminClient.from('advertisements').update(update).eq('id', target_id)
          if (!error) { lastError = null; break }
          lastError = error
          const msg = String(error.message || '').toLowerCase()
          if (!msg.includes('column') && !msg.includes('schema cache')) break
        }
        if (lastError) throw lastError
        break
      }

      case 'reject_ad': {
        const updates = [
          { status: 'rejected', payment_verified: false, updated_at: new Date().toISOString() },
          { status: 'rejected', updated_at: new Date().toISOString() },
          { status: 'rejected' },
        ]
        let lastError: any = null
        for (const update of updates) {
          const { error } = await adminClient.from('advertisements').update(update).eq('id', target_id)
          if (!error) { lastError = null; break }
          lastError = error
          const msg = String(error.message || '').toLowerCase()
          if (!msg.includes('column') && !msg.includes('schema cache')) break
        }
        if (lastError) throw lastError
        break
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Admin action error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Admin action failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})