import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { AuthService } from '../../src/auth/session.ts';
import {
  MARKETING_EMAILS_ENABLED,
  MARKETING_EMAIL_CONFIG,
  canSendMarketingEmail,
  sendMarketingEmailGuard
} from '../../src/config/email.ts';
import { PRICING_CONFIG } from '../../src/config/pricing.ts';
import { runOptimization } from '../../src/optimizer/engine.ts';
import type { OptimizationRequest } from '../../src/optimizer/types.ts';

describe('Legal, Privacy & Product-Security Hardening Suite', () => {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');

  // ========================================================
  // 1. AGE & CHILD ACCESS HARDENING
  // ========================================================
  describe('1. Age & Child Access Hardening', () => {
    it('age gate rejects under 13 and blocks Supabase Auth user creation', async () => {
      let clientSignUpCalled = false;
      class MockAuthClient {
        auth = {
          signUp: async () => {
            clientSignUpCalled = true;
            return { data: { user: { id: 'u_123' }, session: null }, error: null };
          }
        };
      }

      const authService = new (class extends AuthService {
        protected override get client(): any {
          return new MockAuthClient();
        }
      })();

      // Under 13 must be rejected
      await assert.rejects(
        async () => {
          await authService.signUp('teen@example.com', 'password123', { isAtLeast13: false });
        },
        /ChoreMatrix accounts are currently available only to users aged 13 and older/,
        'Under-13 signup must throw an explicit age restriction error'
      );

      assert.strictEqual(clientSignUpCalled, false, 'Under-13 request must never call client auth.signUp');
    });

    it('age gate accepts 13+ users and proceeds with signup', async () => {
      let clientSignUpCalled = false;
      class MockAuthClient {
        auth = {
          signUp: async () => {
            clientSignUpCalled = true;
            return { data: { user: { id: 'u_valid' }, session: null }, error: null };
          }
        };
      }

      const authService = new (class extends AuthService {
        protected override get client(): any {
          return new MockAuthClient();
        }
      })();

      const result = await authService.signUp('adult@example.com', 'password123', { isAtLeast13: true });
      assert.strictEqual(clientSignUpCalled, true, '13+ signup must call client auth.signUp');
      assert.ok(result.user, '13+ signup returns user object');
    });

    it('signup.html contains 13+ age gate checkbox and under-13 safe exit notice', () => {
      const signupHtml = fs.readFileSync(path.join(rootDir, 'signup.html'), 'utf8');
      assert.ok(signupHtml.includes('Are you at least 13 years old?'), 'signup.html must display age question');
      assert.ok(signupHtml.includes('id="chkAgeGate"'), 'signup.html must contain age gate checkbox');
      assert.ok(signupHtml.includes('Yes, I am 13 or older.'), 'signup.html must have exact required checkbox label');
      assert.ok(signupHtml.includes('under13Notice'), 'signup.html must contain under-13 notice container');
      assert.ok(signupHtml.includes('Return to Home / Browser Planning'), 'signup.html must provide safe exit link');
    });

    it('child household member role functions in the optimizer without creating child accounts', () => {
      const householdRequest: OptimizationRequest = {
        household: {
          id: 'h_family_test',
          name: 'Family Test Household',
          type: 'family',
          mode: 'capacity_aware',
          planningHorizonWeeks: 1
        },
        members: [
          {
            id: 'm_adult',
            name: 'Parent Adult',
            role: 'Adult',
            weeklyCapacityMinutes: 300,
            unavailableDays: []
          },
          {
            id: 'm_child',
            name: 'Child Member',
            role: 'Child',
            weeklyCapacityMinutes: 60,
            unavailableDays: []
          }
        ],
        tasks: [
          {
            id: 't_simple',
            name: 'Put Toys Away',
            category: 'Tidying',
            frequencyPerWeek: 3,
            durationMinutes: 15,
            effortLevel: 1,
            eligibleMemberIds: ['m_adult', 'm_child']
          },
          {
            id: 't_heavy',
            name: 'Mow Lawn',
            category: 'Yard',
            frequencyPerWeek: 1,
            durationMinutes: 60,
            effortLevel: 4,
            eligibleMemberIds: ['m_adult'] // Child excluded
          }
        ]
      };

      const result = runOptimization(householdRequest);
      assert.strictEqual(result.unassignedTasks.length, 0, 'All tasks should be successfully allocated');

      const childSummary = result.memberSummaries.find(m => m.memberId === 'm_child');
      assert.ok(childSummary, 'Child member summary must be present');
      assert.strictEqual(childSummary.role, 'Child', 'Child role must be preserved');

      // Verify child never receives t_heavy
      const childAssignments = result.assignments.filter(a => a.memberId === 'm_child');
      for (const a of childAssignments) {
        assert.notStrictEqual(a.taskId, 't_heavy', 'Child must never receive heavy/ineligible chore');
      }
    });

    it('child household member data remains protected by existing RLS policies in schema', () => {
      const schemaSql = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '01_initial_schema.sql'), 'utf8');
      assert.ok(schemaSql.includes('alter table public.members enable row level security;'), 'members table must have RLS enabled');
      assert.ok(schemaSql.includes('create policy "Users can view own members"'), 'members table must have view policy');
      assert.ok(schemaSql.includes('auth.uid() = user_id'), 'members RLS must restrict access to auth.uid()');
    });

    it('household member UI displays explicit child privacy guidance notice', () => {
      const appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf8');
      const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

      const expectedNotice = 'Children can be included as household members, but ChoreMatrix accounts are for users 13+. For privacy, consider using a nickname or household label instead of a child\'s full name.';
      assert.ok(appHtml.includes(expectedNotice), 'app.html must include child privacy guidance');
      assert.ok(indexHtml.includes(expectedNotice), 'index.html must include child privacy guidance');
    });
  });

  // ========================================================
  // 2. FONT & THIRD-PARTY RESOURCE AUDIT
  // ========================================================
  describe('2. Font & Third-Party Resource Audit', () => {
    it('guarantees Google Fonts and external font CDNs are absent from all HTML files and common CSS', () => {
      const filesToScan = [
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
        'app.html',
        'src/styles/common.css'
      ];

      for (const relPath of filesToScan) {
        const fullPath = path.join(rootDir, relPath);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          assert.ok(!content.includes('fonts.googleapis.com'), `${relPath} must not reference fonts.googleapis.com`);
          assert.ok(!content.includes('fonts.gstatic.com'), `${relPath} must not reference fonts.gstatic.com`);
          assert.ok(!content.includes('@import url'), `${relPath} must not import external stylesheets`);
        }
      }
    });

    it('guarantees common.css uses a clean system font stack', () => {
      const cssContent = fs.readFileSync(path.join(rootDir, 'src', 'styles', 'common.css'), 'utf8');
      assert.ok(cssContent.includes('font-family: -apple-system, BlinkMacSystemFont'), 'common.css must use system font stack');
    });
  });

  // ========================================================
  // 3. SESSION REPLAY & RECORDING AUDIT
  // ========================================================
  describe('3. Session Replay & Recording Audit', () => {
    it('verifies that no session replay SDKs or recording scripts exist in repository HTML or client bundle', () => {
      const bannedReplaySignatures = [
        'hotjar',
        'static.hotjar.com',
        'fullstory.com',
        'fs.js',
        'logrocket.min.js',
        'clarity.ms',
        'posthog.com/static',
        'smartlook.com',
        'mouseflow.com',
        'openreplay.com',
        'sentry.io/replay'
      ];

      const scanFiles = [
        'src/client.ts',
        'src/client.bundle.js',
        'index.html',
        'app.html',
        'signup.html',
        'login.html',
        'account.html',
        'faq.html'
      ];

      for (const file of scanFiles) {
        const fullPath = path.join(rootDir, file);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
          for (const signature of bannedReplaySignatures) {
            assert.ok(
              !content.includes(signature),
              `File ${file} must not contain session replay signature: ${signature}`
            );
          }
        }
      }
    });

    it('verifies password and credential fields are never exposed to tracking', () => {
      const authFiles = ['login.html', 'signup.html', 'account.html', 'reset-password.html'];
      for (const file of authFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(content.includes('type="password"'), `${file} must use secure password inputs`);
        assert.ok(!content.includes('data-analytics'), `${file} must not tag passwords with analytics attributes`);
      }
    });
  });

  // ========================================================
  // 4. EMAIL & CAN-SPAM HARDENING
  // ========================================================
  describe('4. Email & CAN-SPAM Hardening', () => {
    it('guarantees marketing emails are disabled by default', () => {
      assert.strictEqual(MARKETING_EMAILS_ENABLED, false, 'MARKETING_EMAILS_ENABLED must be false');
      assert.strictEqual(MARKETING_EMAIL_CONFIG.marketingEmailsEnabled, false, 'marketingEmailsEnabled config must be false');
      assert.strictEqual(canSendMarketingEmail(), false, 'canSendMarketingEmail() must return false with default config');
    });

    it('guard function blocks marketing email dispatch and throws refusal error', () => {
      assert.throws(
        () => {
          sendMarketingEmailGuard('user@example.com', 'newsletter_v1');
        },
        /\[Marketing Email Refusal\]/,
        'sendMarketingEmailGuard must throw refusal error when marketing emails are disabled'
      );
    });

    it('canSendMarketingEmail rejects placeholder credentials and missing postal address', () => {
      const invalidConfig = {
        marketingEmailsEnabled: true,
        senderName: 'ChoreMatrix Team',
        senderEmail: 'support@chorematrix.com', // Placeholder address prohibited
        physicalPostalAddress: '[Registered Business Address Placeholder]', // Placeholder address prohibited
        hasUnsubscribeMechanism: true,
        hasSuppressionList: true
      };

      assert.strictEqual(
        canSendMarketingEmail(invalidConfig),
        false,
        'Marketing email must be refused if sender email or postal address is a placeholder'
      );
    });
  });

  // ========================================================
  // 5. SUBSCRIPTION & AUTO-RENEWAL HARDENING
  // ========================================================
  describe('5. Subscription & Auto-Renewal Hardening', () => {
    it('PRICING_CONFIG defines comprehensive plan data including auto-renewal and cancellation details', () => {
      assert.ok(PRICING_CONFIG.tiers.length >= 3, 'Pricing config must define all tiers');

      for (const tier of PRICING_CONFIG.tiers) {
        assert.ok(tier.name, 'Plan name must be defined');
        assert.ok(typeof tier.monthlyPrice === 'number', 'Price must be a number');
        assert.ok(Array.isArray(tier.billingIntervals), 'Billing intervals must be defined');
        assert.ok(typeof tier.trialDays === 'number', 'Trial duration must be defined');
        assert.ok(typeof tier.monthlyRenewalAmount === 'number', 'Renewal amount must be defined');
        assert.ok(tier.renewalInterval, 'Renewal interval must be defined');
        assert.ok(tier.cancellationMethod, 'Cancellation method must be defined');
        assert.ok(tier.checkoutDisclosures, 'Checkout disclosures must be defined');
        assert.ok(typeof tier.checkoutDisclosures.chargedToday === 'number', 'Amount charged today must be defined');
        assert.ok(tier.checkoutDisclosures.renewalBehavior, 'Renewal behavior must be defined');
        assert.ok(tier.checkoutDisclosures.cancellationMethod, 'Cancellation method must be defined');
      }
    });

    it('pricing.html renders clear informational pricing notices without fake checkout flows', () => {
      const pricingHtml = fs.readFileSync(path.join(rootDir, 'pricing.html'), 'utf8');
      assert.ok(pricingHtml.includes('autoRenewalPolicyContent'), 'pricing.html must include auto-renewal policy container');
      assert.ok(pricingHtml.includes('Renewal & Billing Terms'), 'pricing.html must render renewal terms in card');
      assert.ok(pricingHtml.includes('PRICING_CONFIG.autoRenewalPolicyNotice'), 'pricing.html must bind auto-renewal policy notice');
      assert.ok(pricingHtml.includes('Subscription Auto-Renewal, Merchant of Record & Cancellation Disclosure'), 'pricing.html must emphasize transparent renewal and disclosure');
    });
  });

  // ========================================================
  // 6. DMCA & USER-GENERATED CONTENT AUDIT
  // ========================================================
  describe('6. DMCA & User-Generated Content Audit', () => {
    it('verifies that no file upload controls exist in the application', () => {
      const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
      for (const file of htmlFiles) {
        const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
        assert.ok(!content.includes('type="file"'), `${file} must not contain <input type="file">`);
      }
    });
  });

  // ========================================================
  // 7. SECURITY & SECRETS AUDIT
  // ========================================================
  describe('7. Security & Secrets Audit', () => {
    it('.env.local is gitignored and .env.example contains only placeholders', () => {
      const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
      assert.ok(gitignore.includes('.env') || gitignore.includes('.env.*'), '.gitignore must ignore .env files');

      const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
      assert.ok(envExample.includes('https://your-project-id.supabase.co'), '.env.example must have placeholder URL');
      assert.ok(envExample.includes('sb_pub_your-publishable-key-here'), '.env.example must have placeholder key');
      assert.ok(!envExample.includes('SERVICE_ROLE'), '.env.example must not reference service-role keys');
    });

    it('dist directory contains no secret keys or .env files', () => {
      if (fs.existsSync(distDir)) {
        const distFiles = fs.readdirSync(distDir);
        assert.ok(!distFiles.includes('.env'), 'dist/ must not contain .env');
        assert.ok(!distFiles.includes('.env.local'), 'dist/ must not contain .env.local');

        const bundlePath = path.join(distDir, 'src', 'client.bundle.js');
        if (fs.existsSync(bundlePath)) {
          const bundleContent = fs.readFileSync(bundlePath, 'utf8');
          assert.ok(!bundleContent.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Bundle must not include service role key');
          assert.ok(!bundleContent.includes('SERVICE_ROLE_KEY'), 'Bundle must not include SERVICE_ROLE_KEY');
        }
      }
    });
  });
});
