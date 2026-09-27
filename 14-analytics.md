# 14 — Analytics & Metrics

## North-star candidate

**Useful household plans generated per active household.**

This is preferable to raw pageviews because it measures the product's actual value event.

## Core funnel

1. landing page view
2. start optimizer
3. household created
4. members added
5. tasks added
6. optimizer run
7. plan accepted
8. plan rebalanced
9. plan shared
10. account created
11. returned within 7 days

## Events

- `optimizer_started`
- `household_created`
- `member_added`
- `task_added`
- `optimizer_run`
- `optimization_failed`
- `plan_accepted`
- `plan_rebalanced`
- `plan_shared`
- `account_created`
- `household_saved`
- `returned_user`

## Metrics

### Activation

Percent of starters who generate a first plan.

### Time to value

Median seconds from optimizer start to first result.

### Result acceptance

Percent of generated plans accepted or saved without major edits.

### Replanning

Percent of households that run the optimizer again after the initial plan.

### Retention

7-day and 30-day return rates.

### Monetization

Free-to-paid conversion after paid features exist.

## Privacy principle

Do not collect unnecessary detailed household data for analytics. Event analytics should answer product questions without turning the analytics system into a second household-data store.
