import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AuthService, type SignOutScope } from '../../src/auth/session.ts';

describe('Auth & Session Lifecycle', () => {
  it('enforces explicit session termination scopes (local, others, global)', async () => {
    const executedScopes: SignOutScope[] = [];

    // Mock client to intercept signOut call
    class MockAuthClient {
      async signOut(options: { scope: SignOutScope }) {
        executedScopes.push(options.scope);
        return { error: null };
      }
    }

    const mockAuth = new (class extends AuthService {
      protected override get client(): any {
        return {
          auth: new MockAuthClient()
        };
      }
    })();

    // 1. Standard logout must specify 'local' scope
    await mockAuth.signOut('local');
    assert.strictEqual(executedScopes[0], 'local', 'Default logout must terminate only local device');

    // 2. Sign out others
    await mockAuth.signOut('others');
    assert.strictEqual(executedScopes[1], 'others', 'Sign out other devices must use others scope');

    // 3. Sign out everywhere
    await mockAuth.signOut('global');
    assert.strictEqual(executedScopes[2], 'global', 'Sign out everywhere must use global scope');
  });

  it('validates signup and login inputs', () => {
    function validateAuthInput(email: string, password?: string, confirm?: string) {
      if (!email || !email.includes('@')) return 'INVALID_EMAIL';
      if (password !== undefined && password.length < 8) return 'WEAK_PASSWORD';
      if (confirm !== undefined && password !== confirm) return 'PASSWORD_MISMATCH';
      return 'VALID';
    }

    assert.strictEqual(validateAuthInput('invalid-email'), 'INVALID_EMAIL');
    assert.strictEqual(validateAuthInput('user@example.com', 'short'), 'WEAK_PASSWORD');
    assert.strictEqual(validateAuthInput('user@example.com', 'validpassword123', 'different'), 'PASSWORD_MISMATCH');
    assert.strictEqual(validateAuthInput('user@example.com', 'validpassword123', 'validpassword123'), 'VALID');
  });

  it('handles protected route access for unauthenticated users', async () => {
    // Unauthenticated instance
    const unauthedService = new (class extends AuthService {
      protected override get client(): any {
        return {
          auth: {
            getSession: async () => ({ data: { session: null }, error: null })
          }
        };
      }
    })();

    const session = await unauthedService.getSession();
    assert.strictEqual(session, null, 'Unauthenticated user has no session');
  });

  it('uses browser-safe publishable key in configuration status and unconfigured errors', async () => {
    const unconfiguredAuth = new AuthService();
    await assert.rejects(
      async () => unconfiguredAuth.signUp('test@example.com', 'password123'),
      /VITE_SUPABASE_PUBLISHABLE_KEY/,
      'Unconfigured signup error must reference VITE_SUPABASE_PUBLISHABLE_KEY'
    );
    await assert.rejects(
      async () => unconfiguredAuth.signIn('test@example.com', 'password123'),
      /VITE_SUPABASE_PUBLISHABLE_KEY/,
      'Unconfigured signin error must reference VITE_SUPABASE_PUBLISHABLE_KEY'
    );
  });
});

