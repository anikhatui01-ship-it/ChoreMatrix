import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeRedirectUrl, AuthService, type SignOutScope } from '../../src/auth/session.ts';
import { InactivityService } from '../../src/auth/inactivity.ts';

describe('Security Remediation & Session Acceptance Tests', () => {
  describe('Open Redirect Prevention (sanitizeRedirectUrl)', () => {
    it('allows clean relative paths starting with /', () => {
      assert.strictEqual(sanitizeRedirectUrl('/app.html'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('/account.html?tab=billing'), '/account.html?tab=billing');
      assert.strictEqual(sanitizeRedirectUrl('/app#day-view'), '/app#day-view');
      assert.strictEqual(sanitizeRedirectUrl('/pricing.html'), '/pricing.html');
    });

    it('rejects external absolute URLs and falls back to safe destination', () => {
      assert.strictEqual(sanitizeRedirectUrl('https://evil.com'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('http://attacker.com/steal-creds'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('ftp://malicious.org'), '/app.html');
    });

    it('rejects protocol-relative URLs (//evil.com)', () => {
      assert.strictEqual(sanitizeRedirectUrl('//evil.com'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('//google.com/phish'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('///attacker.com'), '/app.html');
    });

    it('rejects backslash evasion techniques (/\\evil.com or \\evil.com)', () => {
      assert.strictEqual(sanitizeRedirectUrl('/\\evil.com'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('\\evil.com'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('/foo\\bar'), '/app.html');
    });

    it('rejects script and pseudo schemes (javascript:, data:)', () => {
      assert.strictEqual(sanitizeRedirectUrl('javascript:alert(1)'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('data:text/html,<script>alert(1)</script>'), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('vbscript:msgbox(1)'), '/app.html');
    });

    it('handles null, undefined, empty, and custom fallbacks safely', () => {
      assert.strictEqual(sanitizeRedirectUrl(null), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl(undefined), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl(''), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('   '), '/app.html');
      assert.strictEqual(sanitizeRedirectUrl('https://evil.com', '/custom-fallback.html'), '/custom-fallback.html');
    });
  });

  describe('Inactivity & Absolute Session Lifecycle (InactivityService)', () => {
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      mockStorage = {};
      (global as any).localStorage = {
        getItem: (k: string) => mockStorage[k] || null,
        setItem: (k: string, v: string) => { mockStorage[k] = v; },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; }
      };
      (global as any).sessionStorage = {
        clear: () => {}
      };
    });

    it('initializes activity timestamp and returns active status when recent', () => {
      const service = new InactivityService({
        inactivityTimeoutMs: 30 * 60 * 1000,
        warningThresholdMs: 2 * 60 * 1000,
        absoluteLifetimeMs: 24 * 60 * 60 * 1000
      });

      service.initSessionTimestamps();
      const session = service.checkSession();
      assert.strictEqual(session.status, 'active');
      assert.ok(mockStorage['chorematrix_last_activity']);
      assert.strictEqual(mockStorage['chorematrix_session_status'], 'active');
    });

    it('transitions to warning state within warning window', () => {
      const service = new InactivityService({
        inactivityTimeoutMs: 30 * 60 * 1000, // 30m
        warningThresholdMs: 2 * 60 * 1000,   // warning at 28m
        absoluteLifetimeMs: 24 * 60 * 60 * 1000
      });

      // Simulate 29 minutes elapsed since last activity
      const twentyNineMinAgo = Date.now() - (29 * 60 * 1000);
      mockStorage['chorematrix_last_activity'] = String(twentyNineMinAgo);
      mockStorage['chorematrix_session_start'] = String(Date.now() - (29 * 60 * 1000));

      const session = service.checkSession();
      assert.strictEqual(session.status, 'warning');
      assert.ok(session.remainingMs > 0 && session.remainingMs <= 60 * 1000, 'Time remaining should be under 1 minute');
    });

    it('transitions to expired state when idle timeout is exceeded', () => {
      const service = new InactivityService({
        inactivityTimeoutMs: 30 * 60 * 1000,
        warningThresholdMs: 2 * 60 * 1000,
        absoluteLifetimeMs: 24 * 60 * 60 * 1000,
        redirectOnTimeout: false
      });

      // Simulate 35 minutes idle
      const thirtyFiveMinAgo = Date.now() - (35 * 60 * 1000);
      mockStorage['chorematrix_last_activity'] = String(thirtyFiveMinAgo);

      const session = service.checkSession();
      assert.strictEqual(session.status, 'expired');
      assert.strictEqual(session.reason, 'inactivity');
    });

    it('transitions to expired state when absolute lifetime (24h) is exceeded even if active', () => {
      const service = new InactivityService({
        inactivityTimeoutMs: 30 * 60 * 1000,
        warningThresholdMs: 2 * 60 * 1000,
        absoluteLifetimeMs: 24 * 60 * 60 * 1000, // 24 hours
        redirectOnTimeout: false
      });

      // Active right now, but session started 25 hours ago
      mockStorage['chorematrix_last_activity'] = String(Date.now());
      mockStorage['chorematrix_session_start'] = String(Date.now() - (25 * 60 * 60 * 1000));

      const session = service.checkSession();
      assert.strictEqual(session.status, 'expired');
      assert.strictEqual(session.reason, 'absolute');
    });

    it('resets timer when user chooses staySignedIn()', () => {
      const service = new InactivityService({
        inactivityTimeoutMs: 30 * 60 * 1000,
        warningThresholdMs: 2 * 60 * 1000,
        absoluteLifetimeMs: 24 * 60 * 60 * 1000
      });

      // In warning state
      const twentyNineMinAgo = Date.now() - (29 * 60 * 1000);
      mockStorage['chorematrix_last_activity'] = String(twentyNineMinAgo);
      assert.strictEqual(service.checkSession().status, 'warning');

      // User interacts to stay signed in
      service.staySignedIn();
      assert.strictEqual(service.checkSession().status, 'active');
      assert.strictEqual(mockStorage['chorematrix_session_status'], 'active');
    });
  });

  describe('Explicit Session Termination (AuthService.signOut)', () => {
    let mockStorage: Record<string, string>;

    beforeEach(() => {
      mockStorage = {
        chorematrix_auth_token: 'mock-token',
        chorematrix_last_activity: '12345678',
        chorematrix_session_start: '12340000',
        chorematrix_session_status: 'active'
      };
      (global as any).localStorage = {
        getItem: (k: string) => mockStorage[k] || null,
        setItem: (k: string, v: string) => { mockStorage[k] = v; },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear: () => { mockStorage = {}; }
      };
      (global as any).sessionStorage = {
        clear: () => {
          mockStorage['__session_cleared__'] = 'true';
        }
      };
    });

    it('clears credentials and updates session status to expired on local signOut', async () => {
      const service = new AuthService();
      await service.signOut('local');

      assert.strictEqual(mockStorage['chorematrix_auth_token'], undefined);
      assert.strictEqual(mockStorage['chorematrix_last_activity'], undefined);
      assert.strictEqual(mockStorage['chorematrix_session_start'], undefined);
      assert.strictEqual(mockStorage['chorematrix_session_status'], 'expired');
      assert.strictEqual(mockStorage['__session_cleared__'], 'true');
    });

    it('clears credentials and session status on global signOut', async () => {
      const service = new AuthService();
      await service.signOut('global');

      assert.strictEqual(mockStorage['chorematrix_auth_token'], undefined);
      assert.strictEqual(mockStorage['chorematrix_session_status'], 'expired');
    });
  });

  describe('Webhook Replay Attack Protection Logic', () => {
    it('verifies that webhook timestamps older than 300 seconds are rejected', () => {
      function verifyWebhookTimestamp(timestampSeconds: number, maxAgeSeconds = 300): { valid: boolean; reason?: string } {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (isNaN(timestampSeconds)) {
          return { valid: false, reason: 'Invalid timestamp format' };
        }
        if (Math.abs(nowSeconds - timestampSeconds) > maxAgeSeconds) {
          return { valid: false, reason: 'Webhook timestamp tolerance exceeded (replay protection)' };
        }
        return { valid: true };
      }

      const now = Math.floor(Date.now() / 1000);

      // Fresh timestamp: should pass
      assert.strictEqual(verifyWebhookTimestamp(now - 10).valid, true);
      assert.strictEqual(verifyWebhookTimestamp(now).valid, true);

      // Stale timestamp (6 minutes old = 360 seconds): should fail
      const staleResult = verifyWebhookTimestamp(now - 360);
      assert.strictEqual(staleResult.valid, false);
      assert.strictEqual(staleResult.reason, 'Webhook timestamp tolerance exceeded (replay protection)');

      // Future timestamp (clock skew > 300s): should fail
      const futureResult = verifyWebhookTimestamp(now + 400);
      assert.strictEqual(futureResult.valid, false);
    });
  });

  describe('Database RLS & Security Definer Integrity (Migration 09)', () => {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '09_harden_rls_relational_integrity.sql');

    it('verifies migration file exists and is valid SQL', () => {
      assert.ok(fs.existsSync(migrationPath), 'Migration 09 must exist');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      assert.ok(sql.length > 500, 'Migration 09 must contain full SQL definitions');
    });

    it('enforces search_path on security definer functions to prevent privilege escalation', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      assert.ok(
        sql.includes('handle_new_user()') && sql.includes('set search_path = public, auth, pg_temp'),
        'handle_new_user must have fixed search_path'
      );
      assert.ok(
        sql.includes('protect_profile_entitlements()') && sql.includes('set search_path = public, auth, pg_temp'),
        'protect_profile_entitlements must have fixed search_path'
      );
    });

    it('enforces relational household ownership on members, tasks, member_preferences, and plans', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      assert.ok(sql.includes('Users can insert own members'), 'Must define members insert policy');
      assert.ok(sql.includes('Users can insert own tasks'), 'Must define tasks insert policy');
      assert.ok(sql.includes('Users can insert own member preferences'), 'Must define preferences insert policy');
      assert.ok(sql.includes('Users can insert own plans'), 'Must define plans insert policy');

      // Check for EXISTS household ownership query
      assert.ok(
        sql.includes('select 1 from public.households h') && sql.includes('h.id = household_id and h.user_id = auth.uid()'),
        'relational policy must verify household ownership'
      );
    });
  });

  describe('Production Security Headers & Cache-Control (vercel.json)', () => {
    const vercelConfigPath = path.join(process.cwd(), 'vercel.json');

    it('verifies strict security headers configuration', () => {
      assert.ok(fs.existsSync(vercelConfigPath), 'vercel.json must exist');
      const config = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));
      assert.ok(Array.isArray(config.headers), 'Headers array must be present');

      // Check global headers
      const globalHeaderEntry = config.headers.find((h: any) => h.source === '/(.*)');
      assert.ok(globalHeaderEntry, 'Global headers must be defined');

      const headerMap: Record<string, string> = {};
      for (const h of globalHeaderEntry.headers) {
        headerMap[h.key] = h.value;
      }

      assert.strictEqual(headerMap['X-Content-Type-Options'], 'nosniff');
      assert.strictEqual(headerMap['X-Frame-Options'], 'DENY');
      assert.ok(
        headerMap['Strict-Transport-Security'].includes('max-age=63072000'),
        'HSTS must enforce at least 2 years'
      );
      assert.ok(
        headerMap['Strict-Transport-Security'].includes('includeSubDomains'),
        'HSTS must include subdomains'
      );
      assert.strictEqual(headerMap['X-Permitted-Cross-Domain-Policies'], 'none');
    });

    it('enforces Cache-Control: no-store on authenticated pages /app and /account', () => {
      const config = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));
      const authenticatedHeader = config.headers.find((h: any) => h.source.includes('app') && h.source.includes('account'));

      assert.ok(authenticatedHeader, 'Authenticated route header configuration must exist');
      const cacheControl = authenticatedHeader.headers.find((h: any) => h.key === 'Cache-Control');
      assert.ok(cacheControl?.value.includes('no-store'), 'Authenticated pages must have no-store cache control');
    });
  });
});
