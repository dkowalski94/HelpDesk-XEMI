# "Moje zgłoszenia" as a Separate Page — Implementation Plan

## Overview

Give the client their ticket list ("Moje zgłoszenia") a page of its own at `/my-tickets`, rendered on the server, with pagination, and slim `/report-error` down to the paste flow plus one link "Zobacz w moich zgłoszeniach". This is roadmap slice S-02 (M-2); the start page (S-03) will link to this page.

## Current State Analysis

- The list lives inside the `/report-error` island: `ErrorResolutionPanel.tsx` calls `useMyTickets()` (`src/hooks/useMyTickets.ts`, `GET /api/tickets?mine=1`, first page only) and renders `<MyTicketsList state={…} />` under the outcome; it calls `reload()` after a non-match and after an escalation (`ErrorResolutionPanel.tsx:93,153`).
- `MyTicketsList.tsx` is presentational: states `loading` (skeleton rows), `error`, empty, and rows with a status `Badge` and, for resolved tickets, `CauseSteps`. Its type `MyTicketsState` is exported from the hook.
- `listVisibleTickets()` (`src/lib/services/tickets.ts:54`) already supports `createdBy`, `limit`, `offset`, orders newest first and returns `nextOffset`; `TICKET_PAGE_DEFAULT = 50`, `TICKET_PAGE_MAX = 100`. It runs under the caller's session, so RLS bounds it.
- `/report-error` decides four branches on the server (profile lookup failed / staff / client / waiting for assignment) and wraps them in `Topbar` + logo + `Card` (`src/pages/report-error.astro`). A new client page needs the same branches.
- `formatDate` (`src/components/error-resolution/format.ts`) uses `toLocaleString("pl-PL", …)` with no time zone; on the Worker that is UTC.
- `PROTECTED_ROUTES` in `src/middleware.ts:5` lists `/dashboard`, `/search`, `/report-error`.
- Smoke (`scripts/smoke.mjs`) checks server-rendered substrings of `/report-error` per persona (`REPORT_PAGE`, lines ~156-162); the client-rendered list is not checked anywhere.
- Kitchen sink (`KitchenSink.tsx:238-255`) has a "Twoje zgłoszenia" group with loading/default/empty/error cells.

## Desired End State

- A signed-in client user opens `/my-tickets` and sees "Moje zgłoszenia": their own tickets, newest first, 50 per page, each with status badge and date (Polish time), resolved ones with cause and steps; "Starsze zgłoszenia" / "Nowsze zgłoszenia" links page through `?offset=`; an empty account sees the empty message; a failed read shows an error alert.
- Staff, unassigned accounts and failed profile lookups get the same messages on `/my-tickets` as on `/report-error`, from one shared layout; anonymous visitors are redirected to sign-in.
- `/report-error` shows the paste form and the immediate outcome only, plus a persistent link "Zobacz w moich zgłoszeniach" → `/my-tickets`; it no longer loads or shows the ticket list.
- `useMyTickets` is gone; `MyTicketsList` has no loading state.
- The new page follows the UI contract (CLAUDE.md → UI contract): token classes and `src/components/ui` only, lint guardrail covers it, kitchen sink shows its states.

Verify with smoke (new `/my-tickets` steps), lint/type/build, the scan and the kitchen sink.

### Key Discoveries:

- `listVisibleTickets(supabase, { limit, offset, createdBy })` is everything the page needs; no API or schema change (`src/lib/services/tickets.ts:54-66`).
- The API's `intParam` clamping (`src/pages/api/tickets.ts:22-25`) is the pattern for reading `?offset=` without a validation layer.
- React components render to static HTML in an `.astro` page without a `client:*` directive — no hydration, so no client/server date mismatch once the time zone is explicit.
- Smoke signs personas in and reuses their cookies (`request(path, { as })`); a run's own ticket text is unique per run (`runId`), which avoids the seeded-ticket-falls-off-the-page problem CLAUDE.md describes for `/api/tickets`.

## What We're NOT Doing

- Changing `GET /api/tickets` or `?mine=1` (stays as the smoke RLS probe and for any future client-side use).
- Links to `/my-tickets` from the start page or the user bar — S-03 and S-04.
- Filtering or searching the list, ticket detail pages, editing tickets.
- A short "recent tickets" list on `/report-error`, or a per-outcome "see it in my tickets" link — one persistent link only (user decision).
- Restyling `Topbar` or other pages; `admin/tickets.astro`'s own `formatDate` stays as is.
- Removing `/dashboard` (S-03).

## Implementation Approach

Phase 1 adds the new page next to the existing in-panel list, so it can ship on its own; phase 2 removes the list from the panel and tidies the contract (kitchen sink, guardrail, CLAUDE.md). The four page branches move into one shared Astro layout used by both client pages, so their texts cannot drift apart.

## Phase 1: The /my-tickets page

