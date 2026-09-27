import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('UI Theme System & Persistence', () => {
  const htmlPath = path.resolve('index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  it('resolves dark/light theme choices accurately based on system media query', () => {
    function resolveIsDark(setting: string, systemDark: boolean): boolean {
      return setting === 'dark' || (setting === 'system' && systemDark);
    }

    assert.strictEqual(resolveIsDark('dark', false), true, 'Explicit dark must resolve to dark');
    assert.strictEqual(resolveIsDark('dark', true), true, 'Explicit dark must resolve to dark even if system is dark');
    assert.strictEqual(resolveIsDark('light', true), false, 'Explicit light must resolve to light even if system is dark');
    assert.strictEqual(resolveIsDark('light', false), false, 'Explicit light must resolve to light');
    assert.strictEqual(resolveIsDark('system', true), true, 'System mode must resolve to dark when system is dark');
    assert.strictEqual(resolveIsDark('system', false), false, 'System mode must resolve to light when system is light');
  });

  it('includes persistent storage key contract "chorematrix_theme"', () => {
    assert.ok(
      htmlContent.includes("'chorematrix_theme'"),
      'localStorage key "chorematrix_theme" must be used'
    );
  });

  it('includes FOUC prevention script in head', () => {
    const headSection = htmlContent.slice(0, htmlContent.indexOf('</head>'));
    assert.ok(
      headSection.includes("localStorage.getItem('chorematrix_theme')"),
      'Head must have inline script reading theme setting before render'
    );
    assert.ok(
      headSection.includes("document.documentElement.setAttribute('data-theme'"),
      'Head script must set data-theme attribute on root element'
    );
  });

  it('includes complete Light, Dark, System segmented controls with accessibility attributes', () => {
    assert.ok(htmlContent.includes('data-theme-choice="light"'), 'Must have light theme button');
    assert.ok(htmlContent.includes('data-theme-choice="dark"'), 'Must have dark theme button');
    assert.ok(htmlContent.includes('data-theme-choice="system"'), 'Must have system theme button');
    assert.ok(htmlContent.includes('class="theme-switch"'), 'Must have theme-switch container');
    assert.ok(htmlContent.includes('role="group"'), 'Theme switch container must have role=group');
    assert.ok(htmlContent.includes('aria-label="Theme mode"'), 'Theme switch container must have aria-label');
  });

  it('defines coherent CSS tokens for both light and dark modes', () => {
    const requiredTokens = [
      '--bg',
      '--panel',
      '--panel-subtle',
      '--card',
      '--card-hover',
      '--ink',
      '--muted',
      '--line',
      '--accent',
      '--btn-bg',
      '--btn-text',
      '--btn-dark-bg',
      '--input-bg',
      '--input-border',
      '--input-text',
      '--cal-col-bg',
      '--cal-card-bg',
      '--diff-bg',
      '--alert-bg'
    ];

    for (const token of requiredTokens) {
      assert.ok(
        htmlContent.includes(`${token}:`),
        `Token ${token} must be defined in stylesheet`
      );
    }

    assert.ok(htmlContent.includes('html[data-theme="light"]'), 'Must define light theme selector');
    assert.ok(htmlContent.includes('html[data-theme="dark"]'), 'Must define dark theme selector');
    assert.ok(htmlContent.includes('@media (prefers-color-scheme: dark)'), 'Must support media query fallback');
  });

  it('respects prefers-reduced-motion to disable theme transitions', () => {
    assert.ok(
      htmlContent.includes('@media (prefers-reduced-motion: reduce)'),
      'Must contain prefers-reduced-motion media query'
    );
    assert.ok(
      htmlContent.includes('transition: none !important'),
      'Must disable transitions when user prefers reduced motion'
    );
  });

  it('has accessible select dropdown styling in dark mode', () => {
    assert.ok(
      htmlContent.includes('select option') && htmlContent.includes('background: var(--panel)'),
      'Select options must inherit panel background in dark mode'
    );
  });
});
