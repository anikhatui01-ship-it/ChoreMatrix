import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Google AdSense Verification Code Installation Audit', () => {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  const expectedClientId = 'ca-pub-6399557140317733';
  const expectedScriptDomain = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

  const requiredHtmlPages = [
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
    'upgrade.html',
    'app.html',
    '404.html'
  ];

  it('verifies exact AdSense script tag is present inside <head> on all root HTML files', () => {
    for (const page of requiredHtmlPages) {
      const filePath = path.join(rootDir, page);
      assert.ok(fs.existsSync(filePath), `${page} must exist in root`);

      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes(expectedClientId), `${page} must contain client ID ${expectedClientId}`);
      assert.ok(content.includes(expectedScriptDomain), `${page} must reference official Google AdSense domain`);

      const headCloseIdx = content.indexOf('</head>');
      const scriptIdx = content.indexOf(expectedScriptDomain);
      assert.ok(headCloseIdx > -1, `${page} must have a closing </head> tag`);
      assert.ok(scriptIdx > -1 && scriptIdx < headCloseIdx, `${page} must place AdSense script inside <head>`);
    }
  });

  it('guarantees zero duplicate AdSense tags on any HTML file', () => {
    for (const page of requiredHtmlPages) {
      const filePath = path.join(rootDir, page);
      const content = fs.readFileSync(filePath, 'utf8');
      const matches = (content.match(new RegExp(expectedClientId, 'g')) || []).length;
      assert.strictEqual(matches, 1, `${page} must contain exactly ONE occurrence of AdSense client ID (no duplicates)`);
    }
  });

  it('verifies dist directory copies contain the AdSense verification code', () => {
    for (const page of requiredHtmlPages) {
      const distPath = path.join(distDir, page);
      assert.ok(fs.existsSync(distPath), `${page} must exist in dist`);

      const content = fs.readFileSync(distPath, 'utf8');
      assert.ok(content.includes(expectedClientId), `dist/${page} must retain AdSense client ID`);
      assert.ok(content.includes('crossorigin="anonymous"'), `dist/${page} must have crossorigin="anonymous" attribute`);
    }
  });

  it('verifies ads.txt exists in root and dist and contains exact authorized publisher record', () => {
    const rootAdsTxt = path.join(rootDir, 'ads.txt');
    const distAdsTxt = path.join(distDir, 'ads.txt');

    assert.ok(fs.existsSync(rootAdsTxt), 'ads.txt must exist in project root');
    assert.ok(fs.existsSync(distAdsTxt), 'ads.txt must exist in dist');

    const expectedRecord = 'google.com, pub-6399557140317733, DIRECT, f08c47fec0942fa0';

    const rootContent = fs.readFileSync(rootAdsTxt, 'utf8').trim();
    const distContent = fs.readFileSync(distAdsTxt, 'utf8').trim();

    assert.strictEqual(rootContent, expectedRecord, 'root ads.txt must match exact required record');
    assert.strictEqual(distContent, expectedRecord, 'dist ads.txt must match exact required record');
  });
});
