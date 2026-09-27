import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Public Pages & Legal Suite Verification', () => {
  const rootDir = process.cwd();

  const requiredPages = [
    'index.html',
    'how-it-works.html',
    'pricing.html',
    'why-chorematrix.html',
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
    'app.html'
  ];

  it('verifies all 15 required HTML pages exist and contain core head tags', () => {
    for (const page of requiredPages) {
      const filePath = path.join(rootDir, page);
      assert.ok(fs.existsSync(filePath), `Page ${page} must exist in project root`);

      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('<meta charset="utf-8"'), `${page} must include charset meta tag`);
      assert.ok(content.includes('<meta name="viewport"'), `${page} must include viewport meta tag`);
      assert.ok(content.includes('<title>'), `${page} must include title tag`);
      assert.ok(content.includes('chorematrix_theme'), `${page} must include theme preservation script`);
    }
  });

  it('verifies pricing page embeds centralized configuration and provisional notices', () => {
    const pricingHtml = fs.readFileSync(path.join(rootDir, 'pricing.html'), 'utf8');
    assert.ok(pricingHtml.includes('PRICING_CONFIG'), 'pricing.html must import PRICING_CONFIG');
    assert.ok(pricingHtml.includes('Provisional Development Pricing'), 'pricing.html must show provisional notice');
    assert.ok(pricingHtml.includes('Free Trial') && pricingHtml.includes('trialDays'), 'pricing.html must display free trial representation');
  });

  it('verifies privacy page makes honest disclosures without unsubstantiated compliance badges', () => {
    const privacyHtml = fs.readFileSync(path.join(rootDir, 'privacy.html'), 'utf8');
    assert.ok(privacyHtml.includes('Data Minimization'), 'Privacy page must emphasize data minimization');
    assert.ok(privacyHtml.includes('Supabase Inc.'), 'Privacy page must list Supabase subprocessor');
    assert.ok(privacyHtml.includes('Vercel Inc.'), 'Privacy page must list Vercel subprocessor');
    assert.ok(!privacyHtml.includes('HIPAA compliant'), 'Privacy page must NOT falsely claim HIPAA compliance');
    assert.ok(!privacyHtml.includes('SOC 2 certified'), 'Privacy page must NOT falsely claim SOC 2 certification');
    assert.ok(privacyHtml.includes('[ChoreMatrix Legal Entity Placeholder]'), 'Privacy page must include entity placeholder');
  });

  it('verifies account page provides all 3 explicit logout scopes', () => {
    const accountHtml = fs.readFileSync(path.join(rootDir, 'account.html'), 'utf8');
    assert.ok(accountHtml.includes('btnSignOutLocal'), 'Account page must have Sign Out This Device button');
    assert.ok(accountHtml.includes('btnSignOutOthers'), 'Account page must have Sign Out All Other Devices button');
    assert.ok(accountHtml.includes('btnSignOutGlobal'), 'Account page must have Sign Out Everywhere button');
    assert.ok(accountHtml.includes('btnDeleteAccount'), 'Account page must have Delete Account button');
  });

  it('verifies cookie policy and components do not install fake analytics', () => {
    const cookiesHtml = fs.readFileSync(path.join(rootDir, 'cookies.html'), 'utf8');
    assert.ok(cookiesHtml.includes('Disabled'), 'Cookies page must disclose analytics are disabled');
    assert.ok(cookiesHtml.includes('chorematrix_auth_token'), 'Cookies page must list necessary auth token');
  });
});
