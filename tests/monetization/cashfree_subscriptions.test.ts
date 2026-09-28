import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CASHFREE_CONFIG,
  CASHFREE_PLANS,
  getCashfreePlanId,
  mapCashfreePlanToTier,
  isCashfreePlanId,
  resolveReturnUrl
} from '../../src/config/cashfree.ts';
import {
  createCashfreeSubscription,
  verifyCashfreeWebhookSignature,
  generateWebhookEventId,
  processCashfreeWebhook
} from '../../src/monetization/cashfreeService.ts';
import { runCashfreeSdkCheckout } from '../../src/monetization/cashfreeCheckout.ts';
import { isTierAdFree } from '../../src/config/pricing.ts';

describe('Cashfree Sandbox Subscriptions & Webhook Integration Suite', () => {
  const rootDir = process.cwd();
  const mockCredentials = {
    appId: 'TEST_CF_APP_123456',
    secretKey: 'TEST_CF_SECRET_KEY_ABCDEF1234567890',
    baseUrl: 'https://sandbox.cashfree.com/pg',
    returnUrlBase: 'https://chorematrix.online'
  };

  // ========================================================
  // 1. CASHFREE EXISTING PLANS CONFIGURATION & INTEGRITY
  // ========================================================
  describe('1. Existing Cashfree Sandbox Plans Integrity (Requirements 2, 5, 9, 13)', () => {
    it('configures exactly the 4 existing Cashfree sandbox plans without duplicates', () => {
      const planKeys = Object.keys(CASHFREE_PLANS);
      assert.strictEqual(planKeys.length, 4, 'Must define exactly the 4 specified Cashfree plans');

      // 1. CHOREMATRIX_PRO_MONTHLY
      const proMonthly = CASHFREE_PLANS['CHOREMATRIX_PRO_MONTHLY'];
      assert.ok(proMonthly, 'CHOREMATRIX_PRO_MONTHLY must exist');
      assert.strictEqual(proMonthly.planId, 'CHOREMATRIX_PRO_MONTHLY');
      assert.strictEqual(proMonthly.tier, 'pro');
      assert.strictEqual(proMonthly.interval, 'monthly');
      assert.strictEqual(proMonthly.amount, 5.99);
      assert.strictEqual(proMonthly.currency, 'USD');

      // 2. ChoreMatrix_Pro_Annual
      const proAnnual = CASHFREE_PLANS['ChoreMatrix_Pro_Annual'];
      assert.ok(proAnnual, 'ChoreMatrix_Pro_Annual must exist');
      assert.strictEqual(proAnnual.planId, 'ChoreMatrix_Pro_Annual');
      assert.strictEqual(proAnnual.tier, 'pro');
      assert.strictEqual(proAnnual.interval, 'annually');
      assert.strictEqual(proAnnual.amount, 59.99);
      assert.strictEqual(proAnnual.currency, 'USD');

      // 3. ChoreMatrix_Plus_Monthly
      const plusMonthly = CASHFREE_PLANS['ChoreMatrix_Plus_Monthly'];
      assert.ok(plusMonthly, 'ChoreMatrix_Plus_Monthly must exist');
      assert.strictEqual(plusMonthly.planId, 'ChoreMatrix_Plus_Monthly');
      assert.strictEqual(plusMonthly.tier, 'plus');
      assert.strictEqual(plusMonthly.interval, 'monthly');
      assert.strictEqual(plusMonthly.amount, 9.99);
      assert.strictEqual(plusMonthly.currency, 'USD');

      // 4. ChoreMatrix_Plus_Annual
      const plusAnnual = CASHFREE_PLANS['ChoreMatrix_Plus_Annual'];
      assert.ok(plusAnnual, 'ChoreMatrix_Plus_Annual must exist');
      assert.strictEqual(plusAnnual.planId, 'ChoreMatrix_Plus_Annual');
      assert.strictEqual(plusAnnual.tier, 'plus');
      assert.strictEqual(plusAnnual.interval, 'annually');
      assert.strictEqual(plusAnnual.amount, 99.99);
      assert.strictEqual(plusAnnual.currency, 'USD');
    });

    it('maps tier and billing interval to the correct Cashfree plan ID', () => {
      assert.strictEqual(getCashfreePlanId('pro', 'monthly'), 'CHOREMATRIX_PRO_MONTHLY');
      assert.strictEqual(getCashfreePlanId('pro', 'month'), 'CHOREMATRIX_PRO_MONTHLY');
      assert.strictEqual(getCashfreePlanId('pro', 'annual'), 'ChoreMatrix_Pro_Annual');
      assert.strictEqual(getCashfreePlanId('pro', 'annually'), 'ChoreMatrix_Pro_Annual');

      assert.strictEqual(getCashfreePlanId('plus', 'monthly'), 'ChoreMatrix_Plus_Monthly');
      assert.strictEqual(getCashfreePlanId('plus', 'month'), 'ChoreMatrix_Plus_Monthly');
      assert.strictEqual(getCashfreePlanId('plus', 'annual'), 'ChoreMatrix_Plus_Annual');
      assert.strictEqual(getCashfreePlanId('plus', 'annually'), 'ChoreMatrix_Plus_Annual');

      // Free tier must not have a Cashfree subscription plan
      assert.strictEqual(getCashfreePlanId('free', 'monthly'), null);
      assert.strictEqual(getCashfreePlanId('free', 'annually'), null);
      assert.strictEqual(getCashfreePlanId('invalid_tier', 'monthly'), null);
    });

    it('maps Cashfree plan IDs back to ChoreMatrix plan_tier according to Requirement 13', () => {
      // Pro Monthly → Pro
      const mapProM = mapCashfreePlanToTier('CHOREMATRIX_PRO_MONTHLY');
      assert.ok(mapProM);
      assert.strictEqual(mapProM.tier, 'pro');
      assert.strictEqual(mapProM.interval, 'monthly');

      // Pro Annual → Pro
      const mapProA = mapCashfreePlanToTier('ChoreMatrix_Pro_Annual');
      assert.ok(mapProA);
      assert.strictEqual(mapProA.tier, 'pro');
      assert.strictEqual(mapProA.interval, 'annually');

      // Plus Monthly → Plus
      const mapPlusM = mapCashfreePlanToTier('ChoreMatrix_Plus_Monthly');
      assert.ok(mapPlusM);
      assert.strictEqual(mapPlusM.tier, 'plus');
      assert.strictEqual(mapPlusM.interval, 'monthly');

      // Plus Annual → Plus
      const mapPlusA = mapCashfreePlanToTier('ChoreMatrix_Plus_Annual');
      assert.ok(mapPlusA);
      assert.strictEqual(mapPlusA.tier, 'plus');
      assert.strictEqual(mapPlusA.interval, 'annually');
    });

    it('uses https://chorematrix.online as the production return-domain base (Requirement 9)', () => {
      assert.strictEqual(CASHFREE_CONFIG.productionReturnDomain, 'https://chorematrix.online');
      const resolved = resolveReturnUrl();
      assert.strictEqual(resolved, 'https://chorematrix.online/account.html?sub_id={subscription_id}');
      assert.strictEqual(CASHFREE_CONFIG.mode, 'sandbox');
      assert.strictEqual(CASHFREE_CONFIG.sandboxBaseUrl, 'https://sandbox.cashfree.com/pg');
    });
  });

  // ========================================================
  // 2. CHECKOUT CREATION (Requirements 2, 5, 6, 7)
  // ========================================================
  describe('2. Checkout Creation & Secret Key Protection', () => {
    it('creates Cashfree subscription using correct plan ID and returns session ID (Pro Monthly)', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      const mockFetch: typeof fetch = async (url, init) => {
        capturedUrl = url.toString();
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            subscription_id: capturedBody.subscription_id,
            subscription_session_id: 'sub_sess_mock_pro_monthly_987654',
            auth_link: 'https://sandbox.cashfree.com/pg/checkout?session=sub_sess_mock_pro_monthly_987654',
            subscription_status: 'INITIALIZED'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const result = await createCashfreeSubscription(
        {
          userId: 'usr_alice_001',
          userEmail: 'alice@example.com',
          customerName: 'Alice Smith',
          plan: 'pro',
          interval: 'monthly',
          phone: '9876543210'
        },
        mockCredentials,
        mockFetch
      );

      // Verify endpoint and headers
      assert.strictEqual(capturedUrl, 'https://sandbox.cashfree.com/pg/subscriptions');
      assert.strictEqual(capturedHeaders['x-client-id'], mockCredentials.appId);
      assert.strictEqual(capturedHeaders['x-client-secret'], mockCredentials.secretKey);
      assert.strictEqual(capturedHeaders['x-api-version'], '2023-08-01');

      // Verify body
      assert.strictEqual(capturedBody.customer_details.customer_id, 'usr_alice_001');
      assert.strictEqual(capturedBody.customer_details.customer_name, 'Alice Smith');
      assert.strictEqual(capturedBody.customer_details.customer_email, 'alice@example.com');
      assert.strictEqual(capturedBody.customer_details.customer_phone, '9876543210');
      assert.strictEqual(capturedBody.plan_details.plan_id, 'CHOREMATRIX_PRO_MONTHLY');
      assert.strictEqual(
        capturedBody.subscription_meta.return_url,
        'https://chorematrix.online/account.html?sub_id={subscription_id}'
      );

      // Verify result
      assert.ok(result.subscription_id.startsWith('sub_'));
      assert.strictEqual(result.subscription_session_id, 'sub_sess_mock_pro_monthly_987654');
      assert.strictEqual(result.plan_id, 'CHOREMATRIX_PRO_MONTHLY');
      assert.strictEqual(result.plan_tier, 'pro');
      assert.strictEqual(result.billing_interval, 'monthly');

      // CRITICAL: Secret key must NEVER be present in the returned result
      const resultString = JSON.stringify(result);
      assert.ok(!resultString.includes(mockCredentials.secretKey), 'Secret key must never be exposed');
    });

    it('creates Cashfree subscription for all 4 plans with verified plan IDs', async () => {
      const testCases = [
        { plan: 'pro', interval: 'annual', expectedId: 'ChoreMatrix_Pro_Annual', tier: 'pro', intv: 'annually' },
        { plan: 'plus', interval: 'monthly', expectedId: 'ChoreMatrix_Plus_Monthly', tier: 'plus', intv: 'monthly' },
        { plan: 'plus', interval: 'annual', expectedId: 'ChoreMatrix_Plus_Annual', tier: 'plus', intv: 'annually' }
      ];

      for (const tc of testCases) {
        let requestedPlanId = '';
        const mockFetch: typeof fetch = async (_url, init) => {
          const body = JSON.parse(init?.body as string);
          requestedPlanId = body.plan_details.plan_id;
          return new Response(
            JSON.stringify({
              subscription_id: body.subscription_id,
              subscription_session_id: `sub_sess_${requestedPlanId}`
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        };

        const res = await createCashfreeSubscription(
          {
            userId: 'usr_test_user',
            userEmail: 'test@example.com',
            plan: tc.plan,
            interval: tc.interval,
            phone: '9876543210'
          },
          mockCredentials,
          mockFetch
        );

        assert.strictEqual(requestedPlanId, tc.expectedId);
        assert.strictEqual(res.plan_id, tc.expectedId);
        assert.strictEqual(res.plan_tier, tc.tier);
        assert.strictEqual(res.billing_interval, tc.intv);
      }
    });
  });

  // ========================================================
  // 3. INVALID REQUESTS & PHONE VALIDATION (Requirements 3, 4, 5, 8, 16)
  // ========================================================
  describe('3. Validation & Invalid Requests Handling (Phone, Free Tier, Session ID)', () => {
    it('3. missing phone: rejects subscription creation when phone is missing or blank', async () => {
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_valid',
              userEmail: 'valid@example.com',
              plan: 'pro',
              interval: 'monthly'
            },
            mockCredentials
          );
        },
        /Valid customer mobile number/
      );
    });

    it('4. invalid phone: rejects subscription creation when phone has <10 or >15 digits or non-numeric', async () => {
      // Too short (<10 digits)
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_valid',
              userEmail: 'valid@example.com',
              plan: 'pro',
              interval: 'monthly',
              phone: '12345678'
            },
            mockCredentials
          );
        },
        /Valid customer mobile number/
      );

      // Too long (>15 digits)
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_valid',
              userEmail: 'valid@example.com',
              plan: 'pro',
              interval: 'monthly',
              phone: '12345678901234567'
            },
            mockCredentials
          );
        },
        /Valid customer mobile number/
      );

      // Non-digits only
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_valid',
              userEmail: 'valid@example.com',
              plan: 'pro',
              interval: 'monthly',
              phone: 'abc-def-ghij'
            },
            mockCredentials
          );
        },
        /Valid customer mobile number/
      );
    });

    it('5. valid customer details: correctly formats customer_name, customer_email, customer_phone and customer_id', async () => {
      let capturedBody: any = null;
      const mockFetch: typeof fetch = async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            subscription_id: capturedBody.subscription_id,
            subscription_session_id: 'sub_sess_valid_customer_details'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await createCashfreeSubscription(
        {
          userId: 'usr_alice_123',
          userEmail: 'alice.smith@example.com',
          customerName: 'Alice Smith',
          plan: 'pro',
          interval: 'monthly',
          phone: '+1 (555) 234-5678' // formatted phone with non-digits
        },
        mockCredentials,
        mockFetch
      );

      assert.strictEqual(capturedBody.customer_details.customer_id, 'usr_alice_123');
      assert.strictEqual(capturedBody.customer_details.customer_name, 'Alice Smith');
      assert.strictEqual(capturedBody.customer_details.customer_email, 'alice.smith@example.com');
      assert.strictEqual(capturedBody.customer_details.customer_phone, '15552345678');
    });

    it('8. missing session ID handled: rejects when Cashfree gateway response omits subscription_session_id', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            subscription_id: 'sub_missing_sess_123',
            subscription_status: 'INITIALIZED'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_user1',
              userEmail: 'user1@example.com',
              plan: 'pro',
              interval: 'monthly',
              phone: '9876543210'
            },
            mockCredentials,
            mockFetch
          );
        },
        /missing subscription_session_id/
      );
    });

    it('rejects subscription creation for Free tier', async () => {
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_free_user',
              userEmail: 'free@example.com',
              plan: 'free',
              interval: 'monthly',
              phone: '9876543210'
            },
            mockCredentials
          );
        },
        /Invalid plan or interval/,
        'Free tier must be rejected from recurring payment checkout'
      );
    });

    it('rejects unknown or invalid plan name', async () => {
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_attacker',
              userEmail: 'attacker@example.com',
              plan: 'enterprise_vip_tier',
              interval: 'monthly',
              phone: '9876543210'
            },
            mockCredentials
          );
        },
        /Invalid plan or interval/,
        'Unknown plan names must be rejected'
      );
    });

    it('rejects missing user credentials', async () => {
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: '',
              userEmail: '',
              plan: 'pro',
              interval: 'monthly',
              phone: '9876543210'
            },
            mockCredentials
          );
        },
        /Valid user ID and email are required/
      );
    });

    it('rejects when Cashfree credentials are missing', async () => {
      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_valid',
              userEmail: 'valid@example.com',
              plan: 'pro',
              interval: 'monthly',
              phone: '9876543210'
            },
            { appId: '', secretKey: '' }
          );
        },
        /Cashfree credentials unconfigured/
      );
    });

    it('handles Cashfree upstream API errors gracefully without exposing secret key', async () => {
      const failingFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            message: 'Customer phone is invalid or bank mandate cannot be initiated',
            code: 'invalid_request'
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      };

      await assert.rejects(
        async () => {
          await createCashfreeSubscription(
            {
              userId: 'usr_user1',
              userEmail: 'user1@example.com',
              plan: 'pro',
              interval: 'monthly',
              phone: '9876543210'
            },
            mockCredentials,
            failingFetch
          );
        },
        (err: Error) => {
          assert.ok(err.message.includes('Cashfree subscription creation failed (400)'));
          assert.ok(err.message.includes('Customer phone is invalid'));
          assert.ok(!err.message.includes(mockCredentials.secretKey));
          return true;
        }
      );
    });
  });

  // ========================================================
  // 4. WEBHOOK SIGNATURE VERIFICATION (Requirements 10, 11)
  // ========================================================
  describe('4. Webhook Signature Verification (HMAC-SHA256)', () => {
    function computeValidSignature(timestamp: string, rawBody: string, secret: string): string {
      const payload = `${timestamp}${rawBody}`;
      return crypto.createHmac('sha256', secret).update(payload).digest('base64');
    }

    it('accepts valid Cashfree signature computed with correct secret key and timestamp', () => {
      const timestamp = '1716382000000';
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: {
          subscription_details: {
            subscription_id: 'sub_test_001',
            subscription_status: 'ACTIVE'
          }
        }
      });

      const signature = computeValidSignature(timestamp, rawBody, mockCredentials.secretKey);
      const isValid = verifyCashfreeWebhookSignature(signature, rawBody, timestamp, mockCredentials.secretKey);

      assert.strictEqual(isValid, true, 'Valid signature must verify successfully');
    });

    it('rejects tampered or forged webhook signature', () => {
      const timestamp = '1716382000000';
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: { subscription_id: 'sub_test_001', subscription_status: 'ACTIVE' }
      });

      const fakeSignature = 'bWFsaWNpb3VzX2Zha2Vfc2lnbmF0dXJlX2hlaGVoZQ==';
      const isValid = verifyCashfreeWebhookSignature(fakeSignature, rawBody, timestamp, mockCredentials.secretKey);

      assert.strictEqual(isValid, false, 'Forged signature must be rejected');
    });

    it('rejects webhook signed with wrong secret key', () => {
      const timestamp = '1716382000000';
      const rawBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: { subscription_id: 'sub_test_001', subscription_status: 'ACTIVE' }
      });

      const signatureWrongSecret = computeValidSignature(timestamp, rawBody, 'WRONG_SECRET_KEY_123');
      const isValid = verifyCashfreeWebhookSignature(signatureWrongSecret, rawBody, timestamp, mockCredentials.secretKey);

      assert.strictEqual(isValid, false, 'Signature with wrong secret must be rejected');
    });

    it('rejects payload when raw body is tampered after signing', () => {
      const timestamp = '1716382000000';
      const originalBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: { subscription_id: 'sub_test_001', subscription_status: 'FAILED' }
      });

      const signature = computeValidSignature(timestamp, originalBody, mockCredentials.secretKey);

      // Attacker tampers body to claim ACTIVE
      const tamperedBody = JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: { subscription_id: 'sub_test_001', subscription_status: 'ACTIVE' }
      });

      const isValid = verifyCashfreeWebhookSignature(signature, tamperedBody, timestamp, mockCredentials.secretKey);
      assert.strictEqual(isValid, false, 'Tampered body must fail signature check');
    });

    it('rejects webhook when timestamp is altered (replay protection)', () => {
      const timestamp = '1716382000000';
      const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_STATUS_CHANGE' });
      const signature = computeValidSignature(timestamp, rawBody, mockCredentials.secretKey);

      const modifiedTimestamp = '1716389999999';
      const isValid = verifyCashfreeWebhookSignature(signature, rawBody, modifiedTimestamp, mockCredentials.secretKey);

      assert.strictEqual(isValid, false, 'Altered timestamp must fail signature check');
    });
  });

  // ========================================================
  // 5. WEBHOOK IDEMPOTENCY & DUPLICATE HANDLING (Requirement 11)
  // ========================================================
  describe('5. Webhook Idempotency (Requirement 11)', () => {
    class MockSupabaseDb {
      public webhookEvents: any[] = [];
      public profiles: Map<string, any> = new Map();
      public subscriptions: Map<string, any> = new Map();

      from(table: string) {
        return {
          select: (_cols?: string) => ({
            eq: (col: string, val: any) => ({
              maybeSingle: async () => {
                if (table === 'cashfree_webhook_events') {
                  const ev = this.webhookEvents.find(e => e[col] === val);
                  return { data: ev || null, error: null };
                }
                if (table === 'cashfree_subscriptions') {
                  const sub = Array.from(this.subscriptions.values()).find(s => s[col] === val);
                  return { data: sub || null, error: null };
                }
                if (table === 'profiles') {
                  const p = Array.from(this.profiles.values()).find(pr => pr[col] === val);
                  return { data: p || null, error: null };
                }
                return { data: null, error: null };
              }
            })
          }),
          insert: async (data: any) => {
            if (table === 'cashfree_webhook_events') {
              this.webhookEvents.push(data);
            }
            return { error: null };
          },
          update: (updates: any) => ({
            eq: async (col: string, val: any) => {
              if (table === 'profiles') {
                for (const [id, p] of this.profiles.entries()) {
                  if (p[col] === val) {
                    this.profiles.set(id, { ...p, ...updates });
                  }
                }
              }
              if (table === 'cashfree_subscriptions') {
                for (const [id, s] of this.subscriptions.entries()) {
                  if (s[col] === val) {
                    this.subscriptions.set(id, { ...s, ...updates });
                  }
                }
              }
              return { error: null };
            }
          })
        };
      }
    }

    it('first webhook receipt processes and logs event, duplicate returns duplicate: true without re-executing', async () => {
      const db = new MockSupabaseDb();
      const userId = 'usr_bob_777';
      const subId = 'sub_bob_pro_m_123';

      db.profiles.set(userId, { id: userId, plan_tier: 'free', subscription_status: 'none' });
      db.subscriptions.set(subId, { subscription_id: subId, user_id: userId, plan_id: 'CHOREMATRIX_PRO_MONTHLY' });

      const timestamp = '1716382000000';
      const payload = {
        event_id: 'cf_event_998877',
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: {
          subscription_details: {
            subscription_id: subId,
            plan_id: 'CHOREMATRIX_PRO_MONTHLY',
            subscription_status: 'ACTIVE'
          },
          customer_details: { customer_id: userId }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', mockCredentials.secretKey).update(timestamp + rawBody).digest('base64');

      // 1. First receipt: process
      const res1 = await processCashfreeWebhook({
        rawBody,
        signature,
        timestamp,
        secretKey: mockCredentials.secretKey,
        dbClient: db
      });

      assert.strictEqual(res1.success, true);
      assert.strictEqual(res1.subscription_status, 'ACTIVE');
      assert.strictEqual(res1.plan_tier, 'pro');
      assert.strictEqual(db.webhookEvents.length, 1);
      assert.strictEqual(db.profiles.get(userId).plan_tier, 'pro');

      // 2. Duplicate receipt: same payload sent again
      const res2 = await processCashfreeWebhook({
        rawBody,
        signature,
        timestamp,
        secretKey: mockCredentials.secretKey,
        dbClient: db
      });

      assert.strictEqual(res2.success, true);
      assert.strictEqual(res2.duplicate, true, 'Duplicate must be identified');
      assert.strictEqual(res2.message, 'Event already processed.');
      assert.strictEqual(db.webhookEvents.length, 1, 'Event log must not duplicate');
      assert.strictEqual(db.profiles.get(userId).plan_tier, 'pro');
    });
  });

  // ========================================================
  // 6. ACTIVATION, CANCELLATION, & FAILED PAYMENT (Requirements 12, 13, 14, 15)
  // ========================================================
  describe('6. Verified State Transitions: Activation, Cancellation, Failure', () => {
    class MockSupabaseDb {
      public webhookEvents: any[] = [];
      public profiles: Map<string, any> = new Map();
      public subscriptions: Map<string, any> = new Map();

      from(table: string) {
        return {
          select: () => ({
            eq: (col: string, val: any) => ({
              maybeSingle: async () => {
                if (table === 'cashfree_webhook_events') {
                  const ev = this.webhookEvents.find(e => e[col] === val);
                  return { data: ev || null, error: null };
                }
                if (table === 'cashfree_subscriptions') {
                  const sub = Array.from(this.subscriptions.values()).find(s => s[col] === val);
                  return { data: sub || null, error: null };
                }
                if (table === 'profiles') {
                  const p = Array.from(this.profiles.values()).find(pr => pr[col] === val);
                  return { data: p || null, error: null };
                }
                return { data: null, error: null };
              }
            })
          }),
          insert: async (data: any) => {
            if (table === 'cashfree_webhook_events') {
              this.webhookEvents.push(data);
            }
            return { error: null };
          },
          update: (updates: any) => ({
            eq: async (col: string, val: any) => {
              if (table === 'profiles') {
                for (const [id, p] of this.profiles.entries()) {
                  if (p[col] === val) {
                    this.profiles.set(id, { ...p, ...updates });
                  }
                }
              }
              if (table === 'cashfree_subscriptions') {
                for (const [id, s] of this.subscriptions.entries()) {
                  if (s[col] === val) {
                    this.subscriptions.set(id, { ...s, ...updates });
                  }
                }
              }
              return { error: null };
            }
          })
        };
      }
    }

    it('Subscription Activation: promotes profile to Pro on ACTIVE webhook (Requirement 13)', async () => {
      const db = new MockSupabaseDb();
      const userId = 'usr_active_01';
      const subId = 'sub_active_pro_01';

      db.profiles.set(userId, { id: userId, plan_tier: 'free', subscription_status: 'none' });
      db.subscriptions.set(subId, { subscription_id: subId, user_id: userId, plan_id: 'CHOREMATRIX_PRO_MONTHLY' });

      const timestamp = '1716383000000';
      const payload = {
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: {
          subscription_details: {
            subscription_id: subId,
            plan_id: 'CHOREMATRIX_PRO_MONTHLY',
            subscription_status: 'ACTIVE'
          },
          customer_details: { customer_id: userId }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', mockCredentials.secretKey).update(timestamp + rawBody).digest('base64');

      const res = await processCashfreeWebhook({
        rawBody,
        signature,
        timestamp,
        secretKey: mockCredentials.secretKey,
        dbClient: db
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.plan_tier, 'pro');

      const updatedProfile = db.profiles.get(userId);
      assert.strictEqual(updatedProfile.plan_tier, 'pro');
      assert.strictEqual(updatedProfile.billing_interval, 'monthly');
      assert.strictEqual(updatedProfile.subscription_status, 'active');
      assert.strictEqual(updatedProfile.cashfree_subscription_id, subId);

      // Authoritative entitlement check: user is now ad-free
      assert.strictEqual(isTierAdFree(updatedProfile.plan_tier), true);
    });

    it('Subscription Activation: promotes profile to Plus Annual on ACTIVE webhook (Requirement 13)', async () => {
      const db = new MockSupabaseDb();
      const userId = 'usr_active_plus_02';
      const subId = 'sub_active_plus_02';

      db.profiles.set(userId, { id: userId, plan_tier: 'free', subscription_status: 'none' });
      db.subscriptions.set(subId, { subscription_id: subId, user_id: userId, plan_id: 'ChoreMatrix_Plus_Annual' });

      const timestamp = '1716384000000';
      const payload = {
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: {
          subscription_details: {
            subscription_id: subId,
            plan_id: 'ChoreMatrix_Plus_Annual',
            subscription_status: 'ACTIVE'
          },
          customer_details: { customer_id: userId }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', mockCredentials.secretKey).update(timestamp + rawBody).digest('base64');

      const res = await processCashfreeWebhook({
        rawBody,
        signature,
        timestamp,
        secretKey: mockCredentials.secretKey,
        dbClient: db
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.plan_tier, 'plus');

      const updatedProfile = db.profiles.get(userId);
      assert.strictEqual(updatedProfile.plan_tier, 'plus');
      assert.strictEqual(updatedProfile.billing_interval, 'annually');
      assert.strictEqual(updatedProfile.subscription_status, 'active');

      assert.strictEqual(isTierAdFree(updatedProfile.plan_tier), true);
    });

    it('Subscription Cancellation: downgrades profile to free tier on CUSTOMER_CANCELLED webhook', async () => {
      const db = new MockSupabaseDb();
      const userId = 'usr_cancel_01';
      const subId = 'sub_cancel_01';

      // User was previously active Pro
      db.profiles.set(userId, {
        id: userId,
        plan_tier: 'pro',
        billing_interval: 'monthly',
        subscription_status: 'active',
        cashfree_subscription_id: subId
      });
      db.subscriptions.set(subId, { subscription_id: subId, user_id: userId, plan_id: 'CHOREMATRIX_PRO_MONTHLY', status: 'ACTIVE' });

      const timestamp = '1716385000000';
      const payload = {
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: {
          subscription_details: {
            subscription_id: subId,
            subscription_status: 'CUSTOMER_CANCELLED'
          },
          customer_details: { customer_id: userId }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', mockCredentials.secretKey).update(timestamp + rawBody).digest('base64');

      const res = await processCashfreeWebhook({
        rawBody,
        signature,
        timestamp,
        secretKey: mockCredentials.secretKey,
        dbClient: db
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.plan_tier, 'free');

      const updatedProfile = db.profiles.get(userId);
      assert.strictEqual(updatedProfile.plan_tier, 'free');
      assert.strictEqual(updatedProfile.subscription_status, 'canceled');

      // Entitlement check: Free tier has ads enabled
      assert.strictEqual(isTierAdFree(updatedProfile.plan_tier), false);
    });

    it('Failed Payment: marks past_due and does NOT fake payment success (Requirements 14, 15)', async () => {
      const db = new MockSupabaseDb();
      const userId = 'usr_failed_01';
      const subId = 'sub_failed_01';

      db.profiles.set(userId, { id: userId, plan_tier: 'free', subscription_status: 'none' });
      db.subscriptions.set(subId, { subscription_id: subId, user_id: userId, plan_id: 'CHOREMATRIX_PRO_MONTHLY' });

      const timestamp = '1716386000000';
      const payload = {
        type: 'SUBSCRIPTION_PAYMENT_FAILED',
        data: {
          subscription_details: {
            subscription_id: subId,
            subscription_status: 'FAILED'
          },
          payment_details: {
            payment_status: 'FAILED',
            failure_reason: 'Insufficient funds in test mandate'
          },
          customer_details: { customer_id: userId }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', mockCredentials.secretKey).update(timestamp + rawBody).digest('base64');

      const res = await processCashfreeWebhook({
        rawBody,
        signature,
        timestamp,
        secretKey: mockCredentials.secretKey,
        dbClient: db
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.subscription_status, 'FAILED');

      const updatedProfile = db.profiles.get(userId);
      // Plan tier must REMAIN 'free' - never fake payment success
      assert.strictEqual(updatedProfile.plan_tier, 'free');
      assert.strictEqual(updatedProfile.subscription_status, 'past_due');
      assert.strictEqual(isTierAdFree(updatedProfile.plan_tier), false);
    });

    it('16. user isolation: webhook event for User A cannot modify User B profile', async () => {
      const db = new MockSupabaseDb();
      const userA = 'usr_alice_isolation';
      const userB = 'usr_bob_isolation';
      const subA = 'sub_alice_isolation_01';
      const subB = 'sub_bob_isolation_02';

      db.profiles.set(userA, { id: userA, plan_tier: 'free', subscription_status: 'none' });
      db.profiles.set(userB, { id: userB, plan_tier: 'free', subscription_status: 'none' });
      db.subscriptions.set(subA, { subscription_id: subA, user_id: userA, plan_id: 'CHOREMATRIX_PRO_MONTHLY' });
      db.subscriptions.set(subB, { subscription_id: subB, user_id: userB, plan_id: 'ChoreMatrix_Plus_Monthly' });

      const timestamp = '1716387000000';
      const payloadA = {
        type: 'SUBSCRIPTION_STATUS_CHANGE',
        data: {
          subscription_details: {
            subscription_id: subA,
            plan_id: 'CHOREMATRIX_PRO_MONTHLY',
            subscription_status: 'ACTIVE'
          },
          customer_details: { customer_id: userA }
        }
      };

      const rawBodyA = JSON.stringify(payloadA);
      const signatureA = crypto.createHmac('sha256', mockCredentials.secretKey).update(timestamp + rawBodyA).digest('base64');

      await processCashfreeWebhook({
        rawBody: rawBodyA,
        signature: signatureA,
        timestamp,
        secretKey: mockCredentials.secretKey,
        dbClient: db
      });

      // User A is upgraded to Pro
      assert.strictEqual(db.profiles.get(userA).plan_tier, 'pro');
      assert.strictEqual(db.profiles.get(userA).subscription_status, 'active');

      // User B remains on Free tier with zero modification
      assert.strictEqual(db.profiles.get(userB).plan_tier, 'free');
      assert.strictEqual(db.profiles.get(userB).subscription_status, 'none');
    });
  });

  // ========================================================
  // 7. EDGE FUNCTION FILES & FRONTEND WEB CHECKOUT SDK CHECKS
  // ========================================================
  describe('7. Edge Function Files & Frontend Web Checkout SDK Checks', () => {
    it('verifies cashfree-create-subscription edge function exists and enforces authentication', () => {
      const fnPath = path.join(rootDir, 'supabase', 'functions', 'cashfree-create-subscription', 'index.ts');
      assert.ok(fs.existsSync(fnPath), 'cashfree-create-subscription Edge Function must exist');

      const content = fs.readFileSync(fnPath, 'utf8');
      assert.ok(content.includes('CHOREMATRIX_PRO_MONTHLY'), 'Must reference CHOREMATRIX_PRO_MONTHLY');
      assert.ok(content.includes('ChoreMatrix_Pro_Annual'), 'Must reference ChoreMatrix_Pro_Annual');
      assert.ok(content.includes('ChoreMatrix_Plus_Monthly'), 'Must reference ChoreMatrix_Plus_Monthly');
      assert.ok(content.includes('ChoreMatrix_Plus_Annual'), 'Must reference ChoreMatrix_Plus_Annual');
      assert.ok(content.includes('https://chorematrix.online'), 'Must reference production return domain');
      assert.ok(content.includes('subscription_session_id'), 'Must return subscription_session_id');
      assert.ok(content.includes('Authorization'), 'Must check Authorization header');
    });

    it('verifies cashfree-webhook edge function exists with signature verification and idempotency', () => {
      const fnPath = path.join(rootDir, 'supabase', 'functions', 'cashfree-webhook', 'index.ts');
      assert.ok(fs.existsSync(fnPath), 'cashfree-webhook Edge Function must exist');

      const content = fs.readFileSync(fnPath, 'utf8');
      assert.ok(content.includes('x-webhook-signature'), 'Must inspect x-webhook-signature');
      assert.ok(content.includes('x-webhook-timestamp'), 'Must inspect x-webhook-timestamp');
      assert.ok(content.includes('cashfree_webhook_events'), 'Must use cashfree_webhook_events for idempotency');
      assert.ok(content.includes('timingSafeEqual'), 'Must use timing-safe comparison');
    });

    it('1. unauthenticated upgrade attempt: upgrade.html verifies authentication and redirects to login preserving plan and interval', () => {
      const upgradePath = path.join(rootDir, 'upgrade.html');
      assert.ok(fs.existsSync(upgradePath), 'upgrade.html must exist');

      const content = fs.readFileSync(upgradePath, 'utf8');
      assert.ok(content.includes('authService.getUser()'), 'Must check user authentication');
      assert.ok(content.includes('/login.html?redirect='), 'Must redirect unauthenticated users to login');
      assert.ok(content.includes('plan='), 'Must preserve plan in redirect');
      assert.ok(content.includes('interval='), 'Must preserve interval in redirect');
    });

    it('upgrade.html contains mobile number field with tel/numeric/autocomplete and 10-15 digit validation', () => {
      const upgradePath = path.join(rootDir, 'upgrade.html');
      const content = fs.readFileSync(upgradePath, 'utf8');

      assert.ok(content.includes('Mobile number'), 'Must display Mobile number label');
      assert.ok(content.includes('type="tel"'), 'Must set type="tel"');
      assert.ok(content.includes('inputmode="numeric"'), 'Must set inputmode="numeric"');
      assert.ok(content.includes('autocomplete="tel"'), 'Must set autocomplete="tel"');
      assert.ok(content.includes('txtCustomerPhone'), 'Must have ID txtCustomerPhone');
      assert.ok(content.includes('.replace(/\\D/g'), 'Must strip non-digits to validate 10-15 digits');
      assert.ok(!content.includes('name="cc-number"'), 'Must not collect credit card numbers');
    });

    it('9. Cashfree checkout() called with subsSessionId: initializes SDK in sandbox mode and calls checkout', async () => {
      let initMode = '';
      let checkoutArgs: any = null;

      (globalThis as any).window = {
        Cashfree: (cfg: { mode: string }) => {
          initMode = cfg.mode;
          return {
            checkout: async (opts: any) => {
              checkoutArgs = opts;
              return { redirect: true };
            }
          };
        }
      };

      const res = await runCashfreeSdkCheckout('sub_sess_valid_abc_12345');
      assert.strictEqual(res.success, true);
      assert.strictEqual(initMode, 'sandbox', 'Must initialize Cashfree in sandbox mode');
      assert.strictEqual(checkoutArgs.subsSessionId, 'sub_sess_valid_abc_12345', 'Must pass subsSessionId');
      assert.strictEqual(checkoutArgs.redirectTarget, '_self', 'Default redirectTarget must be _self');

      delete (globalThis as any).window;
    });

    it('10. Cashfree SDK error surfaced: returns clear user-readable error when SDK checkout fails or throws', async () => {
      // Case A: SDK returns error object
      (globalThis as any).window = {
        Cashfree: () => ({
          checkout: async () => ({
            error: { message: 'Card mandate authorization failed by bank' }
          })
        })
      };

      const res1 = await runCashfreeSdkCheckout('sub_sess_err_1');
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error, 'Card mandate authorization failed by bank');

      // Case B: SDK throws exception
      (globalThis as any).window = {
        Cashfree: () => ({
          checkout: async () => {
            throw new Error('Connection to Cashfree hosted checkout was refused');
          }
        })
      };

      const res2 = await runCashfreeSdkCheckout('sub_sess_err_2');
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error, 'Connection to Cashfree hosted checkout was refused');

      delete (globalThis as any).window;
    });

    it('src/monetization/cashfreeCheckout.ts uses cashfree.checkout({ subsSessionId, redirectTarget: "_self" })', () => {
      const code = fs.readFileSync(path.join(rootDir, 'src', 'monetization', 'cashfreeCheckout.ts'), 'utf8');
      assert.ok(code.includes('cashfree.checkout({'), 'Must call cashfree.checkout');
      assert.ok(code.includes('subsSessionId:'), 'Must pass subsSessionId');
      assert.ok(code.includes("Cashfree({ mode: 'sandbox' })"), 'Must initialize SDK in sandbox mode');
      assert.ok(!code.includes('cashfree.subscriptionsCheckout('), 'Must NOT use deprecated subscriptionsCheckout');
      assert.ok(!code.includes('CASHFREE_SECRET_KEY'), 'Must never contain secret key');
    });

    it('17. existing Free/Pro/Plus entitlement behavior unchanged', () => {
      assert.strictEqual(isTierAdFree('free'), false, 'Free tier has ads');
      assert.strictEqual(isTierAdFree('pro'), true, 'Pro tier is ad-free');
      assert.strictEqual(isTierAdFree('plus'), true, 'Plus tier is ad-free');
    });
  });
});
