/**
 * ChoreMatrix Ad Monetization & Entitlement Architecture
 *
 * BUSINESS RULES:
 * 1. Free Tier: Ads enabled (restrained development placeholder / house ad).
 * 2. Any Paid Tier (Household Pro, Household Plus): Ads strictly disabled (entitlement, not a preference).
 * 3. Authoritative Check: Uses authenticated Supabase profile data (plan_tier).
 *    NEVER trusts URL parameters, localStorage, or client cookies for paid entitlement.
 * 4. External ad networks are strictly disabled in this phase.
 */

import { isTierAdFree } from '../config/pricing.ts';

export type AdSlotState = 'loading' | 'free-tier' | 'paid-tier' | 'disabled';

export interface AdProvider {
  name: string;
  render(container: HTMLElement, context?: Record<string, any>): void;
  destroy(container: HTMLElement): void;
}

/**
 * DisabledProvider: Renders nothing. Used when ads are disabled or user is on a paid tier.
 */
export class DisabledProvider implements AdProvider {
  name = 'disabled';
  render(container: HTMLElement): void {
    container.innerHTML = '';
    container.style.display = 'none';
  }
  destroy(container: HTMLElement): void {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

/**
 * HouseAdProvider: Renders a restrained, calm in-house sponsorship / pro-upgrade notice for Free Tier.
 * Contains no third-party scripts, tracking pixels, or cookies.
 */
export class HouseAdProvider implements AdProvider {
  name = 'house';

  render(container: HTMLElement, context: Record<string, any> = {}): void {
    container.style.display = 'block';
    container.innerHTML = `
      <div class="ad-slot-card" role="complementary" aria-label="Sponsorship notice" style="
        background: var(--panel-subtle);
        border: 1px dashed var(--line);
        border-radius: var(--radius);
        padding: 16px 20px;
        margin-top: 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      ">
        <div style="flex: 1; min-width: 240px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span class="badge" style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; background: var(--secondary); color: var(--muted);">
              Sponsor Notice · Free Tier
            </span>
            <span style="font-size: 11px; color: var(--muted);">Development Ad Placement Placeholder</span>
          </div>
          <div style="font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 2px;">
            Need 4-week multi-week rotation & cloud sync?
          </div>
          <div style="font-size: 12px; color: var(--muted); line-height: 1.4;">
            Household Pro removes all ads, balances heavy chores across 4 weeks, and saves across devices.
          </div>
        </div>
        <div>
          <a href="/upgrade.html?plan=household_pro" class="btn small" style="white-space: nowrap; border-color: var(--line-subtle);">
            View Pro Plan
          </a>
        </div>
      </div>
    `;
  }

  destroy(container: HTMLElement): void {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

/**
 * ExternalNetworkProvider: Stubbed external advertising provider.
 * Strictly inactive in this phase. Throws or prevents runtime script injection.
 */
export class ExternalNetworkProvider implements AdProvider {
  name = 'external-network-disabled';

  render(container: HTMLElement): void {
    console.warn('[ChoreMatrix AdSlot] External ad network provider is disabled by policy. Falling back to disabled state.');
    container.innerHTML = '';
    container.style.display = 'none';
  }

  destroy(container: HTMLElement): void {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

/**
 * Authoritatively resolves user's ad entitlement based on profile record.
 * NEVER trusts client-side storage or URL parameters for granting paid ad-free status.
 */
export async function resolveAdEntitlement(
  user: { id: string } | null,
  profileFetcher?: (userId: string) => Promise<{ plan_tier: string } | null>
): Promise<AdSlotState> {
  // Unauthenticated visitor on public demo page has no personalized ad entitlement
  if (!user) {
    return 'free-tier';
  }

  if (!profileFetcher) {
    // If no fetcher provided, default to free-tier
    return 'free-tier';
  }

  try {
    const profile = await profileFetcher(user.id);
    const planTier = profile?.plan_tier || 'free';
    
    // Authoritative check against centralized tier configuration
    if (isTierAdFree(planTier)) {
      return 'paid-tier';
    }
    return 'free-tier';
  } catch (err) {
    console.warn('[ChoreMatrix AdSlot] Error resolving ad entitlement:', err);
    // On error, default to free-tier
    return 'free-tier';
  }
}

/**
 * AdSlot Component Controller
 */
export class AdSlot {
  private container: HTMLElement | null = null;
  private state: AdSlotState = 'loading';
  private provider: AdProvider;

  constructor(
    target: HTMLElement | string,
    provider: AdProvider = new HouseAdProvider()
  ) {
    if (typeof target === 'string') {
      this.container = document.querySelector(target);
    } else {
      this.container = target;
    }
    this.provider = provider;

    // Loading state: do NOT flash ads before plan resolves
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  getState(): AdSlotState {
    return this.state;
  }

  async init(
    user: { id: string } | null,
    profileFetcher?: (userId: string) => Promise<{ plan_tier: string } | null>
  ): Promise<void> {
    this.state = 'loading';
    if (this.container) {
      this.container.style.display = 'none';
    }

    const resolvedState = await resolveAdEntitlement(user, profileFetcher);
    this.applyState(resolvedState);
  }

  async refresh(
    user: { id: string } | null,
    profileFetcher?: (userId: string) => Promise<{ plan_tier: string } | null>
  ): Promise<void> {
    await this.init(user, profileFetcher);
  }

  private applyState(newState: AdSlotState): void {
    this.state = newState;
    if (!this.container) return;

    if (this.state === 'free-tier') {
      this.provider.render(this.container);
    } else {
      // Paid tier or disabled: render NOTHING
      this.provider.destroy(this.container);
      this.container.innerHTML = '';
      this.container.style.display = 'none';
    }
  }

  destroy(): void {
    if (this.container) {
      this.provider.destroy(this.container);
      this.container.innerHTML = '';
      this.container.style.display = 'none';
    }
  }
}
