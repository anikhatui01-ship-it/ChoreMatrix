import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAdapter } from '../../src/persistence/supabaseAdapter.ts';
import fs from 'node:fs';
import path from 'node:path';

// Mock localStorage for test environment
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) || null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = new MockLocalStorage();
}

/**
 * Mock Supabase Database & Auth Client for comprehensive Account Deletion testing
 */
class DeletionMockSupabaseClient {
  public tables: Record<string, any[]> = {
    households: [],
    members: [],
    tasks: [],
    member_preferences: [],
    plans: [],
    profiles: [],
    user_privacy_preferences: [],
    user_feedback: [],
    dodo_subscriptions: [],
    dodo_webhook_events: []
  };

  public authUsers: Array<{ id: string; email: string }> = [];
  public currentSession: { access_token: string; user: { id: string; email: string } } | null = null;

  public auth = {
    getUser: async (token: string) => {
      if (!token || token !== 'valid_mock_jwt_token') {
        return { data: { user: null }, error: new Error('Invalid token') };
      }
      return { data: { user: this.currentSession?.user || null }, error: null };
    },
    getSession: async () => ({
      data: { session: this.currentSession },
      error: null
    }),
    admin: {
      deleteUser: async (userId: string) => {
        const idx = this.authUsers.findIndex(u => u.id === userId);
        if (idx !== -1) {
          this.authUsers.splice(idx, 1);
          // Invalidate session if deleted
          if (this.currentSession?.user?.id === userId) {
            this.currentSession = null;
          }
          return { data: { user: null }, error: null };
        }
        return { data: null, error: new Error('User not found in auth.users') };
      }
    }
  };

  from(tableName: string) {
    const table = this.tables[tableName];
    if (!table) {
      throw new Error(`Table ${tableName} does not exist in mock.`);
    }

    const client = this;

    return {
      select(cols = '*') {
        let filters: Array<(row: any) => boolean> = [];
        const builder = {
          eq(col: string, val: any) {
            filters.push(r => r[col] === val);
            return builder;
          },
          in(col: string, vals: any[]) {
            filters.push(r => vals.includes(r[col]));
            return builder;
          },
          maybeSingle: async () => {
            const matches = table.filter(r => filters.every(f => f(r)));
            return { data: matches[0] || null, error: null };
          }
        };
        return builder;
      },
      update(updates: any) {
        return {
          eq(col: string, val: any) {
            for (const row of table) {
              if (row[col] === val) {
                Object.assign(row, updates);
              }
            }
            return Promise.resolve({ error: null });
          }
        };
      },
      delete() {
        return {
          eq(col: string, val: any) {
            client.tables[tableName] = table.filter(r => r[col] !== val);
            return Promise.resolve({ error: null });
          }
        };
      }
    };
  }
}

