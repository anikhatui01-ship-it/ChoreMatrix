# ChoreMatrix

Household workload optimization web app.

## Current status

Fresh project reset. Previous prototype and documentation have intentionally been removed.

## Core product

Input household members, capacities, responsibilities, constraints and preferences.

ChoreMatrix calculates a workable household allocation and rotation instead of acting as a basic chore checklist.

## Design principle

**Input → Optimization → Clear Output → Easy Adjustment**

The product should feel like a small optimization engine, not a task-management app.

## Project structure

```text
chorematrix/
├── README.md
├── docs/
│   └── ui-ux-design.md
└── src/
```

# UI/UX Design & Visual Experiments

**Status:** Experimental / pre-build

## Design objective

ChoreMatrix should not look like a generic family task manager, habit tracker, or calendar.

The experience should communicate:

> **Tell us how your household works. We calculate the workload.**

The interface must make three things obvious:

1. What information the user needs to provide.
2. What the optimizer calculated.
3. What the user can change and what will be recalculated.

## UX principles

### Lightweight input
Use progressive disclosure instead of one giant questionnaire. Start with household members, capacity, responsibilities, frequency and constraints. Keep advanced controls collapsed until needed.

### Results feel like an answer
The result should immediately show whether the workload is balanced, who is overloaded, what was assigned, what assumptions were made, and what happens when something changes.

### Make optimization visible
Use language such as `Optimize household`, `Rebalance`, `What changed?`, `Why this assignment?`, and `Try another arrangement`. Avoid presenting the product as a passive checklist.

### Desktop-first, responsive always
The browser is an advantage because members, tasks, capacity, workload and schedule can be visible together. Mobile must remain fully usable, but the main design target is a spacious browser experience.

## Information architecture

```text
Landing page
    ↓
Start optimizing
    ↓
Household setup
    ↓
Tasks & responsibilities
    ↓
Constraints
    ↓
Optimization
    ↓
Results
    ├── Overview
    ├── Weekly plan
    ├── Workload balance
    ├── Why this result?
    └── Rebalance / edit
```

## Visual directions to test

### A — Calm Utility

**Fonts:** DM Sans + Inter

**Palette:**
- Background `#F7F8F6`
- Surface `#FFFFFF`
- Primary `#2F6B5F`
- Primary dark `#245247`
- Accent `#D8A24A`
- Text `#1D2522`
- Muted `#6E7773`
- Border `#DFE5E1`
- Success `#3F8F6B`
- Warning `#C98B35`
- Danger `#C55A5A`

Personality: calm, trustworthy, mature.

### B — Fresh Productivity

**Fonts:** Manrope + Inter

**Palette:**
- Background `#F5F7FA`
- Surface `#FFFFFF`
- Primary `#4169E1`
- Primary dark `#304FA8`
- Accent `#8BC34A`
- Text `#172033`
- Muted `#697386`
- Border `#E1E6EF`
- Success `#3F9B73`
- Warning `#D9912A`
- Danger `#D65C65`

Personality: crisp, modern, software-first.

### C — Warm Household

**Fonts:** Plus Jakarta Sans + Inter

**Palette:**
- Background `#FBF8F3`
- Surface `#FFFFFF`
- Primary `#7656A6`
- Primary dark `#5F4387`
- Accent `#E7A75B`
- Text `#28242D`
- Muted `#766F7C`
- Border `#E8E1D9`
- Success `#4B936A`
- Warning `#D59743`
- Danger `#C95F62`

Personality: friendly, warm, household-oriented.

### D — Dark Optimization

**Fonts:** Space Grotesk + Inter

**Palette:**
- Background `#0E1116`
- Surface `#171B22`
- Surface 2 `#202631`
- Primary `#75E0B4`
- Accent `#F2C76D`
- Text `#F4F6F8`
- Muted `#98A2B3`
- Border `#2B323D`
- Success `#5FD09D`
- Warning `#E6B85C`
- Danger `#F07A7A`

Personality: technical, premium, analytical.

## Initial visual decision

Prototype **Calm Utility** and **Fresh Productivity** first using the exact same layouts and content. Judge them on trust, intelligence, simplicity and non-judgmental household tone—not on raw visual novelty.

## Landing page concept

```text
┌────────────────────────────────────────────────────────────┐
│ ChoreMatrix                         How it works   Sign in │
│                                                            │
│     Stop arguing over who does what.                       │
│     Let ChoreMatrix calculate the workload.                │
│                                                            │
│     Tell us your household, responsibilities and limits.   │
│     Get a balanced plan in minutes.                        │
│                                                            │
│              [ Build my household plan ]                   │
│                                                            │
│     4 people  •  12 tasks  •  20 min setup                │
└────────────────────────────────────────────────────────────┘
```

