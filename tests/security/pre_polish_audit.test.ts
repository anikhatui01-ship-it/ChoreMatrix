import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Pre-Polish Production Launch Audit Suite', () => {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');

  // ========================================================
  // 1. LEGAL & PRIVACY
  // ========================================================
  describe('1. Legal & Privacy Integrity', () => {
    it('verifies all 4 legal pages exist and are linked in footer', () => {
      const legalPages = ['privacy.html', 'terms.html', 'cookies.html', 'data-rights.html'];
      for (const p of legalPages) {
        assert.ok(fs.existsSync(path.join(rootDir, p)), `${p} must exist in root`);
        assert.ok(fs.existsSync(path.join(distDir, p)), `${p} must exist in dist`);
      }

      const footerTs = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'footer.ts'), 'utf8');
      for (const p of legalPages) {
        assert.ok(footerTs.includes(`/${p}`), `footer.ts must link to /${p}`);
      }
    });

    it('verifies absence of placeholder support email across all public HTML files', () => {
      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(
          !content.includes('support@chorematrix.com'),
          `${file} must not contain placeholder support@chorematrix.com`
        );
      }
    });
  });

  // ========================================================
  // 2. FRONTEND SECURITY & SECRETS
  // ========================================================
  describe('2. Frontend Security & Secrets', () => {
    it('.env.local is gitignored and .env.example contains placeholders only', () => {
      const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
      assert.ok(gitignore.includes('.env'), '.gitignore must ignore .env files');

      const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
      assert.ok(envExample.includes('https://your-project-id.supabase.co'), '.env.example must have placeholder URL');
      assert.ok(envExample.includes('sb_pub_your-publishable-key-here'), '.env.example must have placeholder key');
      assert.ok(!envExample.includes('SERVICE_ROLE'), '.env.example must not expose service role key');
    });

    it('dist directory contains no private keys, database passwords, or env files', () => {
      assert.ok(fs.existsSync(distDir), 'dist/ directory must exist');
      const distFiles = fs.readdirSync(distDir);
      assert.ok(!distFiles.includes('.env'), 'dist/ must not contain .env');
      assert.ok(!distFiles.includes('.env.local'), 'dist/ must not contain .env.local');

      const clientBundle = fs.readFileSync(path.join(distDir, 'src', 'client.bundle.js'), 'utf8');
      assert.ok(!clientBundle.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Client bundle must not contain service role key');
      assert.ok(!clientBundle.includes('SERVICE_ROLE_KEY'), 'Client bundle must not contain SERVICE_ROLE_KEY');
    });
  });

  // ========================================================
  // 3. HTTPS & RESOURCE SECURITY
  // ========================================================
  describe('3. HTTPS & Insecure Resources', () => {
    it('verifies all script, style, and API requests use HTTPS or relative paths', () => {
      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        // Check for insecure http:// resource inclusions (excluding xml namespace declarations)
        const insecureHttpMatches = content.match(/(?:src|href)=["']http:\/\/(?!www\.w3\.org)[^"']*["']/gi);
        assert.strictEqual(
          insecureHttpMatches,
          null,
          `${file} must not contain insecure http:// resource URLs`
        );
      }
    });
  });

  // ========================================================
  // 4. COOKIES, STORAGE & TRACKING
  // ========================================================
  describe('4. Cookies, Storage & Tracking', () => {
    it('verifies zero session replay SDKs, advertising pixels, or font CDNs exist', () => {
      const forbiddenVendors = [
        'hotjar', 'fullstory', 'logrocket', 'clarity.ms', 'posthog',
        'smartlook', 'mouseflow', 'openreplay', 'sentry',
        'google-analytics', 'googletagmanager', 'facebook.net', 'connect.facebook.net',
        'fonts.googleapis.com', 'fonts.gstatic.com'
      ];

      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8').toLowerCase();
        for (const vendor of forbiddenVendors) {
          assert.ok(!content.includes(vendor), `${file} must not contain tracker ${vendor}`);
        }
      }

      const clientBundle = fs.readFileSync(path.join(distDir, 'src', 'client.bundle.js'), 'utf8').toLowerCase();
      for (const vendor of ['hotjar', 'fullstory', 'logrocket', 'clarity.ms', 'openreplay']) {
        assert.ok(!clientBundle.includes(vendor), `client.bundle.js must not contain ${vendor}`);
      }
    });
  });

  // ========================================================
  // 5. SEO, SITEMAP & ROBOTS
  // ========================================================
  describe('5. SEO, Sitemap & Robots', () => {
    it('verifies sitemap.xml exists in root and dist and lists all public pages', () => {
      assert.ok(fs.existsSync(path.join(rootDir, 'sitemap.xml')), 'sitemap.xml must exist in root');
      assert.ok(fs.existsSync(path.join(distDir, 'sitemap.xml')), 'sitemap.xml must exist in dist');

      const sitemap = fs.readFileSync(path.join(rootDir, 'sitemap.xml'), 'utf8');
      const expectedUrls = [
        'https://www.chorematrix.online/',
        'https://www.chorematrix.online/how-it-works.html',
        'https://www.chorematrix.online/pricing.html',
        'https://www.chorematrix.online/why-chorematrix.html',
        'https://www.chorematrix.online/faq.html',
        'https://www.chorematrix.online/privacy.html',
        'https://www.chorematrix.online/terms.html',
        'https://www.chorematrix.online/cookies.html',
        'https://www.chorematrix.online/data-rights.html',
        'https://www.chorematrix.online/login.html',
        'https://www.chorematrix.online/signup.html',
        'https://www.chorematrix.online/forgot-password.html'
      ];

      for (const url of expectedUrls) {
        assert.ok(sitemap.includes(`<loc>${url}</loc>`), `sitemap.xml must include ${url}`);
      }
    });

    it('verifies robots.txt exists in root and dist and disallows private/auth routes', () => {
      assert.ok(fs.existsSync(path.join(rootDir, 'robots.txt')), 'robots.txt must exist in root');
      assert.ok(fs.existsSync(path.join(distDir, 'robots.txt')), 'robots.txt must exist in dist');

      const robots = fs.readFileSync(path.join(rootDir, 'robots.txt'), 'utf8');
      assert.ok(robots.includes('Disallow: /app.html'), 'robots.txt must disallow /app.html');
      assert.ok(robots.includes('Disallow: /account.html'), 'robots.txt must disallow /account.html');
      assert.ok(robots.includes('Disallow: /reset-password.html'), 'robots.txt must disallow /reset-password.html');
      assert.ok(robots.includes('Disallow: /verify-email.html'), 'robots.txt must disallow /verify-email.html');
      assert.ok(robots.includes('Sitemap: https://www.chorematrix.online/sitemap.xml'), 'robots.txt must link to sitemap.xml');
    });

    it('verifies all public pages contain canonical, OG, and Twitter metadata', () => {
      const publicFiles = [
        'index.html', 'how-it-works.html', 'pricing.html', 'why-chorematrix.html',
        'faq.html', 'privacy.html', 'terms.html', 'cookies.html', 'data-rights.html',
        'login.html', 'signup.html', 'forgot-password.html'
      ];

      for (const file of publicFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(content.includes('<link rel="canonical"'), `${file} must contain canonical link`);
        assert.ok(content.includes('property="og:title"'), `${file} must contain og:title`);
        assert.ok(content.includes('property="og:description"'), `${file} must contain og:description`);
        assert.ok(content.includes('property="og:image"'), `${file} must contain og:image`);
        assert.ok(content.includes('name="twitter:card"'), `${file} must contain twitter:card`);
      }
    });

    it('verifies private routes contain noindex robots directive', () => {
      const privateFiles = ['app.html', 'account.html', 'reset-password.html', 'verify-email.html', '404.html'];
      for (const file of privateFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(content.includes('name="robots" content="noindex'), `${file} must contain noindex directive`);
      }
    });

    it('verifies exactly one single h1 element per page across all 17 HTML files', () => {
      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const h1Count = (content.match(/<h1[\s>]/gi) || []).length;
        assert.strictEqual(h1Count, 1, `${file} must have exactly one <h1> heading (found ${h1Count})`);
      }
    });
  });

  // ========================================================
  // 6. FAVICON & ASSETS
  // ========================================================
  describe('6. Favicon & Visual Assets', () => {
    it('verifies favicon files exist in root and dist', () => {
      const faviconFiles = ['favicon.svg', 'favicon.ico', 'favicon.png'];
      for (const fav of faviconFiles) {
        assert.ok(fs.existsSync(path.join(rootDir, fav)), `${fav} must exist in root`);
        assert.ok(fs.existsSync(path.join(distDir, fav)), `${fav} must exist in dist`);
        const stats = fs.statSync(path.join(rootDir, fav));
        assert.ok(stats.size > 0, `${fav} must not be empty`);
      }
    });

    it('verifies every HTML file references the favicon', () => {
      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(content.includes('href="/favicon.svg"'), `${file} must link to /favicon.svg`);
        assert.ok(content.includes('href="/favicon.ico"'), `${file} must link to /favicon.ico`);
      }
    });

    it('verifies og-image.jpg exists in root and dist with reasonable size', () => {
      assert.ok(fs.existsSync(path.join(rootDir, 'og-image.jpg')), 'og-image.jpg must exist in root');
      assert.ok(fs.existsSync(path.join(distDir, 'og-image.jpg')), 'og-image.jpg must exist in dist');
      const stats = fs.statSync(path.join(rootDir, 'og-image.jpg'));
      assert.ok(stats.size > 10000, 'og-image.jpg must be substantial');
      assert.ok(stats.size < 1000000, 'og-image.jpg must be optimized under 1MB');
    });
  });

  // ========================================================
  // 7. CUSTOM 404 & NAVIGATION
  // ========================================================
  describe('7. Custom 404 & Navigation', () => {
    it('verifies 404.html exists in root and dist and provides theme and return navigation', () => {
      assert.ok(fs.existsSync(path.join(rootDir, '404.html')), '404.html must exist in root');
      assert.ok(fs.existsSync(path.join(distDir, '404.html')), '404.html must exist in dist');

      const content = fs.readFileSync(path.join(rootDir, '404.html'), 'utf8');
      assert.ok(content.includes('404'), '404.html must display 404 status');
      assert.ok(content.includes('chorematrix_theme'), '404.html must support theme switching');
      assert.ok(content.includes('href="/"'), '404.html must link back to homepage');
      assert.ok(content.includes('href="/how-it-works.html"'), '404.html must link to how-it-works');
      assert.ok(content.includes('href="/faq.html"'), '404.html must link to FAQ');
    });
  });

  // ========================================================
  // 8. BROKEN LINKS AUDIT
  // ========================================================
  describe('8. Internal Link Integrity', () => {
    it('verifies all internal href links across all HTML files resolve to existing files', () => {
      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const hrefMatches = content.matchAll(/href=["'](\/[^"'#?]*)/g);
        for (const m of hrefMatches) {
          const target = m[1];
          if (target === '/') continue;
          const targetFile = target.slice(1);
          const exists =
            fs.existsSync(path.join(rootDir, targetFile)) ||
            fs.existsSync(path.join(rootDir, targetFile + '.html'));
          assert.ok(exists, `In ${file}: broken internal link to "${target}"`);
        }
      }
    });
  });

  // ========================================================
  // 9. PERFORMANCE & BUNDLE BUDGETS
  // ========================================================
  describe('9. Production Performance & Bundle Budgets', () => {
    it('verifies bundle and stylesheet sizes are within production budgets', () => {
      const optimizerBundle = path.join(distDir, 'optimizer.bundle.js');
      const clientBundle = path.join(distDir, 'src', 'client.bundle.js');
      const commonCss = path.join(distDir, 'src', 'styles', 'common.css');

      assert.ok(fs.existsSync(optimizerBundle), 'optimizer.bundle.js must exist');
      assert.ok(fs.existsSync(clientBundle), 'client.bundle.js must exist');
      assert.ok(fs.existsSync(commonCss), 'common.css must exist');

      const optSize = fs.statSync(optimizerBundle).size;
      const clientSize = fs.statSync(clientBundle).size;
      const cssSize = fs.statSync(commonCss).size;

      assert.ok(optSize < 50000, `optimizer.bundle.js (${optSize} bytes) exceeds budget of 50KB`);
      assert.ok(clientSize < 900000, `client.bundle.js (${clientSize} bytes) exceeds budget of 900KB`);
      assert.ok(cssSize < 25000, `common.css (${cssSize} bytes) exceeds budget of 25KB`);
    });
  });
});
