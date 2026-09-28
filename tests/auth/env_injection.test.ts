import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnvFile, getClientSafeEnv, build } from '../../build.js';

describe('Environment Variable Injection & Offline Fallback', () => {
  const rootDir = process.cwd();

  it('correctly parses .env file syntax including quotes and comments', () => {
    const tmpEnvPath = path.join(rootDir, 'tests', 'auth', '.env.test_tmp');
    try {
      fs.writeFileSync(
        tmpEnvPath,
        [
          '# Comment line',
          'VITE_SUPABASE_URL="https://test-project.supabase.co"',
          'VITE_SUPABASE_PUBLISHABLE_KEY=\'sb_publishable_test_key_12345\'',
          'UNQUOTED_VAR=unquoted_value # trailing comment',
          'EMPTY_VAR=',
          '   # indented comment',
          ''
        ].join('\n'),
        'utf8'
      );

      const parsed = parseEnvFile(tmpEnvPath);
      assert.strictEqual(parsed.VITE_SUPABASE_URL, 'https://test-project.supabase.co');
      assert.strictEqual(parsed.VITE_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_test_key_12345');
      assert.strictEqual(parsed.UNQUOTED_VAR, 'unquoted_value');
      assert.strictEqual(parsed.EMPTY_VAR, '');
    } finally {
      if (fs.existsSync(tmpEnvPath)) {
        fs.unlinkSync(tmpEnvPath);
      }
    }
  });

  it('strictly whitelists browser-safe keys and blocks secret/service-role keys', () => {
    const maliciousEnv = {
      VITE_SUPABASE_URL: 'https://valid-url.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_valid_key',
      VITE_PUBLIC_SITE_URL: 'https://chorematrix.vercel.app',
      SUPABASE_SERVICE_ROLE_KEY: 'secret_service_role_key_that_must_never_leak',
      SUPABASE_SECRET_KEY: 'secret_jwt_master_key',
      DATABASE_PASSWORD: 'supersecretpassword',
      AWS_SECRET_ACCESS_KEY: 'awssecret'
    };

    const safe = getClientSafeEnv({ env: maliciousEnv, envFile: '/nonexistent/.env' });
    assert.strictEqual(safe.VITE_SUPABASE_URL, 'https://valid-url.supabase.co');
    assert.strictEqual(safe.VITE_SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_valid_key');
    assert.strictEqual(safe.VITE_PUBLIC_SITE_URL, 'https://chorematrix.vercel.app');
    assert.strictEqual((safe as any).SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.strictEqual((safe as any).SUPABASE_SECRET_KEY, undefined);
    assert.strictEqual((safe as any).DATABASE_PASSWORD, undefined);
    assert.strictEqual((safe as any).AWS_SECRET_ACCESS_KEY, undefined);
    assert.strictEqual(Object.keys(safe).length, 3, 'Only the client-safe keys may be extracted');
  });

  it('filters placeholder credentials to protect offline fallback', () => {
    const placeholderEnv = {
      VITE_SUPABASE_URL: 'https://placeholder.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'placeholder_key'
    };
    const safe = getClientSafeEnv({ env: placeholderEnv, envFile: '/nonexistent/.env' });
    assert.deepStrictEqual(safe, {}, 'Placeholder values must not be marked safe');
  });

  it('build with valid env produces a configured Supabase client in the browser bundle', async () => {
    const testDist = path.join(rootDir, 'dist_test_valid');
    const validUrl = 'https://regression-test-app.supabase.co';
    const validKey = 'sb_publishable_regression_test_key_valid';

    await build({
      distDir: testDist,
      env: {
        VITE_SUPABASE_URL: validUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: validKey
      },
      envFile: '/nonexistent/.env',
      copyToRoot: false,
      silent: true,
      logLevel: 'silent'
    });

    try {
      const bundlePath = path.join(testDist, 'src', 'client.bundle.js');
      assert.ok(fs.existsSync(bundlePath), 'client.bundle.js must be generated');
      const bundleContent = fs.readFileSync(bundlePath, 'utf8');

      // Verify the credentials are appropriately embedded in define_window_ENV_default
      assert.ok(bundleContent.includes(validUrl), 'Bundle must contain injected URL');
      assert.ok(bundleContent.includes(validKey), 'Bundle must contain injected publishable key');

      // Execute bundle in simulated browser environment
      const previousWindow = (globalThis as any).window;
      (globalThis as any).window = globalThis;

      try {
        const bundleDataUri = 'data:text/javascript;base64,' + Buffer.from(bundleContent).toString('base64');
        const mod = await import(bundleDataUri);

        assert.strictEqual(mod.isSupabaseConfigured, true, 'isSupabaseConfigured must be true when env is valid');
        assert.ok(mod.supabase !== null && mod.supabase !== undefined, 'Supabase client instance must be created');
        const status = mod.getSupabaseConfigStatus();
        assert.strictEqual(status.isConfigured, true, 'Config status must report isConfigured: true');
        assert.deepStrictEqual(status.missingKeys, [], 'missingKeys must be empty');
      } finally {
        (globalThis as any).window = previousWindow;
      }
    } finally {
      if (fs.existsSync(testDist)) {
        fs.rmSync(testDist, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });

  it('build without env preserves offline fallback in the browser bundle', async () => {
    const testDist = path.join(rootDir, 'dist_test_offline');

    await build({
      distDir: testDist,
      env: {
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: ''
      },
      envFile: '/nonexistent/.env',
      copyToRoot: false,
      silent: true,
      logLevel: 'silent'
    });

    try {
      const bundlePath = path.join(testDist, 'src', 'client.bundle.js');
      assert.ok(fs.existsSync(bundlePath), 'client.bundle.js must be generated');
      const bundleContent = fs.readFileSync(bundlePath, 'utf8');

      // Execute bundle in simulated browser environment
      const previousWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      try {
        const bundleDataUri = 'data:text/javascript;base64,' + Buffer.from(bundleContent).toString('base64');
        const mod = await import(bundleDataUri);

        assert.strictEqual(mod.isSupabaseConfigured, false, 'isSupabaseConfigured must be false when env is absent');
        assert.strictEqual(mod.supabase, null, 'Supabase client instance must be null in offline mode');
        const status = mod.getSupabaseConfigStatus();
        assert.strictEqual(status.isConfigured, false, 'Config status must report isConfigured: false');
        assert.ok(status.missingKeys.includes('VITE_SUPABASE_URL'), 'missingKeys must list VITE_SUPABASE_URL');
        assert.ok(status.missingKeys.includes('VITE_SUPABASE_PUBLISHABLE_KEY'), 'missingKeys must list VITE_SUPABASE_PUBLISHABLE_KEY');
      } finally {
        (globalThis as any).window = previousWindow;
      }
    } finally {
      if (fs.existsSync(testDist)) {
        fs.rmSync(testDist, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });

  it('guarantees no secret/service-role variable is included in the output bundle', async () => {
    const testDist = path.join(rootDir, 'dist_test_security');
    const secretValue = 'CRITICAL_SECRET_SERVICE_ROLE_KEY_99999_NEVER_EXPOSE';

    await build({
      distDir: testDist,
      env: {
        VITE_SUPABASE_URL: 'https://security-test.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_safe_key',
        SUPABASE_SERVICE_ROLE_KEY: secretValue,
        SERVICE_ROLE_KEY: secretValue,
        SUPABASE_SECRET_KEY: secretValue
      } as any,
      envFile: '/nonexistent/.env',
      copyToRoot: false,
      silent: true,
      logLevel: 'silent'
    });

    try {
      const bundlePath = path.join(testDist, 'src', 'client.bundle.js');
      const bundleContent = fs.readFileSync(bundlePath, 'utf8');

      assert.strictEqual(
        bundleContent.includes(secretValue),
        false,
        'CRITICAL SECURITY: Secret service-role value must NEVER appear anywhere in the bundle'
      );
      assert.strictEqual(
        bundleContent.includes('SUPABASE_SERVICE_ROLE_KEY'),
        false,
        'Bundle must not reference SUPABASE_SERVICE_ROLE_KEY in define'
      );
    } finally {
      if (fs.existsSync(testDist)) {
        fs.rmSync(testDist, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }
  });

  it('guarantees actual credential values are not printed to logs during build', async () => {
    const testDist = path.join(rootDir, 'dist_test_logs');
    const sensitiveUrl = 'https://sensitive-corp-domain.supabase.co';
    const sensitiveKey = 'sb_publishable_sensitive_token_super_secret_5555';

    let capturedLogs = '';
    const origLog = console.log;
    const origInfo = console.info;
    const origWarn = console.warn;
    const origError = console.error;

    console.log = (...args: any[]) => { capturedLogs += args.join(' ') + '\n'; };
    console.info = (...args: any[]) => { capturedLogs += args.join(' ') + '\n'; };
    console.warn = (...args: any[]) => { capturedLogs += args.join(' ') + '\n'; };
    console.error = (...args: any[]) => { capturedLogs += args.join(' ') + '\n'; };

    try {
      await build({
        distDir: testDist,
        env: {
          VITE_SUPABASE_URL: sensitiveUrl,
          VITE_SUPABASE_PUBLISHABLE_KEY: sensitiveKey
        },
        envFile: '/nonexistent/.env',
        copyToRoot: false,
        silent: false,
        logLevel: 'info'
      });
    } finally {
      console.log = origLog;
      console.info = origInfo;
      console.warn = origWarn;
      console.error = origError;

      if (fs.existsSync(testDist)) {
        fs.rmSync(testDist, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }

    assert.strictEqual(
      capturedLogs.includes(sensitiveUrl),
      false,
      'Build logs must not contain the Supabase URL'
    );
    assert.strictEqual(
      capturedLogs.includes(sensitiveKey),
      false,
      'Build logs must not contain the Supabase Publishable Key'
    );
    assert.ok(
      capturedLogs.includes('Client environment: Configured (cloud credentials injected)'),
      'Build logs must confirm configuration status without leaking credential values'
    );
  });
});