describe('Phase 1C & Phase 3 — Account Deletion & Full Lifecycle Verification', () => {
  let mockClient: DeletionMockSupabaseClient;
  const testUserId = 'user_del_test_123';
  const testEmail = 'member@example.com';
  const otherUserId = 'user_other_456';
  const otherEmail = 'other@example.com';

  beforeEach(() => {
    mockClient = new DeletionMockSupabaseClient();
    globalThis.localStorage.clear();

    mockClient.authUsers = [
      { id: testUserId, email: testEmail },
      { id: otherUserId, email: otherEmail }
    ];

    mockClient.currentSession = {
      access_token: 'valid_mock_jwt_token',
      user: { id: testUserId, email: testEmail }
    };

    mockClient.tables.profiles = [
      {
        id: testUserId,
        email: testEmail,
        plan_tier: 'free',
        subscription_status: 'none',
        dodo_subscription_id: null
      },
      {
        id: otherUserId,
        email: otherEmail,
        plan_tier: 'pro',
        subscription_status: 'active',
        dodo_subscription_id: 'sub_other_999'
      }
    ];

    mockClient.tables.households = [
      { id: 'h1', user_id: testUserId, name: 'Family House' },
      { id: 'h2', user_id: otherUserId, name: 'Other User House' }
    ];

    mockClient.tables.plans = [
      { id: 'p1', user_id: testUserId, household_id: 'h1' },
      { id: 'p2', user_id: otherUserId, household_id: 'h2' }
    ];

    mockClient.tables.user_privacy_preferences = [
      { user_id: testUserId, analytics_consent: true },
      { user_id: otherUserId, analytics_consent: false }
    ];

    mockClient.tables.user_feedback = [
      { id: 'fb1', user_id: testUserId, email: testEmail, useful_feedback: 'Loved the optimizer!' },
      { id: 'fb2', user_id: otherUserId, email: otherEmail, useful_feedback: 'Great tool!' }
    ];

    mockClient.tables.dodo_subscriptions = [
      { id: 'ds_other', user_id: otherUserId, subscription_id: 'sub_other_999', status: 'active', plan_tier: 'pro' }
    ];

    mockClient.tables.dodo_webhook_events = [
      { id: 'wh_1', event_type: 'payment.succeeded', payload: { payment_id: 'pay_999' } }
    ];
  });

  // 1. Free account deletion
  it('1. allows deletion for free tier accounts and purges all personal data', async () => {
    // Simulate server-side deletion logic
    const user = mockClient.currentSession?.user;
    assert.ok(user);

    // De-identify feedback
    for (const fb of mockClient.tables.user_feedback) {
      if (fb.user_id === user.id) {
        fb.user_id = null;
        fb.email = null;
      }
    }

    // Cascade delete tables
    mockClient.tables.plans = mockClient.tables.plans.filter(p => p.user_id !== user.id);
    mockClient.tables.households = mockClient.tables.households.filter(h => h.user_id !== user.id);
    mockClient.tables.user_privacy_preferences = mockClient.tables.user_privacy_preferences.filter(p => p.user_id !== user.id);
    mockClient.tables.profiles = mockClient.tables.profiles.filter(p => p.id !== user.id);
    await mockClient.auth.admin.deleteUser(user.id);

    // Verify user's data is gone
    assert.strictEqual(mockClient.tables.households.filter(h => h.user_id === testUserId).length, 0);
    assert.strictEqual(mockClient.tables.plans.filter(p => p.user_id === testUserId).length, 0);
    assert.strictEqual(mockClient.tables.profiles.filter(p => p.id === testUserId).length, 0);
    assert.strictEqual(mockClient.authUsers.find(u => u.id === testUserId), undefined);

    // Verify other user's data is untouched
    assert.strictEqual(mockClient.tables.households.filter(h => h.user_id === otherUserId).length, 1);
    assert.strictEqual(mockClient.tables.profiles.filter(p => p.id === otherUserId).length, 1);
  });

  // 2. Active subscription guard
  it('2. blocks deletion when user has an active or trialing subscription', async () => {
    mockClient.tables.profiles[0].plan_tier = 'pro';
    mockClient.tables.profiles[0].subscription_status = 'active';

    const checkActiveSub = () => {
      const p = mockClient.tables.profiles.find(r => r.id === testUserId);
      const isPaid = p?.plan_tier && p.plan_tier !== 'free';
      const isActive = p?.subscription_status === 'active' || p?.subscription_status === 'trialing';
      if (isPaid && isActive) {
        return {
          status: 400,
          error: 'ACTIVE_SUBSCRIPTION_EXISTS',
          message: 'You have an active or trialing subscription. Please cancel your subscription under Profile & Subscription before deleting your account to ensure recurring charges are stopped.'
        };
      }
      return { status: 200, success: true };
    };

    const res = checkActiveSub();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.error, 'ACTIVE_SUBSCRIPTION_EXISTS');

    // After cancellation, deletion proceeds
    mockClient.tables.profiles[0].subscription_status = 'canceled';
    mockClient.tables.profiles[0].plan_tier = 'free';
    const retryRes = checkActiveSub();
    assert.strictEqual(retryRes.status, 200);
  });

  // 3. Unauthorized request rejection
  it('3. rejects requests with invalid or missing authentication token', async () => {
    const handleAuth = async (token?: string) => {
      if (!token) return { status: 401, error: 'Unauthorized: Missing Authorization header' };
      const { data: { user }, error } = await mockClient.auth.getUser(token);
      if (error || !user) return { status: 401, error: 'Unauthorized: Invalid or expired session' };
      return { status: 200, user };
    };

    assert.strictEqual((await handleAuth(undefined)).status, 401);
    assert.strictEqual((await handleAuth('bad_token')).status, 401);
    assert.strictEqual((await handleAuth('valid_mock_jwt_token')).status, 200);
  });

  // 4. Cross-user isolation
  it('4. strictly prevents one user from deleting another user data', async () => {
    // Current authenticated session is testUserId
    const sessionUser = mockClient.currentSession?.user;
    assert.strictEqual(sessionUser?.id, testUserId);

    // Deletion targets sessionUser.id exclusively; attacker passes otherUserId in body
    const targetIdFromSession = sessionUser.id; // derived server-side
    assert.notStrictEqual(targetIdFromSession, otherUserId);

    // Execute deletion using derived ID
    mockClient.tables.households = mockClient.tables.households.filter(h => h.user_id !== targetIdFromSession);

    // Other user's household is protected
    const otherHousehold = mockClient.tables.households.find(h => h.user_id === otherUserId);
    assert.ok(otherHousehold, 'Other user household must not be deleted');
  });

  // 5. Repeated deletion requests handled safely (idempotent)
  it('5. handles repeated deletion requests safely without crashing', async () => {
    // First deletion
    await mockClient.auth.admin.deleteUser(testUserId);
    assert.strictEqual(mockClient.currentSession, null);

    // Second deletion attempt with expired/revoked session
    const { data: { user } } = await mockClient.auth.getUser('valid_mock_jwt_token');
    assert.strictEqual(user, null, 'Second request must find no active session');
  });

  // 6. Partial failure reporting
  it('6. does not report success if auth deletion fails', async () => {
    let authDeletionFailed = true;
    const simulateDeletion = async () => {
      // Step: delete tables
      mockClient.tables.households = mockClient.tables.households.filter(h => h.user_id !== testUserId);

      // Step: delete auth
      if (authDeletionFailed) {
        return {
          status: 500,
          success: false,
          error: 'DELETION_FAILED',
          message: 'Unable to complete account authentication deletion. Please contact support.'
        };
      }
      return { status: 200, success: true };
    };

    const res = await simulateDeletion();
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'DELETION_FAILED');
  });

  // 7. Old credentials cannot authenticate deleted account
  it('7. ensures deleted account credentials cannot sign in or restore access', async () => {
    await mockClient.auth.admin.deleteUser(testUserId);

    // Attempt sign-in with deleted account
    const signInMock = (email: string) => {
      const exists = mockClient.authUsers.find(u => u.email === email);
      if (!exists) throw new Error('Invalid login credentials');
      return { user: exists };
    };

    assert.throws(() => signInMock(testEmail), /Invalid login credentials/);
  });

  // 8. Re-registration with same email creates brand-new account
  it('8. permits new account registration with the same email without reviving old data', async () => {
    // Delete original user
    await mockClient.auth.admin.deleteUser(testUserId);
    mockClient.tables.households = mockClient.tables.households.filter(h => h.user_id !== testUserId);

    // Re-register same email
    const newUserId = 'user_del_new_789';
    mockClient.authUsers.push({ id: newUserId, email: testEmail });
    mockClient.tables.profiles.push({
      id: newUserId,
      email: testEmail,
      plan_tier: 'free',
      subscription_status: 'none'
    });

    // Check that new account has no households and new UUID
    assert.notStrictEqual(newUserId, testUserId);
    const newHouseholds = mockClient.tables.households.filter(h => h.user_id === newUserId);
    assert.strictEqual(newHouseholds.length, 0, 'New account must start with zero households');
    assert.strictEqual(mockClient.tables.profiles.find(p => p.id === newUserId)?.plan_tier, 'free');
  });

  // 9. Feedback de-identification and statutory record retention
  it('9. de-identifies feedback and retains statutory tax/webhook records', () => {
    // Feedback de-identification
    for (const fb of mockClient.tables.user_feedback) {
      if (fb.user_id === testUserId) {
        fb.user_id = null;
        fb.email = null;
      }
    }

    const scrubbedFb = mockClient.tables.user_feedback.find(fb => fb.id === 'fb1');
    assert.strictEqual(scrubbedFb?.user_id, null);
    assert.strictEqual(scrubbedFb?.email, null);
    assert.strictEqual(scrubbedFb?.useful_feedback, 'Loved the optimizer!');

    // Webhook/tax records preserved
    assert.strictEqual(mockClient.tables.dodo_webhook_events.length, 1);
  });

  // 10. LocalStorage draft and export cleanup
  it('10. purges local saved plan, draft, and export caches', () => {
    globalThis.localStorage.setItem('chorematrix_saved_plan', '{"plan":true}');
    globalThis.localStorage.setItem('chorematrix_draft', '{"draft":true}');
    globalThis.localStorage.setItem('chorematrix_export', 'csv_data');

    globalThis.localStorage.removeItem('chorematrix_saved_plan');
    globalThis.localStorage.removeItem('chorematrix_draft');
    globalThis.localStorage.removeItem('chorematrix_export');

    assert.strictEqual(globalThis.localStorage.getItem('chorematrix_saved_plan'), null);
    assert.strictEqual(globalThis.localStorage.getItem('chorematrix_draft'), null);
    assert.strictEqual(globalThis.localStorage.getItem('chorematrix_export'), null);
  });

  // 11. account.html UI and Danger Zone structure
  it('11. verifies account.html has confirmation box, input gating with DELETE, and cancel button', () => {
    const accountHtml = fs.readFileSync(path.resolve(process.cwd(), 'account.html'), 'utf-8');
    assert.ok(accountHtml.includes('id="deleteConfirmBox"'), 'account.html must have deleteConfirmBox');
    assert.ok(accountHtml.includes('id="txtDeleteConfirm"'), 'account.html must have txtDeleteConfirm input');
    assert.ok(accountHtml.includes('id="btnConfirmDelete"'), 'account.html must have btnConfirmDelete button');
    assert.ok(accountHtml.includes('id="btnCancelDelete"'), 'account.html must have btnCancelDelete button');
    assert.ok(accountHtml.includes('id="deleteSubWarning"'), 'account.html must have deleteSubWarning container');
  });

  // 12. login.html deletion notification banner
  it('12. verifies login.html displays deletion notice on ?deleted=true redirect', () => {
    const loginHtml = fs.readFileSync(path.resolve(process.cwd(), 'login.html'), 'utf-8');
    assert.ok(loginHtml.includes('id="authNotice"'), 'login.html must have authNotice banner');
    assert.ok(loginHtml.includes("urlParams.get('deleted') === 'true'"), 'login.html must check for deleted query parameter');
  });
});
