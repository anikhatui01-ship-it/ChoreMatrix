# 16 — Test Plan

## Unit tests — optimizer

### Equal household

Same capacity + same load should produce near-even assignment.

### Unequal capacity

A 60-minute/day member should receive more work than a 20-minute/day member when both are eligible.

### Eligibility

A cooking task cannot be assigned to a member marked ineligible.

### Availability

A member unavailable on Saturday should not receive Saturday work when a feasible alternative exists.

### Overload

If total work exceeds total capacity, the system must flag a shortage.

### Impossible task

A task with zero eligible members must appear as unassigned.

### Rotation

Across multiple weeks, eligible members should receive recurring work with reasonable distribution.

### Reproducibility

Same normalized input + optimizer version = same result.

## UX tests

- First run under 3 minutes.
- User understands generated result without documentation.
- User can find how to rebalance.
- User understands why an assignment was made.
- User can identify overloaded members.

## Browser tests

Test current versions of:

- Chrome
- Edge
- Safari
- Firefox

## Responsive tests

Desktop first:

- 1440px
- 1280px
- 1024px

Mobile browser:

- 390px
- 430px

The mobile layout must remain usable even if desktop is the primary workspace.

## Product acceptance test

Give a household description to a first-time user without explaining the algorithm.

Observe:

1. Can they enter it?
2. Do they trust the result?
3. Do they understand imbalance?
4. Do they want to change constraints?
5. Would they share the result?
