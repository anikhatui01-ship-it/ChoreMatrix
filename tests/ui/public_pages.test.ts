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
    'app.html'
  ];

  it('verifies all 16 required HTML pages exist and contain core head tags', () => {
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

  it('verifies public header removes Open App and maintains legitimate navigation', () => {
    const navTs = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'nav.ts'), 'utf8');
    assert.ok(!navTs.includes('Open App'), 'nav.ts must not include Open App button');
    assert.ok(navTs.includes('Log In'), 'nav.ts must include Log In link');
    assert.ok(navTs.includes('Sign Up'), 'nav.ts must include Sign Up button');
    assert.ok(navTs.includes('/faq.html'), 'nav.ts must include FAQ link in nav-links');
    assert.ok(navTs.includes('Optimizer') && navTs.includes('Account'), 'nav.ts preserves authenticated Optimizer and Account navigation');

    const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    assert.ok(!indexHtml.includes('Open App'), 'index.html must not include Open App button');
    assert.ok(indexHtml.includes('/faq.html'), 'index.html must include FAQ link');
    assert.ok(indexHtml.includes('Log In') && indexHtml.includes('Sign Up'), 'index.html must include Log In and Sign Up');
  });

  it('verifies public footer is cleaned of entity, email, and address placeholders and includes FAQ', () => {
    const footerTs = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'footer.ts'), 'utf8');
    assert.ok(!footerTs.includes('[ChoreMatrix Legal Entity Placeholder]'), 'footer.ts must not contain legal entity placeholder');
    assert.ok(!footerTs.includes('support@chorematrix.com'), 'footer.ts must not contain fabricated support email');
    assert.ok(!footerTs.includes('[Registered Business Address Placeholder]'), 'footer.ts must not contain address placeholder');
    assert.ok(footerTs.includes('/faq.html'), 'footer.ts must contain FAQ link');
    assert.ok(footerTs.includes('/how-it-works.html'), 'footer.ts preserves How It Works');
    assert.ok(footerTs.includes('/pricing.html'), 'footer.ts preserves Pricing');
    assert.ok(footerTs.includes('/why-chorematrix.html'), 'footer.ts preserves Why ChoreMatrix');
    assert.ok(footerTs.includes('/privacy.html'), 'footer.ts preserves Privacy Policy');
    assert.ok(footerTs.includes('/terms.html'), 'footer.ts preserves Terms of Service');
    assert.ok(footerTs.includes('/cookies.html'), 'footer.ts preserves Cookie Policy');
    assert.ok(footerTs.includes('/data-rights.html'), 'footer.ts preserves Data Rights');
    assert.ok(footerTs.includes('btnManageCookies'), 'footer.ts preserves Cookie Preferences');
  });

  it('verifies FAQ page contains required SEO metadata, headings, 25 questions, and accessible accordion semantics', () => {
    const faqHtml = fs.readFileSync(path.join(rootDir, 'faq.html'), 'utf8');
    assert.ok(faqHtml.includes('<title>ChoreMatrix FAQ — Household Workload & Chore Planning</title>'), 'FAQ must have exact required title');
    assert.ok(faqHtml.includes('name="description"'), 'FAQ must have meta description');
    assert.ok(faqHtml.includes('rel="canonical"'), 'FAQ must have canonical link');
    assert.ok(faqHtml.includes('property="og:title"'), 'FAQ must have Open Graph title');
    assert.ok(faqHtml.includes('property="og:description"'), 'FAQ must have Open Graph description');
    assert.ok(faqHtml.includes('<h1>Frequently Asked Questions</h1>'), 'FAQ must have exact required H1');
    assert.ok(faqHtml.includes('Everything you need to understand ChoreMatrix and get the most from it.'), 'FAQ must have exact required subtitle');

    // Sections A through F
    assert.ok(faqHtml.includes('Section A — Getting Started'), 'FAQ must include Section A');
    assert.ok(faqHtml.includes('Section B — How the Optimizer Works'), 'FAQ must include Section B');
    assert.ok(faqHtml.includes('Section C — Calculate vs Rebalance'), 'FAQ must include Section C');
    assert.ok(faqHtml.includes('Section D — Results & Diagnostics'), 'FAQ must include Section D');
    assert.ok(faqHtml.includes('Section E — Account & Data'), 'FAQ must include Section E');
    assert.ok(faqHtml.includes('Section F — Privacy'), 'FAQ must include Section F');

    // Questions 1 through 25
    for (let i = 1; i <= 25; i++) {
      assert.ok(faqHtml.includes(`id="faq-btn-${i}"`), `FAQ must have button for question ${i}`);
      assert.ok(faqHtml.includes(`id="faq-panel-${i}"`), `FAQ must have panel for question ${i}`);
      assert.ok(faqHtml.includes(`aria-controls="faq-panel-${i}"`), `FAQ question ${i} must have aria-controls`);
      assert.ok(faqHtml.includes(`aria-labelledby="faq-btn-${i}"`), `FAQ panel ${i} must have aria-labelledby`);
    }

    // Accessible semantics
    assert.ok(faqHtml.includes('aria-expanded="false"'), 'FAQ questions must default to aria-expanded="false"');
    assert.ok(faqHtml.includes('role="region"'), 'FAQ panels must have role="region"');
    assert.ok(faqHtml.includes(':focus-visible'), 'FAQ must specify focus-visible styles');

    // Truthful content assertions
    assert.ok(faqHtml.includes('deterministic') || faqHtml.includes('Deterministic'), 'FAQ must explain deterministic engine');
    assert.ok(faqHtml.includes('No. ChoreMatrix does not use large language models'), 'FAQ must truthfully state AI is not used');
    assert.ok(faqHtml.includes('zero advertising trackers'), 'FAQ must truthfully state advertising trackers are not used');
    assert.ok(!faqHtml.includes('revolutionary'), 'FAQ must avoid hype term revolutionary');
    assert.ok(!faqHtml.includes("world's first"), 'FAQ must avoid hype term world\'s first');
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
