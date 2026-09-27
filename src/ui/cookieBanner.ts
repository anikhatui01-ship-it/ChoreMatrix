/**
 * ChoreMatrix Privacy & Cookie Consent Component
 * Zero Dark Patterns: Equal visual weight, honest disclosures, zero fake analytics.
 */

export interface CookieConsent {
  strictlyNecessary: true;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
}

const STORAGE_KEY = 'chorematrix_cookie_consent';

export function getCookieConsent(): CookieConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCookieConsent(consent: Partial<CookieConsent>) {
  const fullConsent: CookieConsent = {
    strictlyNecessary: true,
    preferences: consent.preferences ?? true,
    analytics: false, // Honesty: Analytics not implemented
    marketing: false, // Honesty: Marketing tracking not collected
    decidedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fullConsent));
  } catch (e) {}
  hideBanner();
  hideModal();
}

function hideBanner() {
  const el = document.getElementById('cookieBannerContainer');
  if (el) el.style.display = 'none';
}

function hideModal() {
  const el = document.getElementById('cookieModalContainer');
  if (el) el.style.display = 'none';
}

export function initCookieBanner() {
  const existing = getCookieConsent();

  // Create containers if not present
  if (!document.getElementById('cookieBannerContainer')) {
    const bannerDiv = document.createElement('div');
    bannerDiv.id = 'cookieBannerContainer';
    document.body.appendChild(bannerDiv);
  }

  if (!document.getElementById('cookieModalContainer')) {
    const modalDiv = document.createElement('div');
    modalDiv.id = 'cookieModalContainer';
    document.body.appendChild(modalDiv);
  }

  window.addEventListener('chorematrix:open-cookie-settings', () => {
    openCookieModal();
  });

  if (!existing) {
    showBanner();
  }
}

function showBanner() {
  const container = document.getElementById('cookieBannerContainer');
  if (!container) return;

  container.style.display = 'block';
  container.innerHTML = `
    <div class="cookie-banner" role="region" aria-label="Cookie & Storage Preferences">
      <div>
        <h3>Cookie & Privacy Choices</h3>
        <p>
          ChoreMatrix uses strictly necessary browser storage to preserve your authenticated session and Light/Dark theme preference.
          Optional analytics and third-party advertising tracking are <strong>not</strong> currently active.
        </p>
      </div>
      <div class="cookie-actions">
        <button type="button" class="btn small primary" id="btnAcceptAllCookies">Accept Preferences</button>
        <button type="button" class="btn small" id="btnRejectOptionalCookies">Strictly Necessary Only</button>
        <button type="button" class="btn small" id="btnOpenCookieModal">Customize</button>
      </div>
    </div>
  `;

  document.getElementById('btnAcceptAllCookies')?.addEventListener('click', () => {
    saveCookieConsent({ preferences: true });
  });

  document.getElementById('btnRejectOptionalCookies')?.addEventListener('click', () => {
    saveCookieConsent({ preferences: false });
  });

  document.getElementById('btnOpenCookieModal')?.addEventListener('click', () => {
    openCookieModal();
  });
}

function openCookieModal() {
  const current = getCookieConsent() || { strictlyNecessary: true, preferences: true, analytics: false, marketing: false };
  const container = document.getElementById('cookieModalContainer');
  if (!container) return;

  container.style.display = 'block';
  container.innerHTML = `
    <div style="position:fixed; inset:0; background:var(--modal-overlay); z-index:1100; display:grid; place-items:center; padding:20px;">
      <div class="panel" style="max-width:540px; width:100%; max-height:90vh; overflow-y:auto;" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="panel-head">
          <h2 id="modalTitle">Privacy & Storage Preferences</h2>
          <button type="button" class="btn small" id="btnCloseCookieModal">✕</button>
        </div>
        <p style="font-size:13px; color:var(--muted); margin-bottom:16px;">
          We believe in data minimization. Below is an honest breakdown of the storage used by ChoreMatrix.
        </p>

        <div style="display:grid; gap:14px; margin-bottom:20px;">
          <div style="padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--panel-subtle);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong>1. Strictly Necessary</strong>
              <span class="badge teal">Always Active</span>
            </div>
            <p style="margin:0; font-size:12px; color:var(--muted);">
              Essential for logging in, restoring your secure session, and storing your theme preference.
            </p>
          </div>

          <div style="padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--panel-subtle);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong>2. UI Preferences</strong>
              <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" id="chkPrefConsent" ${current.preferences ? 'checked' : ''} style="accent-color:var(--accent);">
                <span style="font-size:12px; font-weight:600;">Enable</span>
              </label>
            </div>
            <p style="margin:0; font-size:12px; color:var(--muted);">
              Remembers calendar vs table view layout, active week tab, and preset choices.
            </p>
          </div>

          <div style="padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--panel-subtle); opacity:0.75;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong>3. Analytics</strong>
              <span class="badge">Disabled (Not Implemented)</span>
            </div>
            <p style="margin:0; font-size:12px; color:var(--muted);">
              Product usage telemetry. Currently disabled; ChoreMatrix installs zero third-party analytics trackers.
            </p>
          </div>

          <div style="padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--panel-subtle); opacity:0.75;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <strong>4. Advertising & Marketing</strong>
              <span class="badge">None Collected</span>
            </div>
            <p style="margin:0; font-size:12px; color:var(--muted);">
              ChoreMatrix does not sell personal data or track users across external sites.
            </p>
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button type="button" class="btn small" id="btnCancelModal">Cancel</button>
          <button type="button" class="btn small primary" id="btnSaveCustomCookies">Save Preferences</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btnCloseCookieModal')?.addEventListener('click', hideModal);
  document.getElementById('btnCancelModal')?.addEventListener('click', hideModal);

  document.getElementById('btnSaveCustomCookies')?.addEventListener('click', () => {
    const chk = document.getElementById('chkPrefConsent') as HTMLInputElement | null;
    saveCookieConsent({ preferences: chk ? chk.checked : true });
  });
}
