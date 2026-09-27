/**
 * ChoreMatrix Standardized Site Footer Component
 */

export function renderFooter() {
  const footerContainer = document.getElementById('globalFooter');
  if (!footerContainer) return;

  const currentYear = new Date().getFullYear();

  footerContainer.innerHTML = `
    <footer class="site-footer">
      <div class="shell">
        <div class="footer-grid">
          <div class="footer-col">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
              <div class="brandmark" style="width:28px; height:28px; font-size:12px;">CM</div>
              <strong style="color:var(--ink); font-size:15px;">ChoreMatrix</strong>
            </div>
            <p style="margin:0 0 12px; line-height:1.45; color:var(--muted); max-width:320px;">
              Deterministic household workload optimizer. Describe your household, members, and constraints to calculate balanced, workable allocations.
            </p>
            <div style="font-size:11px; color:var(--muted);">
              <strong>Entity:</strong> [ChoreMatrix Legal Entity Placeholder]<br>
              <strong>Contact:</strong> <a href="mailto:support@chorematrix.com">support@chorematrix.com</a><br>
              <strong>Address:</strong> [Registered Business Address Placeholder]
            </div>
          </div>

          <div class="footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="/how-it-works.html">How It Works</a></li>
              <li><a href="/pricing.html">Pricing & Trials</a></li>
              <li><a href="/why-chorematrix.html">Why ChoreMatrix</a></li>
              <li><a href="/app.html">Launch Optimizer</a></li>
            </ul>
          </div>

          <div class="footer-col">
            <h4>Account & Security</h4>
            <ul>
              <li><a href="/login.html">Sign In</a></li>
              <li><a href="/signup.html">Create Account</a></li>
              <li><a href="/account.html">Account & Devices</a></li>
              <li><a href="/forgot-password.html">Reset Password</a></li>
            </ul>
          </div>

          <div class="footer-col">
            <h4>Legal & Privacy</h4>
            <ul>
              <li><a href="/privacy.html">Privacy Policy</a></li>
              <li><a href="/terms.html">Terms of Service</a></li>
              <li><a href="/cookies.html">Cookie Policy</a></li>
              <li><a href="/data-rights.html">Data Rights & Export</a></li>
              <li><a href="#" id="btnManageCookies">Cookie Preferences</a></li>
            </ul>
          </div>
        </div>

        <div class="footer-bottom">
          <div>
            &copy; ${currentYear} ChoreMatrix. All rights reserved. Mathematical workload planning aid.
          </div>
          <div style="display:flex; gap:16px;">
            <a href="/privacy.html">Privacy</a>
            <a href="/terms.html">Terms</a>
            <a href="/data-rights.html">Data Rights</a>
          </div>
        </div>
      </div>
    </footer>
  `;

  const manageBtn = document.getElementById('btnManageCookies');
  if (manageBtn) {
    manageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('chorematrix:open-cookie-settings'));
    });
  }
}
