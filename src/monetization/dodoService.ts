/**
 * ChoreMatrix Dodo Payments Subscription Backend Service (Test Mode Only)
 *
 * Core service handling:
 * 1. Standard Webhooks (Svix) HMAC-SHA256 signature verification (webhook-id, webhook-timestamp, webhook-signature).
 * 2. Idempotent webhook processing via public.dodo_webhook_events.
 * 3. Trial-consumed lifecycle enforcement:
 *    - 7-day trial granted ONLY for eligible first-time accounts.
 *    - Once consumed (trial_consumed = true), trial cannot be repeated.
 * 4. Subscription state synchronization (active, trialing, past_due, canceled, failed).
 * 5. Cancellation via Dodo API with immediate termination policy.
 * 6. Server-side allowlisted checkout session generation.
 */

import crypto from 'node:crypto';
import { DODO_CONFIG, getDodoProductId, mapDodoProductToTier, normalizePlanTier, normalizeBillingInterval } from '../config/dodo.ts';

export interface DodoCredentials {
  apiKey?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

export interface DodoWebhookHeaders {
  'webhook-id'?: string | null;
  'webhook-timestamp'?: string | null;
  'webhook-signature'?: string | null;
  [key: string]: string | null | undefined;
}

export interface DodoWebhookProcessingParams {
  rawBody: string;
  headers: DodoWebhookHeaders;
  webhookSecret: string;
  dbClient: any;
  toleranceSeconds?: number;
}

export interface DodoWebhookProcessingResult {
  success: boolean;
  event_id: string;
  duplicate?: boolean;
  subscription_id?: string;
  subscription_status?: string;
  plan_tier?: string;
  billing_interval?: string;
  error?: string;
  message?: string;
}

/**
 * Parses the Svix/Standard Webhook signature header into array of signature hashes.
 * Format: "v1,g0hM9SsE+OTPJTGtUV..." or "v1,abc v1,def"
 */
export function parseDodoSignatures(header: string | null | undefined): string[] {
  if (!header || typeof header !== 'string') return [];
  const parts = header.trim().split(/\s+/);
  const signatures: string[] = [];
  for (const part of parts) {
    const [version, sig] = part.split(',');
    if (version?.trim() === 'v1' && sig?.trim()) {
      signatures.push(sig.trim());
    }
  }
  return signatures;
}

/**
 * Verifies the Standard Webhooks (Svix) HMAC-SHA256 signature according to specification:
 * 1. Payload signed is: `${webhook_id}.${webhook_timestamp}.${rawBody}`
 * 2. Key is base64-decoded if secret has `whsec_` prefix, or raw string buffer otherwise.
 * 3. Constant-time comparison against all signatures provided in header.
 */
export function verifyDodoWebhookSignature(
  headers: DodoWebhookHeaders | null | undefined,
  rawBody: string | null | undefined,
  webhookSecret: string | null | undefined,
  toleranceSeconds = 3600 // 1 hour tolerance to accommodate development & simulator delays
): boolean {
  if (!headers || !rawBody || !webhookSecret) {
    return false;
  }

  const webhookId = headers['webhook-id'] || headers['Webhook-Id'] || headers['WEBHOOK-ID'];
  const webhookTimestamp = headers['webhook-timestamp'] || headers['Webhook-Timestamp'] || headers['WEBHOOK-TIMESTAMP'];
  const webhookSignature = headers['webhook-signature'] || headers['Webhook-Signature'] || headers['WEBHOOK-SIGNATURE'];

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  // Replay attack prevention check
  if (toleranceSeconds > 0) {
    const timestampNum = parseInt(webhookTimestamp, 10);
    if (isNaN(timestampNum)) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampNum) > toleranceSeconds) {
      return false; // Signature expired
    }
  }

  try {
    // Secret preparation: if prefixed with whsec_, decode the base64 part
    let secretBuffer: Buffer;
    const cleanSecret = webhookSecret.trim();
    if (cleanSecret.startsWith('whsec_')) {
      secretBuffer = Buffer.from(cleanSecret.slice(6), 'base64');
    } else {
      secretBuffer = Buffer.from(cleanSecret, 'utf8');
    }

    const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const expectedSignatureBase64 = crypto
      .createHmac('sha256', secretBuffer)
      .update(signedPayload)
      .digest('base64');

    const expectedBuf = Buffer.from(expectedSignatureBase64, 'utf8');
    const providedSignatures = parseDodoSignatures(webhookSignature);

    if (providedSignatures.length === 0) {
      return false;
    }

    for (const providedSig of providedSignatures) {
      const providedBuf = Buffer.from(providedSig, 'utf8');
      if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extracts or generates a deterministic event ID from Dodo webhook headers/payload.
 */
export function extractDodoEventId(payload: any, headers?: DodoWebhookHeaders): string {
  if (headers && (headers['webhook-id'] || headers['Webhook-Id'])) {
    return String(headers['webhook-id'] || headers['Webhook-Id']);
  }
  if (payload.event_id) return String(payload.event_id);
  if (payload.id && typeof payload.id === 'string' && (payload.id.startsWith('evt_') || payload.id.startsWith('msg_'))) {
    return payload.id;
  }

  const data = payload.data || {};
  const subId = data.subscription_id || data.id || payload.subscription_id || 'sub_unknown';
  const eventType = payload.type || payload.event_type || 'event';
  const timestamp = payload.timestamp || payload.created_at || Date.now();

  return crypto
    .createHash('sha256')
    .update(`${eventType}:${subId}:${timestamp}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Processes an incoming Dodo webhook with Standard Webhooks verification and idempotency.
 */
export async function processDodoWebhook(
  params: DodoWebhookProcessingParams
): Promise<DodoWebhookProcessingResult> {
  const { rawBody, headers, webhookSecret, dbClient, toleranceSeconds } = params;

  // 1. Mandatory Standard Webhooks signature verification
  const isValid = verifyDodoWebhookSignature(headers, rawBody, webhookSecret, toleranceSeconds);
  if (!isValid) {
    throw new Error('Unauthorized: Invalid Dodo webhook signature.');
  }

  // 2. Parse payload safely
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err: any) {
    throw new Error(`Malformed JSON in webhook body: ${err.message}`);
  }

  // 3. Extract event ID
  const eventId = extractDodoEventId(payload, headers);
  const eventType = String(payload.type || payload.event_type || payload.event || '');

  // 4. Idempotency Check: query dodo_webhook_events
  const { data: existingEvent, error: findError } = await dbClient
    .from('dodo_webhook_events')
    .select('id, event_type')
    .eq('event_id', eventId)
    .maybeSingle();

  if (findError) {
    console.warn('[Dodo Webhook] Error checking event idempotency:', findError.message);
  }

  if (existingEvent) {
    return {
      success: true,
      event_id: eventId,
      duplicate: true,
      message: 'Event already processed.'
    };
  }

  // 5. Extract entity data
  const data = payload.data || {};
  const subscriptionId = data.subscription_id || data.id || payload.subscription_id || null;
  const customerId = data.customer_id || data.customer?.customer_id || payload.customer_id || null;
  const rawStatus = String(data.status || payload.status || '').toLowerCase();

  // 6. Record event in dodo_webhook_events table
  await dbClient.from('dodo_webhook_events').insert({
    event_id: eventId,
    event_type: eventType,
    subscription_id: subscriptionId,
    customer_id: customerId,
    processed_at: new Date().toISOString(),
    payload
  });

  if (!subscriptionId && !eventType.startsWith('payment.')) {
    return {
      success: true,
      event_id: eventId,
      message: 'Logged non-subscription event.'
    };
  }

  // 7. Resolve target user ID
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
    console.warn('[Dodo Webhook] Target user could not be resolved for event:', eventId);
    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      message: 'Webhook logged, but target user could not be resolved.'
    };
  }

  // 8. Fetch current user profile to verify trial consumption invariant
  const { data: userProfile } = await dbClient
    .from('profiles')
    .select('id, trial_consumed, plan_tier, subscription_status, dodo_subscription_id')
    .eq('id', targetUserId)
    .maybeSingle();

  // 8b. Fetch local subscription record to enforce terminal cancellation invariant
  const { data: localSubRecord } = subscriptionId ? await dbClient
    .from('dodo_subscriptions')
    .select('status, plan_tier, subscription_id')
    .eq('subscription_id', subscriptionId)
    .maybeSingle() : { data: null };

  const isSubCancelled = (localSubRecord?.status === 'canceled' || localSubRecord?.status === 'cancelled') &&
    localSubRecord?.subscription_id === subscriptionId;
  const isProfileCancelled = (userProfile?.subscription_status === 'canceled' || userProfile?.subscription_status === 'cancelled') &&
    Boolean(userProfile?.dodo_subscription_id && userProfile.dodo_subscription_id === subscriptionId);

  // INVARIANT: Once a subscription is cancelled immediately, subsequent webhooks for that subscription
  // CANNOT resurrect it back to trialing or active.
  if (isSubCancelled || isProfileCancelled) {
    if (eventType !== 'subscription.cancelled' && eventType !== 'subscription.canceled' && rawStatus !== 'canceled' && rawStatus !== 'cancelled') {
      console.warn(`[Dodo Webhook Safety] Blocked resurrection for cancelled subscription ${subscriptionId} (event: ${eventType}, status: ${rawStatus}). Preserving terminal free/cancelled state.`);
      return {
        success: true,
        event_id: eventId,
        subscription_id: subscriptionId,
        subscription_status: 'canceled',
        plan_tier: 'free',
        message: 'Ignoring webhook for already cancelled subscription; terminal cancellation state preserved.'
      };
    }
  }

  const nowIso = new Date().toISOString();
  const productId = (
    data.product_id ||
    data.product_cart?.[0]?.product_id ||
    payload.product_id ||
    ''
  );

  const mappedTier = mapDodoProductToTier(productId);
  const trialDays = data.trial_period_days || data.subscription_data?.trial_period_days || 0;
  const isTrialing = rawStatus === 'trialing' || trialDays > 0 || eventType === 'subscription.trialing';

  // 9. Apply authoritative state transitions
  // A. Subscription Active / Trialing / Created
  if (
    eventType === 'subscription.active' ||
    eventType === 'subscription.created' ||
    eventType === 'subscription.trialing' ||
    (eventType === 'payment.succeeded' && subscriptionId)
  ) {
    if (!mappedTier) {
      const err = `Security warning: Unknown or unmapped Dodo product ID "${productId}". Entitlement refused.`;
      console.error('[Dodo Webhook]', err);
      return {
        success: false,
        event_id: eventId,
        subscription_id: subscriptionId,
        error: err
      };
    }

    const currentPeriodStart = data.current_period_start || data.current_billing_period?.starts_at || nowIso;
    const currentPeriodEnd = data.current_period_end || data.current_billing_period?.ends_at || null;

    if (isTrialing) {
      // Anti-Abuse Check: If user already consumed trial, do not grant trial entitlement
      if (userProfile?.trial_consumed) {
        console.warn(`[Dodo Webhook] Duplicate trial attempt blocked for user ${targetUserId}.`);
        return {
          success: true,
          event_id: eventId,
          subscription_id: subscriptionId,
          message: 'Duplicate trial denied: trial_consumed is already true for this account.'
        };
      }

      const trialEndsAt = data.trial_end || data.trial_ends_at || new Date(Date.now() + 7 * 86400 * 1000).toISOString();

      await dbClient
        .from('profiles')
        .update({
          plan_tier: mappedTier.tier,
          billing_interval: mappedTier.interval,
          subscription_status: 'trialing',
          payment_provider: 'dodo',
          dodo_subscription_id: subscriptionId,
          dodo_customer_id: customerId,
          provider_subscription_id: subscriptionId,
          trial_consumed: true,
          trial_started_at: nowIso,
          trial_ends_at: trialEndsAt,
          updated_at: nowIso
        })
        .eq('id', targetUserId);

      await dbClient.from('dodo_subscriptions').upsert({
        user_id: targetUserId,
        subscription_id: subscriptionId,
        customer_id: customerId || '',
        product_id: productId,
        plan_tier: mappedTier.tier,
        status: 'trialing',
        billing_interval: mappedTier.interval,
        has_trial: true,
        trial_ends_at: trialEndsAt,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd || trialEndsAt,
        updated_at: nowIso
      });

      return {
        success: true,
        event_id: eventId,
        subscription_id: subscriptionId,
        subscription_status: 'trialing',
        plan_tier: mappedTier.tier,
        billing_interval: mappedTier.interval
      };
    }

    // Standard Active
    await dbClient
      .from('profiles')
      .update({
        plan_tier: mappedTier.tier,
        billing_interval: mappedTier.interval,
        subscription_status: 'active',
        payment_provider: 'dodo',
        dodo_subscription_id: subscriptionId,
        dodo_customer_id: customerId,
        provider_subscription_id: subscriptionId,
        trial_consumed: true,
        updated_at: nowIso
      })
      .eq('id', targetUserId);

    await dbClient.from('dodo_subscriptions').upsert({
      user_id: targetUserId,
      subscription_id: subscriptionId,
      customer_id: customerId || '',
      product_id: productId,
      plan_tier: mappedTier.tier,
      status: 'active',
      billing_interval: mappedTier.interval,
      has_trial: false,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      scheduled_change: null,
      updated_at: nowIso
    });

    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      subscription_status: 'active',
      plan_tier: mappedTier.tier,
      billing_interval: mappedTier.interval
    };
  }

  // B. Subscription Updated / Renewed
  if (eventType === 'subscription.updated' || eventType === 'subscription.renewed') {
    const subRecord: any = {
      user_id: targetUserId,
      subscription_id: subscriptionId,
      customer_id: customerId || '',
      product_id: productId || localSubRecord?.product_id || '',
      status: rawStatus || 'active',
      current_period_start: data.current_period_start || null,
      current_period_end: data.current_period_end || null,
      updated_at: nowIso
    };

    if (mappedTier) {
      subRecord.plan_tier = mappedTier.tier;
      subRecord.billing_interval = mappedTier.interval;

      if (rawStatus === 'active' || rawStatus === 'trialing') {
        await dbClient
          .from('profiles')
          .update({
            plan_tier: mappedTier.tier,
            billing_interval: mappedTier.interval,
            updated_at: nowIso
          })
          .eq('id', targetUserId);
      }
    }

    await dbClient.from('dodo_subscriptions').upsert(subRecord);

    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      subscription_status: rawStatus || 'updated',
      plan_tier: mappedTier?.tier,
      billing_interval: mappedTier?.interval
    };
  }

  // C. Subscription Cancelled (Terminal state)
  if (
    eventType === 'subscription.cancelled' ||
    eventType === 'subscription.canceled' ||
    rawStatus === 'canceled' ||
    rawStatus === 'cancelled'
  ) {
    await dbClient
      .from('profiles')
      .update({
        plan_tier: 'free',
        subscription_status: 'canceled',
        updated_at: nowIso
      })
      .eq('id', targetUserId);

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

    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      subscription_status: 'canceled',
      plan_tier: 'free'
    };
  }

  // D. Subscription Failed / Past Due / Payment Failed
  if (
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

    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      subscription_status: 'past_due'
    };
  }

  return {
    success: true,
    event_id: eventId,
    subscription_id: subscriptionId,
    message: `Logged unhandled event type: ${eventType}`
  };
}

export interface CreateDodoCheckoutSessionOptions {
  plan: string;
  interval: string;
  user: { id: string; email?: string; name?: string };
  returnUrl?: string;
  credentials: { apiKey: string; baseUrl?: string; environment?: 'test_mode' | 'live_mode' };
  isTrialEligible?: boolean;
  customFetch?: typeof fetch;
}

/**
 * Creates a Dodo Payments checkout session on the backend.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. Server-side product allowlisting: never accepts client-provided product IDs.
 * 2. Strict plan and interval validation.
 * 3. Enforces one-trial-per-account invariant: trial_period_days is 7 only if eligible.
 */
export async function createDodoCheckoutSession(
  options: CreateDodoCheckoutSessionOptions
): Promise<{ success: boolean; checkout_url?: string; session_id?: string; product_id?: string; error?: string }> {
  const { plan, interval, user, returnUrl, credentials, isTrialEligible = false, customFetch = fetch } = options;
  const { apiKey, baseUrl = 'https://test.dodopayments.com', environment } = credentials;

  if (!apiKey) {
    throw new Error('Dodo Payments API key unconfigured.');
  }

  if (!user || !user.id) {
    throw new Error('User authentication required for checkout session.');
  }

  const isLive = environment === 'live_mode' ||
    (Boolean(baseUrl) && (baseUrl.includes('live.dodopayments.com') || baseUrl.includes('api.dodopayments.com')) && !baseUrl.includes('test'));
  const targetEnv = isLive ? 'live_mode' : 'test_mode';

  // Server-side mapping to allowlisted product ID
  let cleanPlan: string;
  let cleanInterval: string;
  try {
    cleanPlan = normalizePlanTier(plan);
    cleanInterval = cleanPlan === 'fairness_pass' && (!interval || interval === 'one_time')
      ? 'one_time'
      : normalizeBillingInterval(interval, cleanPlan);
  } catch (err: any) {
    return { success: false, error: err.message || `Invalid plan "${plan}" or interval selection.` };
  }

  let productId: string;
  try {
    productId = getDodoProductId(cleanPlan, cleanInterval, targetEnv);
  } catch (err: any) {
    return { success: false, error: err.message || 'Invalid plan or interval selection.' };
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/checkouts`;

  const requestBody: Record<string, any> = {
    product_cart: [
      {
        product_id: productId,
        quantity: 1
      }
    ],
    customer: {
      email: user.email || undefined,
      name: user.name || undefined
    },
    metadata: {
      user_id: user.id,
      plan: cleanPlan,
      interval: cleanInterval,
      source_product_id: cleanPlan === 'fairness_pass' ? 'pdt_0NphhVTxhO0pNjHindcHi' : undefined
    },
    return_url: returnUrl || `${DODO_CONFIG.productionReturnDomain}/account.html?payment_status=submitted`
  };

  if (isTrialEligible && cleanPlan !== 'fairness_pass' && cleanInterval !== 'one_time') {
    requestBody.subscription_data = {
      trial_period_days: 7
    };
  }

  const response = await customFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const contentType = response.headers?.get?.('content-type') || '';
    let errMessage = `Dodo checkout session creation failed (${response.status})`;
    if (contentType.includes('application/json')) {
      try {
        const errJson = await response.json();
        errMessage = errJson?.message || errJson?.error?.message || errJson?.error || errMessage;
      } catch {
        const rawText = await response.text();
        if (rawText) errMessage += `: ${rawText.slice(0, 150)}`;
      }
    } else {
      const rawText = await response.text();
      if (rawText) errMessage += `: ${rawText.slice(0, 150)}`;
    }
    return { success: false, error: errMessage };
  }

  try {
    const data = await response.json();
    const checkoutUrl = data.checkout_url || data.payment_link || data.url;
    const sessionId = data.session_id || data.id;

    if (!checkoutUrl) {
      return { success: false, error: 'Dodo checkout response missing checkout_url.' };
    }

    return {
      success: true,
      checkout_url: checkoutUrl,
      session_id: sessionId,
      product_id: productId
    };
  } catch (parseErr: any) {
    return {
      success: false,
      error: `Failed to parse Dodo checkout response JSON: ${parseErr.message}`
    };
  }
}

/**
 * Cancels a Dodo subscription on the gateway using the server API key.
 * POLICY: IMMEDIATE CANCELLATION
 */
export async function cancelDodoSubscription(
  subscriptionId: string,
  credentials: { apiKey: string; baseUrl?: string },
  customFetch: typeof fetch = fetch
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { apiKey, baseUrl = 'https://test.dodopayments.com' } = credentials;
  if (!apiKey) {
    throw new Error('Dodo Payments API key unconfigured.');
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/subscriptions/${subscriptionId}`;

  const response = await customFetch(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      status: 'cancelled'
    })
  });

  if (!response.ok) {
    const contentType = response.headers?.get?.('content-type') || '';
    let errMessage = `Dodo cancellation failed (${response.status})`;
    if (contentType.includes('application/json')) {
      try {
        const errJson = await response.json();
        errMessage = errJson?.message || errJson?.error?.message || errJson?.error || errMessage;
      } catch {
        const rawText = await response.text();
        if (rawText) errMessage += `: ${rawText.slice(0, 150)}`;
      }
    } else {
      const rawText = await response.text();
      if (rawText) errMessage += `: ${rawText.slice(0, 150)}`;
    }
    return {
      success: false,
      error: errMessage
    };
  }

  try {
    const data = await response.json();
    return {
      success: true,
      data
    };
  } catch (parseErr: any) {
    return {
      success: false,
      error: `Failed to parse Dodo response JSON: ${parseErr.message}`
    };
  }
}
