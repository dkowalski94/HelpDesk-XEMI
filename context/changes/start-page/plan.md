# Start page for guest, client and staff — Implementation Plan

## Overview

Replace the starter's `Welcome.astro` on `/` with a Polish, XEMI-styled start page that explains what HelpDesk XEMI is and sends each signed-in role to its job, and remove `/dashboard`, which today holds the only post-sign-in role links and account-state messages. Roadmap slice S-03 (MS-01, MS-03).

## Current State Analysis

- `/` (`src/pages/index.astro`) renders `src/components/Welcome.astro`: English "10x Astro Starter" hero, cosmic dark styling (`bg-cosmic`, palette and arbitrary classes), Sign In / Sign Up buttons, three starter feature cards. It ignores who is signed in.
- `/dashboard` (`src/pages/dashboard.astro`, English, cosmic) is the only page with role links: staff → `/admin/users` and `/admin/tickets`, client → `/report-error`. It shows the profile-error and "waiting for assignment" states.
- Sign-in and sign-out already redirect to `/` (`src/pages/api/auth/signin.ts:19`, `signout.ts:9`), so no auth redirect changes are needed.
- `/dashboard` is referenced from `src/middleware.ts:5` (`PROTECTED_ROUTES`) and `:46` (redirect for non-staff on staff routes), `src/components/Topbar.astro:14`, `src/pages/admin/users.astro:85`, `scripts/smoke.mjs` (lines 197, 238, 240, 384–427, 618), `CLAUDE.md` ("Protected page example") and `README.md:148`.
- `src/layouts/ClientPageLayout.astro:47–75` already holds the Polish, token-styled profile-error / staff / waiting texts for `/report-error` and `/my-tickets`. Branch order there: profile error → staff → client → waiting.
- UI contract: tokens in `src/styles/global.css`, shadcn `Button`/`Card` in `src/components/ui/`, dev kitchen sink `src/dev/ui-kitchen-sink.astro` (an `.astro` page, so Astro components render there with static props), lint guard `uiContractConfig` in `eslint.config.js:99`.

## Desired End State

- `/` shows one of five audiences, chosen server-side from `Astro.locals`:
  - **guest** (no user, incl. Supabase not configured) — product heading, short explanation, "Zaloguj się" / "Załóż konto", three "how it works" steps;
  - **client** (client user of a client company) — short product line, company name, two prominent entries "Zgłoś błąd" (`/report-error`) and "Moje zgłoszenia" (`/my-tickets`);
  - **staff** (`role = service_staff`) — prominent "Zgłoszenia do rozwiązania" (`/admin/tickets`) and secondary "Użytkownicy" (`/admin/users`);
  - **waiting** (signed in, no profile / unassigned company / anything not covered above) — product explanation + steps + the shared "Konto czeka na przypisanie" notice;
  - **profile-error** (`profileLookupFailed`) — product explanation + steps + the shared "Nie udało się wczytać Twojego konta" notice.
- The profile-error and waiting texts come from one component used by both the start page and `ClientPageLayout`.
- The start page is on the UI contract: token classes only, its files in `uiContractConfig`, every audience rendered in the kitchen sink.
- `/dashboard` returns 404; no link or redirect in the app points to it; non-staff on staff routes are redirected to `/`.
- `npm run smoke` covers the start page in the guest, waiting and client states and asserts `/dashboard` is gone.

### Key Discoveries:

- Branch order and audience test to mirror: `src/layouts/ClientPageLayout.astro:35–36` (`isStaff` by role only, `isClientUser()` from `src/lib/services/profile.ts:6`).
- React `Card` is already rendered server-side from Astro without a client directive (`ClientPageLayout.astro:42`) — the same works for `Button` with `asChild` around an `<a>`.
- Smoke asserts dashboard text "Client user … Klient Alfa" twice (`scripts/smoke.mjs:391,420`) — the replacement must assert something the client start page renders (company name + the `/report-error` entry).
- The smoke's fresh signup account is still unassigned at `scripts/smoke.mjs:238`, so that step can assert the waiting notice on `/`.

## What We're NOT Doing

