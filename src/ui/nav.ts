/**
 * ChoreMatrix Global Header & Navigation Component
 */

import { authService } from '../auth/session.ts';

export function renderNavbar(activePage: string = '') {
  const navContainer = document.getElementById('globalNavbar');
  if (!navContainer) return;

  const currentTheme = localStorage.getItem('chorematrix_theme') || 'system';

  navContainer.innerHTML = `
    <header class="header-nav">
      <div class="shell nav-container">
        <a href="/" class="brand">
          <div class="brandmark">CM</div>
          <div class="brand-text">
            <h1>ChoreMatrix</h1>
            <span>Workload Optimizer</span>
          </div>
        </a>

        <ul class="nav-links">
          <li><a href="/how-it-works.html" class="${activePage === 'how-it-works' ? 'active' : ''}">How It Works</a></li>
          <li><a href="/pricing.html" class="${activePage === 'pricing' ? 'active' : ''}">Pricing</a></li>
          <li><a href="/why-chorematrix.html" class="${activePage === 'why-chorematrix' ? 'active' : ''}">Why ChoreMatrix</a></li>
        </ul>

        <div class="nav-actions">
          <!-- Theme Switcher -->
          <div class="theme-switch" role="group" aria-label="Theme mode">
            <button type="button" class="theme-btn ${currentTheme === 'light' ? 'active' : ''}" data-theme-choice="light" title="Light theme" aria-pressed="${currentTheme === 'light'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              <span>Light</span>
            </button>
            <button type="button" class="theme-btn ${currentTheme === 'dark' ? 'active' : ''}" data-theme-choice="dark" title="Dark theme" aria-pressed="${currentTheme === 'dark'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              <span>Dark</span>
            </button>
            <button type="button" class="theme-btn ${currentTheme === 'system' ? 'active' : ''}" data-theme-choice="system" title="Follow system theme" aria-pressed="${currentTheme === 'system'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              <span>System</span>
            </button>
          </div>

          <div id="navAuthArea" style="display:flex; gap:8px;">
            <a href="/login.html" class="btn small">Log In</a>
            <a href="/app.html" class="btn small primary">Open App</a>
          </div>
        </div>
      </div>
    </header>
  `;

  // Attach theme switcher listeners
  navContainer.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const choice = (btn as HTMLElement).dataset.themeChoice || 'system';
      setAppTheme(choice);
    });
  });

  // Check auth state asynchronously to update navAuthArea
  authService.getSession().then(session => {
    const authArea = document.getElementById('navAuthArea');
    if (!authArea) return;
    if (session && session.user) {
      authArea.innerHTML = `
        <a href="/app.html" class="btn small ${activePage === 'app' ? 'primary' : ''}">Optimizer</a>
        <a href="/account.html" class="btn small ${activePage === 'account' ? 'primary' : ''}">Account</a>
      `;
    }
  }).catch(() => {});
}

function setAppTheme(choice: string) {
  try {
    localStorage.setItem('chorematrix_theme', choice);
  } catch (e) {}

  const isDark = choice === 'dark' || (choice === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-setting', choice);

  document.querySelectorAll('.theme-btn').forEach(btn => {
    const active = (btn as HTMLElement).dataset.themeChoice === choice;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
