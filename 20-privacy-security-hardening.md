# 20 — Privacy & Security Hardening

## Overview & Scope Notice

This document outlines the product-security and privacy engineering implementation for ChoreMatrix. 

> **Important Boundary Notice**: This document details engineering architecture, data-flow controls, and technical hardening. It does **not** constitute a formal legal opinion, nor does it assert that ChoreMatrix is certified or compliant under GDPR, COPPA, CCPA, SOC 2, HIPAA, DMCA, or any other statutory compliance framework. Technical controls are implemented to eliminate avoidable technical/product risks and maintain data minimization.

---

## A. What ChoreMatrix Currently Collects

ChoreMatrix operates on a data-minimization model. The data collected is strictly limited to the functional requirements of household task scheduling:

### 1. Account & Authentication Data
- **Email Address**: Used solely as the unique user identifier for Supabase authentication, account recovery, and essential transactional notices (password resets, email confirmation).
- **Password**: Securely submitted directly to Supabase Auth over HTTPS/TLS; ChoreMatrix never stores, logs, or inspects plaintext passwords.
- **Age Confirmation**: A boolean confirmation (`isAtLeast13`) collected during signup to ensure account holders are at least 13 years old. Date of birth is **never** collected.

### 2. Household & Schedule Configuration
- **Household Name**: A user-specified label (e.g., "The Smith Home" or a custom nickname).
- **Member Profiles**:
  - Name or nickname (users are explicitly encouraged to use nicknames or initials).
  - Household role: `Adult` or `Child`.
  - Weekly capacity in minutes.
  - Unavailable days of the week (e.g., `["Mon", "Wed"]`).
- **Task Definitions**:
  - Task name/title (e.g., "Dishes", "Vacuuming").
  - Category (e.g., "Kitchen", "General").
  - Frequency per week (1–14).
  - Estimated duration in minutes.
  - Effort rating (scale of 1 to 5).
  - Fixed scheduled days (if any).
  - List of eligible member identifiers.
- **Task Preferences & Aversions**:
  - Preferred tasks per member (+1 bonus in optimizer scoring).
  - Averse tasks per member (-2 penalty in optimizer scoring).
- **Calculated Plans**:
  - Weekly assignment schedules mapped by member ID, task ID, and day of week.
  - Diagnostic metrics (fairness score, variance, capacity utilization, workload balance).

### 3. Client-Side Preferences & State
- **Theme Selection**: Stored in browser `localStorage` under the key `chorematrix_theme` (`light`, `dark`, or `system`).
- **Local Sandbox State**: Stored in browser memory/storage for unauthenticated local planning prior to account creation.

---

## B. What ChoreMatrix Deliberately Does Not Collect

ChoreMatrix explicitly refuses to collect or ingest any of the following personal or sensitive data categories:

- **Dates of Birth**: Full birth dates, years of birth, or birth certificates are prohibited.
- **Government Identifiers**: SSNs, national identity numbers, passport details, or tax IDs.
- **Precise Geolocation**: GPS coordinates, device location APIs, home street addresses, or postal addresses are neither requested nor stored.
- **Biometrics & Device Media**: No access to camera, microphone, photos, media gallery, or biometric sensors.
- **Contact Lists / Address Books**: No access to device contacts or social graphs.
- **Phone Numbers**: No SMS verification or mobile phone collection.
- **Sensitive Demographics**: No collection of race, ethnicity, religion, political opinions, sexual orientation, genetic data, or health/medical information.
- **Financial Account Numbers**: No credit card numbers, bank accounts, or payment instruments are collected or stored in the database.

---

## C. Authentication Age Policy

### Implemented Controls
- **Age Gate on Signup**: Account creation enforces an explicit 13+ age confirmation control. The user must verify: *"Yes, I am 13 or older."*
- **Under-13 Refusal**: If a user is under 13, the signup flow is blocked immediately. No Supabase Auth record is provisioned, no cloud persistence is initialized, and a safe exit link (`/index.html`) is presented.
- **Child Household Role**: The product allows adult account holders to include children as household members in the optimizer schedule (e.g., assigning age-appropriate chores with reduced capacity).
- **Child Privacy Guidance**: The UI explicitly advises adult guardians:
  > *"Children can be included as household members, but ChoreMatrix accounts are for users 13+. For privacy, consider using a nickname or household label instead of a child's full name."*
- **No Child Accounts**: Children do not have independent user credentials, login access, or auth records.

### Planned Controls
- Parental consent management workflows if family multi-user access is introduced in a future version.

### Items Requiring Legal / Business Decisions
- Determination of whether specific jurisdictions (e.g., UK Age Appropriate Design Code, California Age-Appropriate Design Code Act) require additional age assurance mechanisms if family-sharing features expand.

---

## D. Third-Party Resources & Font Audit

