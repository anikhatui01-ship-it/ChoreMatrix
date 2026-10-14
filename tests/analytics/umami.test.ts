import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UMAMI_WEBSITE_ID,
  UMAMI_SCRIPT_URL,
  UMAMI_SCRIPT_ID,
  initUmamiAnalytics,
  isUmamiInitialized,
  removeUmamiScript,
  hasAnalyticsConsent,
  isSensitiveUmamiKey,
  sanitizeUmamiValue,
  sanitizeUmamiData,
  sanitizeUmamiUrl,
  trackUmamiEvent,
  trackUmamiPageView
} from '../../src/analytics/umami.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const distDir = path.join(rootDir, 'dist');

describe('Umami Analytics Integration Suite', () => {

  describe('1. Configuration & Constants', () => {
    it('uses exact Umami Cloud script URL and Website ID', () => {
      assert.strictEqual(UMAMI_WEBSITE_ID, 'a6b2b202-d0c6-4383-a864-7b683fc1285f');
      assert.strictEqual(UMAMI_SCRIPT_URL, 'https://cloud.umami.is/script.js');
      assert.strictEqual(UMAMI_SCRIPT_ID, 'umami-tracking-script');
    });

    it('verifies client.bundle.js includes Umami constants after build', () => {
      const clientBundle = fs.readFileSync(path.join(distDir, 'src', 'client.bundle.js'), 'utf8');
      assert.ok(clientBundle.includes('a6b2b202-d0c6-4383-a864-7b683fc1285f'), 'client.bundle.js must contain Website ID');
      assert.ok(clientBundle.includes('cloud.umami.is/script.js'), 'client.bundle.js must contain Umami script URL');
      assert.ok(clientBundle.includes(UMAMI_SCRIPT_ID), 'client.bundle.js must contain UMAMI_SCRIPT_ID');
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
          if (selector.includes('cloud.umami.is')) {
            return mockHeadChildren.find(el => el.src && el.src.includes('cloud.umami.is')) || null;
          }
          if (selector.includes('data-website-id')) {
            return mockHeadChildren.find(el => el.dataset?.websiteId === UMAMI_WEBSITE_ID || el.attributes?.['data-website-id'] === UMAMI_WEBSITE_ID) || null;
          }
          return null;
        },
        createElement(tagName: string) {
          const el: any = {
            tagName: tagName.toLowerCase(),
            id: '',
            defer: false,
            src: '',
            dataset: {},
            attributes: {},
            setAttribute(k: string, v: string) {
              this.attributes[k] = v;
              if (k.startsWith('data-')) {
                const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                this.dataset[camel] = v;
              }
            },
            parentNode: null
          };
          return el;
        },
        head: {
          appendChild(node: any) {
            node.parentNode = mockDocument.head;
            mockHeadChildren.push(node);
            return node;
          },
          removeChild(node: any) {
            const idx = mockHeadChildren.indexOf(node);
            if (idx > -1) mockHeadChildren.splice(idx, 1);
            return node;
          }
        },
        documentElement: {},
        body: {}
      };

      mockWindow = {
        location: {
          href: 'https://chorematrix.online/app.html',
          origin: 'https://chorematrix.online',
          pathname: '/app.html'
        }
      };

      (global as any).window = mockWindow;
      (global as any).document = mockDocument;
    });

    it('injects Umami script tag with defer and correct attributes when consent is forced', () => {
      const injected = initUmamiAnalytics({ forceConsent: true });
      assert.strictEqual(injected, true, 'First initialization must return true');

      const injectedScripts = mockHeadChildren.filter(el => el.id === UMAMI_SCRIPT_ID);
      assert.strictEqual(injectedScripts.length, 1, 'Exactly one script tag must be injected');
      assert.strictEqual(injectedScripts[0].src, 'https://cloud.umami.is/script.js');
      assert.strictEqual(injectedScripts[0].defer, true, 'Script must have defer attribute');
      assert.strictEqual(injectedScripts[0].attributes['data-website-id'], 'a6b2b202-d0c6-4383-a864-7b683fc1285f');
      assert.strictEqual(isUmamiInitialized(), true, 'isUmamiInitialized must return true');
    });

    it('strictly prevents duplicate script injection across multiple sequential calls', () => {
      const first = initUmamiAnalytics({ forceConsent: true });
      assert.strictEqual(first, true);

      // Multiple subsequent calls (re-renders, navigation)
      for (let i = 0; i < 5; i++) {
        const subsequent = initUmamiAnalytics({ forceConsent: true });
        assert.strictEqual(subsequent, false, `Call ${i + 1} must return false`);
      }

      const scriptCount = mockHeadChildren.filter(el => el.id === UMAMI_SCRIPT_ID).length;
      assert.strictEqual(scriptCount, 1, 'Total script tags must remain exactly 1');
    });

    it('safely removes script tag and resets state on removeUmamiScript', () => {
      initUmamiAnalytics({ forceConsent: true });
      assert.strictEqual(isUmamiInitialized(), true);

      const removed = removeUmamiScript();
      assert.strictEqual(removed, true, 'removeUmamiScript should return true');
      assert.strictEqual(mockHeadChildren.length, 0, 'Head children must be empty after removal');
      assert.strictEqual(isUmamiInitialized(), false, 'isUmamiInitialized should return false');
    });

    it('returns false cleanly in non-browser Node.js environment without throwing', () => {
      delete (global as any).window;
      delete (global as any).document;

      assert.strictEqual(initUmamiAnalytics(), false);
      assert.strictEqual(isUmamiInitialized(), false);
      assert.strictEqual(removeUmamiScript(), false);
    });
  });

  describe('3. Consent Preference Enforcement', () => {
    let mockStorage: Record<string, string> = {};

    beforeEach(() => {
      mockStorage = {};
      (global as any).window = {
        localStorage: {
          getItem: (k: string) => mockStorage[k] || null,
          setItem: (k: string, v: string) => { mockStorage[k] = v; },
          removeItem: (k: string) => { delete mockStorage[k]; }
        }
      };
      (global as any).document = {
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({ setAttribute: () => {}, dataset: {}, attributes: {} }),
        head: { appendChild: (n: any) => n }
      };
    });

    it('refuses to initialize if cookie consent is not yet decided (null)', () => {
      assert.strictEqual(hasAnalyticsConsent(), false);
      const initialized = initUmamiAnalytics();
      assert.strictEqual(initialized, false, 'Must not initialize when consent is null');
    });

    it('refuses to initialize when user explicitly rejects analytics', () => {
      mockStorage['chorematrix_cookie_consent'] = JSON.stringify({
        strictlyNecessary: true,
        preferences: true,
        analytics: false,
        marketing: false,
        decidedAt: new Date().toISOString()
      });

      assert.strictEqual(hasAnalyticsConsent(), false);
      const initialized = initUmamiAnalytics();
      assert.strictEqual(initialized, false, 'Must not initialize when analytics is false');
    });

    it('initializes successfully when user explicitly grants analytics consent', () => {
      mockStorage['chorematrix_cookie_consent'] = JSON.stringify({
        strictlyNecessary: true,
        preferences: true,
        analytics: true,
        marketing: false,
        decidedAt: new Date().toISOString()
      });

      assert.strictEqual(hasAnalyticsConsent(), true);
      const initialized = initUmamiAnalytics();
      assert.strictEqual(initialized, true, 'Must initialize when analytics is true');
    });
  });

  describe('4. PII and Sensitive Data Sanitization', () => {
    it('detects sensitive keys that could contain household, chore, or auth details', () => {
      const sensitiveKeys = [
        'password', 'pwd', 'secret', 'token', 'access_token', 'jwt',
        'email', 'user_email', 'member_name', 'household_name', 'task_name',
        'chore_description', 'card_number', 'cvv', 'billing_address', 'customer_id'
      ];
      for (const k of sensitiveKeys) {
        assert.strictEqual(isSensitiveUmamiKey(k), true, `Key ${k} must be recognized as sensitive`);
      }

      const safeKeys = [
        'step', 'category', 'plan_tier', 'member_count', 'task_count',
        'fairness_score', 'horizon_weeks', 'theme_mode', 'click_target'
      ];
      for (const k of safeKeys) {
        assert.strictEqual(isSensitiveUmamiKey(k), false, `Key ${k} must be recognized as safe`);
      }
    });

    it('redacts email addresses and JWT tokens in parameter values', () => {
      const emailVal = 'Please contact support@chorematrix.online for help';
      assert.strictEqual(sanitizeUmamiValue(emailVal), 'Please contact [REDACTED_EMAIL] for help');

      const tokenVal = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fakeSig';
      assert.strictEqual(sanitizeUmamiValue(tokenVal), '[REDACTED_TOKEN]');
    });

    it('strips all sensitive keys and sanitizes values in sanitizeUmamiData', () => {
      const rawData = {
        member_count: 2,
        task_count: 8,
        plan_tier: 'free',
        member_name: 'Alice Smith',
        chore_description: 'Scrub the kitchen sink',
        password: 'password123',
        customer_id: 'cus_99999',
        note: 'Sent report to admin@family.org'
      };

      const clean = sanitizeUmamiData(rawData);
      assert.strictEqual(clean.member_count, 2);
      assert.strictEqual(clean.task_count, 8);
      assert.strictEqual(clean.plan_tier, 'free');
      assert.strictEqual(clean.note, 'Sent report to [REDACTED_EMAIL]');
      assert.strictEqual(clean.member_name, undefined, 'member_name must be stripped');
      assert.strictEqual(clean.chore_description, undefined, 'chore_description must be stripped');
      assert.strictEqual(clean.password, undefined, 'password must be stripped');
      assert.strictEqual(clean.customer_id, undefined, 'customer_id must be stripped');
    });

    it('trackUmamiEvent enforces consent and scrubs properties before calling window.umami.track', () => {
      const mockCalls: any[] = [];
      (global as any).window = {
        localStorage: {
          getItem: () => JSON.stringify({ analytics: true })
        },
        umami: {
          track: (name: string, data?: any) => {
            mockCalls.push({ name, data });
          }
        }
      };

      trackUmamiEvent('calculator!step.completed', {
        step: 2,
        member_name: 'Secret Member',
        task_count: 5
      });

      assert.strictEqual(mockCalls.length, 1);
      assert.strictEqual(mockCalls[0].name, 'calculator_step_completed');
      assert.deepStrictEqual(mockCalls[0].data, { step: 2, task_count: 5 });
      assert.strictEqual(mockCalls[0].data.member_name, undefined);

      delete (global as any).window;
    });

    it('trackUmamiEvent silently skips when consent is not granted', () => {
      const mockCalls: any[] = [];
      (global as any).window = {
        localStorage: {
          getItem: () => JSON.stringify({ analytics: false }) // Consented = false
        },
        umami: {
          track: (name: string, data?: any) => {
            mockCalls.push({ name, data });
          }
        }
      };

      trackUmamiEvent('test_event', { step: 1 });
      assert.strictEqual(mockCalls.length, 0, 'No event should be tracked without consent');

      delete (global as any).window;
    });

    it('sanitizeUmamiUrl and trackUmamiPageView sanitize URLs by stripping tokens and credentials', () => {
      const unsafeUrl = 'https://chorematrix.online/reset-password.html?token=secret123&email=user@example.com#access_token=jwt456';
      const cleanUrl = sanitizeUmamiUrl(unsafeUrl);
      assert.ok(!cleanUrl.includes('secret123'), 'token must be stripped');
      assert.ok(!cleanUrl.includes('user@example.com'), 'email must be stripped');
      assert.ok(!cleanUrl.includes('jwt456'), 'hash tokens must be stripped');
      assert.strictEqual(cleanUrl, 'https://chorematrix.online/reset-password.html');

      let trackedProps: any = null;
      (global as any).window = {
        localStorage: {
          getItem: () => JSON.stringify({ analytics: true })
        },
        umami: {
          track: (fnOrObj: any) => {
            trackedProps = typeof fnOrObj === 'function' ? fnOrObj({}) : fnOrObj;
          }
        }
      };

      trackUmamiPageView(unsafeUrl, 'Reset Password Page');
      assert.ok(trackedProps, 'trackUmamiPageView must record pageview');
      assert.strictEqual(trackedProps.url, 'https://chorematrix.online/reset-password.html');
      assert.strictEqual(trackedProps.title, 'Reset Password Page');

      delete (global as any).window;
    });
  });
});
