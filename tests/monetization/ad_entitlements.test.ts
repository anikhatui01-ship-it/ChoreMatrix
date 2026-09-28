import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  resolveAdEntitlement,
  AdSlot,
  HouseAdProvider,
  DisabledProvider,
  ExternalNetworkProvider
} from '../../src/monetization/adSlot.ts';
import { PRICING_CONFIG, isTierAdFree, getTierById } from '../../src/config/pricing.ts';

// Lightweight Mock HTMLElement for Node environment
function createMockElement(): HTMLElement {
  const elem = {
    style: { display: '' },
    innerHTML: '',
    className: '',
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  return elem as unknown as HTMLElement;
}

describe('Ad Monetization & Entitlement Architecture', () => {
  it('confirms centralized pricing configuration dictates ad-free entitlement status', () => {
    const freeTier = getTierById('free');
    const proTier = getTierById('household_pro');
    const plusTier = getTierById('household_plus');

    assert.strictEqual(freeTier?.adFree, false, 'Free tier must have adFree = false');
    assert.strictEqual(proTier?.adFree, true, 'Household Pro tier must have adFree = true');
    assert.strictEqual(plusTier?.adFree, true, 'Household Plus tier must have adFree = true');

    assert.strictEqual(isTierAdFree('free'), false);
    assert.strictEqual(isTierAdFree('household_pro'), true);
    assert.strictEqual(isTierAdFree('household_plus'), true);
    assert.strictEqual(isTierAdFree('unknown_tier'), false, 'Unknown tiers must default to ad-enabled');
  });

  it('FREE user: AdSlot renders house ad container with sponsorship disclosures', async () => {
    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);

    const user = { id: 'usr_free_123' };
    const mockFetcher = async () => ({ plan_tier: 'free' });

    await adSlot.init(user, mockFetcher);

    assert.strictEqual(adSlot.getState(), 'free-tier');
    assert.strictEqual(mockContainer.style.display, 'block');
    assert.ok(mockContainer.innerHTML.includes('Sponsor Notice · Free Tier'), 'Must include sponsor notice');
    assert.ok(mockContainer.innerHTML.includes('Development Ad Placement Placeholder'), 'Must identify as development placeholder');
    assert.ok(mockContainer.innerHTML.includes('/upgrade.html?plan=pro'), 'Must link to upgrade page');
    assert.ok(!mockContainer.innerHTML.includes('googlesyndication'), 'Must contain zero external ad scripts');
  });

  it('PAID user (Household Pro): AdSlot does not render anything', async () => {
    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);

    const user = { id: 'usr_pro_456' };
    const mockFetcher = async () => ({ plan_tier: 'household_pro' });

    await adSlot.init(user, mockFetcher);

    assert.strictEqual(adSlot.getState(), 'paid-tier');
    assert.strictEqual(mockContainer.style.display, 'none', 'Paid user container must be hidden');
    assert.strictEqual(mockContainer.innerHTML, '', 'Paid user container must have empty innerHTML');
  });

  it('PAID user (Household Plus): AdSlot does not render anything', async () => {
    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);

    const user = { id: 'usr_plus_789' };
    const mockFetcher = async () => ({ plan_tier: 'household_plus' });

    await adSlot.init(user, mockFetcher);

    assert.strictEqual(adSlot.getState(), 'paid-tier');
    assert.strictEqual(mockContainer.style.display, 'none', 'Paid user container must be hidden');
    assert.strictEqual(mockContainer.innerHTML, '', 'Paid user container must have empty innerHTML');
  });

  it('Unauthenticated public page: no personalized ad entitlement lookup', async () => {
    let fetcherCalled = false;
    const mockFetcher = async (uid: string) => {
      fetcherCalled = true;
      return { plan_tier: 'household_pro' };
    };

    // Anonymous public visitor
    const entitlement = await resolveAdEntitlement(null, mockFetcher);
    assert.strictEqual(entitlement, 'free-tier');
    assert.strictEqual(fetcherCalled, false, 'profileFetcher must NEVER be invoked for unauthenticated visitors');

    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);
    await adSlot.init(null);
    assert.strictEqual(adSlot.getState(), 'free-tier');
    assert.strictEqual(mockContainer.style.display, 'block');
  });

  it('Unknown / loading plan state: no incorrect paid/free flicker', () => {
    const mockContainer = createMockElement();
    mockContainer.style.display = 'block'; // simulate prior visible state

    // On constructor instantiate, container must immediately be hidden to prevent flicker
    const adSlot = new AdSlot(mockContainer);
    assert.strictEqual(adSlot.getState(), 'loading');
    assert.strictEqual(mockContainer.style.display, 'none', 'Container must be hidden while plan state is unknown/loading');
  });

  it('Changing from free → paid: ads disappear after entitlement refresh', async () => {
    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);
    const user = { id: 'usr_dyn_1' };

    let currentTier = 'free';
    const mockFetcher = async () => ({ plan_tier: currentTier });

    // Initial free tier
    await adSlot.init(user, mockFetcher);
    assert.strictEqual(adSlot.getState(), 'free-tier');
    assert.strictEqual(mockContainer.style.display, 'block');
    assert.ok(mockContainer.innerHTML.length > 0);

    // User upgrades to Pro
    currentTier = 'household_pro';
    await adSlot.refresh(user, mockFetcher);

    assert.strictEqual(adSlot.getState(), 'paid-tier');
    assert.strictEqual(mockContainer.style.display, 'none');
    assert.strictEqual(mockContainer.innerHTML, '');
  });

  it('Changing from paid → free: ads return after entitlement refresh', async () => {
    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);
    const user = { id: 'usr_dyn_2' };

    let currentTier = 'household_pro';
    const mockFetcher = async () => ({ plan_tier: currentTier });

    // Initial paid tier
    await adSlot.init(user, mockFetcher);
    assert.strictEqual(adSlot.getState(), 'paid-tier');
    assert.strictEqual(mockContainer.style.display, 'none');

    // Subscription expires or cancels back to Free
    currentTier = 'free';
    await adSlot.refresh(user, mockFetcher);

    assert.strictEqual(adSlot.getState(), 'free-tier');
    assert.strictEqual(mockContainer.style.display, 'block');
    assert.ok(mockContainer.innerHTML.includes('Sponsor Notice'));
  });

  it('Client-side manipulation of plan state: must not grant paid entitlement', async () => {
    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);

    // Attacker modifies client properties or claims to be Pro
    const manipulatedUser = { id: 'usr_attacker', plan_tier: 'household_pro', isPaid: true };

    // But authoritative profile fetcher returns free
    const authoritativeFetcher = async (uid: string) => {
      return { plan_tier: 'free' };
    };

    await adSlot.init(manipulatedUser, authoritativeFetcher);

    assert.strictEqual(
      adSlot.getState(),
      'free-tier',
      'Client manipulation of user object must NOT grant paid entitlement'
    );
    assert.strictEqual(mockContainer.style.display, 'block');
  });

  it('Authoritative fetcher error safely defaults to free-tier (fail-safe)', async () => {
    const mockContainer = createMockElement();
    const adSlot = new AdSlot(mockContainer);

    const failingFetcher = async () => {
      throw new Error('Database network timeout');
    };

    await adSlot.init({ id: 'usr_err' }, failingFetcher);
    assert.strictEqual(adSlot.getState(), 'free-tier');
  });

  it('ExternalNetworkProvider remains strictly inactive and renders nothing', () => {
    const mockContainer = createMockElement();
    const externalProvider = new ExternalNetworkProvider();

    externalProvider.render(mockContainer);

    assert.strictEqual(mockContainer.style.display, 'none');
    assert.strictEqual(mockContainer.innerHTML, '');
  });
});