### Implemented Controls
- **System Font Stack**: ChoreMatrix uses a zero-external-dependency native system font stack:
  ```css
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  ```
- **Zero Google Fonts / CDN Fonts**: All references to `fonts.googleapis.com` and `fonts.gstatic.com` have been eliminated. No external font requests occur during page load or interaction.
- **No External Script CDNs**: The application does not load runtime JavaScript libraries from external CDNs (such as unpkg, cdnjs, or jsdelivr). All client code is bundled locally via esbuild.
- **Infrastructure Endpoints**: The only external HTTP/WebSocket network connections made by the browser are to the authenticated Supabase project URL (`https://<project-ref>.supabase.co`) for auth and data persistence.

### Build & Test Verifications
- Regression tests in `tests/security/legal_privacy_hardening.test.ts` verify that no HTML file or CSS bundle contains references to external font CDNs or third-party scripts.

---

## E. Tracking & Session Recording Policy

### Implemented Controls
- **Zero Session Replay**: ChoreMatrix contains no session recording or replay SDKs. Specifically audited and confirmed absent:
  - Hotjar
  - FullStory
  - LogRocket
  - Microsoft Clarity
  - PostHog Session Recording
  - Smartlook
  - Mouseflow
  - OpenReplay
  - Sentry Session Replay
- **No Keystroke / Text-Entry Logging**: Form inputs, password fields, chore notes, and member names are never monitored, captured, or transmitted to third-party analytics services.
- **No Advertising Trackers**: No Meta Pixel, Google Ads tag, TikTok Pixel, LinkedIn Insight tag, or affiliate tracking pixels exist in the codebase.
- **Cookie & Storage Inventory**:
  - `chorematrix_theme`: Strictly necessary for user interface preference persistence (`localStorage`).
  - `sb-<ref>-auth-token`: Strictly necessary for maintaining authenticated Supabase session state (`localStorage` / secure cookies).
  - No marketing or advertising cookies are set.

---

## F. Email & Communication Policy

### Implemented Controls
- **Central Marketing Configuration**:
  ```typescript
  export const MARKETING_EMAILS_ENABLED = false;
  ```
- **Marketing Refusal Guard**: Any invocation of marketing email dispatch is intercepted by `sendMarketingEmailGuard()`, throwing an explicit operational error.
- **Zero Fake Infrastructure**: ChoreMatrix does not fabricate unsubscribe tokens, fake suppression lists, or fictitious company physical addresses.
- **No Placeholder Sender Addresses**: Addresses such as `support@chorematrix.com` are blocked from automated dispatch until an active operational inbox and corporate domain MX/SPF/DKIM records are provisioned.
- **Transactional Auth Only**: Only essential transactional emails (Supabase auth verification and password recovery) are permitted via Supabase's secure auth mailer.

### Planned Controls (If Marketing is Activated in Future)
- Mandatory CAN-SPAM and global communication compliance checklist:
  1. Valid physical postal address of the legal entity.
  2. Clear and conspicuous identification of commercial content.
  3. One-click functional unsubscribe link.
  4. Real-time suppression list synchronization.
  5. Enforcement of a 10-business-day unsubscribe processing window.

### Items Requiring Legal / Business Decisions
- Acquisition of a registered commercial physical mailing address or registered agent address.
- Operational setup of official domain mailboxes (`hello@...` or `support@...`).

---

## G. Subscription Readiness & Pricing Architecture

### Implemented Controls
- **Centralized Pricing Data (`src/config/pricing.ts`)**: Defines all tiers with complete disclosure parameters:
  - Amount charged today ($0 during provisional release)
  - Trial duration (if applicable)
  - Amount charged after trial
  - Billing frequency (Monthly / Annual)
  - Renewal behavior (Explicit auto-renewal disclosure)
  - Cancellation method (In-app Account Settings self-serve cancellation)
  - Material limitations and features
  - Taxes notice ("Plus applicable state/local taxes where required by law")
- **Informational Pricing UI**: The public pricing page (`pricing.html`) clearly distinguishes informational previews from live payment checkout.
- **Adjacent Disclosure Placement**: All purchase CTAs are accompanied by direct, adjacent statutory auto-renewal and cancellation terms:
  > *"Subscriptions automatically renew at the disclosed rate until canceled in Account Settings. Cancel anytime before renewal to avoid future charges."*
- **No Live Checkout / Fake Billing**: No credit card capture forms or mock transaction controls exist.

### Planned Controls (Before Stripe/Payment Launch)
- Explicit double opt-in checkbox confirming acceptance of continuous service / auto-renewal terms.
- Post-purchase immediate confirmation email detailing renewal amount, date, and cancellation instructions.
- Pre-renewal reminder emails (typically 15–30 days prior to annual renewal).
- Frictionless, immediate online cancellation flow equivalent to signup ease.

### Items Requiring Legal / Business Decisions
- Finalization of merchant of record (e.g., Stripe Billing vs. Paddle vs. Lemon Squeezy).
- Specific state auto-renewal law compliance review (e.g., California ARL - AB 390 / SB 1200, New York, federal FTC Negative Option Rule).
- Formal refund and cancellation policy terms.

---

## H. DMCA & User-Generated Content Applicability

