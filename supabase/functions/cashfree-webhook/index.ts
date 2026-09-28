/**
 * Supabase Edge Function: cashfree-webhook
 *
 * Receives, signature-verifies, and idempotently processes Cashfree subscription webhooks.
 *
 * Rules:
 * 1. Webhook processing must be signature-verified and idempotent.
 * 2. Only verified Cashfree subscription state may change plan_tier in Supabase.
 * 3. Map:
 *    Pro Monthly → Pro
 *    Pro Annual → Pro
 *    Plus Monthly → Plus
 *    Plus Annual → Plus
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import crypto from 'node:crypto';

const CASHFREE_PLANS: Record<string, { tier: 'pro' | 'plus'; interval: 'monthly' | 'annually' }> = {
  CHOREMATRIX_PRO_MONTHLY: { tier: 'pro', interval: 'monthly' },
  ChoreMatrix_Pro_Annual: { tier: 'pro', interval: 'annually' },
  ChoreMatrix_Plus_Monthly: { tier: 'plus', interval: 'monthly' },
  ChoreMatrix_Plus_Annual: { tier: 'plus', interval: 'annually' }
};

function mapPlanId(planId?: string): { tier: 'pro' | 'plus'; interval: 'monthly' | 'annually' } | null {
  if (!planId) return null;
  if (CASHFREE_PLANS[planId]) return CASHFREE_PLANS[planId];
  const found = Object.entries(CASHFREE_PLANS).find(
    ([k]) => k.toLowerCase() === planId.toLowerCase()
  );
  return found ? found[1] : null;
}

function verifySignature(signature: string, rawBody: string, timestamp: string, secretKey: string): boolean {
  try {
    const payload = `${timestamp}${rawBody}`;
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(payload);
    const expected = hmac.digest('base64');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

function deriveEventId(payload: any, timestamp: string): string {
  if (payload.event_id) return String(payload.event_id);
  if (payload.data?.event_id) return String(payload.data.event_id);

  const subId =
    payload.data?.subscription_details?.subscription_id ||
    payload.subscription_id ||
    payload.data?.cf_subscription_id ||
    'sub_unknown';

  const type = payload.type || payload.event || 'STATUS_CHANGE';
  const status =
    payload.data?.subscription_details?.subscription_status ||
    payload.subscription_status ||
    payload.data?.payment_details?.payment_status ||
    '';

  const time = payload.event_time || payload.data?.event_time || timestamp;
  const raw = `${type}:${subId}:${status}:${time}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const signature = req.headers.get('x-webhook-signature');
    const timestamp = req.headers.get('x-webhook-timestamp');
    const rawBody = await req.text();

    const secretKey = Deno.env.get('CASHFREE_SECRET_KEY');
    if (!secretKey) {
      console.error('[Cashfree Webhook] CASHFREE_SECRET_KEY is not configured');
      return new Response(JSON.stringify({ error: 'Webhook handler misconfigured' }), { status: 500 });
    }

    // 1. Mandatory HMAC-SHA256 signature verification
    if (!signature || !timestamp || !verifySignature(signature, rawBody, timestamp, secretKey)) {
      console.warn('[Cashfree Webhook] Rejected: Invalid signature');
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid webhook signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Parse payload safely
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), { status: 400 });
    }

    const eventId = deriveEventId(payload, timestamp);

    // 3. Supabase Client using Service Role Key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const dbClient = createClient(supabaseUrl, supabaseServiceKey);

    // 4. Idempotency Check: Query cashfree_webhook_events
    const { data: existing } = await dbClient
      .from('cashfree_webhook_events')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle();

    if (existing) {
      console.log(`[Cashfree Webhook] Duplicate event detected (${eventId}). Acknowledging 200.`);
      return new Response(JSON.stringify({ success: true, message: 'Event already processed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const eventType = payload.type || payload.event || 'SUBSCRIPTION_STATUS_CHANGE';
    const subDetails = payload.data?.subscription_details || payload.subscription_details || {};
    const paymentDetails = payload.data?.payment_details || payload.payment_details || {};
    const customerDetails = payload.data?.customer_details || payload.customer_details || {};

    const subscriptionId = subDetails.subscription_id || payload.subscription_id;
    const rawStatus = (
      subDetails.subscription_status ||
      payload.subscription_status ||
      paymentDetails.payment_status ||
      ''
    ).toUpperCase();

    // 5. Record event in cashfree_webhook_events for idempotency
    await dbClient.from('cashfree_webhook_events').insert({
      event_id: eventId,
      subscription_id: subscriptionId || null,
      event_type: eventType,
      processed_at: new Date().toISOString(),
      payload
    });

    if (!subscriptionId) {
      return new Response(JSON.stringify({ success: true, event_id: eventId }), { status: 200 });
    }

    // 6. Resolve target user in database
    let targetUserId = customerDetails.customer_id;
    let targetPlanId = subDetails.plan_id || payload.plan_id;

    const { data: localSub } = await dbClient
      .from('cashfree_subscriptions')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .maybeSingle();

    if (localSub) {
      if (!targetUserId) targetUserId = localSub.user_id;
      if (!targetPlanId) targetPlanId = localSub.plan_id;
    }

    if (!targetUserId) {
      const { data: profile } = await dbClient
        .from('profiles')
        .select('id')
        .eq('cashfree_subscription_id', subscriptionId)
        .maybeSingle();
      if (profile) targetUserId = profile.id;
    }

    if (!targetUserId) {
      console.warn(`[Cashfree Webhook] Target user not found for subscription ${subscriptionId}`);
      return new Response(JSON.stringify({ success: true, event_id: eventId, warning: 'User not found' }), {
        status: 200
      });
    }

    const nowIso = new Date().toISOString();

    // 7. Update User Plan Tier in Supabase (Only verified Cashfree states change plan_tier)
    // A. Active / Success
    if (
      rawStatus === 'ACTIVE' ||
      rawStatus === 'SUCCESS' ||
      eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS'
    ) {
      const mapping = mapPlanId(targetPlanId);
      const tier = mapping?.tier || 'pro';
      const interval = mapping?.interval || 'monthly';

      await dbClient
        .from('profiles')
        .update({
          plan_tier: tier,
          billing_interval: interval,
          subscription_status: 'active',
          cashfree_subscription_id: subscriptionId,
          updated_at: nowIso
        })
        .eq('id', targetUserId);

      await dbClient
        .from('cashfree_subscriptions')
        .update({ status: 'ACTIVE', updated_at: nowIso })
        .eq('subscription_id', subscriptionId);

      console.log(`[Cashfree Webhook] User ${targetUserId} activated on ${tier} (${interval})`);
    }
    // B. Cancelled / Expired
    else if (
      rawStatus === 'CUSTOMER_CANCELLED' ||
      rawStatus === 'CANCELLED' ||
      rawStatus === 'EXPIRED' ||
      rawStatus === 'TERMINATED' ||
      rawStatus === 'COMPLETED'
    ) {
      await dbClient
        .from('profiles')
        .update({
          plan_tier: 'free',
          subscription_status: 'canceled',
          updated_at: nowIso
        })
        .eq('id', targetUserId);

      await dbClient
        .from('cashfree_subscriptions')
        .update({ status: 'CANCELLED', updated_at: nowIso })
        .eq('subscription_id', subscriptionId);

      console.log(`[Cashfree Webhook] User ${targetUserId} downgraded to free tier`);
    }
    // C. Payment Failed / Past Due
    else if (
      rawStatus === 'FAILED' ||
      rawStatus === 'PAYMENT_FAILED' ||
      rawStatus === 'ON_HOLD' ||
      eventType === 'SUBSCRIPTION_PAYMENT_FAILED'
    ) {
      await dbClient
        .from('profiles')
        .update({
          subscription_status: 'past_due',
          updated_at: nowIso
        })
        .eq('id', targetUserId);

      await dbClient
        .from('cashfree_subscriptions')
        .update({ status: 'FAILED', updated_at: nowIso })
        .eq('subscription_id', subscriptionId);

      console.log(`[Cashfree Webhook] User ${targetUserId} marked as past_due`);
    }

    return new Response(JSON.stringify({ success: true, event_id: eventId, status: rawStatus }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[Cashfree Webhook Error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