- No redesign of the Topbar beyond replacing its "Dashboard" link (S-04 owns the bar's contents, Polish labels and return-to-page after sign-in).
- No redirect from `/dashboard` — it simply 404s.
- No restyling or translation of `/admin/users`, `/admin/tickets`, `/auth/*` or the 404 page; only the `/admin/users` back link changes target.
- No change to `Layout.astro` (`<html lang="en">`, default title) — the page sets its own title and `lang="pl"` on its wrapper, like the other contract pages.
- No new data, API route, migration or RLS change.
- No ticket counts or recent tickets on the start page — entries only.

## Implementation Approach

A presentational `StartPage.astro` takes the audience (and company name for clients) as props and never reads `Astro.locals`; `index.astro` derives the audience and composes `Layout` + `Topbar` + `StartPage`. That split lets the kitchen sink render all five audiences with static props, the same way it renders the React states. The account notices move out of `ClientPageLayout` into a shared component first, so the start page and the client pages cannot drift. Phase 2 then removes `/dashboard` and repoints everything at `/`, with the smoke test moved onto the new page in the same phase.

## Phase 1: Start page on the UI contract

### Overview

Ship the new `/` in all five audiences, on tokens, with kitchen-sink cells and the lint guard; delete `Welcome.astro`.

### Changes Required:

#### 1. Shared account-status notice

**File**: `src/components/AccountStatusNotice.astro` (new), `src/layouts/ClientPageLayout.astro`

**Intent**: One source for the profile-error and waiting heading + text, so `/`, `/report-error` and `/my-tickets` say the same thing. `ClientPageLayout` replaces its two inline branches with this component.

**Contract**: Props `status: "profile-error" | "waiting"` and `headingLevel: "h1" | "h2"` (the client pages keep `h1`; the start page uses `h2` under its own `h1`). Texts: profile-error keeps the current wording and `text-destructive` heading; waiting keeps "Konto czeka na przypisanie" with the last sentence made page-neutral — "…po przypisaniu zgłaszanie błędów będzie dostępne." Token classes only. Update the `ClientPageLayout` doc comment that refers to "the dashboard".

#### 2. Start page component

**File**: `src/components/start/StartPage.astro` (new)

**Intent**: Render the five audiences described in _Desired End State_ with XEMI logo (`/logo-xemi.svg`), `Card`, and `Button asChild` links; Polish copy throughout.

**Contract**: Props `audience: "guest" | "client" | "staff" | "waiting" | "profile-error"` and optional `companyName?: string` (shown for `client`). Reads no `Astro.locals`. One `h1` per audience. Guest copy, minimum: heading "HelpDesk XEMI"; a paragraph saying it helps users of the XEMI ERP — paste the error message and get the cause and fix steps from the knowledge base, or the problem goes to the XEMI service team as a ticket; three steps (Wklej treść błędu → Otrzymaj podpowiedź albo zgłoszenie → Serwis rozwiązuje i odpowiedź trafia do „Moje zgłoszenia”). `waiting` / `profile-error` render the product explanation + steps and `AccountStatusNotice` (`headingLevel="h2"`), without sign-in buttons. Primary entries use the default `Button` variant, secondary ones `outline`. Wrapper carries `lang="pl"`.

#### 3. Route

**File**: `src/pages/index.astro`

**Intent**: Derive the audience from `Astro.locals` and render `Layout` (title "HelpDesk XEMI") → light `bg-background` page wrapper → `Topbar` → `StartPage`.

**Contract**: Derivation order: `!user` → `guest`; `profileLookupFailed` → `profile-error`; `profile?.role === "service_staff"` → `staff`; `isClientUser(profile)` → `client` (pass `profile.companyName`); otherwise → `waiting`. Same order as `ClientPageLayout`.

#### 4. Remove the starter hero

**File**: `src/components/Welcome.astro` (delete)

**Intent**: Nothing else imports it once `index.astro` changes.

**Contract**: File removed; `grep -r Welcome src` returns nothing.

#### 5. Kitchen sink and lint guard

**File**: `src/dev/ui-kitchen-sink.astro`, `eslint.config.js`

**Intent**: Add a "Strona startowa" section rendering `StartPage` once per audience (client with "Klient Alfa") so the screenshot gate covers every state; widen the page header text beyond `/report-error`. Put the new files under the contract lint.

**Contract**: Add `src/pages/index.astro`, `src/components/start/**` and `src/components/AccountStatusNotice.astro` to `uiContractConfig.files`.

#### 6. Docs

**File**: `CLAUDE.md`

**Intent**: Keep the _UI contract_ section true: add the start page files to the "views already on the contract" list and drop the "Topbar on `/` via `Welcome.astro`" example from the `.dark` sentence.

**Contract**: _UI contract_ section only.

### Success Criteria:

#### Automated Verification:

- Lint passes with the new files under the contract: `npm run lint`
- Type check passes: `npx astro sync && npx astro check`
- Production build passes: `npm run build`
- `Welcome.astro` is gone and unreferenced: `grep -rn "Welcome" src` returns nothing

#### Manual Verification:

- Kitchen sink `/dev/ui-kitchen-sink` shows all five start-page audiences legibly on the light theme (screenshot gate), with visible `ring-ring` focus on every link/button when tabbing
- Signed out, `/` shows the Polish guest page; signed in as the seeded Klient Alfa user it shows "Klient Alfa" with "Zgłoś błąd" and "Moje zgłoszenia"; signed in as `serwis@xemi.local` it shows "Zgłoszenia do rozwiązania" and "Użytkownicy"; a fresh unassigned signup sees the waiting notice
- `/report-error` and `/my-tickets` still show the waiting / profile-error texts as before (only the neutral last sentence changed)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Remove /dashboard

### Overview

Delete the page and repoint every link, redirect, smoke step and doc at `/`.

### Changes Required:

#### 1. Page and route gate

**File**: `src/pages/dashboard.astro` (delete), `src/middleware.ts`

**Intent**: The page goes; the middleware stops protecting a route that no longer exists and sends non-staff on staff routes to `/` instead.

**Contract**: `PROTECTED_ROUTES` loses `"/dashboard"`; the staff-gate page redirect becomes `context.redirect("/")`. API branch (403) unchanged.

#### 2. In-app links

**File**: `src/components/Topbar.astro`, `src/pages/admin/users.astro`

**Intent**: No link points to `/dashboard`.

**Contract**: Topbar's "Dashboard" link becomes a link to `/` labelled "Strona startowa" (the rest of the bar stays for S-04). `/admin/users` back link → `href="/"`, text "Back to start page" (the page stays English until it is migrated).

#### 3. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Move the dashboard assertions onto the start page and pin the 404.

**Contract**:
- "home renders" additionally checks the guest copy (`Zaloguj się`).
- Replace "dashboard redirects anonymous user" with "dashboard is gone" → `request("/dashboard")` expects `status: 404`.
- Replace "dashboard renders for signed-in user" with a `/` step for the fresh unassigned account expecting 200 and the text "Konto czeka na przypisanie".
- Replace "dashboard redirects after signout" with a `/` step expecting 200, guest copy present and the waiting notice absent.
- Every `location: "/dashboard"` (staff-gate redirects) becomes `location: "/"`.
- The two "dashboard says Client user at Klient Alfa" steps request `/` and check `Klient Alfa` and `href="/report-error"`; update the comment above them.

#### 4. Docs

**File**: `CLAUDE.md`, `README.md`, `src/layouts/ClientPageLayout.astro` (comment, if not already done in Phase 1)

**Intent**: No doc names `/dashboard` as an existing page.

**Contract**: CLAUDE.md "Protected page example" → `src/pages/my-tickets.astro`; README route table row for `/dashboard` replaced by `/` (start page). The CLAUDE.md `/admin../dashboard` normalization example stays — it illustrates path normalization, not a page.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro sync && npx astro check`
- Production build passes: `npm run build`
- No app reference to the page remains: `grep -rn '"/dashboard"\|href="/dashboard"' src scripts` returns only the smoke 404 step
- Smoke passes on a fresh database: `npx supabase db reset`, then `npm run build && npm run preview` and `npm run smoke`

#### Manual Verification:

- `/dashboard` shows the 404 page whether signed in or not
- Signed in as the Klient Alfa user, opening `/admin/tickets` lands on `/` (client view)
- Topbar "Strona startowa" and the `/admin/users` back link both lead to `/`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- None — the repo has no unit-test runner; the page is presentational and covered by the kitchen sink and smoke.

### Integration Tests:

- `npm run smoke`: guest copy on `/`, waiting notice for an unassigned account, client view with company name and `/report-error` entry, staff-gate redirects to `/`, `/dashboard` → 404.

### Manual Testing Steps:

1. `/dev/ui-kitchen-sink`: compare all five audiences, tab through every entry.
2. Sign in as each seeded persona (Klient Alfa user, `serwis@xemi.local`) and a fresh signup; check the audience and that every entry opens the right page.
3. As a client, visit `/admin/tickets` and `/dashboard`.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- Shared states today: `src/layouts/ClientPageLayout.astro:35–75`
- Previous contract change: `context/archive/2026-10-27-my-tickets-page/`
- Design tokens: `context/foundation/design-tokens.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Start page on the UI contract

#### Automated

- [x] 1.1 Lint passes with the new files under the contract: `npm run lint`
- [x] 1.2 Type check passes: `npx astro sync && npx astro check`
- [x] 1.3 Production build passes: `npm run build`
- [x] 1.4 `Welcome.astro` is gone and unreferenced: `grep -rn "Welcome" src` returns nothing

#### Manual

- [x] 1.5 Kitchen sink shows all five start-page audiences legibly with visible focus (screenshot gate)
- [x] 1.6 `/` shows the right audience for guest, Klient Alfa user, `serwis@xemi.local` and a fresh unassigned signup
- [x] 1.7 `/report-error` and `/my-tickets` still show the waiting / profile-error texts

### Phase 2: Remove /dashboard

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Type check passes: `npx astro sync && npx astro check`
- [ ] 2.3 Production build passes: `npm run build`
- [ ] 2.4 No app reference to the page remains (grep returns only the smoke 404 step)
- [ ] 2.5 Smoke passes on a fresh database (`npx supabase db reset`, preview, `npm run smoke`)

#### Manual

- [ ] 2.6 `/dashboard` shows the 404 page whether signed in or not
- [ ] 2.7 Klient Alfa user opening `/admin/tickets` lands on `/`
- [ ] 2.8 Topbar "Strona startowa" and the `/admin/users` back link lead to `/`