### Overview

Server-rendered client page with the shared branch layout, pagination and smoke coverage; `/report-error` keeps working unchanged (its list is removed in phase 2).

### Changes Required:

#### 1. Shared client-page layout

**File**: `src/layouts/ClientPageLayout.astro` (new), `src/pages/report-error.astro`

**Intent**: One place for the chrome and the non-client branches of a client-only page (Topbar, XEMI logo, `Card`, profile-error / staff / waiting messages), so `/report-error` and `/my-tickets` render identical texts.

**Contract**: Props: `title` (document title), `heading` (client heading), optional `intro` (client hint). Renders the client branch content from the default slot only when `profile.role === "client_user" && profile.companyKind === "client"`; otherwise the branch messages exactly as today's `report-error.astro` (the staff message keeps "Ta strona jest przeznaczona dla użytkowników klienta"; the waiting message keeps "Twoje konto czeka na przypisanie do firmy" — smoke matches both; page-specific second sentences may become generic). `report-error.astro` is rewritten on top of it with no visible change. Token classes only.

#### 2. The page

**File**: `src/pages/my-tickets.astro` (new)

**Intent**: The client's own tickets, server-rendered, 50 per page.

**Contract**: Heading "Moje zgłoszenia". Reads `?offset=` clamped like `intParam` in `api/tickets.ts` (non-numeric → 0, negative → 0). Calls `listVisibleTickets(supabase, { limit: TICKET_PAGE_DEFAULT, offset, createdBy: user.id })` only in the client branch; `null` (or no Supabase client) → error state with "Nie udało się wczytać Twoich zgłoszeń.". Renders `<MyTicketsList>` without a `client:*` directive. `lang="pl"` on the content.

#### 3. List pagination and server use

**File**: `src/components/error-resolution/MyTicketsList.tsx`

**Intent**: Let the list render the page links itself (so the kitchen sink can show them) and fit the server page's heading.

**Contract**: New optional props `olderHref` / `newerHref` (strings; rendered as links "Starsze zgłoszenia" / "Nowsze zgłoszenia" when present, keyboard-focusable with the view's `FOCUS_RING`) and an optional heading override (the page shows "Moje zgłoszenia" as its `h1`; the list's own `h2` "Twoje zgłoszenia" is hidden or omitted there). Existing `loading` state stays in this phase (the panel still uses it).

#### 4. Polish time

**File**: `src/components/error-resolution/format.ts`

**Intent**: Dates must read the same on the server (UTC Worker) and in the browser.

**Contract**: `formatDate` passes `timeZone: "Europe/Warsaw"`.

#### 5. Route protection

**File**: `src/middleware.ts`

**Intent**: Anonymous visitors are redirected to sign-in like on `/report-error`.

**Contract**: `"/my-tickets"` added to `PROTECTED_ROUTES`.

#### 6. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Cover the page per persona and its tenant isolation through the HTML.

**Contract**: New steps: anonymous `/my-tickets` → 302 to `/auth/signin`; after the step that files this run's ticket as Klient Alfa, Alfa's `/my-tickets` → 200 containing "Moje zgłoszenia" and this run's error text; Klient Beta's `/my-tickets` → 200 not containing it; staff → staff message; unassigned account → waiting message; `/my-tickets?offset=abc` as Alfa → 200 (clamped, no error). Page substrings kept in a constant like `REPORT_PAGE`.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase, including the new `/my-tickets` steps

#### Manual Verification:

- As Klient Alfa, `/my-tickets` lists own tickets with Polish dates; a resolved ticket shows cause and steps
- `/report-error` looks and behaves as before for every branch (shared layout introduced no visible change)
- Page usable at ≈390 px; keyboard focus visible on the pagination links

**Implementation Note**: After automated verification passes, pause for manual confirmation before the next phase.

---

## Phase 2: Slim /report-error and close the contract

### Overview

Remove the list from the panel, add the persistent link, drop the loading state and the hook, and bring the kitchen sink, guardrail and CLAUDE.md up to date.

### Changes Required:

#### 1. Panel without the list

**File**: `src/components/error-resolution/ErrorResolutionPanel.tsx`

**Intent**: The view shows the paste form and the immediate outcome only.

