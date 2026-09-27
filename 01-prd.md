# 01 — Product Requirements Document (PRD)

## Status

Draft v0.1 — 2026-09-27

## 1. Product objective

Create a consumer web application that computes a practical household responsibility allocation from structured inputs.

## 2. Target users

### Primary

- Couples sharing a home
- Families with children/teens
- Adult roommates

### Secondary

- Multigenerational households
- Shared houses with 3+ adults
- Households with uneven work/school schedules

## 3. Core job to be done

> "Given who lives here, how much capacity each person has, and what has to get done, create a workable household plan without us manually negotiating every assignment."

## 4. MVP scope

### Required

- Household type selection
- Member creation
- Member weekly/daily capacity
- Household task library + custom tasks
- Task frequency
- Task estimated duration
- Eligibility/exclusions
- Basic preferred days
- Optimization mode
- Schedule generation
- Workload summary
- Capacity utilization
- Rebalance/regenerate
- Conflict/shortfall reporting
- Local persistence

### Nice to have

- Four-week rotation
- Shareable read-only result
- Print view
- Saved households
- Household invite flow

### Explicitly out of scope

- Chat
- AI assistant
- Calendar sync
- Native mobile app
- Gamification
- Push notifications
- Detailed task history
- Complex permissions
- Relationship advice

## 5. MVP non-functional target

A first plan should generate fast enough to feel instantaneous for normal household sizes. For example, a household of 2–8 members and 10–60 recurring tasks should complete in under one second on a normal desktop browser.

## 6. Primary success metrics

- First-plan completion rate
- Median time to first plan
- Regeneration/rebalance rate
- Result share rate
- 7-day return rate
- % of generated plans with unresolved hard conflicts
- Plan acceptance rate where users explicitly mark the plan as usable

## 7. Product quality bar

A plan that looks balanced but violates a hard constraint is a product failure.

A plan that is imperfect but explicitly explains the shortage is acceptable.

## 8. Acceptance criteria for v0

A user can:

1. Create a household.
2. Add at least two members.
3. Set capacity for each member.
4. Add recurring tasks.
5. restrict task eligibility.
6. Generate a plan.
7. See workload by person.
8. See unassigned/overloaded work.
9. Re-run after a change.
10. Refresh the browser without losing the local prototype state.
