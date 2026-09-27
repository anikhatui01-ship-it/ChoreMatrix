/**
 * ChoreMatrix Supabase Client Configuration
 *
 * NON-NEGOTIABLE SECURITY RULES:
 * 1. Read ONLY from environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).
 * 2. NEVER hardcode real or fabricated credentials.
 * 3. NEVER use or reference a service-role key or secret key in browser code.
 * 4. Browser-safe Publishable Key is used exclusively in client-side code.
 * 5. If credentials are not configured, degrade gracefully:
 *    - the application remains buildable
 *    - local public pages work
 *    - the optimizer/prototype remains usable
 *    - authenticated views show an informative configuration notice rather than crashing.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __ENV__?: Record<string, string>;
  }
}

export function getEnvVar(key: string): string | undefined {
  if (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__[key]) {
    return window.__ENV__[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) {}
  return undefined;
}

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL');
const supabasePublishableKey =
  getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY') ||
  getEnvVar('SUPABASE_PUBLISHABLE_KEY');

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  supabaseUrl.trim() !== '' &&
  supabasePublishableKey.trim() !== '' &&
  !supabaseUrl.includes('placeholder')
);

export function getSupabaseConfigStatus() {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabasePublishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  return {
    isConfigured: isSupabaseConfigured,
    missingKeys: missing,
    supabaseUrl: supabaseUrl ? `${supabaseUrl.substring(0, 16)}...` : undefined
  };
}

let clientInstance: SupabaseClient | null = null;

if (isSupabaseConfigured && supabaseUrl && supabasePublishableKey) {
  try {
    clientInstance = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'chorematrix_auth_token'
      }
    });
  } catch (err) {
    console.warn('[ChoreMatrix] Failed to initialize Supabase client:', err);
    clientInstance = null;
  }
}

export const supabase: SupabaseClient | null = clientInstance;

export function getSupabaseClient(): SupabaseClient {
  if (!clientInstance) {
    throw new Error(
      'Supabase is not configured. Please supply VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables to use cloud persistence.'
    );
  }
  return clientInstance;
}
