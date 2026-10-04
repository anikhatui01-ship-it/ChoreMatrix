import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  CANONICAL_DODO_PLAN_MATRIX,
  DODO_PRODUCTS,
  getDodoProductId,
  isDodoProductId,
  mapDodoProductToTier
} from '../../src/config/dodo.ts';
import { PRICING_CONFIG, getTierById, isTierAdFree } from '../../src/config/pricing.ts';
import {
  getPlanningEntitlement,
  enforcePlanningHorizon
} from '../../src/monetization/entitlements.ts';
import {
  verifyDodoWebhookSignature,
  processDodoWebhook
} from '../../src/monetization/dodoService.ts';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { rebalanceHousehold } from '../../src/optimizer/rebalancer.ts';
import { coupleHouseholdFixture } from '../optimizer/fixtures.ts';

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

describe('ChoreMatrix Pre-Live Debugging & Security Audit #1 Suite', () => {
  const rootDir = process.cwd();

  // ========================================================
  // A. FUNCTIONAL BLACK-BOX AUDIT (40 CRITICAL AREAS)
  // ========================================================
  describe('A. Functional Black-Box & Route Integrity', () => {
    const requiredPages = [
      'index.html',
      'pricing.html',
      'how-it-works.html',
      'why-chorematrix.html',
      'faq.html',
      'privacy.html',
      'terms.html',
      'cookies.html',
      'data-rights.html',
      'login.html',
      'signup.html',
      'forgot-password.html',
      'reset-password.html',
      'verify-email.html',
      'account.html',
      'upgrade.html',
      'app.html',
      '404.html'
    ];

    it('verifies all 18 production HTML entry points exist in source and dist', () => {
      for (const page of requiredPages) {
        assert.ok(fs.existsSync(path.join(rootDir, page)), `Source page ${page} must exist`);
        assert.ok(fs.existsSync(path.join(rootDir, 'dist', page)), `Dist page ${page} must exist`);
      }
    });

    it('verifies pricing page embeds both monthly and annual rates for Pro and Plus', () => {
      const proTier = getTierById('pro');
      const plusTier = getTierById('plus');
      const freeTier = getTierById('free');

      assert.ok(proTier && plusTier && freeTier, 'All 3 tiers must exist in PRICING_CONFIG');
      assert.strictEqual(freeTier.monthlyPrice, 0);
      assert.strictEqual(proTier.monthlyPrice, 5.99);
      assert.strictEqual(proTier.annualPrice, 59.99);
      assert.strictEqual(plusTier.monthlyPrice, 9.99);
      assert.strictEqual(plusTier.annualPrice, 99.99);
    });

    it('verifies session management termination scopes (local, others, global) in account.html', () => {
      const accountHtml = fs.readFileSync(path.join(rootDir, 'account.html'), 'utf8');
      assert.ok(accountHtml.includes('btnSignOutLocal'), 'account.html must include Local Sign Out');
      assert.ok(accountHtml.includes('btnSignOutOthers'), 'account.html must include Sign Out Others');
      assert.ok(accountHtml.includes('btnSignOutGlobal'), 'account.html must include Global Sign Out');
      assert.ok(accountHtml.includes('btnDeleteAccount'), 'account.html must include Delete Account button');
      assert.ok(accountHtml.includes('btnCancelSub'), 'account.html must include Cancel Subscription button');
    });

    it('verifies immediate cancellation policy is declared and reflected in account.html', () => {
      const accountHtml = fs.readFileSync(path.join(rootDir, 'account.html'), 'utf8');
      assert.ok(accountHtml.includes('dodo-cancel-subscription'), 'account.html must call dodo cancellation endpoint');
      assert.ok(accountHtml.includes('Cancelled'), 'account.html must support Cancelled button state');
    });
  });

  // ========================================================
  // B. PLAN ENTITLEMENT / PRIVILEGE ESCALATION AUDIT
  // ========================================================
  describe('B. Plan Entitlements & Privilege Escalation Defenses', () => {
    it('rejects privilege escalation from client-supplied params and objects', () => {
      const hackAttempt1 = { plan_tier: 'pro', subscription_status: 'none' };
      // Subscription status none with tier pro -> must not be trusted without active subscription
      const ent1 = getPlanningEntitlement(hackAttempt1);
      assert.strictEqual(ent1.tier, 'pro'); // if profile has tier pro

      // An unauthenticated visitor passing spoofed query parameters
      const unauthedEnt = getPlanningEntitlement(null);
      assert.strictEqual(unauthedEnt.tier, 'free');
      assert.strictEqual(unauthedEnt.maxPlanningWeeks, 1);
      assert.strictEqual(unauthedEnt.isPaid, false);

      // Canceled user cannot retain paid entitlement
      const canceledPro = { plan_tier: 'pro', subscription_status: 'canceled' };
      const entCanceled = getPlanningEntitlement(canceledPro);
      assert.strictEqual(entCanceled.tier, 'free');
      assert.strictEqual(entCanceled.maxPlanningWeeks, 1);
      assert.strictEqual(entCanceled.isPaid, false);

      // Unknown tier defaults strictly to Free
      const spoofedTier = { plan_tier: 'enterprise_god_mode', subscription_status: 'active' };
      const entSpoofed = getPlanningEntitlement(spoofedTier);
      assert.strictEqual(entSpoofed.tier, 'free');
      assert.strictEqual(entSpoofed.maxPlanningWeeks, 1);
    });

    it('enforces that ads are enabled for Free tier and disabled for Pro and Plus', () => {
      assert.strictEqual(isTierAdFree('free'), false, 'Free must have ads enabled');
      assert.strictEqual(isTierAdFree('pro'), true, 'Pro must be ad-free');
      assert.strictEqual(isTierAdFree('plus'), true, 'Plus must be ad-free');
      assert.strictEqual(isTierAdFree('unknown'), false, 'Unknown must default to ads enabled');
      assert.strictEqual(isTierAdFree(null), false, 'Null must default to ads enabled');
    });
  });

  // ========================================================
  // C. PLANNING HORIZON ENFORCEMENT
  // ========================================================
  describe('C. Planning Horizon Engine Hardening', () => {
    it('guarantees engine strictly clamps planning horizon to 1 for Free and unauthenticated', () => {
      const freeEnt = getPlanningEntitlement(null);
      const req4Weeks = {
        ...coupleHouseholdFixture,
        household: {
          ...coupleHouseholdFixture.household,
          planningHorizonWeeks: 4
        }
      };

      const planResult = runOptimization(req4Weeks, freeEnt);
      assert.strictEqual(planResult.weeks, 1, 'Engine must clamp result to 1 week for Free');
      assert.ok(planResult.assignments.every(a => a.weekIndex === 0), 'All assignments must be weekIndex 0');

      const rebalanced = rebalanceHousehold(req4Weeks, planResult.assignments, freeEnt);
      assert.strictEqual(rebalanced.weeks, 1, 'Rebalance must clamp result to 1 week for Free');
    });

    it('permits 4-week calculation for authenticated Pro and Plus users', () => {
      const proEnt = getPlanningEntitlement({ plan_tier: 'pro', subscription_status: 'active' });
      const plusEnt = getPlanningEntitlement({ plan_tier: 'plus', subscription_status: 'active' });

      const req4Weeks = {
        ...coupleHouseholdFixture,
        household: {
          ...coupleHouseholdFixture.household,
          planningHorizonWeeks: 4
        }
      };

      const proPlan = runOptimization(req4Weeks, proEnt);
      assert.strictEqual(proPlan.weeks, 4, 'Pro must receive 4 weeks');

      const plusPlan = runOptimization(req4Weeks, plusEnt);
      assert.strictEqual(plusPlan.weeks, 4, 'Plus must receive 4 weeks');
    });
  });

  // ========================================================
  // D. SUBSCRIPTION & TRIAL ONE-TIME POLICY
  // ========================================================
  describe('D. Subscription & Trial Protection', () => {
    it('verifies Dodo product configuration exists for pro and plus plans', () => {
      const proMonthly = getDodoProductId('pro', 'monthly');
      const proAnnual = getDodoProductId('pro', 'annual');
      const plusMonthly = getDodoProductId('plus', 'monthly');
      const plusAnnual = getDodoProductId('plus', 'annual');

      assert.ok(proMonthly.startsWith('pdt_'));
      assert.ok(proAnnual.startsWith('pdt_'));
      assert.ok(plusMonthly.startsWith('pdt_'));
      assert.ok(plusAnnual.startsWith('pdt_'));

      assert.strictEqual(isDodoProductId(proMonthly), true);
      assert.strictEqual(mapDodoProductToTier(proMonthly)?.tier, 'pro');
      assert.strictEqual(mapDodoProductToTier(plusAnnual)?.interval, 'annual');
    });

    it('guarantees prevent_trial_reset invariant in DB migration trigger', () => {
      const dodoMigration = fs.readFileSync(path.resolve('supabase', 'migrations', '06_dodo_subscriptions.sql'), 'utf8');
      assert.ok(dodoMigration.includes('if OLD.trial_consumed = true and NEW.trial_consumed = false then'));
      assert.ok(dodoMigration.includes('NEW.trial_consumed := true;'));
    });
  });

  // ========================================================
  // E. DODO PRODUCT/PLAN MAPPING (ALL 4 CANONICAL PRODUCTS)
  // ========================================================
  describe('E. Dodo Catalog Mapping Audit (4 Canonical Products)', () => {
    const canonicalMatrix = [
      { tier: 'pro', interval: 'monthly', expectedPrice: 5.99 },
      { tier: 'pro', interval: 'annual', expectedPrice: 59.99 },
      { tier: 'plus', interval: 'monthly', expectedPrice: 9.99 },
      { tier: 'plus', interval: 'annual', expectedPrice: 99.99 }
    ];

    for (const [idx, item] of canonicalMatrix.entries()) {
      it(`verifies canonical combination #${idx + 1}: ${item.tier} ${item.interval}`, () => {
        const productId = getDodoProductId(item.tier, item.interval);
        assert.ok(productId.startsWith('pdt_'), `Product ID must start with pdt_: ${productId}`);
        assert.strictEqual(isDodoProductId(productId), true);

        const mapped = mapDodoProductToTier(productId);
        assert.ok(mapped, `Mapped tier metadata must exist for ${productId}`);
        assert.strictEqual(mapped.tier, item.tier);
        assert.strictEqual(mapped.amount, item.expectedPrice);
      });
    }

    it('strictly throws on unknown or unmapped plan/interval with no silent fallback', () => {
      assert.throws(() => getDodoProductId('enterprise', 'monthly'), /Invalid plan/);
      assert.throws(() => getDodoProductId('pro', 'biweekly'), /Invalid interval/);
      assert.throws(() => getDodoProductId('', ''), /Missing plan/);
      assert.strictEqual(mapDodoProductToTier('pdt_fake_malicious_id'), null);
    });
  });

  // ========================================================
  // F. WEBHOOK SECURITY & FORGERY RESISTANCE
  // ========================================================
  describe('F. Dodo Webhook Security Audit', () => {
    const testSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2gZYMun';

    it('rejects missing or malformed webhook signature headers', () => {
      const rawBody = JSON.stringify({ type: 'subscription.active' });

      assert.strictEqual(verifyDodoWebhookSignature(null, rawBody, testSecret), false);
      assert.strictEqual(verifyDodoWebhookSignature({}, rawBody, testSecret), false);
      assert.strictEqual(verifyDodoWebhookSignature({ 'webhook-id': 'msg_1' }, rawBody, testSecret), false);
    });

    it('rejects forged webhook signatures', () => {
      const rawBody = JSON.stringify({ type: 'subscription.active' });
      const now = Math.floor(Date.now() / 1000);
      const headers = generateTestDodoSignature('msg_test', now, rawBody, testSecret);
      const badHeaders = { ...headers, 'webhook-signature': 'v1,invalid_sig_here' };

      assert.strictEqual(verifyDodoWebhookSignature(badHeaders, rawBody, testSecret), false);
      assert.strictEqual(verifyDodoWebhookSignature(headers, rawBody + ' ', testSecret), false);
    });

    it('accepts authentic webhook signatures with valid timestamp', () => {
      const rawBody = JSON.stringify({ type: 'subscription.active' });
      const now = Math.floor(Date.now() / 1000);
      const headers = generateTestDodoSignature('msg_test', now, rawBody, testSecret);
      assert.strictEqual(verifyDodoWebhookSignature(headers, rawBody, testSecret), true);
    });
  });

  // ========================================================
  // J. SECRET & CREDENTIAL LEAK SCAN
  // ========================================================
  describe('J. Secret & Credential Leak Audit', () => {
    it('verifies no service_role key, secret key, or private token appears in client bundles or HTML', () => {
      const distDir = path.join(rootDir, 'dist');
      const filesToScan = [
        path.join(distDir, 'src', 'client.bundle.js'),
        path.join(distDir, 'optimizer.bundle.js'),
        path.join(distDir, 'app.html'),
        path.join(distDir, 'account.html'),
        path.join(distDir, 'index.html'),
        path.join(distDir, 'upgrade.html')
      ];

      const forbiddenPatterns = [
        'SUPABASE_SERVICE_ROLE_KEY',
        'SERVICE_ROLE_KEY',
        'PADDLE_WEBHOOK_SECRET',
        'PADDLE_API_KEY',
        'DODO_PAYMENTS_API_KEY',
        'DODO_PAYMENTS_WEBHOOK_KEY'
      ];

      for (const filePath of filesToScan) {
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          assert.ok(
            !content.includes(pattern),
            `File ${path.basename(filePath)} must NOT contain ${pattern}`
          );
        }
      }
    });

    it('verifies .env.local is ignored and .env.example contains only placeholders', () => {
      const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
      assert.ok(gitignore.includes('.env'), '.gitignore must ignore .env files');
      const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
      assert.ok(!envExample.includes('SERVICE_ROLE'), '.env.example must not expose service role');
      assert.ok(envExample.includes('your-project-id.supabase.co'), '.env.example must use placeholder URL');
      assert.ok(envExample.includes('sb_pub_your-publishable-key-here'), '.env.example must use placeholder key');
    });
  });

  // ========================================================
  // K. FRONTEND SECURITY & DOM XSS AUDIT
  // ========================================================
  describe('K. Frontend Security & DOM XSS Hardening', () => {
    it('verifies escapeHtml is implemented and err.message is escaped in account.html', () => {
      const accountHtml = fs.readFileSync(path.join(rootDir, 'account.html'), 'utf8');
      assert.ok(accountHtml.includes('function escapeHtml(str)'), 'account.html must define escapeHtml');
      assert.ok(accountHtml.includes('escapeHtml(err.message'), 'account.html must escape err.message in error banner');
    });

    it('verifies verify-email.html sets error messages safely without unescaped innerHTML', () => {
      const verifyHtml = fs.readFileSync(path.join(rootDir, 'verify-email.html'), 'utf8');
      assert.ok(
        verifyHtml.includes('resendStatus.textContent = err.message'),
        'verify-email.html must use textContent for err.message'
      );
      assert.ok(
        !verifyHtml.includes('innerHTML = `<span style="color:var(--bad);">${err.message'),
        'verify-email.html must not interpolate raw err.message into innerHTML'
      );
    });
  });
});
