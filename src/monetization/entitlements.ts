/**
 * ChoreMatrix Canonical Entitlement Engine
 *
 * Single source of truth for user planning-horizon and feature authorization.
 *
 * Rules:
 * 1. Unauthenticated visitors are always treated as Free tier (maxPlanningWeeks = 1).
 * 2. Authenticated Free users have maxPlanningWeeks = 1.
 * 3. Pro and Plus users have maxPlanningWeeks = 4.
 * 4. Missing, unresolved, or error states strictly default to Free (1 week).
 * 5. Client manipulation of localStorage, query params, DOM, or payload is rejected.
 */

export interface PlanningEntitlement {
  tier: 'free' | 'pro' | 'plus';
  maxPlanningWeeks: 1 | 4;
  isPaid: boolean;
  allowedWeeks: number[];
}

const FREE_ENTITLEMENT: PlanningEntitlement = Object.freeze({
  tier: 'free',
  maxPlanningWeeks: 1,
  isPaid: false,
  allowedWeeks: [1]
});

/**
 * Synchronous canonical entitlement resolver.
 * Inspects a profile row or user record and derives the effective planning entitlement.
 */
export function getPlanningEntitlement(userOrProfile?: any | null): PlanningEntitlement {
  if (!userOrProfile) {
    return FREE_ENTITLEMENT;
  }

  // Extract candidate tier
  const rawTier = (
    userOrProfile.plan_tier ??
    userOrProfile.tier ??
    userOrProfile.plan ??
    ''
  );

  const tier = String(rawTier).toLowerCase().trim();
  const status = String(userOrProfile.subscription_status ?? '').toLowerCase().trim();

  // If explicitly cancelled, revert to Free
  if (status === 'canceled' || status === 'cancelled') {
    return FREE_ENTITLEMENT;
  }

  if (tier === 'pro') {
    return {
      tier: 'pro',
      maxPlanningWeeks: 4,
      isPaid: true,
      allowedWeeks: [1, 2, 3, 4]
    };
  }

  if (tier === 'plus') {
    return {
      tier: 'plus',
      maxPlanningWeeks: 4,
      isPaid: true,
      allowedWeeks: [1, 2, 3, 4]
    };
  }

  // Any other value (free, unmapped, missing, hack attempt) defaults strictly to Free
  return FREE_ENTITLEMENT;
}

/**
 * Asynchronous entitlement resolver that calls an authoritative profile fetcher.
 * Guarantees safe fallback to Free if unauthenticated, network fails, or profile missing.
 */
export async function resolvePlanningEntitlement(
  user: { id: string } | null,
  profileFetcher?: (userId: string) => Promise<{ plan_tier?: string; subscription_status?: string } | null>
): Promise<PlanningEntitlement> {
  if (!user || !profileFetcher) {
    return FREE_ENTITLEMENT;
  }

  try {
    const profile = await profileFetcher(user.id);
    return getPlanningEntitlement(profile);
  } catch (err) {
    console.warn('[ChoreMatrix Entitlements] Profile fetch error, falling back to Free entitlement:', err);
    return FREE_ENTITLEMENT;
  }
}

/**
 * Enforces planning horizon constraints against an authoritative entitlement.
 * Safely clamps/normalizes client values.
 */
export function enforcePlanningHorizon(
  requestedWeeks: any,
  entitlement?: PlanningEntitlement | null
): number {
  const safeEntitlement = entitlement || FREE_ENTITLEMENT;
  const numWeeks = Math.floor(Number(requestedWeeks)) || 1;

  if (!safeEntitlement.isPaid || safeEntitlement.maxPlanningWeeks === 1) {
    return 1;
  }

  return Math.max(1, Math.min(safeEntitlement.maxPlanningWeeks, numWeeks));
}
