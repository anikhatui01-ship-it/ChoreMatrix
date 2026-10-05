/**
 * Supabase Edge Function: dodo-webhook
 *
 * Receives, Standard Webhooks (Svix) signature-verifies, and idempotently processes
 * Dodo Payments test-mode subscription webhooks.
 *
 * Security:
 * 1. Verification checks `webhook-id`, `webhook-timestamp`, `webhook-signature` using HMAC-SHA256 with DODO_WEBHOOK_SECRET.
 * 2. Idempotent processing guaranteed by logging events to public.dodo_webhook_events.
 * 3. Authoritative entitlement:
 *    - subscription.active / subscription.trialing: grants Pro/Plus, marks trial_consumed = true.
 *    - subscription.cancelled: reverts plan_tier to free, status to canceled.
 *    - subscription.failed / subscription.past_due: updates status to past_due.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const CANONICAL_PRODUCT_MAP: Record<string, { tier: 'pro' | 'plus'; interval: 'monthly' | 'annual' }> = {
  // Test Mode Product IDs
  'pdt_0NozKZ3sZ6h0vplb451YK': { tier: 'pro', interval: 'monthly' },
  'pdt_0NozL7OvhpMonCSMw99Ng': { tier: 'pro', interval: 'annual' },
  'pdt_0NozLK4XCjDSCbkADEtQL': { tier: 'plus', interval: 'monthly' },
  'pdt_0NozLba96vBrtNtGdFONX': { tier: 'plus', interval: 'annual' },
  // Live Mode Product IDs
  'pdt_0Np1eZsemtECph1HLoDb0': { tier: 'pro', interval: 'monthly' },
  'pdt_0Np1ec3oUFACgeOKl4ktP': { tier: 'pro', interval: 'annual' },
  'pdt_0Np1ean3rbxLUQs6d1QAb': { tier: 'plus', interval: 'monthly' },
  'pdt_0Np1ebMsCqGBWntrkX3fK': { tier: 'plus', interval: 'annual' }
};

const TIER_RANK: Record<string, number> = { 'free': 0, 'pro': 1, 'plus': 2 };

function resolveProductEntitlement(productId: string | null | undefined): { tier: 'pro' | 'plus'; interval: 'monthly' | 'annual' } | null {
  if (!productId) return null;
  const clean = productId.trim();
  return CANONICAL_PRODUCT_MAP[clean] || null;
}

function parseSignatures(header: string | null): string[] {
  if (!header) return [];
  const parts = header.trim().split(/\s+/);
  const signatures: string[] = [];
  for (const part of parts) {
    const [v, sig] = part.split(',');
    if (v?.trim() === 'v1' && sig?.trim()) {
      signatures.push(sig.trim());
    }
  }
  return signatures;
}

function verifyStandardWebhook(
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  secret: string
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature || !rawBody || !secret) {
    return false;
  }
  try {
    let secretBuffer: Buffer;
    const cleanSecret = secret.trim();
    if (cleanSecret.startsWith('whsec_')) {
      secretBuffer = Buffer.from(cleanSecret.slice(6), 'base64');
    } else {
      secretBuffer = Buffer.from(cleanSecret, 'utf8');
    }

    const signedPayload = `${headers.id}.${headers.timestamp}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secretBuffer).update(signedPayload).digest('base64');
    const expectedBuf = Buffer.from(expected, 'utf8');

    const provided = parseSignatures(headers.signature);
    for (const sig of provided) {
      const pBuf = Buffer.from(sig, 'utf8');
      if (pBuf.length === expectedBuf.length && crypto.timingSafeEqual(pBuf, expectedBuf)) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('[Dodo Webhook] verifyStandardWebhook exception:', err);
    return false;
  }
}

function deriveEventId(payload: any, webhookId: string | null): string {
  if (webhookId) return webhookId;
  if (payload.event_id) return String(payload.event_id);
  if (payload.id && typeof payload.id === 'string' && (payload.id.startsWith('evt_') || payload.id.startsWith('msg_'))) {
    return payload.id;
  }
  const data = payload.data || {};
  const subId = data.subscription_id || data.id || payload.subscription_id || 'sub_unknown';
  const type = payload.type || payload.event_type || 'event';
  const timestamp = payload.timestamp || payload.created_at || Date.now();
  return crypto.createHash('sha256').update(`${type}:${subId}:${timestamp}`).digest('hex').slice(0, 32);
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const webhookId =
      req.headers.get('webhook-id') ||
      req.headers.get('svix-id') ||
      req.headers.get('webhook_id');
    const webhookTimestamp =
      req.headers.get('webhook-timestamp') ||
      req.headers.get('svix-timestamp') ||
      req.headers.get('webhook_timestamp');
    const webhookSignature =
      req.headers.get('webhook-signature') ||
      req.headers.get('svix-signature') ||
      req.headers.get('webhook_signature');
    const rawBody = await req.text();

    const webhookSecret =
      Deno.env.get('DODO_WEBHOOK_SECRET') ||
      Deno.env.get('DODO_PAYMENTS_WEBHOOK_KEY') ||
      Deno.env.get('ODO_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('[Dodo Webhook] Webhook secret not configured in environment (checked DODO_WEBHOOK_SECRET, DODO_PAYMENTS_WEBHOOK_KEY, ODO_WEBHOOK_SECRET)');
      return new Response(JSON.stringify({ error: 'Webhook misconfigured' }), { status: 500 });
    }

    // 1. Mandatory Standard Webhooks signature verification
    const isValid = verifyStandardWebhook(
      { id: webhookId, timestamp: webhookTimestamp, signature: webhookSignature },
      rawBody,
      webhookSecret
    );

    if (!isValid) {
      console.warn('[Dodo Webhook] Unauthorized: Invalid Standard Webhooks signature');
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

    const eventId = deriveEventId(payload, webhookId);
    const eventType = String(payload.type || payload.event_type || '');
    const data = payload.data || {};
    const subscriptionId = data.subscription_id || data.id || payload.subscription_id || null;
    const customerId = data.customer_id || data.customer?.customer_id || payload.customer_id || null;
    const rawStatus = (data.status || payload.status || '').toLowerCase();

    // 3. Supabase Service Role client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SECRET_KEY') ||
      '';

    const dbClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    // 4. Idempotency Check: query dodo_webhook_events
    const { data: existing } = await dbClient
      .from('dodo_webhook_events')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle();

    if (existing) {
      console.log(`[Dodo Webhook] Duplicate event detected (${eventId}). Acknowledging 200.`);
      return new Response(JSON.stringify({ success: true, message: 'Event already processed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Record event in dodo_webhook_events
    await dbClient.from('dodo_webhook_events').insert({
      event_id: eventId,
      event_type: eventType,
      subscription_id: subscriptionId,
      customer_id: customerId,
      processed_at: new Date().toISOString(),
      payload
    });

    // 6. Resolve target user
    let targetUserId = (
      data.metadata?.user_id ||
      data.custom_data?.user_id ||
      payload.metadata?.user_id ||
      payload.custom_data?.user_id
    );

    if (!targetUserId && customerId) {
      const { data: profile } = await dbClient
        .from('profiles')
        .select('id')
        .eq('dodo_customer_id', customerId)
        .maybeSingle();
      if (profile) targetUserId = profile.id;
    }

    if (!targetUserId && subscriptionId) {
      const { data: localSub } = await dbClient
        .from('dodo_subscriptions')
        .select('user_id')
        .eq('subscription_id', subscriptionId)
        .maybeSingle();
      if (localSub) targetUserId = localSub.user_id;
    }

    if (!targetUserId && (data.customer?.email || payload.customer?.email)) {
      const email = data.customer?.email || payload.customer?.email;
      const { data: profile } = await dbClient
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      if (profile) targetUserId = profile.id;
    }

    if (!targetUserId) {
      console.warn(`[Dodo Webhook] Target user not found for subscription ${subscriptionId}`);
      return new Response(JSON.stringify({ success: true, event_id: eventId, warning: 'User not found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Query user profile
    const { data: userProfile } = await dbClient
      .from('profiles')
      .select('id, trial_consumed, plan_tier, subscription_status, dodo_subscription_id')
      .eq('id', targetUserId)
      .maybeSingle();

    // Query local subscription record to enforce terminal cancellation invariant
    const { data: localSubRecord } = subscriptionId ? await dbClient
      .from('dodo_subscriptions')
      .select('status, plan_tier, subscription_id')
      .eq('subscription_id', subscriptionId)
      .maybeSingle() : { data: null };

    const isSubCancelled = (localSubRecord?.status === 'canceled' || localSubRecord?.status === 'cancelled') &&
      localSubRecord?.subscription_id === subscriptionId;
    const isProfileCancelled = (userProfile?.subscription_status === 'canceled' || userProfile?.subscription_status === 'cancelled') &&
      Boolean(userProfile?.dodo_subscription_id && userProfile.dodo_subscription_id === subscriptionId);

    // INVARIANT: A cancelled subscription cannot be resurrected by out-of-order webhook events for the same subscription ID
    if (isSubCancelled || isProfileCancelled) {
      if (eventType !== 'subscription.cancelled' && eventType !== 'subscription.canceled' && rawStatus !== 'canceled' && rawStatus !== 'cancelled') {
        console.warn(`[Dodo Webhook Safety] Blocked resurrection for cancelled subscription ${subscriptionId} (event: ${eventType}, status: ${rawStatus}). Preserving terminal free/cancelled state.`);
        return new Response(JSON.stringify({
          success: true,
          event_id: eventId,
          subscription_id: subscriptionId,
          subscription_status: 'canceled',
          plan_tier: 'free',
          message: 'Ignoring webhook for already cancelled subscription; terminal cancellation state preserved.'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const nowIso = new Date().toISOString();
    const productId = (
      data.product_id ||
      data.product_cart?.[0]?.product_id ||
      payload.product_id ||
      ''
    );

    const entitlement = resolveProductEntitlement(productId);
    const trialDays = data.trial_period_days || data.subscription_data?.trial_period_days || 0;
    const isTrialing = rawStatus === 'trialing' || trialDays > 0 || eventType === 'subscription.trialing';

    // 7. Authoritative State Transitions
    // A. Active / Trialing / Created
    if (
      eventType === 'subscription.active' ||
      eventType === 'subscription.created' ||
      eventType === 'subscription.trialing' ||
      (eventType === 'payment.succeeded' && subscriptionId)
    ) {
      if (!entitlement) {
        console.error(`[Dodo Webhook Security] Refusing entitlement: Unknown or unmapped product ID "${productId}"`);
        return new Response(JSON.stringify({ success: false, event_id: eventId, error: `Unknown product ID "${productId}". Entitlement refused.` }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // If user already consumed trial, grant subscription as standard 'active' (paid) without repeat trial
      const shouldGrantTrial = isTrialing && !userProfile?.trial_consumed;
      const effectiveStatus = shouldGrantTrial ? 'trialing' : 'active';
      const trialEndsAt = shouldGrantTrial
        ? (data.trial_end || data.trial_ends_at || new Date(Date.now() + 7 * 86400 * 1000).toISOString())
        : null;

      // Always record/upsert subscription in dodo_subscriptions
      await dbClient.from('dodo_subscriptions').upsert({
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        product_id: productId,
        plan_tier: entitlement.tier,
        status: effectiveStatus,
        billing_interval: entitlement.interval,
        has_trial: shouldGrantTrial,
        trial_ends_at: trialEndsAt,
        current_period_start: data.current_period_start || nowIso,
        current_period_end: data.current_period_end || trialEndsAt || null,
        scheduled_change: null,
        updated_at: nowIso
      });

      // Multi-subscription hierarchy resolution: plus (2) > pro (1) > free (0)
      const currentRank = (userProfile?.subscription_status === 'active' || userProfile?.subscription_status === 'trialing')
        ? (TIER_RANK[userProfile?.plan_tier || 'free'] || 0)
        : 0;
      const newRank = TIER_RANK[entitlement.tier] || 0;

      if (newRank >= currentRank || userProfile?.subscription_status === 'canceled' || userProfile?.subscription_status === 'cancelled' || !userProfile?.plan_tier || userProfile.plan_tier === 'free') {
        const profileUpdate: Record<string, any> = {
          plan_tier: entitlement.tier,
          billing_interval: entitlement.interval,
          subscription_status: effectiveStatus,
          payment_provider: 'dodo',
          dodo_subscription_id: subscriptionId,
          dodo_customer_id: customerId,
          provider_subscription_id: subscriptionId,
          trial_consumed: true,
          updated_at: nowIso
        };

        if (shouldGrantTrial) {
          profileUpdate.trial_started_at = nowIso;
          profileUpdate.trial_ends_at = trialEndsAt;
        }

        await dbClient
          .from('profiles')
          .update(profileUpdate)
          .eq('id', targetUserId);
      }
    }
    // B. Updated / Renewed
    else if (eventType === 'subscription.updated' || eventType === 'subscription.renewed') {
      const subUpsert: any = {
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        product_id: productId || localSubRecord?.product_id || '',
        status: rawStatus || 'active',
        current_period_start: data.current_period_start || null,
        current_period_end: data.current_period_end || null,
        updated_at: nowIso
      };

      if (entitlement) {
        subUpsert.plan_tier = entitlement.tier;
        subUpsert.billing_interval = entitlement.interval;

        if (rawStatus === 'active' || rawStatus === 'trialing') {
          const currentRank = (userProfile?.subscription_status === 'active' || userProfile?.subscription_status === 'trialing')
            ? (TIER_RANK[userProfile?.plan_tier || 'free'] || 0)
            : 0;
          const newRank = TIER_RANK[entitlement.tier] || 0;

          if (newRank >= currentRank) {
            await dbClient
              .from('profiles')
              .update({
                plan_tier: entitlement.tier,
                billing_interval: entitlement.interval,
                subscription_status: rawStatus,
                updated_at: nowIso
              })
              .eq('id', targetUserId);
          }
        }
      }

      await dbClient.from('dodo_subscriptions').upsert(subUpsert);
    }
    // C. Cancelled
    else if (
      eventType === 'subscription.cancelled' ||
      eventType === 'subscription.canceled' ||
      rawStatus === 'canceled' ||
      rawStatus === 'cancelled'
    ) {
      await dbClient.from('dodo_subscriptions').upsert({
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        product_id: productId || localSubRecord?.product_id || '',
        plan_tier: 'free',
        status: 'canceled',
        scheduled_change: null,
        updated_at: nowIso
      });

      // Check if user has any remaining active subscriptions
      const { data: remainingActive } = await dbClient
        .from('dodo_subscriptions')
        .select('plan_tier, billing_interval, subscription_id, customer_id')
        .eq('user_id', targetUserId)
        .in('status', ['active', 'trialing'])
        .neq('subscription_id', subscriptionId);

      if (remainingActive && remainingActive.length > 0) {
        const highest = remainingActive.sort((a, b) => (TIER_RANK[b.plan_tier] || 0) - (TIER_RANK[a.plan_tier] || 0))[0];
        await dbClient
          .from('profiles')
          .update({
            plan_tier: highest.plan_tier,
            billing_interval: highest.billing_interval,
            subscription_status: 'active',
            dodo_subscription_id: highest.subscription_id,
            dodo_customer_id: highest.customer_id,
            updated_at: nowIso
          })
          .eq('id', targetUserId);
      } else {
        await dbClient
          .from('profiles')
          .update({
            plan_tier: 'free',
            subscription_status: 'canceled',
            updated_at: nowIso
          })
          .eq('id', targetUserId);
      }
    }
    // D. Failed / Past Due
    else if (
      eventType === 'subscription.failed' ||
      eventType === 'subscription.past_due' ||
      eventType === 'payment.failed' ||
      rawStatus === 'past_due' ||
      rawStatus === 'failed'
    ) {
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
        await dbClient.from('dodo_subscriptions').upsert({
          user_id: targetUserId,
          subscription_id: subscriptionId,
          customer_id: customerId || '',
          product_id: productId || localSubRecord?.product_id || '',
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
    console.error('[Dodo Webhook Error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
