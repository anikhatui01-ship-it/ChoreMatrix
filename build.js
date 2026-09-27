import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

async function build() {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');

  // Ensure clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // 1. Bundle optimizer to dist/optimizer.bundle.js
  const distBundlePath = path.join(distDir, 'optimizer.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src', 'optimizer', 'index.ts')],
    bundle: true,
    format: 'esm',
    outfile: distBundlePath,
    target: ['es2022', 'chrome100', 'firefox100', 'safari15', 'edge100'],
    logLevel: 'info'
  });

  // 2. Prepare and copy index.html to dist/index.html
  const srcHtmlPath = path.join(rootDir, 'index.html');
  let html = fs.readFileSync(srcHtmlPath, 'utf8');

  // Ensure import resolves to ./optimizer.bundle.js
  html = html.replace(/from\s+['"](?:\.\/src|\/src|\.)\/optimizer\.bundle\.js['"]/g, "from './optimizer.bundle.js'");
  fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf8');

  // 3. Keep local development at root working by keeping bundle in root and src/
  fs.copyFileSync(distBundlePath, path.join(rootDir, 'optimizer.bundle.js'));
  fs.copyFileSync(distBundlePath, path.join(rootDir, 'src', 'optimizer.bundle.js'));

  // 4. Verify dist contents
  const filesInDist = fs.readdirSync(distDir);
  console.log(`\nProduction build complete.`);
  console.log(`Output directory: ${distDir}`);
  console.log(`Files in dist:`, filesInDist);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
