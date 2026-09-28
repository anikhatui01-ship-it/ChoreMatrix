import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Parse simple .env file into key-value pairs without adding third-party dependencies.
 * Strips comments, quotes, and trims whitespace.
 */
export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const env = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    } else {
      const hashIndex = val.indexOf('#');
      if (hashIndex > -1) {
        val = val.slice(0, hashIndex).trim();
      }
    }
    env[key] = val;
  }
  return env;
}

/**
 * Extract strictly client-safe Supabase environment variables.
 *
 * CRITICAL SECURITY GUARANTEES:
 * 1. Only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are permitted.
 * 2. Service role keys (e.g. SUPABASE_SERVICE_ROLE_KEY, secret keys) are NEVER extracted or injected.
 * 3. Never prints raw credentials to build output or logs.
 */
export function getClientSafeEnv(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const envFilePath = options.envFile || path.join(rootDir, '.env.local');
  const fileEnv = parseEnvFile(envFilePath);

  // Whitelist-only extraction of the client-safe variables
  const safeEnv = {};
  const candidateUrl = (
    options.env?.VITE_SUPABASE_URL ??
    fileEnv.VITE_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    ''
  ).trim();

  const candidateKey = (
    options.env?.VITE_SUPABASE_PUBLISHABLE_KEY ??
    fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    ''
  ).trim();

  const candidateSiteUrl = (
    options.env?.VITE_PUBLIC_SITE_URL ??
    fileEnv.VITE_PUBLIC_SITE_URL ??
    process.env.VITE_PUBLIC_SITE_URL ??
    ''
  ).trim();

  if (candidateUrl && !candidateUrl.includes('placeholder')) {
    safeEnv.VITE_SUPABASE_URL = candidateUrl;
  }
  if (candidateKey && !candidateKey.includes('placeholder')) {
    safeEnv.VITE_SUPABASE_PUBLISHABLE_KEY = candidateKey;
  }
  if (candidateSiteUrl && !candidateSiteUrl.includes('placeholder')) {
    safeEnv.VITE_PUBLIC_SITE_URL = candidateSiteUrl.replace(/\/+$/, '');
  }

  return safeEnv;
}

export async function build(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const distDir = options.distDir || path.join(rootDir, 'dist');

  // 1. Clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(path.join(distDir, 'src', 'styles'), { recursive: true });

  // 2. Bundle optimizer to dist/optimizer.bundle.js
  const distOptimizerBundle = path.join(distDir, 'optimizer.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src', 'optimizer', 'index.ts')],
    bundle: true,
    format: 'esm',
    outfile: distOptimizerBundle,
    target: ['es2022', 'chrome100', 'firefox100', 'safari15', 'edge100'],
    logLevel: options.logLevel || 'info'
  });

  // 3. Bundle client services (auth, nav, footer, cookies, pricing, persistence)
  const distClientBundle = path.join(distDir, 'src', 'client.bundle.js');
  const safeEnv = getClientSafeEnv(options);
  const define = {};
  const isConfigured = Boolean(safeEnv.VITE_SUPABASE_URL && safeEnv.VITE_SUPABASE_PUBLISHABLE_KEY);

  if (isConfigured) {
    define['window.__ENV__'] = JSON.stringify(safeEnv);
  }

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src', 'client.ts')],
    bundle: true,
    format: 'esm',
    outfile: distClientBundle,
    target: ['es2022', 'chrome100', 'firefox100', 'safari15', 'edge100'],
    define,
    logLevel: options.logLevel || 'info'
  });

  // Keep local copies in root / src so local dev servers continue working seamlessly
  if (options.copyToRoot !== false) {
    fs.copyFileSync(distOptimizerBundle, path.join(rootDir, 'optimizer.bundle.js'));
    fs.copyFileSync(distOptimizerBundle, path.join(rootDir, 'src', 'optimizer.bundle.js'));
    fs.copyFileSync(distClientBundle, path.join(rootDir, 'src', 'client.bundle.js'));
  }

  // 4. Copy styles to dist
  fs.copyFileSync(
    path.join(rootDir, 'src', 'styles', 'common.css'),
    path.join(distDir, 'src', 'styles', 'common.css')
  );

  // 5. Copy all production HTML pages
  const htmlFiles = [
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
    'app.html'
  ];

  for (const file of htmlFiles) {
    const srcPath = path.join(rootDir, file);
    if (fs.existsSync(srcPath)) {
      let content = fs.readFileSync(srcPath, 'utf8');
      // Normalize relative script paths for production
      content = content.replace(/from\s+['"](?:\.\/src|\/src|\.)\/optimizer\.bundle\.js['"]/g, "from './optimizer.bundle.js'");
      fs.writeFileSync(path.join(distDir, file), content, 'utf8');
    }
  }

  // 6. Verify dist directory
  if (!options.silent) {
    const rootDistFiles = fs.readdirSync(distDir);
    console.log(`\nClient environment: ${isConfigured ? 'Configured (cloud credentials injected)' : 'Offline fallback (credentials absent)'}`);
    console.log(`Production build complete.`);
    console.log(`Output directory: ${distDir}`);
    console.log(`Root files in dist:`, rootDistFiles);
  }
}

const isDirectCliRun =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isDirectCliRun) {
  build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

