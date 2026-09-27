/**
 * ChoreMatrix Authentication & Session Lifecycle Service
 *
 * NON-NEGOTIABLE SECURITY SPECIFICATIONS:
 * 1. Explicit session termination scopes:
 *    - 'local'   -> Terminates current device session only
 *    - 'others'  -> Terminates all other active sessions while preserving current session
 *    - 'global'  -> Terminates all sessions across all devices
 * 2. Graceful fallback when Supabase is unconfigured
 * 3. Protected route verification
 */

import { supabase, isSupabaseConfigured, getEnvVar } from '../config/supabase.ts';
import type { Session, User } from '@supabase/supabase-js';

export type SignOutScope = 'local' | 'others' | 'global';

/**
 * Resolves the base site URL for redirects based on environment:
 * 1. Explicit configured site URL (VITE_PUBLIC_SITE_URL)
 * 2. In-browser location origin (local development or runtime origin)
 * 3. Default production URL fallback ('https://chorematrix.vercel.app')
 */
export function getSiteUrl(): string {
  const configured = getEnvVar('VITE_PUBLIC_SITE_URL');
  if (configured && configured.trim() !== '') {
    return configured.trim().replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return 'https://chorematrix.vercel.app';
}

/**
 * Returns a fully qualified redirect URL for auth workflows.
 */
export function getAuthRedirectUrl(pathname: string): string {
  const base = getSiteUrl();
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${cleanPath}`;
}

export class AuthService {
  protected get client() {
    if (!isSupabaseConfigured || !supabase) {
      return null;
    }
    return supabase;
  }

  /**
   * Retrieves active session if Supabase is configured.
   */
  async getSession(): Promise<Session | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) {
        console.warn('[ChoreMatrix Auth] getSession error:', error.message);
        return null;
      }
      return data.session;
    } catch (err) {
      console.warn('[ChoreMatrix Auth] Unexpected error in getSession:', err);
      return null;
    }
  }

  /**
   * Retrieves current authenticated user.
   */
  async getUser(): Promise<User | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client.auth.getUser();
      if (error) return null;
      return data.user;
    } catch {
      return null;
    }
  }

  /**
   * Verified user lookup. Contacts Supabase Auth server to validate JWT.
   * Includes a timeout fallback so requests never hang indefinitely.
   */
  async getVerifiedUser(timeoutMs = 8000): Promise<User | null> {
    if (!this.client) return null;
    try {
      const userPromise = this.client.auth.getUser().then(({ data, error }) => {
        if (error) {
          console.warn('[ChoreMatrix Auth] getVerifiedUser error:', error.message);
          return null;
        }
        return data.user;
      });

      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Auth verification timed out')), timeoutMs)
      );

      return await Promise.race([userPromise, timeoutPromise]);
    } catch (err) {
      console.warn('[ChoreMatrix Auth] Verified user check failed or timed out:', err);
      return null;
    }
  }

  /**
   * Email and password sign-up with environment-aware redirect URL.
   */
  async signUp(email: string, password: string, redirectTo?: string) {
    if (!this.client) {
      throw new Error('Cloud authentication is unconfigured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
    const targetUrl = redirectTo || getAuthRedirectUrl('/verify-email.html');
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: targetUrl
      }
    });
    if (error) throw error;
    return data;
  }

  /**
   * Email and password login.
   */
  async signIn(email: string, password: string) {
    if (!this.client) {
      throw new Error('Cloud authentication is unconfigured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  }

  /**
   * Explicitly scoped sign out.
   * - 'local': Terminates current device session only (standard logout)
   * - 'others': Terminates all other devices
   * - 'global': Terminates all devices everywhere
   */
  async signOut(scope: SignOutScope = 'local') {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut({ scope });
    if (error) throw error;

    if (scope === 'local' || scope === 'global') {
      try {
        localStorage.removeItem('chorematrix_auth_token');
        sessionStorage.clear();
      } catch (e) {}
    }
  }

  /**
   * Triggers a password recovery email with environment-aware redirect URL.
   */
  async requestPasswordReset(email: string, redirectTo?: string) {
    if (!this.client) {
      throw new Error('Cloud authentication is unconfigured.');
    }
    const targetUrl = redirectTo || getAuthRedirectUrl('/reset-password.html');
    const { data, error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: targetUrl
    });
    if (error) throw error;
    return data;
  }

  /**
   * Updates user password during reset-password flow or from account settings.
   */
  async updatePassword(newPassword: string) {
    if (!this.client) {
      throw new Error('Cloud authentication is unconfigured.');
    }
    const { data, error } = await this.client.auth.updateUser({
      password: newPassword
    });
    if (error) throw error;
    return data;
  }

  /**
   * Resends verification email.
   */
  async resendVerificationEmail(email: string) {
    if (!this.client) {
      throw new Error('Cloud authentication is unconfigured.');
    }
    const { error } = await this.client.auth.resend({
      type: 'signup',
      email
    });
    if (error) throw error;
  }

  /**
   * Subscribes to global auth state changes.
   */
  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    if (!this.client) {
      return { data: { subscription: { unsubscribe: () => {} } } };
    }
    return this.client.auth.onAuthStateChange(callback);
  }

  /**
   * Route guard for protected pages (/app.html, /account.html).
   * Validates both session existence and server-side verification.
   */
  async requireAuth(currentPath: string, timeoutMs = 8000): Promise<User | null> {
    if (!this.client) {
      // In local development without Supabase credentials, return null but don't loop redirect
      return null;
    }
    const session = await this.getSession();
    if (!session || !session.user) {
      if (typeof window !== 'undefined') {
        const loginUrl = `/login.html?redirect=${encodeURIComponent(currentPath)}`;
        window.location.href = loginUrl;
      }
      return null;
    }

    // Verify identity with Supabase Auth to catch expired/invalidated tokens
    const verifiedUser = await this.getVerifiedUser(timeoutMs);
    if (!verifiedUser) {
      if (typeof window !== 'undefined') {
        const loginUrl = `/login.html?redirect=${encodeURIComponent(currentPath)}&reason=expired`;
        window.location.href = loginUrl;
      }
      return null;
    }

    return verifiedUser;
  }
}

export const authService = new AuthService();
