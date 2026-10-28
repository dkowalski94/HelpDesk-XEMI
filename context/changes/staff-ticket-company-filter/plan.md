# Staff ticket company filter Implementation Plan

## Overview

Roadmap S-05 (MS-06, MS-07): a service-staff member filters the `todo` ticket queue on `/admin/tickets` by client company, on a page moved onto the UI contract (light XEMI look, `max-w-5xl`, same Topbar as the start page). Phase 1 moves the page onto the contract with no behaviour change; Phase 2 builds the filter on top of it.

## Current State Analysis

- `src/pages/admin/tickets.astro` loads data and renders everything inline in starter literals (`bg-cosmic dark`, `bg-white/10`, `text-blue-100/60`, `text-rose-200`, …), `max-w-3xl`. It is not in `uiContractConfig` and has no kitchen-sink cells.
- `listTodoQueue()` (`src/lib/services/ticket-resolution.ts:48`) reads every company's `todo` tickets under the staff session (RLS lets staff read all), oldest first, `id` tie-break, 50 per page via `?offset=` with one extra row for "next page".
- Client companies are `companies.kind = 'client'` (`supabase/migrations/20260922120000_tenant_identity_foundation.sql:28`); `internal`/`unassigned` can never own a ticket (`enforce_ticket_company_kind()`). Seed: Klient Alfa (`…c101`), Klient Beta (`…c102`).
- `src/pages/api/admin/resolve-ticket.ts` and `backfill-embeddings.ts` redirect to a hard-coded `/admin/tickets?status=…` / `?error=…`, so any filter is lost after an action.
- `UUID_PATTERN` exists privately in `ticket-resolution.ts:19`.
- Smoke (`scripts/smoke.mjs`) matches resolve redirects exactly (`^/admin/tickets\?status=resolved(-no-embedding)?$`, `/admin/tickets?error=invalid`, `?error=already-resolved`) and checks the escalation comment appears on `/admin/tickets` (`:589`).
- No migration is needed: the filter narrows what RLS already returns to staff and opens no new data path.

## Desired End State

- `/admin/tickets` renders on `bg-background` with `Card`, tokens and shadcn `Button`/`Textarea`/`Alert`, `max-w-5xl`, passes `uiContractConfig` lint, and every state is visible in `/dev/ui-kitchen-sink`.
- Above the queue, a GET form with `<select name="company">` lists "Wszystkie firmy" plus every client company alphabetically with its open-ticket count (`Klient Beta (0)`); a page script submits on change, a "Filtruj" button works without JS.
- `?company=<uuid>` narrows the queue; pagination links, the resolve form and "Przelicz" carry it, and both endpoints redirect back to `/admin/tickets?company=<uuid>&status|error=…` (offset dropped).
- Smoke proves the filter and the kept-filter redirect against the real server.

### Key Discoveries:

- Presentational-component pattern to follow: `src/components/start/StartPage.astro` rendered both by `src/pages/index.astro` and `src/dev/ui-kitchen-sink.astro`.
- Chrome to match: `src/layouts/ClientPageLayout.astro` (`min-h-screen bg-background p-4`, `mx-auto w-full max-w-5xl`, `Topbar`, `Card lang="pl" className="gap-0 p-6 sm:p-8"`).
- React `Card`/`Textarea`/`Button`/`Alert` render statically from `.astro` without hydration (as `ClientPageLayout` does with `Card`).
- The KB-preview `<script>` keys on `form[data-company-name]`, `[data-kb-resolution-preview]` and the `cause`/`steps` textarea names — the restyle must keep those hooks.
- Topbar already highlights "Zgłoszenia do rozwiązania" for `currentPath="/admin/tickets"`.

## What We're NOT Doing

- No migration, RLS or grant change; no new API route.
- No shadcn `Select` / React island; the filter is a native `<select>`.
- No multi-company selection, no filter by status/date, no search.
- No offset kept across resolve/backfill redirects (the list shifts by one after a resolve).
- `/admin/users` and removal of the `.dark`/cosmic theme stay in S-06 / S-07.
- `GET /api/tickets` is untouched.