**Contract**: No `useMyTickets`, no `MyTicketsList`, no `reload()` calls (escalation's `onEscalated` becomes unnecessary or a no-op — remove the prop if nothing else uses it). API calls to `/api/resolve-error` and `/api/escalate-error` unchanged.

#### 2. Persistent link

**File**: `src/pages/report-error.astro` (client branch)

**Intent**: Earlier resolved and reported errors are one click away.

**Contract**: A link "Zobacz w moich zgłoszeniach" → `/my-tickets` under the panel, token classes, visible focus. Only in the client branch.

#### 3. List and hook cleanup

**File**: `src/components/error-resolution/MyTicketsList.tsx`, `src/hooks/useMyTickets.ts` (delete)

**Intent**: The list is server-rendered only; the client-side loader has no users left.

**Contract**: `MyTicketsList` props become `{ status: "ok"; tickets } | { status: "error"; error }` plus the pagination props (the type moves into the component file); the skeleton/loading branch is removed. `src/hooks/useMyTickets.ts` deleted; no remaining imports.

#### 4. Kitchen sink

**File**: `src/components/error-resolution/KitchenSink.tsx`

**Intent**: The visual gate shows the list's real states.

**Contract**: The list group shows default, empty, error, with pagination links (older only / both), and marks loading N/A (server-rendered). Group title "Moje zgłoszenia".

#### 5. Guardrail and docs

**File**: `eslint.config.js`, `CLAUDE.md`

**Intent**: Keep the next agent on the contract for the new files and describe the new page.

**Contract**: The UI-contract `files` list adds `src/pages/my-tickets.astro` and `src/layouts/ClientPageLayout.astro`. CLAUDE.md: *Error resolution (S-01)* — the `?mine=1` note no longer says the client page uses it; add `/my-tickets` (server-rendered list, `PROTECTED_ROUTES`, shared `ClientPageLayout`).

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase
- Hard-coded-value scan on `src/pages/report-error.astro`, `src/pages/my-tickets.astro`, `src/layouts/ClientPageLayout.astro`, `src/components/error-resolution/*.tsx` returns 0 matches
- No reference to `useMyTickets` remains: `grep -rn useMyTickets src` returns nothing

#### Manual Verification:

- `/report-error` as Klient Alfa: matched result shows immediately; ticket-created / already-reported / escalation work as before; no list on the page; "Zobacz w moich zgłoszeniach" opens `/my-tickets`
- Kitchen sink shows the list's states including pagination links
- Polish diacritics correct; both pages usable at ≈390 px

**Implementation Note**: After automated verification passes, pause for manual confirmation, then run `/10x-impl-review`.

---

## Testing Strategy

### Integration Tests:

- Smoke: `/my-tickets` per persona (anonymous redirect, Alfa sees own run ticket, Beta does not, staff and unassigned messages, bad `offset` clamped); existing `/report-error` steps unchanged.

### Manual Testing Steps:

1. As Klient Alfa: file an error on `/report-error`, follow "Zobacz w moich zgłoszeniach", find it at the top with today's Polish time.
2. As staff: resolve that ticket on `/admin/tickets`; as Alfa reload `/my-tickets` and see cause and steps.
3. With more than 50 tickets (local DB after several smoke runs): "Starsze zgłoszenia" shows the next page, "Nowsze zgłoszenia" goes back.
4. As staff and as the unassigned account: both pages show the same messages.

## Performance Considerations

One server query per page view instead of a page load plus a client fetch; bounded at 51 rows.

## Migration Notes

No database change. Rolling back the Worker restores the in-panel list.

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-02 (`my-tickets-page`)
- UI contract: CLAUDE.md → UI contract; tokens `context/foundation/design-tokens.md`
- Previous change on this view: `context/archive/2026-10-19-report-error-ui-contract/plan.md`
- Pagination clamp pattern: `src/pages/api/tickets.ts:22-25`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The /my-tickets page

#### Automated

- [x] 1.1 Type-check passes: `npx astro sync && npx astro check`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Production build passes: `npm run build`
- [x] 1.4 Smoke passes against the production preview on a freshly reset local Supabase, including the new `/my-tickets` steps

#### Manual

- [x] 1.5 As Klient Alfa, `/my-tickets` lists own tickets with Polish dates; a resolved ticket shows cause and steps
- [x] 1.6 `/report-error` looks and behaves as before for every branch (shared layout introduced no visible change)
- [x] 1.7 Page usable at ≈390 px; keyboard focus visible on the pagination links

### Phase 2: Slim /report-error and close the contract

#### Automated

- [ ] 2.1 Type-check passes: `npx astro sync && npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Production build passes: `npm run build`
- [ ] 2.4 Smoke passes against the production preview on a freshly reset local Supabase
- [ ] 2.5 Hard-coded-value scan on `src/pages/report-error.astro`, `src/pages/my-tickets.astro`, `src/layouts/ClientPageLayout.astro`, `src/components/error-resolution/*.tsx` returns 0 matches
- [ ] 2.6 No reference to `useMyTickets` remains: `grep -rn useMyTickets src` returns nothing

#### Manual

- [ ] 2.7 `/report-error` as Klient Alfa: matched result shows immediately; ticket-created / already-reported / escalation work as before; no list on the page; "Zobacz w moich zgłoszeniach" opens `/my-tickets`
- [ ] 2.8 Kitchen sink shows the list's states including pagination links
- [ ] 2.9 Polish diacritics correct; both pages usable at ≈390 px
