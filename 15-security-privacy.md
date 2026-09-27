# 15 — Security & Privacy

## Product principle

Household data may reveal names, relationships, routines and schedules. Treat it as personal information.

## v0

Local-first prototype means the active household data remains in the user's browser.

## v1 cloud requirements

### Authentication

Use managed authentication rather than implementing passwords from scratch.

### Authorization

Every household record must be tied to an authenticated owner/member relationship.

### Row-level security

Cloud database policies must prevent cross-household reads and writes.

### Validation

Validate all user-owned identifiers and permissions on the server. Never trust a household ID supplied by the browser.

### Sharing

Shared links should be revocable and should expose only the minimum intended data.

### Deletion

Users should be able to delete a household and its associated data.

### Export

If exports are implemented, generate them from authorized household data only.

## Data minimization

Avoid collecting:

- exact home address
- unrelated personal identifiers
- sensitive family information
- unnecessary location data

Unless a future validated feature specifically needs it.

## Security checklist before launch

- HTTPS
- secure authentication
- authorization tests
- database policy tests
- input validation
- rate limiting where relevant
- dependency update process
- error logging without leaking household data