## Implementation Approach

Restyle first so the filter is born on the contract and Phase 1 is a pure visual change that the existing smoke still proves. The page keeps all data loading and query-string parsing; a new static-props component owns markup and the preview script. The filter is a view parameter validated as a UUID and against the loaded client-company list; redirects echo it only after validation, always in a fixed `company=…&status|error=…` order so existing exact-match smoke steps (no company) stay valid.

## Critical Implementation Details

**Redirect injection** — endpoints must echo `company` only when it matches `UUID_PATTERN`; anything else is dropped, never URL-built from raw input. With no (valid) company the redirect is byte-identical to today's, which the existing smoke steps rely on.

**Embedded count query** — the open counts come from one PostgREST call `companies` `select("id, name, tickets(count)")` with `.eq("kind","client")` and `.eq("tickets.status","todo")`, ordered by `name`. If the embedded filtered count misbehaves on the local PostgREST version, fall back to two queries (client companies + `tickets` `company_id` where `status = 'todo'`, counted in TS) — do not add an RPC/migration for it.

## Phase 1: UI contract for the staff queue

### Overview

Move `/admin/tickets` onto the light XEMI contract via an extracted presentational component, with identical behaviour, text and form fields.

### Changes Required:

#### 1. Presentational component

**File**: `src/components/admin/StaffTicketQueue.astro` (new)

**Intent**: Own all markup of the queue — heading, intro, success/error messages (`Alert`, `text-success`/`text-destructive` roles), "Przelicz" banner (warning role), error/empty/list states, ticket cards (company, date, error text, client comment, KB preview, resolve form with `Textarea` + `Button`), "Dalej" link — using tokens only. Move the KB-preview `<script>` and `formatDate` here unchanged in behaviour.

**Contract**: Props `{ queue: StaffQueueResult; successMessage: string | null; errorMessage: string | null; missingEmbeddings: number | null; nextHref: string | null }`. Keeps `form[data-company-name]`, `[data-kb-resolution-preview]`, field names `ticketId`/`cause`/`steps`, `maxlength={RESOLUTION_TEXT_MAX_LENGTH}`, `required` on steps, and the same Polish strings. Focus uses `ring-ring`.

#### 2. Page

**File**: `src/pages/admin/tickets.astro`

**Intent**: Keep message maps, query parsing and data loading; render `Layout` → `bg-background` → `max-w-5xl` → `Topbar` → `Card lang="pl"` → `StaffTicketQueue`. Drop `bg-cosmic dark` and all literals.

**Contract**: Same URL parameters and output semantics; `nextHref` built from `queue.nextOffset`.

#### 3. Lint contract

**File**: `eslint.config.js`

**Intent**: Add `src/pages/admin/tickets.astro` and `src/components/admin/**` to `uiContractConfig.files`.

#### 4. Kitchen sink

**File**: `src/dev/ui-kitchen-sink.astro`

**Intent**: Add a "Kolejka serwisu" section rendering `StaffTicketQueue` with static props for: list with two tickets (one with client comment, one without), empty, load error, success message, `backfilled` message, error message, "Przelicz" banner, "Dalej" present. Update the header text listing contract views.

#### 5. Docs

**File**: `CLAUDE.md`

