import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sanitizeParams,
  sanitizeParamValue,
  sanitizeUrl,
  isSensitiveKey
} from '../../src/analytics/ga4.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

describe('Phase 4: SEO and Conversion Measurement Suite', () => {

  describe('1. Technical SEO & Meta Integrity', () => {
    const publicPages = [
      'index.html',
      'how-it-works.html',
      'chore-chart-for-couples.html',
      'roommate-chore-schedule.html',
      'family-chore-planner.html',
      'pricing.html',
      'why-chorematrix.html',
      'faq.html',
      'privacy.html',
      'terms.html',
      'cookies.html',
      'data-rights.html',
      'refund.html',
      'contact.html',
      'feedback.html',
      'login.html',
      'signup.html',
      'forgot-password.html'
    ];

    it('guarantees unique page titles and meta descriptions across public pages', () => {
      const titles = new Set<string>();
      const descriptions = new Set<string>();

      for (const file of publicPages) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const titleMatch = content.match(/<title>(.*?)<\/title>/i);
        const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);

        assert.ok(titleMatch && titleMatch[1].trim(), `${file} must have a non-empty <title> tag`);
        assert.ok(descMatch && descMatch[1].trim(), `${file} must have a non-empty meta description`);

        const title = titleMatch[1].trim();
        const desc = descMatch[1].trim();

        assert.ok(!titles.has(title), `Duplicate title detected in ${file}: "${title}"`);
        assert.ok(!descriptions.has(desc), `Duplicate meta description detected in ${file}: "${desc}"`);

        titles.add(title);
        descriptions.add(desc);
      }
    });

    it('guarantees canonical URLs point to production domain https://chorematrix.online/ and never preview URLs', () => {
      for (const file of publicPages) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const canonicalMatch = content.match(/<link\s+rel=["']canonical["']\s+href=["'](.*?)["']/i);
        assert.ok(canonicalMatch, `${file} must specify a canonical link`);

        const canonicalUrl = canonicalMatch[1];
        assert.ok(canonicalUrl.startsWith('https://chorematrix.online'), `${file} canonical must start with https://chorematrix.online`);
        assert.ok(!canonicalUrl.includes('vercel.app'), `${file} canonical must never contain vercel.app`);
        assert.ok(!canonicalUrl.includes('localhost'), `${file} canonical must never contain localhost`);
      }
    });

    it('guarantees exactly one <h1> element on every HTML page', () => {
      const allHtmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of allHtmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const h1Matches = content.match(/<h1[\s>]/gi) || [];
        assert.strictEqual(h1Matches.length, 1, `${file} must have exactly one <h1> element, found ${h1Matches.length}`);
      }
    });

    it('guarantees Open Graph and Twitter Card tags exist on all public pages', () => {
      for (const file of publicPages) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(content.includes('<meta property="og:title"'), `${file} must have og:title`);
        assert.ok(content.includes('<meta property="og:description"'), `${file} must have og:description`);
        assert.ok(content.includes('<meta property="og:url"'), `${file} must have og:url`);
        assert.ok(content.includes('<meta property="og:image"'), `${file} must have og:image`);
        assert.ok(content.includes('<meta name="twitter:card"'), `${file} must have twitter:card`);
      }
    });

    it('verifies robots.txt disallows private authenticated routes and specifies sitemap', () => {
      const robotsTxt = fs.readFileSync(path.join(rootDir, 'robots.txt'), 'utf8');
      assert.ok(robotsTxt.includes('Disallow: /app.html'));
      assert.ok(robotsTxt.includes('Disallow: /account.html'));
      assert.ok(robotsTxt.includes('Disallow: /upgrade.html'));
      assert.ok(robotsTxt.includes('Disallow: /reset-password.html'));
      assert.ok(robotsTxt.includes('Disallow: /verify-email.html'));
      assert.ok(robotsTxt.includes('Sitemap: https://chorematrix.online/sitemap.xml'));
    });

    it('verifies sitemap.xml includes all public pages and excludes private/noindex routes', () => {
      const sitemapXml = fs.readFileSync(path.join(rootDir, 'sitemap.xml'), 'utf8');

      // Check all 3 new landing pages are present
      assert.ok(sitemapXml.includes('https://chorematrix.online/chore-chart-for-couples.html'));
      assert.ok(sitemapXml.includes('https://chorematrix.online/roommate-chore-schedule.html'));
      assert.ok(sitemapXml.includes('https://chorematrix.online/family-chore-planner.html'));

      // Check private routes are excluded from sitemap
      assert.ok(!sitemapXml.includes('app.html'), 'app.html must not be in sitemap');
      assert.ok(!sitemapXml.includes('account.html'), 'account.html must not be in sitemap');
      assert.ok(!sitemapXml.includes('upgrade.html'), 'upgrade.html must not be in sitemap');
      assert.ok(!sitemapXml.includes('reset-password.html'), 'reset-password.html must not be in sitemap');
      assert.ok(!sitemapXml.includes('verify-email.html'), 'verify-email.html must not be in sitemap');
    });
  });

  describe('2. Search Intent Landing Pages Distinctness & Integrity', () => {
    it('verifies couples landing page has audience-specific content and working calculator link', () => {
      const content = fs.readFileSync(path.join(rootDir, 'chore-chart-for-couples.html'), 'utf8');
      assert.ok(content.includes('Couples Workload Planning'));
      assert.ok(content.includes('A Practical Chore System for Couples Who Want Fair Balance'));
      assert.ok(content.includes('Capacity-Aware Proportionality'));
      assert.ok(content.includes('50/50'));
      assert.ok(content.includes('/?preset=couple#calculator'));
    });

    it('verifies roommate landing page has audience-specific content and working calculator link', () => {
      const content = fs.readFileSync(path.join(rootDir, 'roommate-chore-schedule.html'), 'utf8');
      assert.ok(content.includes('Roommate & Flatmate Planning'));
      assert.ok(content.includes('Shared House Chore Schedules Without Housemate Drama'));
      assert.ok(content.includes('Equal Workload Flattening'));
      assert.ok(content.includes('Unavailable Days & Travel'));
      assert.ok(content.includes('/?preset=roommates#calculator'));
    });

    it('verifies family landing page has audience-specific content and working calculator link', () => {
      const content = fs.readFileSync(path.join(rootDir, 'family-chore-planner.html'), 'utf8');
      assert.ok(content.includes('Family Workload Optimization'));
      assert.ok(content.includes('Family Chore Planning That Balances Parents, Teens & Kids'));
      assert.ok(content.includes('Age-Appropriate Task Eligibility'));
      assert.ok(content.includes('Proportional Capacity Modeling'));
      assert.ok(content.includes('/?preset=family#calculator'));
    });

    it('verifies homepage hero headline is strictly preserved', () => {
      const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      assert.ok(
        indexHtml.includes('Stop Guessing Who Does More. Build a Fairer Chore Plan.'),
        'Homepage hero headline must remain exactly as approved'
      );
    });
  });

  describe('3. Conversion Funnel Measurement & Privacy Audit', () => {
    it('verifies all conversion milestone events are instrumented', () => {
      const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      const appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf8');
      const signupHtml = fs.readFileSync(path.join(rootDir, 'signup.html'), 'utf8');
      const feedbackHtml = fs.readFileSync(path.join(rootDir, 'feedback.html'), 'utf8');
      const dodoCheckoutTs = fs.readFileSync(path.join(rootDir, 'src', 'monetization', 'dodoCheckout.ts'), 'utf8');

      // Calculator & Plan events
      assert.ok(indexHtml.includes("trackEvent('calculator_started')") || indexHtml.includes('trackEvent("calculator_started")'));
      assert.ok(indexHtml.includes("trackEvent('preset_selected'"));
      assert.ok(indexHtml.includes("trackEvent('plan_calculated'"));
      assert.ok(indexHtml.includes("trackEvent('plan_rebalanced'"));

      // App & Persistence events
      assert.ok(appHtml.includes("trackEvent('plan_saved'"));

      // Registration events
      assert.ok(signupHtml.includes("trackEvent('registration_started')"));
      assert.ok(signupHtml.includes("trackEvent('registration_completed'"));

      // Feedback events
      assert.ok(feedbackHtml.includes("trackEvent('feedback_page_viewed')"));
      assert.ok(feedbackHtml.includes("trackEvent('feedback_submitted'"));

      // Checkout event
      assert.ok(dodoCheckoutTs.includes("trackEvent('checkout_started'"));
    });

    it('verifies no personal or sensitive data is sent in event payloads', () => {
      // Test payload with both clean and sensitive keys
      const samplePayload = {
        member_count: 3,
        task_count: 5,
        mode: 'capacity_aware',
        fairness_score: 95,
        preset_name: 'couple',
        user_name: 'Secret Person',
        chore_name: 'Clean Toilet',
        email: 'user@domain.com',
        token: 'eyJhbGciOiJIUzI1Ni...'
      };

      const clean = sanitizeParams(samplePayload);
      assert.strictEqual(clean.member_count, 3);
      assert.strictEqual(clean.task_count, 5);
      assert.strictEqual(clean.mode, 'capacity_aware');
      assert.strictEqual(clean.fairness_score, 95);
      assert.strictEqual(clean.preset_name, 'couple');

      // Sensitive fields must be completely stripped
      assert.strictEqual(clean.user_name, undefined);
      assert.strictEqual(clean.chore_name, undefined);
      assert.strictEqual(clean.email, undefined);
      assert.strictEqual(clean.token, undefined);
    });
  });
});
