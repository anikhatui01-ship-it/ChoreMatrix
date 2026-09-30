/**
 * Supabase Edge Function: paddle-webhook
 *
 * Receives, signature-verifies, and idempotently processes Paddle sandbox subscription webhooks.
 *
 * Rules:
 * 1. Verification must check the `paddle-signature` header using HMAC-SHA256 with PADDLE_WEBHOOK_SECRET.
 * 2. Idempotent processing guaranteed by logging events to public.paddle_webhook_events.
 * 3. Authoritative entitlement:
 *    - subscription.trialing: grants Pro, marks trial_consumed = true (locked by DB trigger).
 *    - subscription.activated: maintains Pro, active.
 *    - subscription.canceled: reverts plan_tier to free, status to canceled.
 *    - subscription.past_due: updates status to past_due.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const CANONICAL_PRICE_ENTITLEMENT_MAP: Record<string, { tier: 'pro' | 'plus'; interval: 'monthly' | 'annual' }> = {
  // Pro Monthly
  'pri_01m3q8bcndadvqgz9jbr26pmw3': { tier: 'pro', interval: 'monthly' }, // trial
  'pri_01m3q8bcwn953t664zt4e9071z': { tier: 'pro', interval: 'monthly' }, // standard
  // Pro Annual
  'pri_01m3rc2rxpbwq45kpjbdc124ph': { tier: 'pro', interval: 'annual' },  // trial
  'pri_01m3rcv82ahy3nvcbgtpkvpemp': { tier: 'pro', interval: 'annual' },  // standard
  // Plus Monthly
  'pri_01m3rc7qwjvt2ehz4p9xcsbhfq': { tier: 'plus', interval: 'monthly' }, // trial
  'pri_01m3rcz5jsr2058j5e2v8zka84': { tier: 'plus', interval: 'monthly' }, // standard
  // Plus Annual
  'pri_01m3rc5nmgzwske72g5h6dsh32': { tier: 'plus', interval: 'annual' },  // trial
  'pri_01m3rcx7d36mj5bw7wwrkg87mh': { tier: 'plus', interval: 'annual' }   // standard
};

function resolvePriceEntitlement(priceId: string | null | undefined): { tier: 'pro' | 'plus'; interval: 'monthly' | 'annual' } | null {
  if (!priceId) return null;
  const clean = priceId.trim();
  return CANONICAL_PRICE_ENTITLEMENT_MAP[clean] || null;
}

function parseSignatureHeader(header: string | null): { ts: string; h1: string } | null {
  if (!header) return null;
  const parts = header.split(';');
  let ts = '';
  let h1 = '';
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k?.trim() === 'ts') ts = v?.trim() || '';
    if (k?.trim() === 'h1') h1 = v?.trim() || '';
  }
  return ts && h1 ? { ts, h1 } : null;
}

function verifySignature(header: string | null, rawBody: string, secret: string): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed || !rawBody || !secret) {
    console.warn('[Paddle Webhook] Missing signature parts, body, or secret:', {
      hasParsed: !!parsed,
      hasBody: !!rawBody,
      hasSecret: !!secret
    });
    return false;
  }
  try {
    const payload = `${parsed.ts}:${rawBody}`;
    const expected = crypto.createHmac('sha256', secret.trim()).update(payload).digest('hex');
    const h1Buf = Buffer.from(parsed.h1.trim(), 'utf8');
    const expBuf = Buffer.from(expected.trim(), 'utf8');
    if (h1Buf.length !== expBuf.length) {
      console.warn('[Paddle Webhook] Signature length mismatch:', h1Buf.length, expBuf.length);
      return false;
    }
    const match = crypto.timingSafeEqual(h1Buf, expBuf);
    if (!match) {
      console.warn('[Paddle Webhook] HMAC signature mismatch');
    }
    return match;
  } catch (err) {
    console.error('[Paddle Webhook] verifySignature exception:', err);
    return false;
  }
}

function deriveEventId(payload: any): string {
  if (payload.event_id) return String(payload.event_id);
  if (payload.id && typeof payload.id === 'string' && payload.id.startsWith('evt_')) {
    return payload.id;
  }
  const data = payload.data || {};
  const subId = data.id || payload.subscription_id || 'sub_unknown';
  const type = payload.event_type || 'event';
  const occurredAt = payload.occurred_at || Date.now();
  return crypto.createHash('sha256').update(`${type}:${subId}:${occurredAt}`).digest('hex').slice(0, 32);
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const signature = req.headers.get('paddle-signature');
    const rawBody = await req.text();
    const webhookSecret = Deno.env.get('PADDLE_WEBHOOK_SECRET');

    if (!webhookSecret) {
      console.error('[Paddle Webhook] PADDLE_WEBHOOK_SECRET not configured');
      return new Response(JSON.stringify({ error: 'Webhook misconfigured' }), { status: 500 });
    }

    // 1. Mandatory HMAC signature verification
    if (!signature || !verifySignature(signature, rawBody, webhookSecret)) {
      console.warn('[Paddle Webhook] Unauthorized: Invalid paddle-signature header');
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid signature' }), {
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

    const eventId = deriveEventId(payload);
    const eventType = String(payload.event_type || '');
    const data = payload.data || {};
    const isSubscriptionEvent = eventType.startsWith('subscription.');
    const subscriptionId = isSubscriptionEvent ? data.id : (data.subscription_id || data.id || null);
    const customerId = data.customer_id || null;
    const rawStatus = (data.status || '').toLowerCase();

    // 3. Supabase Service Role client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SECRET_KEY') ||
      '';

    const dbClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    // 4. Idempotency Check: query paddle_webhook_events
    const { data: existing } = await dbClient
      .from('paddle_webhook_events')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle();

    if (existing) {
      console.log(`[Paddle Webhook] Duplicate event detected (${eventId}). Acknowledging 200.`);
      return new Response(JSON.stringify({ success: true, message: 'Event already processed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Record event in paddle_webhook_events
    await dbClient.from('paddle_webhook_events').insert({
      event_id: eventId,
      event_type: eventType,
      subscription_id: subscriptionId,
      customer_id: customerId,
      processed_at: new Date().toISOString(),
      payload
    });

    // 6. Resolve target user
    let targetUserId = data.custom_data?.user_id;

    if (!targetUserId && customerId) {
      const { data: profile } = await dbClient
        .from('profiles')
        .select('id')
        .eq('paddle_customer_id', customerId)
        .maybeSingle();
      if (profile) targetUserId = profile.id;
    }

    if (!targetUserId && subscriptionId) {
      const { data: localSub } = await dbClient
        .from('paddle_subscriptions')
        .select('user_id')
        .eq('subscription_id', subscriptionId)
        .maybeSingle();
      if (localSub) targetUserId = localSub.user_id;
    }

    if (!targetUserId && data.customer?.email) {
      const { data: profile } = await dbClient
        .from('profiles')
        .select('id')
        .eq('email', data.customer.email)
        .maybeSingle();
      if (profile) targetUserId = profile.id;
    }

    if (!targetUserId) {
      console.warn(`[Paddle Webhook] Target user not found for subscription ${subscriptionId}`);
      return new Response(JSON.stringify({ success: true, event_id: eventId, warning: 'User not found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Query user profile
    const { data: userProfile } = await dbClient
      .from('profiles')
      .select('id, trial_consumed, plan_tier, subscription_status, paddle_subscription_id')
      .eq('id', targetUserId)
      .maybeSingle();

    // Query local subscription record to enforce terminal cancellation invariant
    const { data: localSubRecord } = subscriptionId ? await dbClient
      .from('paddle_subscriptions')
      .select('status, plan_tier, subscription_id')
      .eq('subscription_id', subscriptionId)
      .maybeSingle() : { data: null };

    const isSubCancelled = localSubRecord?.status === 'canceled' || localSubRecord?.status === 'cancelled';
    const isProfileCancelled = (userProfile?.subscription_status === 'canceled' || userProfile?.subscription_status === 'cancelled') &&
      (userProfile?.paddle_subscription_id === subscriptionId || !userProfile?.paddle_subscription_id);

    // INVARIANT: A cancelled subscription cannot be resurrected by subsequent webhooks
    if (isSubCancelled || isProfileCancelled) {
      if (eventType !== 'subscription.canceled' && rawStatus !== 'canceled' && rawStatus !== 'cancelled') {
        console.warn(`[Paddle Webhook Safety] Blocked resurrection for cancelled subscription ${subscriptionId} (event: ${eventType}, status: ${rawStatus}). Preserving terminal free/cancelled state.`);
        return new Response(JSON.stringify({
          success: true,
          event_id: eventId,
          subscription_id: subscriptionId,
          status: 'canceled',
          plan_tier: 'free',
          warning: 'Subscription already cancelled; resurrection prevented'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const nowIso = new Date().toISOString();
    const currentPeriod = data.current_billing_period || {};
    const primaryItem = (data.items || [])[0] || {};
    const priceId = primaryItem.price?.id || primaryItem.price_id || '';
    const productId = primaryItem.price?.product_id || primaryItem.product_id || '';

    const entitlement = resolvePriceEntitlement(priceId);

    // 7. Authoritative State Transitions
    // A. Trialing: Introductory 7-day free trial active
    if (eventType === 'subscription.trialing' || (eventType === 'subscription.created' && rawStatus === 'trialing')) {
      if (!entitlement) {
        console.error(`[Paddle Webhook Security] Refusing trial entitlement: Unknown or unmapped price ID "${priceId}" for subscription ${subscriptionId}`);
        return new Response(JSON.stringify({ success: false, event_id: eventId, error: `Unknown price ID "${priceId}". Entitlement refused.` }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (userProfile?.trial_consumed) {
        console.warn(`[Paddle Webhook] User ${targetUserId} already consumed trial. Denying repeat trial.`);
        return new Response(JSON.stringify({ success: true, event_id: eventId, warning: 'Duplicate trial denied' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const trialEndsAt = currentPeriod.ends_at || new Date(Date.now() + 7 * 86400 * 1000).toISOString();

      const { error: profileErr } = await dbClient
        .from('profiles')
        .update({
          plan_tier: entitlement.tier,
          billing_interval: entitlement.interval,
          subscription_status: 'trialing',
          payment_provider: 'paddle',
          paddle_subscription_id: subscriptionId,
          paddle_customer_id: customerId,
          provider_subscription_id: subscriptionId,
          trial_consumed: true,
          trial_started_at: nowIso,
          trial_ends_at: trialEndsAt,
          updated_at: nowIso
        })
        .eq('id', targetUserId);
      if (profileErr) console.error('[Paddle Webhook] Profile update error (trialing):', profileErr);

      const { error: subErr } = await dbClient.from('paddle_subscriptions').upsert({
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        price_id: priceId,
        product_id: productId,
        plan_tier: entitlement.tier,
        status: 'trialing',
        billing_interval: entitlement.interval,
        has_trial: true,
        trial_ends_at: trialEndsAt,
        current_period_start: currentPeriod.starts_at || nowIso,
        current_period_end: currentPeriod.ends_at || trialEndsAt,
        updated_at: nowIso
      });
      if (subErr) console.error('[Paddle Webhook] paddle_subscriptions upsert error (trialing):', subErr);

      console.log(`[Paddle Webhook] User ${targetUserId} trial activated (${entitlement.tier} ${entitlement.interval}, ends: ${trialEndsAt})`);
    }
    // B. Activated / Standard Active / Converted from trial
    else if (
      eventType === 'subscription.activated' ||
      (eventType === 'subscription.created' && rawStatus === 'active') ||
      eventType === 'subscription.resumed' ||
      (eventType === 'transaction.completed' && subscriptionId)
    ) {
      if (!entitlement) {
        console.error(`[Paddle Webhook Security] Refusing active entitlement: Unknown or unmapped price ID "${priceId}" for subscription ${subscriptionId}`);
        return new Response(JSON.stringify({ success: false, event_id: eventId, error: `Unknown price ID "${priceId}". Entitlement refused.` }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const { error: profileErr } = await dbClient
        .from('profiles')
        .update({
          plan_tier: entitlement.tier,
          billing_interval: entitlement.interval,
          subscription_status: 'active',
          payment_provider: 'paddle',
          paddle_subscription_id: subscriptionId,
          paddle_customer_id: customerId,
          provider_subscription_id: subscriptionId,
          trial_consumed: true,
          updated_at: nowIso
        })
        .eq('id', targetUserId);
      if (profileErr) console.error('[Paddle Webhook] Profile update error (active):', profileErr);

      const { error: subErr } = await dbClient.from('paddle_subscriptions').upsert({
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        price_id: priceId,
        product_id: productId,
        plan_tier: entitlement.tier,
        status: 'active',
        billing_interval: entitlement.interval,
        has_trial: Boolean(data.trial_period),
        current_period_start: currentPeriod.starts_at || nowIso,
        current_period_end: currentPeriod.ends_at || null,
        scheduled_change: null,
        updated_at: nowIso
      });
      if (subErr) console.error('[Paddle Webhook] paddle_subscriptions upsert error (active):', subErr);

      console.log(`[Paddle Webhook] User ${targetUserId} subscription active (${entitlement.tier} ${entitlement.interval})`);
    }
    // C. Subscription Updated (e.g. cancellation scheduled at period end or plan change)
    else if (eventType === 'subscription.updated') {
      const scheduledChange = data.scheduled_change?.effective_at || null;
      const subUpsert: any = {
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        price_id: priceId,
        product_id: productId,
        status: rawStatus || 'active',
        scheduled_change: scheduledChange,
        current_period_start: currentPeriod.starts_at || null,
        current_period_end: currentPeriod.ends_at || null,
        updated_at: nowIso
      };

      if (entitlement) {
        subUpsert.plan_tier = entitlement.tier;
        subUpsert.billing_interval = entitlement.interval;

        // If subscription is still active or trialing, update profile plan tier as well
        if (rawStatus === 'active' || rawStatus === 'trialing') {
          await dbClient
            .from('profiles')
            .update({
              plan_tier: entitlement.tier,
              billing_interval: entitlement.interval,
              updated_at: nowIso
            })
            .eq('id', targetUserId);
        }
      }

      await dbClient.from('paddle_subscriptions').upsert(subUpsert);
      console.log(`[Paddle Webhook] Subscription ${subscriptionId} updated (scheduled_change: ${scheduledChange})`);
    }
    // D. Canceled (Terminal state)
    else if (eventType === 'subscription.canceled' || rawStatus === 'canceled' || rawStatus === 'cancelled') {
      await dbClient
        .from('profiles')
        .update({
          plan_tier: 'free',
          subscription_status: 'canceled',
          updated_at: nowIso
        })
        .eq('id', targetUserId);

      await dbClient.from('paddle_subscriptions').upsert({
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        price_id: priceId,
        product_id: productId,
        plan_tier: 'free',
        status: 'canceled',
        scheduled_change: null,
        updated_at: nowIso
      });

      console.log(`[Paddle Webhook] User ${targetUserId} downgraded to free tier`);
    }
    // E. Paused
    else if (eventType === 'subscription.paused' || rawStatus === 'paused') {
      await dbClient
        .from('profiles')
        .update({
          plan_tier: 'free',
          subscription_status: 'paused',
          updated_at: nowIso
        })
        .eq('id', targetUserId);

      await dbClient.from('paddle_subscriptions').upsert({
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        price_id: priceId,
        product_id: productId,
        status: 'paused',
        updated_at: nowIso
      });
    }
    // F. Past Due / Payment Failed
    else if (eventType === 'subscription.past_due' || rawStatus === 'past_due' || eventType === 'transaction.payment_failed') {
      if (userProfile?.subscription_status === 'active' || userProfile?.subscription_status === 'trialing') {
        await dbClient
          .from('profiles')
          .update({
            subscription_status: 'past_due',
            updated_at: nowIso
          })
          .eq('id', targetUserId);
      }

      if (subscriptionId) {
        await dbClient.from('paddle_subscriptions').upsert({
          user_id: targetUserId,
          subscription_id: subscriptionId,
          customer_id: customerId || '',
          price_id: priceId,
          product_id: productId,
          status: 'past_due',
          updated_at: nowIso
        });
      }
    }

    return new Response(JSON.stringify({ success: true, event_id: eventId, status: rawStatus || eventType }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[Paddle Webhook Error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
