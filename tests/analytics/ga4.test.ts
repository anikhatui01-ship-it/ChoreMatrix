import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GA_MEASUREMENT_ID,
  GA4_SCRIPT_ID,
  initGoogleAnalytics,
  isGA4Initialized,
  isSensitiveKey,
  sanitizeParamValue,
  sanitizeParams,
  sanitizeUrl,
  trackEvent,
  trackPageView
} from '../../src/analytics/ga4.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const distDir = path.join(rootDir, 'dist');

describe('Google Analytics 4 (GA4) Integration Suite', () => {

  describe('1. Configuration & Measurement ID', () => {
    it('uses the exact expected Measurement ID G-M0CEPNN7S3', () => {
      assert.strictEqual(GA_MEASUREMENT_ID, 'G-M0CEPNN7S3');
    });

    it('verifies client.bundle.js includes GA_MEASUREMENT_ID and ga4-tag-script', () => {
      const clientBundle = fs.readFileSync(path.join(distDir, 'src', 'client.bundle.js'), 'utf8');
      assert.ok(clientBundle.includes('G-M0CEPNN7S3'), 'client.bundle.js must contain G-M0CEPNN7S3');
      assert.ok(clientBundle.includes(GA4_SCRIPT_ID), 'client.bundle.js must contain GA4_SCRIPT_ID');
      assert.ok(clientBundle.includes('googletagmanager.com/gtag/js'), 'client.bundle.js must contain Google Tag URL');
    });
  });

  describe('2. Browser DOM Tag Injection & Idempotent Singleton Guard', () => {
    let mockHeadChildren: any[] = [];
    let mockWindow: any;
    let mockDocument: any;

    beforeEach(() => {
      mockHeadChildren = [];

      mockDocument = {
        getElementById(id: string) {
          return mockHeadChildren.find(el => el.id === id) || null;
        },
        querySelector(selector: string) {
          if (selector.includes('googletagmanager.com')) {
            return mockHeadChildren.find(el => el.src && el.src.includes('googletagmanager.com')) || null;
          }
          return null;
        },
        createElement(tagName: string) {
          return { tagName: tagName.toLowerCase(), id: '', async: false, src: '' };
        },
        head: {
          appendChild(node: any) {
            mockHeadChildren.push(node);
            return node;
          }
        },
        documentElement: {},
        body: {}
      };

      mockWindow = {
        location: {
          href: 'https://chorematrix.com/app.html?plan=pro',
          origin: 'https://chorematrix.com',
          pathname: '/app.html'
        }
      };

      // Set global browser mocks
      (global as any).window = mockWindow;
      (global as any).document = mockDocument;
    });

    it('injects the script tag exactly once with correct attributes', () => {
      const result = initGoogleAnalytics();
      assert.strictEqual(result, true, 'First initialization must return true');

      const injectedScripts = mockHeadChildren.filter(el => el.id === GA4_SCRIPT_ID);
      assert.strictEqual(injectedScripts.length, 1, 'Exactly one GA4 script tag must be injected');
      assert.strictEqual(injectedScripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-M0CEPNN7S3');
      assert.strictEqual(injectedScripts[0].async, true, 'Script must be marked async');
      assert.strictEqual(isGA4Initialized(), true, 'isGA4Initialized() must return true');
    });

    it('prevents duplicate tag injection when initGoogleAnalytics is called multiple times', () => {
      const firstResult = initGoogleAnalytics();
      assert.strictEqual(firstResult, true);

      // Call it 5 more times (simulating re-renders, SPA navigations, or redundant module loads)
      for (let i = 0; i < 5; i++) {
        const subsequentResult = initGoogleAnalytics();
        assert.strictEqual(subsequentResult, false, `Subsequent call ${i} must return false`);
      }

      const scriptCount = mockHeadChildren.filter(el => el.id === GA4_SCRIPT_ID).length;
      assert.strictEqual(scriptCount, 1, 'Script tag count must strictly remain 1 even after multiple calls');
    });

    it('configures gtag with required privacy protections and dataLayer', () => {
      initGoogleAnalytics();

      assert.ok(Array.isArray(mockWindow.dataLayer), 'dataLayer must be initialized as an array');
      assert.strictEqual(typeof mockWindow.gtag, 'function', 'window.gtag must be a callable function');

      // Check config calls recorded in dataLayer
      const configCall = mockWindow.dataLayer.find((call: any[]) => call[0] === 'config');
      assert.ok(configCall, 'gtag config call must exist in dataLayer');
      assert.strictEqual(configCall[1], 'G-M0CEPNN7S3');

      const options = configCall[2];
      assert.strictEqual(options.anonymize_ip, true, 'anonymize_ip must be true');
      assert.strictEqual(options.allow_google_signals, false, 'allow_google_signals must be false');
      assert.strictEqual(options.allow_ad_personalization_signals, false, 'allow_ad_personalization_signals must be false');
      assert.strictEqual(options.restricted_data_processing, true, 'restricted_data_processing must be true');
    });

    it('returns false in non-browser Node.js environment without throwing errors', () => {
      delete (global as any).window;
      delete (global as any).document;

      assert.strictEqual(initGoogleAnalytics(), false, 'initGoogleAnalytics must return false in Node.js');
      assert.strictEqual(isGA4Initialized(), false, 'isGA4Initialized must return false in Node.js');
    });
  });

  describe('3. PII & Sensitive Data Sanitization', () => {
    it('identifies sensitive keys accurately', () => {
      const sensitiveKeys = [
        'password', 'user_password', 'pwd', 'token', 'access_token', 'refresh_token',
        'auth_token', 'secret', 'email', 'user_email', 'subscription_id', 'sub_id',
        'card_number', 'cvv', 'cvc', 'payment_id', 'household_name', 'member_name'
      ];
      for (const key of sensitiveKeys) {
        assert.strictEqual(isSensitiveKey(key), true, `Key ${key} must be recognized as sensitive`);
      }

      const safeKeys = ['page_title', 'plan_tier', 'optimizer_step', 'theme_mode', 'click_target'];
      for (const key of safeKeys) {
        assert.strictEqual(isSensitiveKey(key), false, `Key ${key} must be recognized as safe`);
      }
    });

    it('redacts email addresses from string parameter values', () => {
      const valWithEmail = 'Contact support at user@example.com for help';
      const sanitized = sanitizeParamValue(valWithEmail);
      assert.strictEqual(sanitized, 'Contact support at [REDACTED_EMAIL] for help');
    });

    it('redacts JWT tokens from string parameter values', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature';
      const sanitized = sanitizeParamValue(jwtToken);
      assert.strictEqual(sanitized, '[REDACTED_TOKEN]');
    });

    it('strips all sensitive keys and sanitizes values in sanitizeParams', () => {
      const rawParams = {
        plan: 'pro',
        email: 'alice@domain.org',
        password: 'superSecretPassword123',
        subscription_id: 'sub_live_9999',
        card: '4111222233334444',
        theme: 'dark',
        note: 'Sent message to bob@family.net'
      };

      const cleaned = sanitizeParams(rawParams);

      assert.strictEqual(cleaned.plan, 'pro');
      assert.strictEqual(cleaned.theme, 'dark');
      assert.strictEqual(cleaned.note, 'Sent message to [REDACTED_EMAIL]');
      assert.strictEqual(cleaned.email, undefined, 'email must be completely stripped');
      assert.strictEqual(cleaned.password, undefined, 'password must be completely stripped');
      assert.strictEqual(cleaned.subscription_id, undefined, 'subscription_id must be completely stripped');
      assert.strictEqual(cleaned.card, undefined, 'card must be completely stripped');
    });

    it('strips auth tokens, credentials, and email query params from URL in sanitizeUrl', () => {
      const unsafeUrl1 = 'https://chorematrix.com/reset-password.html?token=super_secret_reset_token&email=test@example.com';
      const safeUrl1 = sanitizeUrl(unsafeUrl1);
      assert.ok(!safeUrl1.includes('token='), 'token must be stripped');
      assert.ok(!safeUrl1.includes('test@example.com'), 'email must be stripped');
      assert.strictEqual(safeUrl1, 'https://chorematrix.com/reset-password.html');

      const unsafeUrl2 = 'https://chorematrix.com/login.html#access_token=eyJhbGciOi...&type=recovery';
      const safeUrl2 = sanitizeUrl(unsafeUrl2);
      assert.ok(!safeUrl2.includes('access_token'), 'hash tokens must be stripped');
      assert.strictEqual(safeUrl2, 'https://chorematrix.com/login.html');
    });
  });

  describe('4. Safe Event & PageView Tracking', () => {
    it('trackEvent safely sanitizes event names and payloads before pushing to dataLayer', () => {
      const mockDataLayer: any[] = [];
      (global as any).window = {
        dataLayer: mockDataLayer,
        gtag: function(...args: any[]) {
          mockDataLayer.push(args);
        }
      };

      trackEvent('user_action!test@123', {
        step: 2,
        email: 'attacker@evil.com',
        category: 'workflow'
      });

      assert.strictEqual(mockDataLayer.length, 1);
      const call = mockDataLayer[0];
      assert.strictEqual(call[0], 'event');
      assert.strictEqual(call[1], 'user_action_test_123'); // Sanitized event name
      assert.deepStrictEqual(call[2], { step: 2, category: 'workflow' }); // email removed

      delete (global as any).window;
    });

    it('trackPageView sanitizes page_location and restricts page_title length', () => {
      const mockDataLayer: any[] = [];
      (global as any).window = {
        location: {
          origin: 'https://chorematrix.com',
          href: 'https://chorematrix.com/app.html?token=secret123'
        },
        dataLayer: mockDataLayer,
        gtag: function(...args: any[]) {
          mockDataLayer.push(args);
        }
      };

      trackPageView();

      assert.strictEqual(mockDataLayer.length, 1);
      const call = mockDataLayer[0];
      assert.strictEqual(call[0], 'event');
      assert.strictEqual(call[1], 'page_view');
      assert.strictEqual(call[2].page_location, 'https://chorematrix.com/app.html');

      delete (global as any).window;
    });
  });

  describe('5. Architecture & Bundle Verification', () => {
    it('verifies all 17 public/app HTML pages import client.bundle.js', () => {
      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      assert.ok(htmlFiles.length >= 17, 'Must have at least 17 HTML files');

      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(
          content.includes('client.bundle.js'),
          `${file} must import client.bundle.js to participate in shared analytics and runtime`
        );
      }
    });

    it('verifies no private API keys or secrets are contained in ga4.ts or client.bundle.js', () => {
      const forbiddenSecrets = [
        'SUPABASE_SERVICE_ROLE_KEY',
        'PADDLE_API_KEY',
        'PADDLE_WEBHOOK_SECRET',
        'SECRET_KEY',
        'PRIVATE_KEY'
      ];

      const ga4Source = fs.readFileSync(path.join(rootDir, 'src', 'analytics', 'ga4.ts'), 'utf8');
      const clientBundle = fs.readFileSync(path.join(distDir, 'src', 'client.bundle.js'), 'utf8');

      for (const secret of forbiddenSecrets) {
        assert.ok(!ga4Source.includes(secret), `ga4.ts must not contain ${secret}`);
        assert.ok(!clientBundle.includes(secret), `client.bundle.js must not contain ${secret}`);
      }
    });
  });
});