**Intent**: Add the page and `src/components/admin/` to the UI-contract view list; replace the note that `.dark` is applied by `admin/tickets.astro` (it now lives only in the kitchen sink's dark UserBar cell).

### Success Criteria:

#### Automated Verification:

- Lint passes with the page in `uiContractConfig`: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Build succeeds: `npm run build`
- Smoke passes unchanged against the preview after `npx supabase db reset`: `npm run smoke`

#### Manual Verification:

- `/admin/tickets` as `serwis@xemi.local` shows the light look at start-page width with the Topbar item active
- Kitchen-sink "Kolejka serwisu" cells screenshotted; every state legible, focus ring visible on textareas, button and link
- Resolving a ticket still works and the KB preview updates while typing

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Company filter

### Overview

Add the client-company filter, keep it through pagination and both staff actions, and cover it in smoke.

### Changes Required:

#### 1. Service and types

**File**: `src/lib/services/ticket-resolution.ts`, `src/types.ts`

**Intent**: `listTodoQueue` accepts an optional `companyId` and adds `.eq("company_id", companyId)` when present. New `listClientCompanies()` returns client companies alphabetically with their `todo` count (see Critical Implementation Details), `null` on error (logged). Export `UUID_PATTERN` and a `staffQueueHref()` helper so the page and both endpoints build the URL the same way.

**Contract**:
- `listTodoQueue(supabase, { offset, companyId }: { offset: number; companyId?: string | null })`
- `listClientCompanies(supabase): Promise<StaffCompanyOption[] | null>`; `StaffCompanyOption = { id: string; name: string; openCount: number }` in `src/types.ts`
- `staffQueueHref({ company?, status?, error?, filled?, offset? }): string` → `/admin/tickets` with params in order `company`, `offset`, `status`, `filled`, `error`; `company` included only if it matches `UUID_PATTERN`; no `?` when empty.

#### 2. Page

**File**: `src/pages/admin/tickets.astro`

**Intent**: Read `company`; accept it only if it matches `UUID_PATTERN` and — when the company list loaded — is one of its ids; otherwise treat as "all". Load companies and the filtered queue; build `nextHref` with the company kept. If the company list failed, hide the filter but still apply a UUID-valid `company`.

**Contract**: Passes `companies`, `selectedCompany: StaffCompanyOption | null` (or id) to the component.

#### 3. Component

**File**: `src/components/admin/StaffTicketQueue.astro`

**Intent**: Filter form (GET, `action="/admin/tickets"`) with a labelled `<select name="company">` ("Firma"): "Wszystkie firmy" (`value=""`) + `Name (count)` options, the selected one marked; a "Filtruj" `Button`; a page script submits on `change`. Filtered-empty state: "Brak zgłoszeń do rozwiązania w firmie {name}." with a link "Pokaż wszystkie firmy". Resolve forms and the "Przelicz" form get `<input type="hidden" name="company">` when a company is selected. Native select styled with tokens (`border-input`, `bg-background`, `ring-ring`).

**Contract**: New props `companies: StaffCompanyOption[] | null`, `selectedCompanyId: string | null`; select options use the company id as value. Empty-value submit reaches `/admin/tickets?company=`, which the page treats as "all".

#### 4. Endpoints

**File**: `src/pages/api/admin/resolve-ticket.ts`, `src/pages/api/admin/backfill-embeddings.ts`

**Intent**: Read the optional `company` form field and redirect via `staffQueueHref`, so the filter survives; offset is not carried. Invalid/missing `company` → today's exact URLs.

**Contract**: e.g. `/admin/tickets?company=<uuid>&status=resolved`, `/admin/tickets?company=<uuid>&error=invalid`, `/admin/tickets?company=<uuid>&status=backfilled&filled=0`.

#### 5. Kitchen sink

**File**: `src/dev/ui-kitchen-sink.astro`

**Intent**: Add cells: filter with "Wszystkie firmy" selected (counts incl. a 0), filter with one company selected and its tickets, filtered-empty state, filter hidden (company list failed).

#### 6. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: After the escalation steps: staff `/admin/tickets?company=${COMPANY.alfa}` contains `escalationComment`; `?company=${COMPANY.beta}` does not; `?company=not-a-uuid` contains it (filter ignored). In the resolution block: blank steps with `company: COMPANY.alfa` redirect to `/admin/tickets?company=${COMPANY.alfa}&error=invalid`; existing steps stay as they are. Extend `resolveTicket()` with an optional `company`. Update the header comment's first-page assumption to cover the filtered queue.

#### 7. Docs and roadmap

**File**: `CLAUDE.md`

**Intent**: In _Ticket resolution (S-02)_, note the `company` filter (client companies with open counts, view filter inside RLS, not a security boundary) and that both admin endpoints redirect back with a validated `company`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Types check: `npx astro sync && npx astro check`
- Build succeeds: `npm run build`
- Smoke passes including the new filter and kept-filter steps, after `npx supabase db reset`: `npm run smoke`

#### Manual Verification:

- Selecting "Klient Alfa" narrows the queue immediately (with JS) and via "Filtruj" (JS disabled); the URL is shareable
- "Klient Beta (0)" shows the filtered-empty message and "Pokaż wszystkie firmy" returns to all
- Resolving a ticket and clicking "Przelicz" while filtered return to the same company with the message shown
- "Dalej" keeps the company filter when the filtered queue has more than 50 tickets (or verified by temporarily lowering `STAFF_QUEUE_PAGE_SIZE` locally)
- Kitchen-sink filter cells screenshotted; select has a visible focus ring

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Integration Tests:

- Smoke (CI, real server + RLS): filtered queue includes/excludes the escalation comment by company; non-UUID `company` ignored; resolve redirect keeps a validated company; existing no-company redirects unchanged.

### Manual Testing Steps:

1. `npx supabase db reset`, `npm run dev`, sign in as `serwis@xemi.local`, open `/admin/tickets`.
2. Switch between "Wszystkie firmy", "Klient Alfa", "Klient Beta (0)"; then repeat with JS disabled using "Filtruj".
3. While filtered, resolve a ticket and click "Przelicz"; confirm the filter and message.
4. Open `/dev/ui-kitchen-sink`, screenshot the "Kolejka serwisu" section, Tab through the controls.

## Performance Considerations

One extra query per page load (client companies with embedded `todo` count). Company count is small; no index change needed (`tickets` is already filtered by `status`/`company_id` under RLS).

## Migration Notes

None — no schema change, nothing to push to the hosted project.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-05)
- Similar implementation: `src/components/start/StartPage.astro`, `src/layouts/ClientPageLayout.astro`
- Prior contract move: `context/archive/2026-10-19-report-error-ui-contract/plan.md`
- Queue service: `src/lib/services/ticket-resolution.ts:48`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: UI contract for the staff queue