The landing page's job is to get the user into the optimizer quickly; do not overload it with dashboards.

## Core visual components

### Workload meter

```text
Anik
██████████████████░░  82%

Maya
██████████████░░░░░░  67%
```

The percentage represents capacity utilization, not a vague fairness score.

### Balance state

```text
✓ Balanced
All members are within the chosen capacity range.
```

or

```text
! Needs adjustment
Maya is 31 minutes above her weekly capacity.
```

Explain the problem in copy; do not rely on color alone.

### Assignment card

```text
Laundry
────────────────
Maya
2× / week
25 min / occurrence
Medium effort

[ Change ]
```

### Why-this-result drawer

```text
Why was laundry assigned to Maya?

• She has 45 unused minutes of weekly capacity.
• She is eligible for the task.
• The assignment reduced the household imbalance.
• No hard constraint was violated.
```

This should become a major trust feature.

## Results-screen experiment

Prototype three variants:

1. **Dashboard-first** — workload and balance first.
2. **Schedule-first** — actual weekly assignments first.
3. **Explanation-first** — algorithm reasoning first.

Initial hypothesis: **Schedule-first** should be the default, with workload visible beside it and explanations one click away. The user ultimately wants to know **who does what**.

## Typography

Use no more than two font families.

```text
Hero:         48–64px
Page title:   32–40px
Section:      20–24px
Card title:   16–18px
Body:         15–17px
UI label:     13–14px
Helper text:  12–13px
```

Prefer weight and spacing before adding more colors. Use numerical-friendly typography for minutes, percentages and counts.

## Color rules

Color communicates state, not decoration.

- Green → balanced / healthy
- Amber → attention needed
- Red → overloaded / impossible constraint
- Primary color → interaction

Do not give every household member a different bright color and do not make the UI look like a children's chore chart.

## Empty, loading and error states

Loading should communicate work:

> **Balancing your household…**  
> Checking capacity → matching tasks → resolving constraints

Impossible constraints must be explicit:

> **No fully valid schedule found.**  
> Your household has 86 minutes of required work but only 61 minutes of available capacity.

Offer actions such as `Relax capacity`, `Reduce task frequency`, or `Edit tasks`.

## Accessibility

Minimum targets:

- Keyboard navigable controls
- Visible focus states
- Semantic headings
- Accessible contrast
- Never rely on color alone for balance/overload
- Appropriate mobile touch targets
- Screen-reader labels for icons

## What ChoreMatrix must not become

- A colorful children's chore chart
- A Notion clone
- A calendar clone
- A gamified points app by default
- A dense spreadsheet
- A social feed
- An AI-chat interface

The intended feeling is:

> **Calm input → serious calculation → clear answer.**

## Supabase Auth URL Configuration

To ensure email verification and password reset flows work reliably across desktop, mobile, and production environments, configure your Supabase project (under **Authentication → URL Configuration**) as follows:

### 1. Site URL
Set the primary Site URL to your stable production domain:
```text
https://chorematrix.vercel.app
```

### 2. Redirect URLs (Allowed Callback URLs)
Add explicit allowed redirect paths for production and local development. Avoid open wildcards (`*`) to prevent open redirect vulnerabilities:

```text
https://chorematrix.vercel.app/verify-email.html
https://chorematrix.vercel.app/reset-password.html
https://chorematrix.vercel.app/app.html
http://localhost:4173/verify-email.html
http://localhost:4173/reset-password.html
http://localhost:4173/app.html
http://localhost:5173/verify-email.html
http://localhost:5173/reset-password.html
http://localhost:5173/app.html
http://127.0.0.1:4173/verify-email.html
http://127.0.0.1:4173/reset-password.html
```

---

## Mobile Testing & Email Confirmation Note

When testing email confirmation flows across devices:

> [!NOTE]
> **Why clicking email verification links on a phone fails with `ERR_CONNECTION_REFUSED` in default local development:**  
> If an account is created on a desktop dev server at `http://localhost:4173`, the verification link dispatched by Supabase embeds `http://localhost:4173/verify-email.html` as the target. Opening that email on a physical phone causes the phone to look for port 4173 on the *phone itself* (`127.0.0.1`), where no server is running. This is an expected networking characteristic, not an application bug.

### How to test email verification on a mobile device:
1. **Production testing (recommended):** Test against the deployed production site (`https://chorematrix.vercel.app`) where URLs are globally routable.
2. **Local network testing:** Set `VITE_PUBLIC_SITE_URL` in `.env.local` to your workstation's LAN IP (e.g. `http://192.168.1.150:4173`), ensure the dev server listens on all interfaces (`serve -l 4173 dist`), and add that LAN URL to Supabase's Redirect URLs.
