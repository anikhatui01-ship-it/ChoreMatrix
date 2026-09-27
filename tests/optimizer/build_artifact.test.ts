import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Production Build Output (dist/)', () => {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  const distHtmlPath = path.join(distDir, 'index.html');
  const distBundlePath = path.join(distDir, 'optimizer.bundle.js');

  it('verifies that dist/ exists and contains exactly the required runtime files', () => {
    assert.ok(fs.existsSync(distDir), 'dist/ directory must exist after build');
    const files = fs.readdirSync(distDir);
    assert.deepStrictEqual(
      files.sort(),
      ['index.html', 'optimizer.bundle.js'].sort(),
      'dist/ must contain ONLY index.html and optimizer.bundle.js'
    );
  });

  it('verifies that dist/index.html correctly imports ./optimizer.bundle.js', () => {
    assert.ok(fs.existsSync(distHtmlPath), 'dist/index.html must exist');
    const html = fs.readFileSync(distHtmlPath, 'utf8');
    assert.ok(
      html.includes("from './optimizer.bundle.js'"),
      'dist/index.html must import from ./optimizer.bundle.js'
    );
    assert.ok(
      !html.includes("from './src/optimizer.bundle.js'") && !html.includes("from '/src/optimizer.bundle.js'"),
      'dist/index.html must not reference src/'
    );
  });

  it('verifies that dist/optimizer.bundle.js is a valid ESM bundle containing optimizer exports', () => {
    assert.ok(fs.existsSync(distBundlePath), 'dist/optimizer.bundle.js must exist');
    const bundleContent = fs.readFileSync(distBundlePath, 'utf8');
    assert.ok(bundleContent.length > 5000, 'optimizer.bundle.js must be a substantial compiled bundle');
    assert.ok(bundleContent.includes('runOptimization'), 'optimizer.bundle.js must export runOptimization');
    assert.ok(bundleContent.includes('rebalanceHousehold'), 'optimizer.bundle.js must export rebalanceHousehold');
  });

  it('ensures no development files or markdown docs leak into dist/', () => {
    const files = fs.readdirSync(distDir);
    for (const file of files) {
      assert.ok(!file.endsWith('.md'), 'Markdown docs must not be in dist/');
      assert.ok(!file.endsWith('.ts'), 'TypeScript source files must not be in dist/');
      assert.ok(!file.endsWith('.json'), 'Package or config files must not be in dist/');
    }
  });

  it('verifies that local root development bundle also exists', () => {
    assert.ok(fs.existsSync(path.join(rootDir, 'optimizer.bundle.js')), 'Root optimizer.bundle.js must exist for local dev server');
  });
});
