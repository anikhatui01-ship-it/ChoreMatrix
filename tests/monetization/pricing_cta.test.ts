import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { PRICING_CONFIG, getTierById, getDefaultPaidTier } from '../../src/config/pricing.ts';

describe('Pricing CTAs & Upgrade Route Architecture', () => {
  const rootDir = process.cwd();
  const pricingHtmlPath = path.join(rootDir, 'pricing.html');
  const upgradeHtmlPath = path.join(rootDir, 'upgrade.html');

  it('verifies pricing.html routes Free CTA to the optimizer', () => {
    assert.ok(fs.existsSync(pricingHtmlPath), 'pricing.html must exist');
    const content = fs.readFileSync(pricingHtmlPath, 'utf8');

    // Free tier CTA must point to /app.html
    assert.ok(
      content.includes("isFree ? '/app.html' : `/upgrade.html?plan=${encodeURIComponent(tier.id)}`") ||
      content.includes('/app.html'),
      'Free tier must route to /app.html'
    );
    assert.ok(
      content.includes('Launch Optimizer'),
      'Free CTA must use action-oriented optimizer text "Launch Optimizer"'
    );
  });

  it('verifies pricing.html routes Paid CTAs to /upgrade.html?plan=<id> and NOT directly to /app.html', () => {
    const content = fs.readFileSync(pricingHtmlPath, 'utf8');

    // Paid tiers must route to upgrade.html
    assert.ok(
      content.includes('/upgrade.html?plan='),
      'Paid CTAs must target /upgrade.html with plan parameter'
    );

    // Ensure paid CTAs do not link directly to /app.html
    assert.ok(
      content.includes("isFree ? '/app.html' : `/upgrade.html?plan=${encodeURIComponent(tier.id)}`"),
      'Paid tiers must NOT link directly to /app.html'
    );
  });

  it('verifies /upgrade.html exists and reads from centralized pricing configuration', () => {
    assert.ok(fs.existsSync(upgradeHtmlPath), 'upgrade.html must exist');
    const content = fs.readFileSync(upgradeHtmlPath, 'utf8');

    // Centralized pricing contract
    assert.ok(
      content.includes('PRICING_CONFIG') && content.includes('getTierById'),
      'upgrade.html must import or consume centralized PRICING_CONFIG'
    );

    // Required dynamic fields rendered from selected tier
    assert.ok(content.includes('selectedTier.name'), 'Must render selectedTier.name');
    assert.ok(content.includes('selectedTier.monthlyPrice'), 'Must render selectedTier.monthlyPrice');
    assert.ok(content.includes('selectedTier.trialDays'), 'Must render selectedTier.trialDays');
    assert.ok(content.includes('selectedTier.checkoutDisclosures'), 'Must render selectedTier.checkoutDisclosures');
    assert.ok(content.includes('selectedTier.features'), 'Must render selectedTier.features');
  });

  it('verifies helper functions resolve valid paid plans accurately from centralized config', () => {
    const pro = getTierById('household_pro');
    assert.ok(pro, 'Household Pro must exist');
    assert.strictEqual(pro.name, 'Household Pro');
    assert.strictEqual(pro.monthlyPrice, 4.99);
    assert.strictEqual(pro.trialDays, 14);
    assert.strictEqual(pro.adFree, true);

    const plus = getTierById('household_plus');
    assert.ok(plus, 'Household Plus must exist');
    assert.strictEqual(plus.name, 'Household Plus');
    assert.strictEqual(plus.monthlyPrice, 7.99);
    assert.strictEqual(plus.trialDays, 14);
    assert.strictEqual(plus.adFree, true);
  });

  it('verifies invalid plan parameter falls back gracefully to default paid tier', () => {
    const invalidTier = getTierById('malicious_override_tier');
    assert.strictEqual(invalidTier, undefined, 'Invalid tier id must return undefined');

    const fallback = getDefaultPaidTier();
    assert.strictEqual(fallback.id, 'household_pro', 'Fallback must safely return household_pro');
    assert.strictEqual(fallback.adFree, true);

    const content = fs.readFileSync(upgradeHtmlPath, 'utf8');
    assert.ok(
      content.includes('getDefaultPaidTier()'),
      'upgrade.html must gracefully fallback on invalid plan parameter'
    );
  });

  it('verifies upgrade page displays honest coming-soon state with no fake payment success', () => {
    const content = fs.readFileSync(upgradeHtmlPath, 'utf8');

    // Honest status messaging
    assert.ok(
      content.includes('Upgrade Checkout Coming Soon') ||
      content.includes('Payment processing is currently being finalized'),
      'Must display honest state that payments are coming soon'
    );

    // No fake payment or credit card fields
    assert.ok(!content.includes('name="cc-number"'), 'Must not have fake credit card inputs');
    assert.ok(!content.includes('name="cardnumber"'), 'Must not have fake card number inputs');
    assert.ok(!content.includes('Payment Successful!'), 'Must not display fake payment success');
    assert.ok(!content.includes('Charge Complete'), 'Must not pretend payment has completed');

    // Safe return navigation
    assert.ok(content.includes('/app.html'), 'Must link back to free optimizer');
    assert.ok(content.includes('/pricing.html'), 'Must link to plan comparison');
  });
});
