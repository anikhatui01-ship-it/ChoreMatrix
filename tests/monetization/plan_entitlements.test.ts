import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  PRICING_CONFIG,
  getTierById,
  isTierAdFree,
  getDefaultPaidTier,
  calculateAnnualSavings,
  normalizeTierId
} from '../../src/config/pricing.ts';
import { resolveAdEntitlement, AdSlot } from '../../src/monetization/adSlot.ts';
import type { ProfileRow, BillingDetails } from '../../src/persistence/types.ts';

describe('ChoreMatrix Plan Entitlements & Truthful Pricing Suite', () => {
  const rootDir = process.cwd();
  const pricingHtmlPath = path.join(rootDir, 'pricing.html');
  const upgradeHtmlPath = path.join(rootDir, 'upgrade.html');
  const accountHtmlPath = path.join(rootDir, 'account.html');

  // ========================================================
  // 1. FEATURE TRUTH: CAPABILITY MATRIX
  // ========================================================
  describe('1. Feature Truth & Capability Matrix', () => {
    it('Free sees Free features', () => {
      const free = getTierById('free');
      assert.ok(free, 'Free tier must exist in centralized config');
      assert.strictEqual(free.id, 'free');
      assert.strictEqual(free.name, 'Free');

      const expectedFreeFeatures = [
        '1-week planning',
        'core optimizer',
        'Calculate Plan',
        'Rebalance',
        'cloud saving',
        'basic diagnostics',
        'ads'
      ];

      for (const feat of expectedFreeFeatures) {
        assert.ok(
          free.features.some(f => f.toLowerCase().includes(feat.toLowerCase())),
          `Free tier must advertise feature: ${feat}`
        );
      }
    });

    it('Pro sees Pro features', () => {
      const pro = getTierById('pro');
      assert.ok(pro, 'Pro tier must exist in centralized config');
      assert.strictEqual(pro.id, 'pro');
      assert.strictEqual(pro.name, 'Pro');

      const expectedProFeatures = [
        'everything in Free',
        '4-week planning',
        'advanced preferences/aversions',
        'richer plan information',
        'no ads'
      ];

      for (const feat of expectedProFeatures) {
        assert.ok(
          pro.features.some(f => f.toLowerCase().includes(feat.toLowerCase())),
          `Pro tier must advertise feature: ${feat}`
        );
      }
    });

    it('Plus sees Plus features', () => {
      const plus = getTierById('plus');
      assert.ok(plus, 'Plus tier must exist in centralized config');
      assert.strictEqual(plus.id, 'plus');
      assert.strictEqual(plus.name, 'Plus');

      const expectedPlusFeatures = [
        'everything in Pro',
        'priority feature feedback',
        'no ads'
      ];

      for (const feat of expectedPlusFeatures) {
        assert.ok(
          plus.features.some(f => f.toLowerCase().includes(feat.toLowerCase())),
          `Plus tier must advertise feature: ${feat}`
        );
      }
    });

    it('unsupported features are not advertised in any plan', () => {
      // Must NOT advertise unimplemented features like multiple saved households or schedule export
      for (const tier of PRICING_CONFIG.tiers) {
        for (const feat of tier.features) {
          const lower = feat.toLowerCase();
          assert.ok(
            !lower.includes('multiple saved households'),
            `Tier ${tier.name} must not advertise unimplemented multiple saved households`
          );
          assert.ok(
            !lower.includes('exportable schedule summaries') && !lower.includes('schedule export'),
            `Tier ${tier.name} must not advertise unimplemented schedule export summaries`
          );
          assert.ok(
            !lower.includes('ai') && !lower.includes('llm') && !lower.includes('neural'),
            `Tier ${tier.name} must not claim AI or LLM functionality`
          );
        }
      }
    });
  });

  // ========================================================
  // 2. ADS BUSINESS RULE & AUTHORITATIVE ENTITLEMENTS
  // ========================================================
  describe('2. Ads Business Rule & Entitlements', () => {
    it('Free has ads entitlement (ads enabled)', () => {
      const free = getTierById('free');
      assert.strictEqual(free?.adFree, false, 'Free tier adFree must be false');
      assert.strictEqual(free?.adEntitlement, 'ads_enabled');
      assert.strictEqual(isTierAdFree('free'), false);
    });

    it('Pro/Plus are ad-free (ads disabled)', () => {
      const pro = getTierById('pro');
      assert.strictEqual(pro?.adFree, true, 'Pro tier adFree must be true');
      assert.strictEqual(pro?.adEntitlement, 'ad_free');
      assert.strictEqual(isTierAdFree('pro'), true);

      const plus = getTierById('plus');
      assert.strictEqual(plus?.adFree, true, 'Plus tier adFree must be true');
      assert.strictEqual(plus?.adEntitlement, 'ad_free');
      assert.strictEqual(isTierAdFree('plus'), true);

      // Backwards compatibility legacy aliases
      assert.strictEqual(isTierAdFree('household_pro'), true);
      assert.strictEqual(isTierAdFree('household_plus'), true);
    });

    it('ad entitlement does not trust client parameters or localStorage manipulation', async () => {
      // Attacker manipulates client state claiming to be Pro or Plus
      const fakeUser = { id: 'usr_hacker_99', plan_tier: 'pro', isPaid: true };

      // Authoritative database fetcher reports user is actually on the Free tier
      const authoritativeFetcher = async (uid: string) => ({ plan_tier: 'free' });

      const entitlement = await resolveAdEntitlement(fakeUser, authoritativeFetcher);
      assert.strictEqual(
        entitlement,
        'free-tier',
        'resolveAdEntitlement must strictly use authoritative DB profile and reject client spoofing'
      );
    });

    it('anonymous visitors default safely to free-tier ad slot', async () => {
      const entitlement = await resolveAdEntitlement(null);
      assert.strictEqual(entitlement, 'free-tier');
    });
  });

  // ========================================================
  // 3. MONTHLY & ANNUAL PRICING MODEL
  // ========================================================
  describe('3. Monthly & Annual Pricing Model', () => {
    it('monthly pricing is correct', () => {
      const free = getTierById('free')!;
      assert.strictEqual(free.monthlyPrice, 0);

      const pro = getTierById('pro')!;
      assert.strictEqual(pro.monthlyPrice, 5.99);

      const plus = getTierById('plus')!;
      assert.strictEqual(plus.monthlyPrice, 9.99);
    });

    it('annual pricing is correct and represents approximately two months free', () => {
      const free = getTierById('free')!;
      assert.strictEqual(free.annualPrice, 0);

      const pro = getTierById('pro')!;
      assert.strictEqual(pro.annualPrice, 59.99);

      const plus = getTierById('plus')!;
      assert.strictEqual(plus.annualPrice, 99.99);

      // Pro annual math: 12 * $5.99 = $71.88. Annual is $59.99. Savings = $11.89 (about 2 months @ $5.99 = $11.98)
      const proSavings = calculateAnnualSavings(pro);
      assert.strictEqual(proSavings.monthlyTotal, 71.88);
      assert.strictEqual(proSavings.annualPrice, 59.99);
      assert.strictEqual(proSavings.savingsAmount, 11.89);
      assert.strictEqual(pro.annualSavingText, 'Save about 2 months');

      // Plus annual math: 12 * $9.99 = $119.88. Annual is $99.99. Savings = $19.89 (about 2 months @ $9.99 = $19.98)
      const plusSavings = calculateAnnualSavings(plus);
      assert.strictEqual(plusSavings.monthlyTotal, 119.88);
      assert.strictEqual(plusSavings.annualPrice, 99.99);
      assert.strictEqual(plusSavings.savingsAmount, 19.89);
      assert.strictEqual(plus.annualSavingText, 'Save about 2 months');
    });

    it('paid plans have 7-day free trial duration', () => {
      const free = getTierById('free')!;
      assert.strictEqual(free.trialDays, 0);

      const pro = getTierById('pro')!;
      assert.strictEqual(pro.trialDays, 7);
      assert.strictEqual(pro.checkoutDisclosures.trialDurationText, '7-day free trial period');

      const plus = getTierById('plus')!;
      assert.strictEqual(plus.trialDays, 7);
      assert.strictEqual(plus.checkoutDisclosures.trialDurationText, '7-day free trial period');
    });
  });

  // ========================================================
  // 4. PRICING PAGE ANNUAL TOGGLE UI & CTA TRUTH
  // ========================================================
  describe('4. Annual Billing UI & Safe Paid CTAs', () => {
    it('pricing.html contains Monthly / Annual toggle controls and savings badge', () => {
      const content = fs.readFileSync(pricingHtmlPath, 'utf8');

      assert.ok(content.includes('id="btnMonthlyBilling"'), 'Must have monthly toggle button');
      assert.ok(content.includes('id="btnAnnualBilling"'), 'Must have annual toggle button');
      assert.ok(
        content.includes('Save ~2 Months') || content.includes('Save about 2 months'),
        'Must display annual savings callout on annual toggle'
      );
    });

    it('annual toggle changes displayed price correctly in client script logic', () => {
      const content = fs.readFileSync(pricingHtmlPath, 'utf8');

      // Verify toggle switches currentInterval
      assert.ok(content.includes("currentInterval = 'monthly'"), 'Script must handle monthly interval switch');
      assert.ok(content.includes("currentInterval = 'annually'"), 'Script must handle annual interval switch');
      assert.ok(content.includes('renderTiers()'), 'Script must re-render tiers on interval change');

      // Verify dynamic price expression uses tier.annualPrice vs tier.monthlyPrice
      assert.ok(
        content.includes('tier.annualPrice.toFixed(2)') && content.includes('tier.monthlyPrice.toFixed(2)'),
        'pricing.html must render both annual and monthly prices from centralized config'
      );
    });

    it('paid CTA does not pretend payment succeeded and routes honestly to upgrade page', () => {
      const pricingContent = fs.readFileSync(pricingHtmlPath, 'utf8');
      const upgradeContent = fs.readFileSync(upgradeHtmlPath, 'utf8');

      // Paid CTA routes to /upgrade.html
      assert.ok(pricingContent.includes('/upgrade.html?plan='), 'Paid tiers must route to upgrade.html');

      // Must not link paid CTA directly to /app.html
      assert.ok(
        pricingContent.includes("isFree\n      ? '/app.html'") ||
        pricingContent.includes("isFree ? '/app.html' : `/upgrade.html?plan="),
        'Paid tiers must NOT link directly to /app.html'
      );

      // Upgrade page displays honest checkout coming soon banner
      assert.ok(
        upgradeContent.includes('Upgrade Checkout Coming Soon'),
        'upgrade.html must display honest coming soon status'
      );
      assert.ok(
        upgradeContent.includes('Payment processing is currently being finalized'),
        'upgrade.html must explain payment processing is in progress'
      );

      // No fake payment or credit card simulation
      assert.ok(!upgradeContent.includes('Payment Successful!'), 'Must not pretend payment succeeded');
      assert.ok(!upgradeContent.includes('name="cc-number"'), 'Must not contain fake CC input');
    });

    it('upgrade.html and account.html consume centralized pricing configuration', () => {
      const upgradeContent = fs.readFileSync(upgradeHtmlPath, 'utf8');
      const accountContent = fs.readFileSync(accountHtmlPath, 'utf8');

      assert.ok(upgradeContent.includes('PRICING_CONFIG'), 'upgrade.html must import PRICING_CONFIG');
      assert.ok(upgradeContent.includes('getTierById'), 'upgrade.html must import getTierById');
      assert.ok(accountContent.includes('getTierById'), 'account.html must import getTierById');
    });
  });

  // ========================================================
  // 5. BILLING-READY DATA MODEL REPRESENTATION
  // ========================================================
  describe('5. Billing-Ready Data Model Representation', () => {
    it('ProfileRow and BillingDetails support all required subscription fields', () => {
      const mockProfile: ProfileRow = {
        id: 'usr_sub_1',
        email: 'user@example.com',
        plan_tier: 'pro',
        billing_interval: 'monthly',
        subscription_status: 'active',
        trial_ends_at: '2026-10-05T00:00:00Z',
        current_period_start: '2026-09-28T00:00:00Z',
        current_period_end: '2026-10-28T00:00:00Z',
        created_at: '2026-09-28T00:00:00Z',
        updated_at: '2026-09-28T00:00:00Z'
      };

      assert.strictEqual(mockProfile.plan_tier, 'pro');
      assert.strictEqual(mockProfile.billing_interval, 'monthly');
      assert.strictEqual(mockProfile.subscription_status, 'active');
      assert.strictEqual(mockProfile.trial_ends_at, '2026-10-05T00:00:00Z');
      assert.strictEqual(mockProfile.current_period_start, '2026-09-28T00:00:00Z');
      assert.strictEqual(mockProfile.current_period_end, '2026-10-28T00:00:00Z');

      const mockBillingDetails: BillingDetails = {
        plan_tier: 'plus',
        billing_interval: 'annually',
        subscription_status: 'trialing',
        trial_ends_at: '2026-10-05T00:00:00Z',
        current_period_start: '2026-09-28T00:00:00Z',
        current_period_end: '2027-09-28T00:00:00Z'
      };

      assert.strictEqual(mockBillingDetails.plan_tier, 'plus');
      assert.strictEqual(mockBillingDetails.billing_interval, 'annually');
      assert.strictEqual(mockBillingDetails.subscription_status, 'trialing');
    });
  });
});
