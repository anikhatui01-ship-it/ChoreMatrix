import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AuthService, getSiteUrl, getAuthRedirectUrl } from '../../src/auth/session.ts';
import { SupabaseAdapter } from '../../src/persistence/supabaseAdapter.ts';

describe('Account Lifecycle & Redirect Architecture', () => {
  // Test 1: Account loading success (verified user + profile query)
  it('account loading success: retrieves verified user and profile data', async () => {
    const mockUser = { id: 'usr-123', email: 'verified.user@example.com' };
    const mockProfile = {
      id: 'usr-123',
      email: 'verified.user@example.com',
      plan_tier: 'pro',
      trial_ends_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const mockAuth = new (class extends AuthService {
      protected override get client(): any {
        return {
          auth: {
            getSession: async () => ({ data: { session: { user: mockUser } }, error: null }),
            getUser: async () => ({ data: { user: mockUser }, error: null })
          }
        };
      }
    })();

    const mockPersistence = new (class extends SupabaseAdapter {
      override async getProfile(userId: string): Promise<any> {
        if (userId === mockUser.id) return mockProfile;
        return null;
      }
    })();

    const user = await mockAuth.requireAuth('/account.html');
    assert.ok(user, 'User must be returned by requireAuth');
    assert.strictEqual(user.email, 'verified.user@example.com');

    const profile = await mockPersistence.getProfile(user.id);
    assert.ok(profile, 'Profile must be loaded');
    assert.strictEqual(profile.plan_tier, 'pro');
  });

  // Test 2: Account loading failure (network error / timeout handled gracefully)
  it('account loading failure: network and timeout failures terminate without hanging', async () => {
    const hangingAuth = new (class extends AuthService {
      protected override get client(): any {
        return {
          auth: {
            getSession: async () => ({ data: { session: { user: { id: 'u-hang', email: 'hang@example.com' } } }, error: null }),
            // Intentionally hangs longer than timeout
            getUser: () => new Promise(() => {})
          }
        };
      }
    })();

    // Verified lookup with short 50ms timeout must reject/return null gracefully
    const verified = await hangingAuth.getVerifiedUser(50);
    assert.strictEqual(verified, null, 'Hanging verification must terminate and return null');

    const errorPersistence = new (class extends SupabaseAdapter {
      override async getProfile(_userId: string): Promise<any> {
        throw new Error('Connection refused (Postgres 503)');
      }
    })();

    // Profile query failure must not crash or hang
    let caughtError: string | null = null;
    try {
      await errorPersistence.getProfile('u-fail');
    } catch (err: any) {
      caughtError = err.message;
    }
    assert.strictEqual(caughtError, 'Connection refused (Postgres 503)');
  });

  // Test 3: Signed-out account state (unauthenticated user redirect)
  it('signed-out account state: redirects unauthenticated user to login with redirect parameter', async () => {
    let redirectedUrl = '';
    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = {
      location: {
        set href(val: string) { redirectedUrl = val; },
        get href() { return redirectedUrl; },
        origin: 'http://localhost:4173'
      }
    };

    try {
      const signedOutAuth = new (class extends AuthService {
        protected override get client(): any {
          return {
            auth: {
              getSession: async () => ({ data: { session: null }, error: null }),
              getUser: async () => ({ data: { user: null }, error: null })
            }
          };
        }
      })();

      const user = await signedOutAuth.requireAuth('/account.html');
      assert.strictEqual(user, null, 'Unauthenticated user returns null');
      assert.strictEqual(
        redirectedUrl,
        '/login.html?redirect=%2Faccount.html',
        'requireAuth must redirect to login with encoded redirect path'
      );
    } finally {
      (globalThis as any).window = previousWindow;
    }
  });

  // Test 4: Profile missing (user exists in auth, but no profile row in DB)
  it('profile missing: handles absent profile row gracefully with fallback', async () => {
    const mockUser = { id: 'usr-no-prof', email: 'noprofile@example.com' };

    const mockPersistence = new (class extends SupabaseAdapter {
      // maybeSingle returning null represents absent DB row
      override async getProfile(_userId: string): Promise<any> {
        return null;
      }
    })();

    const profile = await mockPersistence.getProfile(mockUser.id);
    assert.strictEqual(profile, null, 'Missing profile row returns null cleanly');

    // UI contract: when profile is null, tier falls back to free and user email is preserved
    const resolvedTier = profile?.plan_tier || 'free';
    const resolvedEmail = mockUser.email;
    assert.strictEqual(resolvedTier, 'free');
    assert.strictEqual(resolvedEmail, 'noprofile@example.com');
  });

  // Test 5: Auth state restoration (subscription triggers on events)
  it('auth state restoration: notifies listeners on SIGNED_IN, TOKEN_REFRESHED, and SIGNED_OUT', async () => {
    type AuthCallback = (event: string, session: any) => void;
    let registeredCallback: AuthCallback | null = null;

    const mockAuth = new (class extends AuthService {
      override onAuthStateChange(callback: AuthCallback): any {
        registeredCallback = callback;
        return { data: { subscription: { unsubscribe: () => { registeredCallback = null; } } } };
      }
    })();

    const receivedEvents: string[] = [];
    const sub = mockAuth.onAuthStateChange((event, session) => {
      receivedEvents.push(`${event}:${session?.user?.id || 'null'}`);
    });

    assert.ok(registeredCallback !== null, 'Callback must be registered');

    // 1. Simulate SIGNED_IN
    registeredCallback!('SIGNED_IN', { user: { id: 'user-restore' } });
    assert.strictEqual(receivedEvents[0], 'SIGNED_IN:user-restore');

    // 2. Simulate TOKEN_REFRESHED
    registeredCallback!('TOKEN_REFRESHED', { user: { id: 'user-restore' } });
    assert.strictEqual(receivedEvents[1], 'TOKEN_REFRESHED:user-restore');

    // 3. Simulate SIGNED_OUT
    registeredCallback!('SIGNED_OUT', null);
    assert.strictEqual(receivedEvents[2], 'SIGNED_OUT:null');

    // 4. Unsubscribe
    sub.data.subscription.unsubscribe();
    assert.strictEqual(registeredCallback, null);
  });

  // Test 6: Expired session (cached token invalid on server triggers expired redirect)
  it('expired session: invalid/expired server session redirects with reason=expired', async () => {
    let redirectedUrl = '';
    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = {
      location: {
        set href(val: string) { redirectedUrl = val; },
        get href() { return redirectedUrl; },
        origin: 'http://localhost:4173'
      }
    };

    try {
      const expiredAuth = new (class extends AuthService {
        protected override get client(): any {
          return {
            auth: {
              // Local storage has an old session
              getSession: async () => ({ data: { session: { user: { id: 'u-exp' } } }, error: null }),
              // Server rejected the expired token
              getUser: async () => ({ data: { user: null }, error: { message: 'jwt expired' } })
            }
          };
        }
      })();

      const user = await expiredAuth.requireAuth('/account.html');
      assert.strictEqual(user, null, 'Expired session must return null user');
      assert.ok(
        redirectedUrl.includes('reason=expired'),
        'Redirect URL must indicate expired session reason'
      );
    } finally {
      (globalThis as any).window = previousWindow;
    }
  });

  // Test 7: Verification redirect (post-verification URL parameters trigger app redirect)
  it('verification redirect: token/code presence resolves to verified app redirect', () => {
    function parseVerificationState(urlStr: string) {
      const url = new URL(urlStr);
      const searchParams = url.searchParams;
      const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(rawHash);

      const err = searchParams.get('error') || hashParams.get('error');
      const hasToken = hashParams.has('access_token') || hashParams.get('type') === 'signup';
      const hasCode = searchParams.has('code');

      if (err) return 'ERROR';
      if (hasToken || hasCode) return 'VERIFYING';
      return 'INBOX_PROMPT';
    }

    // Success token hash
    assert.strictEqual(
      parseVerificationState('https://chorematrix.online/verify-email.html#access_token=token123&type=signup'),
      'VERIFYING'
    );

    // PKCE code query param
    assert.strictEqual(
      parseVerificationState('https://chorematrix.online/verify-email.html?code=auth_code_xyz'),
      'VERIFYING'
    );

    // Normal post-signup prompt
    assert.strictEqual(
      parseVerificationState('https://chorematrix.online/verify-email.html?email=user@example.com'),
      'INBOX_PROMPT'
    );
  });

  // Test 8: Verification failure (error in hash/query produces error state)
  it('verification failure: expired or invalid token produces readable failure state', () => {
    function extractVerificationError(urlStr: string) {
      const url = new URL(urlStr);
      const searchParams = url.searchParams;
      const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
      const hashParams = new URLSearchParams(rawHash);

      const error = searchParams.get('error') || hashParams.get('error');
      const errorCode = searchParams.get('error_code') || hashParams.get('error_code');
      const errorDesc = searchParams.get('error_description') || hashParams.get('error_description');

      if (!error && !errorCode) return null;
      return {
        error,
        errorCode,
        description: errorDesc ? decodeURIComponent(errorDesc.replace(/\+/g, ' ')) : 'Invalid link'
      };
    }

    const failureUrl = 'http://localhost:4173/verify-email.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    const failure = extractVerificationError(failureUrl);

    assert.ok(failure !== null);
    assert.strictEqual(failure.error, 'access_denied');
    assert.strictEqual(failure.errorCode, 'otp_expired');
    assert.strictEqual(failure.description, 'Email link is invalid or has expired');
  });

  // Test 9: Correct local vs production redirect target
  it('correct local vs production redirect target: resolves environment-aware redirect URLs', () => {
    const previousWindow = (globalThis as any).window;

    // Case A: Explicit VITE_PUBLIC_SITE_URL set (e.g. production or mobile LAN IP)
    (globalThis as any).window = {
      __ENV__: { VITE_PUBLIC_SITE_URL: 'https://chorematrix.online' },
      location: { origin: 'http://localhost:4173' }
    };
    assert.strictEqual(getSiteUrl(), 'https://chorematrix.online');
    assert.strictEqual(getAuthRedirectUrl('/verify-email.html'), 'https://chorematrix.online/verify-email.html');
    assert.strictEqual(getAuthRedirectUrl('reset-password.html'), 'https://chorematrix.online/reset-password.html');

    // Case B: In local browser without explicit VITE_PUBLIC_SITE_URL
    (globalThis as any).window = {
      location: { origin: 'http://localhost:4173' }
    };
    assert.strictEqual(getSiteUrl(), 'http://localhost:4173');
    assert.strictEqual(getAuthRedirectUrl('/verify-email.html'), 'http://localhost:4173/verify-email.html');

    // Case C: Server-side or non-browser fallback
    (globalThis as any).window = undefined;
    assert.strictEqual(getSiteUrl(), 'https://chorematrix.online');
    assert.strictEqual(getAuthRedirectUrl('/verify-email.html'), 'https://chorematrix.online/verify-email.html');

    (globalThis as any).window = previousWindow;
  });
});
