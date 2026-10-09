import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFeedbackInput, submitUserFeedback, type FeedbackSubmission } from '../../src/feedback/feedbackService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 3: Early User Feedback System Tests', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  const appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf-8');
  const feedbackHtml = fs.readFileSync(path.join(rootDir, 'feedback.html'), 'utf-8');
  const migrationSql = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '08_user_feedback.sql'), 'utf-8');

  // ========================================================
  // 1. INPUT VALIDATION TESTS
  // ========================================================
  describe('1. Form Input Validation', () => {
    it('accepts valid minimal anonymous submission', () => {
      const valid: FeedbackSubmission = {
        householdType: 'couple',
      };
      const result = validateFeedbackInput(valid);
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, {});
    });

    it('accepts complete valid feedback submission with rating and email', () => {
      const valid: FeedbackSubmission = {
        householdType: 'family',
        experienceRating: 5,
        usefulFeedback: 'The capacity-aware mode helped us balance chores proportionally.',
        confusingFeedback: 'Took a minute to realize the rebalance button was enabled after calculating.',
        improvementFeedback: 'Would love automated reminder alerts.',
        email: 'user@example.com',
        allowQuote: true,
      };
      const result = validateFeedbackInput(valid);
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, {});
    });

    it('rejects missing or invalid household type', () => {
      const invalid: any = { householdType: 'mansion_residents' };
      const result = validateFeedbackInput(invalid);
      assert.equal(result.valid, false);
      assert.ok(result.errors.householdType);

      const missing: any = {};
      const result2 = validateFeedbackInput(missing);
      assert.equal(result2.valid, false);
      assert.ok(result2.errors.householdType);
    });

    it('rejects rating outside 1..5 range', () => {
      const low: FeedbackSubmission = { householdType: 'couple', experienceRating: 0 };
      const resultLow = validateFeedbackInput(low);
      assert.equal(resultLow.valid, false);
      assert.ok(resultLow.errors.experienceRating);

      const high: FeedbackSubmission = { householdType: 'couple', experienceRating: 6 };
      const resultHigh = validateFeedbackInput(high);
      assert.equal(resultHigh.valid, false);
      assert.ok(resultHigh.errors.experienceRating);
    });

    it('rejects feedback exceeding 2000 characters', () => {
      const oversizedText = 'a'.repeat(2001);
      const invalid: FeedbackSubmission = {
        householdType: 'roommates',
        usefulFeedback: oversizedText,
      };
      const result = validateFeedbackInput(invalid);
      assert.equal(result.valid, false);
      assert.ok(result.errors.usefulFeedback);
    });

    it('rejects malformed email addresses', () => {
      const invalidEmail: FeedbackSubmission = {
        householdType: 'couple',
        email: 'not-an-email',
      };
      const result = validateFeedbackInput(invalidEmail);
      assert.equal(result.valid, false);
      assert.ok(result.errors.email);
    });
  });

  // ========================================================
  // 2. SUBMISSION PAYLOAD & CLIENT HANDLING
  // ========================================================
  describe('2. Client Submission & Privacy Handling', () => {
    it('successfully handles anonymous submissions with mock client', async () => {
      let insertedPayload: any = null;
      const mockClient = {
        from: (table: string) => {
          assert.equal(table, 'user_feedback');
          return {
            insert: async (data: any) => {
              insertedPayload = data;
              return { error: null };
            },
          };
        },
      };

      const submission: FeedbackSubmission = {
        householdType: 'living_alone',
        usefulFeedback: 'Great single user task planner.',
      };

      const result = await submitUserFeedback(submission, null, mockClient);
      assert.equal(result.success, true);
      assert.equal(insertedPayload.user_id, null);
      assert.equal(insertedPayload.household_type, 'living_alone');
      assert.equal(insertedPayload.allow_quote, false);
    });

    it('attaches authenticated user_id when user is logged in', async () => {
      let insertedPayload: any = null;
      const mockClient = {
        from: () => ({
          insert: async (data: any) => {
            insertedPayload = data;
            return { error: null };
          },
        }),
      };

      const submission: FeedbackSubmission = {
        householdType: 'other',
        allowQuote: true,
      };

      const result = await submitUserFeedback(submission, 'usr_123456', mockClient);
      assert.equal(result.success, true);
      assert.equal(insertedPayload.user_id, 'usr_123456');
      assert.equal(insertedPayload.allow_quote, true);
    });

    it('handles backend insertion errors gracefully without crashing', async () => {
      const mockFailingClient = {
        from: () => ({
          insert: async () => ({ error: { message: 'Database connection failed' } }),
        }),
      };

      const submission: FeedbackSubmission = { householdType: 'couple' };
      const result = await submitUserFeedback(submission, null, mockFailingClient);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('Database connection failed'));
    });
  });

  // ========================================================
  // 3. DATABASE MIGRATION & RLS SECURITY AUDIT
  // ========================================================
  describe('3. Database Schema & RLS Policies', () => {
    it('migration 08 enables RLS on public.user_feedback', () => {
      assert.ok(migrationSql.includes('alter table public.user_feedback enable row level security;'));
    });

    it('migration 08 grants insert privilege to anon and authenticated', () => {
      assert.ok(migrationSql.includes('grant insert on public.user_feedback to anon, authenticated;'));
    });

    it('migration 08 disallows public select (no public select policy created)', () => {
      assert.ok(
        !migrationSql.toLowerCase().includes('for select'),
        'Must not grant or create public SELECT policy on user_feedback'
      );
    });
  });

  // ========================================================
  // 4. UI PAGE & INTEGRATION AUDIT
  // ========================================================
  describe('4. Dedicated Page, Footers, and Post-Plan Invitations', () => {
    it('feedback.html exists with single H1 and accessible elements', () => {
      assert.ok(feedbackHtml.includes('Help shape ChoreMatrix.'));
      const h1Count = (feedbackHtml.match(/<h1[\s>]/g) || []).length;
      assert.equal(h1Count, 1, 'feedback.html must have exactly one H1');
      assert.ok(feedbackHtml.includes('id="feedbackForm"'));
      assert.ok(feedbackHtml.includes('id="chkAllowQuote"'));
    });

    it('site footer includes feedback links', () => {
      const footerTs = fs.readFileSync(path.join(rootDir, 'src', 'ui', 'footer.ts'), 'utf-8');
      assert.ok(footerTs.includes('/feedback.html'), 'footer.ts must link to /feedback.html');
    });

    it('calculator post-plan banner offers subtle feedback invitation', () => {
      assert.ok(indexHtml.includes('postPlanBannerFeedback'), 'index.html must have postPlanBannerFeedback');
      assert.ok(indexHtml.includes('/feedback.html'), 'index.html must link to feedback page in post-plan area');
      assert.ok(appHtml.includes('postPlanBannerFeedback'), 'app.html must have postPlanBannerFeedback');
      assert.ok(appHtml.includes('/feedback.html'), 'app.html must link to feedback page in post-plan area');
    });

    it('restores preferred homepage headline on index.html', () => {
      assert.ok(
        indexHtml.includes('Stop arguing over who does what.<br>Let our household workload optimizer calculate the plan.')
      );
    });
  });
});
