# 13 — Monetization

## Principle

Do not charge for the first successful calculation until the product demonstrates repeat value.

## Free tier hypothesis

- one household
- core optimizer
- basic task presets
- first result
- basic rebalancing

## Paid hypothesis

Possible premium value:

- multiple saved households
- multi-week rotation
- advanced constraints
- custom workload models
- historical plans
- household members/invites
- advanced sharing
- exports/print packs
- recurring automatic replanning

## Pricing experiments

Initial experiments could test:

### Option A

$4.99/month or $39/year

### Option B

$7.99/month or $59/year

### Option C

One-time household plan purchase + optional recurring tier

Do not choose final pricing from competitor pricing alone. Test whether the product's output creates repeat willingness to pay.

## What should remain free

The first successful optimization should remain free enough to make the product naturally shareable and SEO-friendly.

## Revenue danger

The major risk is that users perceive the optimizer as a one-time calculator rather than subscription software.

The business model therefore depends on proving at least one repeat use case:

- weekly replanning
- rotating responsibilities
- changing schedules
- household membership changes
- seasonal work
- recurring household load optimization

## Advertising & Entitlement Architecture

ChoreMatrix employs a strict product entitlement model for advertisements:

- **Free Plan**: Ads enabled. Served via restrained, calm in-house sponsor notices / pro upgrade placeholders (`HouseAdProvider`). No tracking or external network scripts.
- **Paid Plans (Household Pro, Household Plus)**: Ads strictly disabled (`DisabledProvider`). This is an authoritative server-profile entitlement (`profile.plan_tier`), never a client-side preference or bypassable via URL query params or localStorage.
- **Loading State**: Ads remain hidden during plan resolution to prevent flashing ads to paid subscribers.
- **External Ad Networks**: Strictly disabled in this phase (`ExternalNetworkProvider` inactive). Activation of third-party networks requires:
  1. Privacy policy review & partner disclosures
  2. Cookie policy audit and registration
  3. CMP / consent integration
  4. Security & DOM isolation audit
  5. Core Web Vitals performance review

