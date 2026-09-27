# 09 — System Architecture

## v0

Browser-only application:

`UI → domain model → optimizer → result renderer`

No backend is required for the initial demonstration.

## v1 proposed stack

### Frontend

- React or Next.js
- TypeScript
- responsive CSS

### Backend

- Supabase
- Postgres
- Supabase Auth

### Hosting

- Vercel or equivalent static/edge-friendly host

### Analytics

- lightweight privacy-conscious event analytics

## Separation of concerns

### UI layer

Forms, navigation, result visualization.

### Domain layer

Household, member, task and constraint validation.

### Optimizer layer

Pure functions where possible. No UI dependencies.

### Persistence layer

Local storage initially, repository abstraction before cloud migration.

## Authentication strategy

Do not require authentication for first-use planning.

Require an account only when the user requests persistence, sharing or multi-device access.

## Rendering strategy

Server-rendered public marketing/SEO pages should be used where useful. The interactive optimizer itself can be a client-side application.

## Deployment principle

The core optimizer must remain usable even if analytics or non-essential third-party services fail.
