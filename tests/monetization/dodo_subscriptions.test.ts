/**
 * ChoreMatrix Dodo Payments Subscriptions & Entitlements Test Suite (Test Mode Only)
 *
 * Covers:
 * 1. All 4 plan/interval mappings (Pro/Plus x Monthly/Annual)
 * 2. Valid/invalid plan selections & strict no-silent-fallback
 * 3. One-time 7-day trial consumption rule
 * 4. Resubscribe after cancelled trial = no second trial
 * 5. Checkout session creation authorization & server allowlisting
 * 6. Standard Webhooks (Svix) HMAC-SHA256 signature verification
 * 7. Malformed/tampered webhook rejection
 * 8. Duplicate webhook idempotency
 * 9. Out-of-order/stale event handling & anti-resurrection
 * 10. Complete lifecycle handling (active, trialing, updated, renewed, cancelled, past_due)
 * 11. Immediate cancellation behavior
 * 12. Entitlement protection & Free/Pro/Plus access boundaries
 * 13. Zero secret leakage into client bundle or environment
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DODO_CONFIG,
  CANONICAL_DODO_PLAN_MATRIX,
  DODO_PRODUCTS,
  getDodoProductId,
  isDodoProductId,
  mapDodoProductToTier,
  normalizePlanTier,
  normalizeBillingInterval
} from '../../src/config/dodo.ts';
import {
  verifyDodoWebhookSignature,
  parseDodoSignatures,
  extractDodoEventId,
  processDodoWebhook,
  createDodoCheckoutSession,
  cancelDodoSubscription
} from '../../src/monetization/dodoService.ts';
import { getPlanningEntitlement, enforcePlanningHorizon } from '../../src/monetization/entitlements.ts';
import { getClientSafeEnv } from '../../build.js';

// Helper: generate valid Svix Standard Webhooks signature header for testing
function generateTestDodoSignature(
  webhookId: string,
  timestamp: string | number,
  rawBody: string,
  secret: string
): { 'webhook-id': string; 'webhook-timestamp': string; 'webhook-signature': string } {
  const ts = String(timestamp);
  let secretBuffer: Buffer;
  if (secret.startsWith('whsec_')) {
    secretBuffer = Buffer.from(secret.slice(6), 'base64');
  } else {
    secretBuffer = Buffer.from(secret, 'utf8');
  }

  const signedPayload = `${webhookId}.${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBuffer).update(signedPayload).digest('base64');

  return {
    'webhook-id': webhookId,
    'webhook-timestamp': ts,
    'webhook-signature': `v1,${sig}`
  };
}

// In-memory mock Supabase client for testing Dodo webhook state machine & idempotency
function createMockSupabase(initialProfile?: {
  id: string;
  plan_tier: string;
  subscription_status: string;
  trial_consumed: boolean;
  payment_provider?: string | null;
  dodo_customer_id?: string | null;
  dodo_subscription_id?: string | null;
}) {
  const webhookEvents: Set<string> = new Set();
  const profile = initialProfile || {
    id: 'user_123',
    plan_tier: 'free',
    subscription_status: 'none',
    trial_consumed: false,
    payment_provider: null,
    dodo_customer_id: null,
    dodo_subscription_id: null
  };
  const subscriptions: Record<string, any> = {};

  return {
    profile,
    webhookEvents,
    subscriptions,
    from(table: string) {
      if (table === 'dodo_webhook_events') {
        return {
          select(cols: string) {
            return {
              eq(col: string, val: string) {
                return {
                  async maybeSingle() {
                    if (webhookEvents.has(val)) {
                      return { data: { event_id: val }, error: null };
                    }
                    return { data: null, error: null };
                  }
                };
              }
            };
          },
          insert(record: { event_id: string; event_type: string }) {
            webhookEvents.add(record.event_id);
            return Promise.resolve({ error: null });
          }
        };
      }

      if (table === 'dodo_subscriptions') {
        return {
          upsert(record: any) {
            subscriptions[record.subscription_id] = { ...record };
            return Promise.resolve({ error: null });
          },
          select(cols: string) {
            return {
              eq(col: string, val: string) {
                return {
                  async maybeSingle() {
                    const sub = subscriptions[val];
                    if (sub) return { data: sub, error: null };
                    return { data: null, error: null };
                  }
                };
              }
            };
          }
        };
      }

      if (table === 'profiles') {
        return {
          select(cols: string) {
            return {
              eq(col: string, val: string) {
                return {
                  async maybeSingle() {
                    if (profile.id === val || profile.dodo_customer_id === val || profile.dodo_subscription_id === val) {
                      return { data: { ...profile }, error: null };
                    }
                    return { data: null, error: null };
                  }
                };
              }
            };
          },
          update(updates: Partial<typeof profile>) {
            return {
              eq(col: string, val: string) {
                if (profile.id === val) {
                  Object.assign(profile, updates);
                }
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }

      throw new Error(`Unhandled mock table: ${table}`);
    }
  };
}

describe('Dodo Payments Subscriptions & Security Suite (Test Mode)', () => {
  describe('1. Catalog & Plan Mapping Audit (TEST & LIVE)', () => {
    describe('TEST Environment Catalog', () => {
      it('maps TEST Pro Monthly ($5.99/mo) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('pro', 'monthly', 'test_mode');
        assert.strictEqual(pid, 'pdt_0NozKZ3sZ6h0vplb451YK');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'pro');
        assert.strictEqual(meta.interval, 'monthly');
        assert.strictEqual(meta.amount, 5.99);
        assert.strictEqual(meta.trialDays, 7);
      });

      it('maps TEST Pro Annual ($59.99/yr) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('pro', 'annual', 'test_mode');
        assert.strictEqual(pid, 'pdt_0NozL7OvhpMonCSMw99Ng');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'pro');
        assert.strictEqual(meta.interval, 'annual');
        assert.strictEqual(meta.amount, 59.99);
        assert.strictEqual(meta.trialDays, 7);
      });

      it('maps TEST Plus Monthly ($9.99/mo) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('plus', 'monthly', 'test_mode');
        assert.strictEqual(pid, 'pdt_0NozLK4XCjDSCbkADEtQL');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'plus');
        assert.strictEqual(meta.interval, 'monthly');
        assert.strictEqual(meta.amount, 9.99);
        assert.strictEqual(meta.trialDays, 7);
      });

      it('maps TEST Plus Annual ($99.99/yr) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('plus', 'annual', 'test_mode');
        assert.strictEqual(pid, 'pdt_0NozLba96vBrtNtGdFONX');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'plus');
        assert.strictEqual(meta.interval, 'annual');
        assert.strictEqual(meta.amount, 99.99);
        assert.strictEqual(meta.trialDays, 7);
      });
    });

    describe('LIVE Environment Catalog', () => {
      it('maps LIVE Pro Monthly ($5.99/mo) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('pro', 'monthly', 'live_mode');
        assert.strictEqual(pid, 'pdt_0Np1eZsemtECph1HLoDb0');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'pro');
        assert.strictEqual(meta.interval, 'monthly');
        assert.strictEqual(meta.amount, 5.99);
        assert.strictEqual(meta.trialDays, 7);
      });

      it('maps LIVE Pro Annual ($59.99/yr) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('pro', 'annual', 'live_mode');
        assert.strictEqual(pid, 'pdt_0Np1ec3oUFACgeOKI4ktP');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'pro');
        assert.strictEqual(meta.interval, 'annual');
        assert.strictEqual(meta.amount, 59.99);
        assert.strictEqual(meta.trialDays, 7);
      });

      it('maps LIVE Plus Monthly ($9.99/mo) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('plus', 'monthly', 'live_mode');
        assert.strictEqual(pid, 'pdt_0Np1ean3rbxLUQs6d1QAb');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'plus');
        assert.strictEqual(meta.interval, 'monthly');
        assert.strictEqual(meta.amount, 9.99);
        assert.strictEqual(meta.trialDays, 7);
      });

      it('maps LIVE Plus Annual ($99.99/yr) exactly to canonical Dodo product ID', () => {
        const pid = getDodoProductId('plus', 'annual', 'live_mode');
        assert.strictEqual(pid, 'pdt_0Np1ebMsCqGBWntrkX3fK');
        const meta = mapDodoProductToTier(pid);
        assert.ok(meta);
        assert.strictEqual(meta.tier, 'plus');
        assert.strictEqual(meta.interval, 'annual');
        assert.strictEqual(meta.amount, 99.99);
        assert.strictEqual(meta.trialDays, 7);
      });
    });

    it('strictly normalizes valid tier and interval aliases', () => {
      assert.strictEqual(normalizePlanTier('pro'), 'pro');
      assert.strictEqual(normalizePlanTier('household_pro'), 'pro');
      assert.strictEqual(normalizePlanTier('plus'), 'plus');
      assert.strictEqual(normalizePlanTier('family_plus'), 'plus');
      assert.strictEqual(normalizePlanTier('household_plus'), 'plus');

      assert.strictEqual(normalizeBillingInterval('monthly'), 'monthly');
      assert.strictEqual(normalizeBillingInterval('month'), 'monthly');
      assert.strictEqual(normalizeBillingInterval('annual'), 'annual');
      assert.strictEqual(normalizeBillingInterval('annually'), 'annual');
      assert.strictEqual(normalizeBillingInterval('yearly'), 'annual');
    });

    it('throws explicitly on invalid or missing plan/interval with NO silent fallback', () => {
      assert.throws(() => getDodoProductId('enterprise', 'monthly'), /Invalid plan/);
      assert.throws(() => getDodoProductId('free', 'monthly'), /Invalid plan/);
      assert.throws(() => getDodoProductId('pro', 'weekly'), /Invalid interval/);
      assert.throws(() => getDodoProductId('', 'monthly'), /Missing plan parameter/);
      assert.throws(() => getDodoProductId('pro', ''), /Missing interval parameter/);
    });

    it('isDodoProductId validates all 8 allowlisted TEST and LIVE product IDs', () => {
      // Test mode product IDs
      assert.strictEqual(isDodoProductId('pdt_0NozKZ3sZ6h0vplb451YK'), true);
      assert.strictEqual(isDodoProductId('pdt_0NozL7OvhpMonCSMw99Ng'), true);
      assert.strictEqual(isDodoProductId('pdt_0NozLK4XCjDSCbkADEtQL'), true);
      assert.strictEqual(isDodoProductId('pdt_0NozLba96vBrtNtGdFONX'), true);

      // Live mode product IDs
      assert.strictEqual(isDodoProductId('pdt_0Np1eZsemtECph1HLoDb0'), true);
      assert.strictEqual(isDodoProductId('pdt_0Np1ec3oUFACgeOKI4ktP'), true);
      assert.strictEqual(isDodoProductId('pdt_0Np1ean3rbxLUQs6d1QAb'), true);
      assert.strictEqual(isDodoProductId('pdt_0Np1ebMsCqGBWntrkX3fK'), true);

      // Invalid product IDs
      assert.strictEqual(isDodoProductId('pdt_unauthorized_fake'), false);
      assert.strictEqual(isDodoProductId(null), false);
    });
  });

  describe('2. Standard Webhooks (Svix) Signature Verification Suite', () => {
    const testSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2gZYMun';
    const testBody = JSON.stringify({ type: 'subscription.active', data: { id: 'sub_test123' } });

    it('accepts authentic Svix HMAC-SHA256 signature with valid timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const headers = generateTestDodoSignature('msg_123', now, testBody, testSecret);
      const isValid = verifyDodoWebhookSignature(headers, testBody, testSecret);
      assert.strictEqual(isValid, true);
    });

    it('rejects missing or incomplete webhook signature headers', () => {
      assert.strictEqual(verifyDodoWebhookSignature(null, testBody, testSecret), false);
      assert.strictEqual(verifyDodoWebhookSignature({}, testBody, testSecret), false);
      assert.strictEqual(verifyDodoWebhookSignature({ 'webhook-id': 'msg_1' }, testBody, testSecret), false);
      assert.strictEqual(verifyDodoWebhookSignature({ 'webhook-id': 'msg_1', 'webhook-timestamp': '123' }, testBody, testSecret), false);
    });

    it('rejects tampered body or forged signature', () => {
      const now = Math.floor(Date.now() / 1000);
      const headers = generateTestDodoSignature('msg_123', now, testBody, testSecret);
      const tamperedBody = testBody + ' ';
      assert.strictEqual(verifyDodoWebhookSignature(headers, tamperedBody, testSecret), false);

      const badHeaders = { ...headers, 'webhook-signature': 'v1,invalid_sig_here' };
      assert.strictEqual(verifyDodoWebhookSignature(badHeaders, testBody, testSecret), false);
    });

    it('rejects signature verified against wrong secret', () => {
      const now = Math.floor(Date.now() / 1000);
      const headers = generateTestDodoSignature('msg_123', now, testBody, testSecret);
      const wrongSecret = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      assert.strictEqual(verifyDodoWebhookSignature(headers, testBody, wrongSecret), false);
    });

    it('rejects expired webhook signatures based on timestamp tolerance', () => {
      const pastTime = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
      const headers = generateTestDodoSignature('msg_123', pastTime, testBody, testSecret);
      const isValid = verifyDodoWebhookSignature(headers, testBody, testSecret, 3600); // 1 hr tolerance
      assert.strictEqual(isValid, false);
    });

    it('accepts header containing multiple signature candidates', () => {
      const now = Math.floor(Date.now() / 1000);
      const headers = generateTestDodoSignature('msg_123', now, testBody, testSecret);
      headers['webhook-signature'] = `v1,old_invalid_sig ${headers['webhook-signature']}`;
      assert.strictEqual(verifyDodoWebhookSignature(headers, testBody, testSecret), true);
    });
  });

  describe('3. Idempotency & Duplicate Handling Suite', () => {
    const testSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2gZYMun';

    it('processes first webhook event and registers event_id', async () => {
      const mockSupabase = createMockSupabase();
      const payload = {
        type: 'subscription.active',
        data: {
          id: 'sub_dodo_100',
          customer_id: 'cus_dodo_100',
          product_id: 'pdt_0NozKZ3sZ6h0vplb451YK',
          metadata: { user_id: 'user_123' }
        }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_idemp_1', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.duplicate, undefined);
      assert.strictEqual(mockSupabase.profile.plan_tier, 'pro');
      assert.strictEqual(mockSupabase.profile.subscription_status, 'active');
      assert.ok(mockSupabase.webhookEvents.has('msg_idemp_1'));
    });

    it('detects duplicate event_id and acknowledges without re-executing side effects', async () => {
      const mockSupabase = createMockSupabase();
      mockSupabase.webhookEvents.add('msg_idemp_duplicate');

      const payload = {
        type: 'subscription.active',
        data: { id: 'sub_dodo_100', product_id: 'pdt_0NozKZ3sZ6h0vplb451YK' }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_idemp_duplicate', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.duplicate, true);
      assert.strictEqual(result.message, 'Event already processed.');
    });
  });

  describe('4. Lifecycle & Trial Protection State Transitions', () => {
    const testSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2gZYMun';

    it('grants 7-day trial for eligible new user and sets trial_consumed=true', async () => {
      const mockSupabase = createMockSupabase({
        id: 'user_trial_1',
        plan_tier: 'free',
        subscription_status: 'none',
        trial_consumed: false
      });

      const payload = {
        type: 'subscription.active',
        data: {
          id: 'sub_trial_1',
          customer_id: 'cus_1',
          product_id: 'pdt_0NozKZ3sZ6h0vplb451YK',
          status: 'trialing',
          trial_period_days: 7,
          metadata: { user_id: 'user_trial_1' }
        }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_tr_1', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.subscription_status, 'trialing');
      assert.strictEqual(mockSupabase.profile.plan_tier, 'pro');
      assert.strictEqual(mockSupabase.profile.subscription_status, 'trialing');
      assert.strictEqual(mockSupabase.profile.trial_consumed, true);
      assert.strictEqual(mockSupabase.profile.payment_provider, 'dodo');
    });

    it('anti-abuse: denies second free trial if trial_consumed is already true', async () => {
      const mockSupabase = createMockSupabase({
        id: 'user_abuser',
        plan_tier: 'free',
        subscription_status: 'canceled',
        trial_consumed: true
      });

      const payload = {
        type: 'subscription.trialing',
        data: {
          id: 'sub_repeat_trial',
          product_id: 'pdt_0NozKZ3sZ6h0vplb451YK',
          trial_period_days: 7,
          metadata: { user_id: 'user_abuser' }
        }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_tr_repeat', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(mockSupabase.profile.plan_tier, 'free');
      assert.strictEqual(mockSupabase.profile.subscription_status, 'canceled');
    });

    it('resubscribe after cancelled trial activates standard paid subscription', async () => {
      const mockSupabase = createMockSupabase({
        id: 'user_resubscribe',
        plan_tier: 'free',
        subscription_status: 'canceled',
        trial_consumed: true
      });

      const payload = {
        type: 'subscription.active',
        data: {
          id: 'sub_resub',
          customer_id: 'cus_resub',
          product_id: 'pdt_0NozLba96vBrtNtGdFONX',
          status: 'active',
          trial_period_days: 0,
          metadata: { user_id: 'user_resubscribe' }
        }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_resub_1', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(mockSupabase.profile.plan_tier, 'plus');
      assert.strictEqual(mockSupabase.profile.subscription_status, 'active');
      assert.strictEqual(mockSupabase.profile.billing_interval, 'annual');
    });

    it('subscription.cancelled immediately downgrades user to free tier', async () => {
      const mockSupabase = createMockSupabase({
        id: 'user_active_cancel',
        plan_tier: 'pro',
        subscription_status: 'active',
        trial_consumed: true,
        dodo_subscription_id: 'sub_active_to_cancel'
      });

      const payload = {
        type: 'subscription.cancelled',
        data: {
          id: 'sub_active_to_cancel',
          product_id: 'pdt_0NozKZ3sZ6h0vplb451YK',
          status: 'cancelled',
          metadata: { user_id: 'user_active_cancel' }
        }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_cancel_1', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(mockSupabase.profile.plan_tier, 'free');
      assert.strictEqual(mockSupabase.profile.subscription_status, 'canceled');
    });

    it('anti-resurrection: prevents out-of-order webhooks from reviving cancelled subscriptions', async () => {
      const mockSupabase = createMockSupabase({
        id: 'user_locked_cancelled',
        plan_tier: 'free',
        subscription_status: 'canceled',
        trial_consumed: true,
        dodo_subscription_id: 'sub_terminal_cancel'
      });
      mockSupabase.subscriptions['sub_terminal_cancel'] = {
        subscription_id: 'sub_terminal_cancel',
        status: 'canceled',
        plan_tier: 'free'
      };

      // Stale subscription.active webhook arrives after cancellation
      const payload = {
        type: 'subscription.active',
        data: {
          id: 'sub_terminal_cancel',
          product_id: 'pdt_0NozKZ3sZ6h0vplb451YK',
          status: 'active',
          metadata: { user_id: 'user_locked_cancelled' }
        }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_stale_1', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(mockSupabase.profile.plan_tier, 'free');
      assert.strictEqual(mockSupabase.profile.subscription_status, 'canceled');
      assert.ok(result.message?.includes('terminal cancellation state preserved'));
    });

    it('subscription.failed sets subscription_status to past_due', async () => {
      const mockSupabase = createMockSupabase({
        id: 'user_failing',
        plan_tier: 'pro',
        subscription_status: 'active',
        trial_consumed: true
      });

      const payload = {
        type: 'subscription.failed',
        data: {
          id: 'sub_fail_1',
          product_id: 'pdt_0NozKZ3sZ6h0vplb451YK',
          status: 'past_due',
          metadata: { user_id: 'user_failing' }
        }
      };
      const rawBody = JSON.stringify(payload);
      const headers = generateTestDodoSignature('msg_fail_1', Math.floor(Date.now() / 1000), rawBody, testSecret);

      const result = await processDodoWebhook({
        rawBody,
        headers,
        webhookSecret: testSecret,
        dbClient: mockSupabase
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(mockSupabase.profile.subscription_status, 'past_due');
    });
  });

  describe('5. Checkout Session Creation & Authorization', () => {
    it('creates checkout session with trial_period_days: 7 when trial-eligible', async () => {
      let capturedPayload: any = null;
      const customFetch = (async (url: string, init: any) => {
        capturedPayload = JSON.parse(init.body);
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            checkout_url: 'https://test.checkout.dodopayments.com/session/sess_123',
            session_id: 'sess_123'
          })
        };
      }) as any;

      const result = await createDodoCheckoutSession({
        plan: 'pro',
        interval: 'monthly',
        user: { id: 'usr_1', email: 'alice@example.com' },
        credentials: { apiKey: 'test_dodo_key' },
        isTrialEligible: true,
        customFetch
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.checkout_url, 'https://test.checkout.dodopayments.com/session/sess_123');
      assert.strictEqual(capturedPayload.product_cart[0].product_id, 'pdt_0NozKZ3sZ6h0vplb451YK');
      assert.strictEqual(capturedPayload.subscription_data?.trial_period_days, 7);
      assert.strictEqual(capturedPayload.metadata?.user_id, 'usr_1');
    });

    it('creates checkout session without trial_period_days when trial is already consumed', async () => {
      let capturedPayload: any = null;
      const customFetch = (async (url: string, init: any) => {
        capturedPayload = JSON.parse(init.body);
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            checkout_url: 'https://test.checkout.dodopayments.com/session/sess_456'
          })
        };
      }) as any;

      const result = await createDodoCheckoutSession({
        plan: 'plus',
        interval: 'annual',
        user: { id: 'usr_2', email: 'bob@example.com' },
        credentials: { apiKey: 'test_dodo_key' },
        isTrialEligible: false,
        customFetch
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(capturedPayload.product_cart[0].product_id, 'pdt_0NozLba96vBrtNtGdFONX');
      assert.strictEqual(capturedPayload.subscription_data, undefined);
    });

    it('creates LIVE checkout session with LIVE product ID when baseUrl or environment is LIVE', async () => {
      let capturedPayload: any = null;
      let capturedEndpoint = '';
      const customFetch = (async (url: string, init: any) => {
        capturedEndpoint = url;
        capturedPayload = JSON.parse(init.body);
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            checkout_url: 'https://checkout.dodopayments.com/session/sess_live_123',
            session_id: 'sess_live_123'
          })
        };
      }) as any;

      const result = await createDodoCheckoutSession({
        plan: 'pro',
        interval: 'monthly',
        user: { id: 'usr_live_1', email: 'live@example.com' },
        credentials: { apiKey: 'live_dodo_key', baseUrl: 'https://live.dodopayments.com' },
        isTrialEligible: true,
        customFetch
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.checkout_url, 'https://checkout.dodopayments.com/session/sess_live_123');
      assert.strictEqual(capturedPayload.product_cart[0].product_id, 'pdt_0Np1eZsemtECph1HLoDb0');
      assert.notStrictEqual(capturedPayload.product_cart[0].product_id, 'pdt_0NozKZ3sZ6h0vplb451YK');
      assert.strictEqual(capturedEndpoint, 'https://live.dodopayments.com/checkouts');
    });

    it('verifies LIVE environment creates correct product IDs for all 4 plans', async () => {
      const livePlans = [
        { plan: 'pro', interval: 'monthly', expected: 'pdt_0Np1eZsemtECph1HLoDb0' },
        { plan: 'pro', interval: 'annual', expected: 'pdt_0Np1ec3oUFACgeOKI4ktP' },
        { plan: 'plus', interval: 'monthly', expected: 'pdt_0Np1ean3rbxLUQs6d1QAb' },
        { plan: 'plus', interval: 'annual', expected: 'pdt_0Np1ebMsCqGBWntrkX3fK' }
      ];

      for (const item of livePlans) {
        let capturedPayload: any = null;
        const customFetch = (async (_url: string, init: any) => {
          capturedPayload = JSON.parse(init.body);
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ checkout_url: 'https://checkout.dodopayments.com/session/s', session_id: 's' })
          };
        }) as any;

        const result = await createDodoCheckoutSession({
          plan: item.plan,
          interval: item.interval,
          user: { id: 'usr_live_test' },
          credentials: { apiKey: 'live_key', baseUrl: 'https://live.dodopayments.com' },
          customFetch
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(capturedPayload.product_cart[0].product_id, item.expected);
        assert.ok(!capturedPayload.product_cart[0].product_id.startsWith('pdt_0No'), 'LIVE checkout must never use TEST product ID');
      }
    });

    it('rejects unallowlisted or invalid plan selections server-side', async () => {
      const result = await createDodoCheckoutSession({
        plan: 'vip_tier',
        interval: 'monthly',
        user: { id: 'usr_3' },
        credentials: { apiKey: 'test_dodo_key' }
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid plan'));
    });
  });

  describe('6. Immediate Cancellation API Suite', () => {
    it('calls Dodo API with status: cancelled for immediate termination', async () => {
      let capturedUrl = '';
      let capturedBody: any = null;

      const customFetch = (async (url: string, init: any) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: 'cancelled' })
        };
      }) as any;

      const result = await cancelDodoSubscription('sub_test_to_cancel', { apiKey: 'test_dodo_key' }, customFetch);
      assert.strictEqual(result.success, true);
      assert.ok(capturedUrl.includes('/subscriptions/sub_test_to_cancel'));
      assert.strictEqual(capturedBody.status, 'cancelled');
    });
  });

  describe('7. Entitlements & Access Boundaries', () => {
    it('grants 1-week planning horizon to Free users', () => {
      const ent = getPlanningEntitlement({ plan_tier: 'free' });
      assert.strictEqual(ent.maxPlanningWeeks, 1);
      assert.strictEqual(ent.isPaid, false);
      assert.strictEqual(enforcePlanningHorizon(4, ent), 1);
    });

    it('grants 4-week planning horizon to active Pro and Plus users', () => {
      const proEnt = getPlanningEntitlement({ plan_tier: 'pro', subscription_status: 'active' });
      assert.strictEqual(proEnt.maxPlanningWeeks, 4);
      assert.strictEqual(proEnt.isPaid, true);
      assert.strictEqual(enforcePlanningHorizon(4, proEnt), 4);

      const plusEnt = getPlanningEntitlement({ plan_tier: 'plus', subscription_status: 'trialing' });
      assert.strictEqual(plusEnt.maxPlanningWeeks, 4);
      assert.strictEqual(plusEnt.isPaid, true);
      assert.strictEqual(enforcePlanningHorizon(3, plusEnt), 3);
    });

    it('reverts to 1-week planning horizon if subscription_status is canceled', () => {
      const cancelledEnt = getPlanningEntitlement({ plan_tier: 'pro', subscription_status: 'canceled' });
      assert.strictEqual(cancelledEnt.maxPlanningWeeks, 1);
      assert.strictEqual(cancelledEnt.isPaid, false);
    });
  });

  describe('8. Secret & Credential Leak Audit', () => {
    it('verifies DODO_API_KEY and DODO_WEBHOOK_SECRET never appear in client safe env', () => {
      const safeEnv = getClientSafeEnv({
        env: {
          VITE_SUPABASE_URL: 'https://test.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_pub_test',
          VITE_DODO_ENVIRONMENT: 'test_mode',
          DODO_API_KEY: 'dodo_secret_api_key_must_never_leak',
          DODO_WEBHOOK_SECRET: 'whsec_secret_must_never_leak'
        }
      });

      assert.strictEqual((safeEnv as any).DODO_API_KEY, undefined);
      assert.strictEqual((safeEnv as any).DODO_WEBHOOK_SECRET, undefined);
      assert.strictEqual(safeEnv.VITE_DODO_ENVIRONMENT, 'test_mode');
    });
  });

  describe('9. Dodo-Only Standardization & Legacy Provider Exclusion Audit', () => {
    it('verifies active application code in src/ contains zero legacy payment provider references', () => {
      const srcDir = path.resolve('src');
      function scanDir(dir: string): string[] {
        let results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results = results.concat(scanDir(fullPath));
          } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            results.push(fullPath);
          }
        }
        return results;
      }

      const files = scanDir(srcDir);
      const forbiddenTerms = ['paddle', 'cashfree', 'razorpay', 'stripe'];

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8').toLowerCase();
        for (const term of forbiddenTerms) {
          assert.strictEqual(
            content.includes(term),
            false,
            `File ${path.relative(srcDir, file)} must NOT contain legacy payment provider reference: "${term}"`
          );
        }
      }
    });

    it('verifies supabase/functions contains ONLY Dodo edge functions', () => {
      const functionsDir = path.resolve('supabase', 'functions');
      const dirs = fs.readdirSync(functionsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      assert.deepStrictEqual(dirs.sort(), [
        'dodo-cancel-subscription',
        'dodo-create-checkout',
        'dodo-webhook'
      ].sort());
    });
  });

  describe('10. Supabase Edge Function (dodo-create-checkout) Environment Mapping Audit', () => {
    it('verifies edge function source contains accurate LIVE and TEST product IDs', () => {
      const edgeFuncPath = path.resolve('supabase', 'functions', 'dodo-create-checkout', 'index.ts');
      const content = fs.readFileSync(edgeFuncPath, 'utf8');

      // LIVE product IDs
      assert.ok(content.includes('pdt_0Np1eZsemtECph1HLoDb0'), 'Must include LIVE Pro Monthly ID');
      assert.ok(content.includes('pdt_0Np1ec3oUFACgeOKI4ktP'), 'Must include LIVE Pro Annual ID');
      assert.ok(content.includes('pdt_0Np1ean3rbxLUQs6d1QAb'), 'Must include LIVE Plus Monthly ID');
      assert.ok(content.includes('pdt_0Np1ebMsCqGBWntrkX3fK'), 'Must include LIVE Plus Annual ID');

      // TEST product IDs
      assert.ok(content.includes('pdt_0NozKZ3sZ6h0vplb451YK'), 'Must include TEST Pro Monthly ID');
      assert.ok(content.includes('pdt_0NozL7OvhpMonCSMw99Ng'), 'Must include TEST Pro Annual ID');
      assert.ok(content.includes('pdt_0NozLK4XCjDSCbkADEtQL'), 'Must include TEST Plus Monthly ID');
      assert.ok(content.includes('pdt_0NozLba96vBrtNtGdFONX'), 'Must include TEST Plus Annual ID');

      // Verifies server-side resolution function exists and checks environment
      assert.ok(content.includes('isLiveEnvironment'), 'Must include environment detection');
      assert.ok(content.includes('resolveServerProductId'), 'Must include server product resolution');
    });
  });
});
