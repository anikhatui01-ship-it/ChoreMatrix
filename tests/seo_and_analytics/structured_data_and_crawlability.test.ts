import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const distDir = path.join(rootDir, 'dist');

describe('Structured Data, GEO & AI Crawlability Test Suite', () => {
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

  describe('1. JSON-LD Structured Data Validation', () => {
    it('guarantees valid JSON-LD structured data on all 18 public pages', () => {
      for (const file of publicPages) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const jsonLdMatch = content.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
        assert.ok(jsonLdMatch, `${file} must contain a <script type="application/ld+json"> tag`);

        let parsed: any;
        assert.doesNotThrow(() => {
          parsed = JSON.parse(jsonLdMatch[1]);
        }, `${file} JSON-LD must be valid JSON syntax`);

        assert.strictEqual(parsed['@context'], 'https://schema.org', `${file} schema context must be https://schema.org`);
        assert.ok(Array.isArray(parsed['@graph']) || parsed['@type'], `${file} schema must have @graph or @type`);
      }
    });

    it('verifies homepage JSON-LD contains WebSite, Organization, and WebApplication entities', () => {
      const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      const jsonLdMatch = indexHtml.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
      assert.ok(jsonLdMatch);

      const parsed = JSON.parse(jsonLdMatch[1]);
      const graph = parsed['@graph'] as any[];
      assert.ok(Array.isArray(graph));

      const types = graph.map(item => item['@type']);
      assert.ok(types.includes('WebSite'), 'Homepage must declare WebSite schema');
      assert.ok(types.includes('Organization'), 'Homepage must declare Organization schema');
      assert.ok(types.includes('WebApplication'), 'Homepage must declare WebApplication schema');

      // Verify no fake ratings or invented statistics
      const rawJson = JSON.stringify(parsed);
      assert.ok(!rawJson.includes('aggregateRating'), 'Must NOT include fake aggregateRating schema');
      assert.ok(!rawJson.includes('reviewCount'), 'Must NOT include fake reviewCount');
      assert.ok(!rawJson.includes('5.0'), 'Must NOT include fake star ratings');

      // Verify truthful contact email
      const org = graph.find(item => item['@type'] === 'Organization');
      assert.strictEqual(org.contactPoint.email, 'chorematrixsupport@gmail.com');
    });

    it('verifies faq.html JSON-LD contains FAQPage with 25 questions and answers', () => {
      const faqHtml = fs.readFileSync(path.join(rootDir, 'faq.html'), 'utf8');
      const jsonLdMatch = faqHtml.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
      assert.ok(jsonLdMatch);

      const parsed = JSON.parse(jsonLdMatch[1]);
      const graph = parsed['@graph'] as any[];
      const faqPage = graph.find(item => item['@type'] === 'FAQPage');
      assert.ok(faqPage, 'faq.html must declare FAQPage schema');
      assert.strictEqual(faqPage.mainEntity.length, 25, 'FAQ schema must contain exactly 25 questions');

      for (const q of faqPage.mainEntity) {
        assert.strictEqual(q['@type'], 'Question');
        assert.ok(q.name && q.name.length > 0, 'Question name must be non-empty');
        assert.strictEqual(q.acceptedAnswer['@type'], 'Answer');
        assert.ok(q.acceptedAnswer.text && q.acceptedAnswer.text.length > 0, 'Answer text must be non-empty');
      }
    });

    it('verifies BreadcrumbList structured data is present on public pages', () => {
      for (const file of publicPages.filter(f => f !== 'index.html')) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const jsonLdMatch = content.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
        assert.ok(jsonLdMatch);

        const parsed = JSON.parse(jsonLdMatch[1]);
        const graph = parsed['@graph'] as any[];
        const breadcrumb = graph.find(item => item['@type'] === 'BreadcrumbList');
        assert.ok(breadcrumb, `${file} must declare BreadcrumbList schema`);
        assert.ok(breadcrumb.itemListElement.length >= 2, `${file} breadcrumb must have at least 2 items`);
        assert.strictEqual(breadcrumb.itemListElement[0].item, 'https://chorematrix.online/');
      }
    });
  });

  describe('2. llms.txt Discovery File Validation', () => {
    it('verifies llms.txt exists in root and dist and contains required sections', () => {
      const rootLlmsPath = path.join(rootDir, 'llms.txt');
      assert.ok(fs.existsSync(rootLlmsPath), 'llms.txt must exist in repository root');

      const content = fs.readFileSync(rootLlmsPath, 'utf8');
      assert.ok(content.includes('# ChoreMatrix'), 'llms.txt must start with ChoreMatrix title');
      assert.ok(content.includes('Deterministic Household Workload Optimizer'), 'llms.txt must describe optimizer');
      assert.ok(content.includes('https://chorematrix.online/how-it-works.html'), 'llms.txt must link to how-it-works');
      assert.ok(content.includes('https://chorematrix.online/pricing.html'), 'llms.txt must link to pricing');
      assert.ok(content.includes('https://chorematrix.online/faq.html'), 'llms.txt must link to faq');
      assert.ok(content.includes('chorematrixsupport@gmail.com'), 'llms.txt must list support email');

      // Security check: no private paths or secrets
      assert.ok(!content.includes('/app.html'), 'llms.txt must not link to private /app.html');
      assert.ok(!content.includes('/account.html'), 'llms.txt must not link to private /account.html');
      assert.ok(!content.includes('eyJhbGci'), 'llms.txt must never contain JWTs or tokens');

      if (fs.existsSync(distDir)) {
        const distLlmsPath = path.join(distDir, 'llms.txt');
        assert.ok(fs.existsSync(distLlmsPath), 'llms.txt must be copied to dist/ by build pipeline');
      }
    });
  });

  describe('3. Crawler Access & Robots.txt Disallow Rules', () => {
    it('verifies robots.txt disallows both clean URLs and .html extensions for private routes', () => {
      const robotsTxt = fs.readFileSync(path.join(rootDir, 'robots.txt'), 'utf8');

      const privateRoutes = ['app', 'account', 'upgrade', 'reset-password', 'verify-email'];
      for (const route of privateRoutes) {
        assert.ok(robotsTxt.includes(`Disallow: /${route}\n`) || robotsTxt.includes(`Disallow: /${route}\r\n`), `robots.txt must disallow clean URL /${route}`);
        assert.ok(robotsTxt.includes(`Disallow: /${route}.html`), `robots.txt must disallow /${route}.html`);
      }

      assert.ok(robotsTxt.includes('Sitemap: https://chorematrix.online/sitemap.xml'), 'robots.txt must specify canonical sitemap');
      assert.ok(robotsTxt.includes('Allow: /'), 'robots.txt must allow public pages');
    });
  });
});
