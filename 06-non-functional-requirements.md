# 06 — Non-Functional Requirements

## Performance

- First interactive paint should feel immediate on modern desktop browsers.
- A typical household optimization should complete in under 1 second.
- Avoid unnecessary network requests in the initial local-first prototype.

## Reliability

- Deterministic input should produce deterministic output for the same optimizer version.
- Results should not disappear due to a normal page refresh.
- A failed optimization should return diagnostics instead of a blank screen.

## Accessibility

- Keyboard navigation for all critical controls.
- Visible focus state.
- Labels for all form fields.
- No information conveyed by color alone.
- Sufficient contrast.
- Mobile-responsive fallback.

## Privacy

Household information should be treated as personal data. The product should collect only what is needed for the product experience.

## Security

When cloud storage is added:

- authenticated data access
- strict household-level authorization
- server-side validation of membership
- no client-provided household ID trusted without authorization
- auditability for membership changes

## Maintainability

The optimizer should be isolated from UI code so it can be tested independently.
