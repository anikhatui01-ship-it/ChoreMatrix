# 07 — Optimizer Specification

## Goal

Produce a feasible assignment that balances household workload according to selected rules while respecting hard constraints.

## Inputs

### Member

- id
- name
- household role
- weekly capacity minutes
- weekday capacity
- task eligibility
- exclusions
- preferred tasks
- avoided tasks

### Task

- id
- name
- category
- frequency per week
- estimated minutes
- effort weight
- eligible members
- excluded members
- preferred days
- fixed schedule

## Workload normalization

For each task occurrence:

`weighted_minutes = duration_minutes × effort_weight`

Weekly task load is the sum of weighted occurrences.

## Hard constraints

A candidate assignment is invalid when:

- member is explicitly ineligible
- fixed schedule conflicts
- assignment exceeds a hard capacity limit
- task requires a member on a day where that member is unavailable

## Soft constraints

Use penalties for:

- workload imbalance
- capacity imbalance
- avoided tasks
- repeated same-person assignments
- non-preferred day placement
- unnecessary concentration of the same task type

## v0 approach

1. Expand recurring tasks into occurrence units.
2. Sort units from most constrained to least constrained.
3. Calculate eligible candidates.
4. Score each candidate using projected load and penalties.
5. Assign the lowest-loss candidate.
6. Run local swap passes.
7. Calculate diagnostics.
8. Return assignments + explanation + unresolved conflicts.

## Fairness model

Do not expose a single "fairness score" as if it were objective truth.

Instead show the inputs used:

- assigned minutes
- available minutes
- weighted load
- capacity utilization
- number of avoided/preferred-task violations

A future experimental score can be shown as a convenience metric, but the underlying components must remain visible.

## Explainability

Every non-obvious assignment should have a reason object such as:

- `highest_remaining_capacity`
- `only_eligible_member`
- `preferred_day_match`
- `avoided_task_penalty_tradeoff`
- `rotation_balance`

The UI can convert these into human language.

## v1 algorithm options

If real-world household sizes expose weaknesses, evaluate:

- local search
- simulated annealing
- integer programming

Do not add heavier optimization methods until simple methods demonstrably fail on real cases.