### Current Implementation & Status
- **No File Uploads**: ChoreMatrix provides no user upload features. No `<input type="file">` elements exist in any public or authenticated page.
- **No Content Hosting**: Users cannot upload images, profile photos, documents, videos, audio clips, or public posts.
- **No Public Publishing**: Household schedules, chores, and member lists are strictly private to the authenticated account holder via PostgreSQL Row Level Security (`auth.uid() = user_id`). There is no public feed, social timeline, or shared link gallery.
- **DMCA Applicability**: Because ChoreMatrix does not host or transmit user-generated multimedia or public user submissions, registration of an agent with the U.S. Copyright Office under 17 U.S.C. § 512(c) is **currently not applicable**.
- **No Fabricated Agent**: ChoreMatrix does not publish fictitious DMCA agent names, addresses, or phone numbers.

### Planned Controls (If Public Sharing or File Uploads Are Added)
- Designation of a formal DMCA agent with the U.S. Copyright Office.
- Public DMCA notice page with registered agent contact details.
- Expedited Notice-and-Takedown procedure.
- Repeat Infringer Termination Policy.

---

## I. Secrets & Environment Variable Policy

### Implemented Controls
- **Strict Key Separation**:
  - `SUPABASE_URL` and `SUPABASE_ANON_KEY`: Intended for browser-client communication with Row Level Security.
  - `SUPABASE_SERVICE_ROLE_KEY`: Strictly prohibited from client builds, browser bundles, and public repositories.
- **Build Isolation (`build.js`)**:
  - Validates environment variables and explicitly blocks secret/service-role keys from bundling.
  - Generates browser-safe client bundles containing only public configuration.
  - Validates that real credential values are never printed to build logs or console output.
- **Repository Hygiene**:
  - `.env.local` and `.env` are gitignored.
  - `.env.example` contains only placeholder values (`https://your-project-id.supabase.co`).
  - Production `dist/` directory is audited by automated tests to ensure no `.env` files or secret keys leak into production artifacts.

---

## J. Summary of Technical Controls vs. Business Decisions

| Domain | Technical Status | Implemented Engineering Control | Open Legal / Business Decision |
| :--- | :--- | :--- | :--- |
| **Age Gate** | Implemented | 13+ checkbox on signup; under-13 block; child nickname advice in UI | Jurisdiction-specific age assurance assessments |
| **Third-Party Fonts** | Implemented | System font stack; 0 requests to Google Fonts | None (Fully self-contained) |
| **Session Replay** | Implemented | Zero session replay SDKs in repo; no keystroke logging | Ongoing policy to prevent adding replay trackers |
| **Email Communications** | Implemented | `MARKETING_EMAILS_ENABLED = false`; dispatch guard throws error | Commercial physical address; official domain email setup |
| **Subscription Terms** | Implemented | Centralized `CheckoutDisclosures`; terms adjacent to CTAs | Merchant of record selection; refund & terms legal sign-off |
| **DMCA Safe Harbor** | Not Applicable | No file uploads; no public content hosting | Register agent only if public file uploads are introduced |
| **Secrets Management** | Implemented | `.env.local` gitignored; service keys excluded; dist audited | Production secret management in hosting dashboard (Vercel) |
| **Row Level Security** | Implemented | `auth.uid() = user_id` enforced on all household tables | Formal penetration testing prior to public launch |
| **Ad Monetization** | Implemented (Disabled Provider) | External network provider strictly inactive; house ads only on free tier; paid tiers 100% ad-free | Privacy/Cookie update & CMP integration before external network activation |

---

## K. Advertising Network Activation Prerequisites (Mandatory Gate)

ChoreMatrix has engineered an extensible advertising entitlement architecture (`src/monetization/adSlot.ts`) with strict separation between free tier and paid entitlements. External advertising networks (`ExternalNetworkProvider`) are **strictly disabled by default** and must remain inactive until the following five-point gate is cleared:

1. **Privacy Policy Review**:
   - Explicit disclosure of external advertising network identity and corporate entity.
   - Comprehensive disclosure of collected data types (IP address, mobile advertising identifiers, pseudo-anonymous IDs).
   - Clear explanation of interest-based advertising and opt-out mechanisms.
2. **Cookie Policy Review**:
   - Comprehensive inventory of all third-party advertising cookies, storage keys, lifespans, and purposes.
   - Update of `/cookies.html` prior to script activation.
3. **Consent Management Integration**:
   - Integration of a certified Consent Management Platform (CMP) supporting TCF v2.2 or regional opt-in regulations.
   - Scripts must strictly not execute or drop cookies prior to affirmative consent where legally mandated.
4. **Third-Party Request & Security Audit**:
   - Content Security Policy (CSP) headers updated to restrict script-src and connect-src to authorized ad provider domains only.
   - Security verification ensuring ad scripts have no DOM access to household member names, chores, or private planning data.
5. **Performance & Core Web Vitals Audit**:
   - Zero-layout-shift enforcement (fixed reserved ad slot dimensions).
   - Verification that Largest Contentful Paint (LCP) and Interaction to Next Paint (INP) meet high-performance thresholds.

Until all five criteria are fulfilled, `ExternalNetworkProvider` remains disabled in production code, rendering no external scripts, iframes, or tracking beacons.

