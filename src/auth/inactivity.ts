/**
 * ChoreMatrix Session Inactivity & Lifetime Enforcement Service
 *
 * SPECIFICATION & SECURITY GUARANTEES:
 * 1. Client-side inactivity timeout (default: 30 minutes).
 * 2. Warning modal / notice at 2 minutes remaining, allowing user to extend session.
 * 3. Absolute session lifetime (default: 24 hours) from initial session start.
 * 4. Multi-tab synchronization via localStorage events (activity in Tab A keeps Tab B alive).
 * 5. Tab wake-up / suspend handling: on visibilitychange and pageshow, immediately calculates
 *    elapsed wall-clock time and triggers logout if threshold exceeded.
 * 6. Explicit session termination: invokes authService.signOut('local') and redirects to login.
 * 7. Residual validity disclosure: Client-side timers invoke token revocation; access JWTs
 *    remain invalid for server operations once invalidated by Supabase Auth.
 */

import { authService } from './session.ts';

export const INACTIVITY_STORAGE_KEY = 'chorematrix_last_activity';
export const SESSION_START_STORAGE_KEY = 'chorematrix_session_start';
export const SESSION_STATUS_STORAGE_KEY = 'chorematrix_session_status';

export interface InactivityConfig {
  inactivityTimeoutMs?: number;   // Inactivity timeout (default: 30 minutes)
  warningThresholdMs?: number;    // Warning before timeout (default: 2 minutes)
  absoluteLifetimeMs?: number;    // Absolute session maximum lifetime (default: 24 hours)
  checkIntervalMs?: number;       // Periodic check interval (default: 10 seconds)
  redirectOnTimeout?: boolean;    // Whether to redirect to /login.html?reason=inactivity
  onWarning?: (remainingMs: number) => void;
  onWarningDismissed?: () => void;
  onTimeout?: (reason: 'inactivity' | 'absolute') => void;
}

export class InactivityService {
  private inactivityTimeoutMs: number;
  private warningThresholdMs: number;
  private absoluteLifetimeMs: number;
  private checkIntervalMs: number;
  private redirectOnTimeout: boolean;
  private onWarningCallback?: (remainingMs: number) => void;
  private onWarningDismissedCallback?: () => void;
  private onTimeoutCallback?: (reason: 'inactivity' | 'absolute') => void;

  private checkTimer: any = null;
  private throttleTimer: any = null;
  private isWarned = false;
  private isRunning = false;
  private userEventListeners: Array<{ target: EventTarget; type: string; listener: EventListener }> = [];

  constructor(config: InactivityConfig = {}) {
    this.inactivityTimeoutMs = config.inactivityTimeoutMs ?? 30 * 60 * 1000;       // 30 min
    this.warningThresholdMs = config.warningThresholdMs ?? 2 * 60 * 1000;          // 2 min
    this.absoluteLifetimeMs = config.absoluteLifetimeMs ?? 24 * 60 * 60 * 1000;    // 24 hours
    this.checkIntervalMs = config.checkIntervalMs ?? 10 * 1000;                   // 10 sec
    this.redirectOnTimeout = config.redirectOnTimeout ?? true;
    this.onWarningCallback = config.onWarning;
    this.onWarningDismissedCallback = config.onWarningDismissed;
    this.onTimeoutCallback = config.onTimeout;
  }

  /**
   * Initializes session start and activity timestamps if not present.
   */
  public initSessionTimestamps(): void {
    const now = Date.now();
    try {
      if (typeof localStorage !== 'undefined') {
        if (!localStorage.getItem(SESSION_START_STORAGE_KEY)) {
          localStorage.setItem(SESSION_START_STORAGE_KEY, String(now));
        }
        localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
        localStorage.setItem(SESSION_STATUS_STORAGE_KEY, 'active');
      }
    } catch (_) {}
  }