#### Automated

- [x] 1.1 Lint passes with the page in `uiContractConfig`: `npm run lint`
- [x] 1.2 Types check: `npx astro sync && npx astro check`
- [x] 1.3 Build succeeds: `npm run build`
- [x] 1.4 Smoke passes unchanged against the preview after `npx supabase db reset`: `npm run smoke`

#### Manual

- [x] 1.5 `/admin/tickets` as `serwis@xemi.local` shows the light look at start-page width with the Topbar item active
- [x] 1.6 Kitchen-sink "Kolejka serwisu" cells screenshotted; every state legible, focus ring visible on textareas, button and link
- [x] 1.7 Resolving a ticket still works and the KB preview updates while typing

### Phase 2: Company filter

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Types check: `npx astro sync && npx astro check`
- [ ] 2.3 Build succeeds: `npm run build`
- [ ] 2.4 Smoke passes including the new filter and kept-filter steps, after `npx supabase db reset`: `npm run smoke`

#### Manual

- [ ] 2.5 Selecting "Klient Alfa" narrows the queue immediately (with JS) and via "Filtruj" (JS disabled); the URL is shareable
- [ ] 2.6 "Klient Beta (0)" shows the filtered-empty message and "Pokaż wszystkie firmy" returns to all
- [ ] 2.7 Resolving a ticket and clicking "Przelicz" while filtered return to the same company with the message shown
- [ ] 2.8 "Dalej" keeps the company filter when the filtered queue has more than 50 tickets (or verified by temporarily lowering `STAFF_QUEUE_PAGE_SIZE` locally)
- [ ] 2.9 Kitchen-sink filter cells screenshotted; select has a visible focus ring
