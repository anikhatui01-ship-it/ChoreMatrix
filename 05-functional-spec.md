# 05 — Functional Specification

## 1. Household setup

### Household type

Supported presets:

- Couple
- Family
- Roommates
- Multigenerational
- Custom

Preset only changes defaults. It must not constrain the user to a fixed household structure.

## 2. Member setup

Fields:

- name
- role/category
- weekly capacity
- optional weekday capacities
- task eligibility
- exclusions
- optional preferred tasks
- optional avoided tasks

## 3. Task setup

Fields:

- task name
- category
- frequency
- duration per occurrence
- effort weight
- eligible members
- excluded members
- preferred days
- fixed days if necessary

## 4. Optimization modes

### Balanced

Minimize workload difference across members while respecting constraints.

### Capacity-aware

Normalize workload against each person's available capacity.

### Rotation-first

Prioritize distribution of recurring tasks over several weeks.

MVP can expose only Balanced and Capacity-aware. Rotation-first can initially be an internal option.

## 5. Results

The result screen must show:

- total household workload
- total available capacity
- per-member assigned minutes
- per-member capacity utilization
- weighted workload
- unassigned work
- overloaded members
- day-by-day assignments
- rotation, if enabled

## 6. Rebalance

Changing any of these must allow a new run without deleting the household:

- capacity
- eligibility
- availability
- task duration
- task frequency
- household member
- task assignment

## 7. Error states

The product must explicitly handle:

- no eligible person for a task
- workload greater than capacity
- missing required member data
- invalid duration/frequency
- contradictory fixed constraints

Never silently drop a task.
