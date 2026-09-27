# 08 — Data Model

## Local-first v0

Store the active household in browser local storage.

## Core entities

### Household

- id
- name
- type
- optimization_mode
- created_at
- updated_at

### Member

- id
- household_id
- name
- role
- weekly_capacity_minutes
- weekday_capacity
- eligibility_rules
- exclusions
- preferences

### Task

- id
- household_id
- name
- category
- frequency
- estimated_minutes
- effort_weight
- allowed_members
- excluded_members
- preferred_days
- fixed_schedule

### Assignment

- id
- optimization_run_id
- task_id
- member_id
- occurrence_date
- estimated_minutes
- weighted_effort
- reason_codes

### OptimizationRun

- id
- household_id
- optimizer_version
- objective_settings
- generated_at
- result_summary
- diagnostics

## Cloud v1

Preferred candidate stack: Supabase/Postgres for authentication, relational storage and row-level security.

Tables should preserve household isolation and should never expose another household's data through a client-controlled identifier.

## Migration principle

The optimizer should accept a normalized domain object independent of whether the source is local storage or a remote database.