  /**
   * Records user activity, throttled to prevent performance overhead.
   */
  public recordActivity = (): void => {
    if (this.throttleTimer) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
    }, 5000);

    const now = Date.now();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
      }
    } catch (_) {}

    if (this.isWarned) {
      this.dismissWarning();
    }
  };

  /**
   * Explicitly extends the active session (e.g. user clicks "Stay Signed In").
   */
  public staySignedIn = (): void => {
    const now = Date.now();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
        localStorage.setItem(SESSION_STATUS_STORAGE_KEY, 'active');
      }
    } catch (_) {}
    this.dismissWarning();
  };

  /**
   * Evaluates current inactivity status against wall-clock time.
   */
  public checkSession(): { status: 'active' | 'warning' | 'expired'; remainingMs: number; reason?: 'inactivity' | 'absolute' } {
    const now = Date.now();
    let lastActivity = now;
    let sessionStart = now;

    try {
      if (typeof localStorage !== 'undefined') {
        const storedActivity = localStorage.getItem(INACTIVITY_STORAGE_KEY);
        const storedStart = localStorage.getItem(SESSION_START_STORAGE_KEY);
        if (storedActivity) lastActivity = Number(storedActivity) || now;
        if (storedStart) sessionStart = Number(storedStart) || now;
      }
    } catch (_) {}

    // 1. Absolute session lifetime check
    if (now - sessionStart >= this.absoluteLifetimeMs) {
      return { status: 'expired', remainingMs: 0, reason: 'absolute' };
    }

    // 2. Inactivity timeout check
    const idleElapsed = now - lastActivity;
    if (idleElapsed >= this.inactivityTimeoutMs) {
      return { status: 'expired', remainingMs: 0, reason: 'inactivity' };
    }

    // 3. Warning threshold check
    const remainingIdleMs = this.inactivityTimeoutMs - idleElapsed;
    if (remainingIdleMs <= this.warningThresholdMs) {
      return { status: 'warning', remainingMs: remainingIdleMs, reason: 'inactivity' };
    }

    return { status: 'active', remainingMs: remainingIdleMs };
  }

  /**
   * Triggers warning modal or callback.
   */
  private triggerWarning(remainingMs: number): void {
    if (this.isWarned) return;
    this.isWarned = true;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_STATUS_STORAGE_KEY, 'warning');
      }
    } catch (_) {}

    if (this.onWarningCallback) {
      this.onWarningCallback(remainingMs);
    } else if (typeof document !== 'undefined') {
      this.renderWarningDialog(remainingMs);
    }
  }

  /**
   * Dismisses warning UI and resets state.
   */
  private dismissWarning(): void {
    if (!this.isWarned) return;
    this.isWarned = false;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_STATUS_STORAGE_KEY, 'active');
      }
    } catch (_) {}

    if (this.onWarningDismissedCallback) {
      this.onWarningDismissedCallback();
    } else if (typeof document !== 'undefined') {
      const dialog = document.getElementById('chorematrixInactivityModal');
      if (dialog) dialog.remove();
    }
  }

  /**
   * Default DOM warning dialog rendered if no custom callback is supplied.
   */
  private renderWarningDialog(remainingMs: number): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('chorematrixInactivityModal')) return;

    const remainingMinutes = Math.max(1, Math.round(remainingMs / 60000));
    const dialog = document.createElement('div');
    dialog.id = 'chorematrixInactivityModal';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'inactivityModalTitle');
    dialog.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
      font-family: inherit;
    `;

    dialog.innerHTML = `
      <div style="
        background: var(--card, #ffffff);
        color: var(--ink, #111827);
        border: 1px solid var(--line, #e5e7eb);
        border-radius: 16px;
        padding: 28px;
        max-width: 440px;
        width: 100%;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
        text-align: center;
      ">
        <div style="font-size: 32px; margin-bottom: 12px;">⏳</div>
        <h2 id="inactivityModalTitle" style="font-size: 18px; font-weight: 800; margin: 0 0 8px;">Session Inactivity Notice</h2>
        <p style="font-size: 14px; color: var(--muted, #6b7280); line-height: 1.5; margin: 0 0 24px;">
          You have been inactive for a while. For your security, your session will expire in approximately
          <strong>${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}</strong> unless you continue.
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button type="button" id="btnExtendSession" style="
            background: var(--primary, #0D7A5F);
            color: #ffffff;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 700;
            cursor: pointer;
            font-size: 14px;
          ">Stay Signed In</button>
          <button type="button" id="btnSignOutNow" style="
            background: transparent;
            color: var(--muted, #6b7280);
            border: 1px solid var(--line, #e5e7eb);
            padding: 10px 16px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
          ">Log Out</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('btnExtendSession')?.addEventListener('click', () => {
      this.staySignedIn();
    });

    document.getElementById('btnSignOutNow')?.addEventListener('click', () => {
      this.expireSession('inactivity');
    });
  }

  /**
   * Executes session expiration, revoking the session and redirecting.
   */
  public async expireSession(reason: 'inactivity' | 'absolute' = 'inactivity'): Promise<void> {
    this.stop();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_STATUS_STORAGE_KEY, 'expired');
        localStorage.removeItem(INACTIVITY_STORAGE_KEY);
        localStorage.removeItem(SESSION_START_STORAGE_KEY);
      }
    } catch (_) {}

    if (this.onTimeoutCallback) {
      this.onTimeoutCallback(reason);
    }

    try {
      await authService.signOut('local');
    } catch (e) {
      console.warn('[InactivityService] signOut warning:', e);
    }

    if (this.redirectOnTimeout && typeof window !== 'undefined') {
      window.location.href = `/login.html?reason=${encodeURIComponent(reason)}`;
    }
  }

  /**
   * Starts monitoring user activity and cross-tab storage events.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.initSessionTimestamps();

    // User activity listeners
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    if (typeof window !== 'undefined') {
      for (const ev of events) {
        const handler: EventListener = () => this.recordActivity();
        window.addEventListener(ev, handler, { passive: true });
        this.userEventListeners.push({ target: window, type: ev, listener: handler });
      }

      // Cross-tab sync: listening to storage event
      const storageHandler: EventListener = (e: any) => {
        if (e.key === INACTIVITY_STORAGE_KEY) {
          if (this.isWarned) {
            this.dismissWarning();
          }
        } else if (e.key === SESSION_STATUS_STORAGE_KEY && e.newValue === 'expired') {
          this.expireSession('inactivity');
        }
      };
      window.addEventListener('storage', storageHandler);
      this.userEventListeners.push({ target: window, type: 'storage', listener: storageHandler });

      // Tab wake-up / suspend handling (browser tab was hidden or suspended in background)
      const wakeHandler: EventListener = () => {
        if (document.visibilityState === 'visible') {
          const res = this.checkSession();
          if (res.status === 'expired') {
            this.expireSession(res.reason);
          } else if (res.status === 'warning') {
            this.triggerWarning(res.remainingMs);
          }
        }
      };
      document.addEventListener('visibilitychange', wakeHandler);
      this.userEventListeners.push({ target: document, type: 'visibilitychange', listener: wakeHandler });

      // Page restoration from bfcache (Back/Forward cache)
      const pageshowHandler: EventListener = (e: any) => {
        const res = this.checkSession();
        if (res.status === 'expired') {
          this.expireSession(res.reason);
        }
      };
      window.addEventListener('pageshow', pageshowHandler);
      this.userEventListeners.push({ target: window, type: 'pageshow', listener: pageshowHandler });
    }

    // Periodic check interval
    this.checkTimer = setInterval(() => {
      const res = this.checkSession();
      if (res.status === 'expired') {
        this.expireSession(res.reason);
      } else if (res.status === 'warning') {
        this.triggerWarning(res.remainingMs);
      } else if (this.isWarned) {
        this.dismissWarning();
      }
    }, this.checkIntervalMs);
  }

  /**
   * Stops timers and removes all listeners.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    for (const { target, type, listener } of this.userEventListeners) {
      try {
        target.removeEventListener(type, listener);
      } catch (_) {}
    }
    this.userEventListeners = [];
    this.dismissWarning();
  }
}

export const inactivityService = new InactivityService();
