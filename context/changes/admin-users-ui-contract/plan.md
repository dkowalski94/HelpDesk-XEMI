# `/admin/users` on the UI contract Implementation Plan

## Overview

Roadmap S-06 (MS-07): a service-staff member assigns new accounts to client companies on a Polish, XEMI-styled `/admin/users` — light look, start-page width (`max-w-5xl`), the same Topbar as every other contract page. The page gets the heading „Konta do przypisania” and shows each waiting account's creation date. No behaviour, endpoint or data change.

## Current State Analysis

- `src/pages/admin/users.astro:26-92` renders inline in starter literals (`bg-cosmic`, `bg-white/10`, `text-blue-100/60`, `text-rose-200`, `text-emerald-200`, gradient heading), `max-w-2xl`, no Topbar, English copy („Assign users”, „Choose a company”, „Assign”, „Back to start page”) and English `ERROR_MESSAGES` (`:9-15`). It is not in `uiContractConfig` (`eslint.config.js:99-117`) and has no kitchen-sink cells.
- Data loading is already separated: `listPendingAssignments()` (`src/lib/services/company-assignment.ts:12`) returns `PendingAssignmentsResult` (`src/types.ts:104`) — users oldest first with `id`, `email`, `fullName`, `createdAt`, plus client companies alphabetically. `createdAt` is loaded but not shown.
- `src/pages/api/admin/assign-company.ts` redirects to `/admin/users?status=assigned` or `?error=<missing-fields|not-configured|invalid-company|not-updated|error>`; the page maps the code to a fixed message, unknown codes falling back to the generic one.
- Smoke (`scripts/smoke.mjs:144`) `waitingUserId(html, email)` finds `>${email}<` in the page HTML and takes the last `name="userId" value="<uuid>"` before it; steps at `:384-452` read `/admin/users` as staff and match the endpoint's redirect `location`s exactly.
- The S-05 pattern to copy: `src/pages/admin/tickets.astro` (data + query-string mapping) renders the static-props `src/components/admin/StaffTicketQueue.astro` inside `Topbar` + `Card className="gap-0 p-6 sm:p-8"`; the kitchen sink renders the same component per state (`src/dev/ui-kitchen-sink.astro:65-106,159-182`).
- `src/components/admin/**` is already in `uiContractConfig`; the UserBar labels the page „Użytkownicy” (`src/components/UserBar.astro:30`) and the kitchen sink has no UserBar variant with that entry active.

## Desired End State

- `/admin/users` renders on `bg-background` with `Topbar`, `Card`, tokens and shadcn `Button`/`Alert`/`ErrorAlert`, `max-w-5xl`, all copy in Polish, and passes `uiContractConfig` lint.
- H1 „Konta do przypisania” (also the `<title>`), hint „Nowe konta czekają na firmę. Przypisz każde do jego firmy klienckiej.”; each waiting account shows its e-mail, full name when present, and „Założone: <date>” formatted like the staff queue (`pl-PL`, `dateStyle: "medium"`, `timeStyle: "short"`), then a native company `<select>` and „Przypisz”.
- Every state (list, list with and without full name, empty list, no client companies, load error, success, error message) is visible in `/dev/ui-kitchen-sink`, plus a UserBar with „Użytkownicy” active.
- `npm run smoke` passes unchanged.

### Key Discoveries:

- Smoke parser constraint: the e-mail must be the sole text content of its element (`>alfa@…<`, no surrounding whitespace or extra text), and the hidden input must render `name="userId" value="<id>"` in that attribute order before it — `scripts/smoke.mjs:144-149`.
- Shared helpers to reuse: `FOCUS_RING`, `INNER_CARD` (`src/components/error-resolution/format.ts:7,13`), `ErrorAlert` (`src/components/error-resolution/ErrorAlert.tsx:4`), the native-select class and `formatDate` pattern in `StaffTicketQueue.astro:57-71`.
- Topbar already marks „Użytkownicy” active for `currentPath="/admin/users"` (`UserBar.astro` `isCurrent`).

## What We're NOT Doing

- No change to `assign-company.ts`, its redirect codes, `company-assignment.ts`, types, RLS or migrations.
- No renaming of the UserBar entry „Użytkownicy”.
- No shadcn `Select` / React island — native `<select>`, as on `/admin/tickets`.
- No pagination, search, or display of which account was just assigned.
- No new smoke steps; removing `.dark`/cosmic tokens stays in S-07.

## Implementation Approach

Same split as S-05: the page keeps data loading and maps `status`/`error` to fixed Polish strings; a new presentational component owns the markup so the kitchen sink can render every state with static props. The form markup keeps the smoke-read shape.

## Phase 1: `/admin/users` on the UI contract

### Overview

Extract the view into `StaffUserAssignment.astro`, restyle and translate it, put the page on Topbar + Card, add it to the lint contract and the kitchen sink, update CLAUDE.md.

### Changes Required:

#### 1. Presentational component

**File**: `src/components/admin/StaffUserAssignment.astro` (new)

**Intent**: Render the whole `/admin/users` content from props, reading no locals and running no query, in token classes and shadcn components only, with Polish copy and the creation date.

**Contract**: Props `{ pending: PendingAssignmentsResult; successMessage: string | null; errorMessage: string | null }`. Order: H1 „Konta do przypisania” + hint; success `Alert` (`border-success/40 bg-success/10`, `text-success`) and `ErrorAlert`, as in `StaffTicketQueue`; then one of: load error `ErrorAlert` „Nie udało się wczytać listy kont. Odśwież stronę za chwilę.”, empty „Żadne konto nie czeka na przypisanie.” (`text-muted-foreground`), no companies „Nie ma jeszcze firm klienckich, do których można przypisać konta.” (`text-warning`), or a `<ul>` of `Card className={INNER_CARD}` rows. Each row is a POST form to `/api/admin/assign-company` with `<input type="hidden" name="userId" value={id} />` first, then the e-mail alone in its own element (`font-semibold text-foreground`, `truncate`), optional full name and „Założone: …” in `text-muted-foreground`, a native `<select name="companyId" required>` with `aria-label={`Firma dla ${email}`}`, placeholder option „Wybierz firmę”, options from `pending.companies`, styled like the S-05 select with `FOCUS_RING`, and `<Button type="submit" className={FOCUS_RING}>Przypisz</Button>`. Doc comment names the smoke-read shape (`name="userId" value`, `>email<`).

#### 2. Page

**File**: `src/pages/admin/users.astro`

**Intent**: Keep data loading and the code→message mapping, translate the messages, and render the component in the shared chrome.

**Contract**: `<Layout title="Konta do przypisania">` → `div.min-h-screen.bg-background.p-4` → `div.mx-auto.w-full.max-w-5xl` → `<Topbar />` → `<Card className="gap-0 p-6 sm:p-8">` → `<StaffUserAssignment … />`. Success „Konto przypisane do firmy.”; `ERROR_MESSAGES`: `missing-fields` „Wybierz firmę przed przypisaniem.”, `not-configured` „Supabase nie jest skonfigurowany.”, `invalid-company` „Do tej firmy nie można przypisać kont. Wybierz firmę kliencką.”, `not-updated` „Nic nie zmieniono — konto już nie istnieje albo ma już firmę.”, `error` „Przypisanie się nie powiodło. Spróbuj ponownie.”; unknown codes keep falling back to `error`. The „Back to start page” link goes (the Topbar logo links home, as on `/admin/tickets`).

#### 3. Lint contract

**File**: `eslint.config.js`

**Intent**: Enforce the contract on the page.

**Contract**: add `"src/pages/admin/users.astro"` to `uiContractConfig.files` (the component is already covered by `src/components/admin/**`).

#### 4. Kitchen sink

**File**: `src/dev/ui-kitchen-sink.astro`

**Intent**: Screenshot gate for every state.

**Contract**: new section „Konta do przypisania” rendering `StaffUserAssignment` in `Card className="gap-0 p-6 sm:p-8"` for: lista (two accounts, one with full name, one without), pusta lista, brak firm klienckich, błąd wczytania, komunikat sukcesu, komunikat błędu. Add `<UserBar email="serwis@xemi.local" access="staff" currentPath="/admin/users" />` to the user-bar section. Update the header comment and intro text listing views to include `/admin/users`.

#### 5. Docs

**File**: `CLAUDE.md`

**Intent**: Keep the UI-contract view list accurate.

**Contract**: _UI contract_ → add `src/pages/admin/users.astro` to the "Applies to views already on the contract" list.

### Success Criteria:

#### Automated Verification:

- Lint passes with the page in the contract: `npm run lint`
- Type check passes: `npx astro sync && npx astro check`
- Production build succeeds: `npm run build`
- Smoke passes unchanged against the preview on a freshly reset local Supabase: `npx supabase db reset`, `npm run preview`, `npm run smoke`
- No palette/arbitrary/hex classes remain: `grep -nE "bg-cosmic|white/|blue-|purple-|rose-|emerald-|amber-" src/pages/admin/users.astro src/components/admin/StaffUserAssignment.astro` returns nothing

#### Manual Verification:

- Kitchen-sink screenshot of every „Konta do przypisania” cell and the „Użytkownicy”-active UserBar looks like `/admin/tickets` (light, tokens, readable contrast)
- As `serwis@xemi.local` on `/admin/users`: Topbar with „Użytkownicy” active, a newly signed-up account listed with „Założone: …”, assigning it shows „Konto przypisane do firmy.” and the account disappears
- Keyboard: Tab reaches each select and „Przypisz” with a visible full-strength focus ring; narrow viewport stacks the row without horizontal scroll

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Integration Tests:

- Existing smoke steps (`scripts/smoke.mjs:384-452`) prove the waiting list still exposes the account id next to its e-mail and every assignment redirect still lands on the page.

### Manual Testing Steps:

1. `npm run dev`, open `/dev/ui-kitchen-sink`, screenshot the new section and the UserBar row.
2. Sign up a fresh account, sign in as `serwis@xemi.local`, open `/admin/users`, check the row and date, assign it to Klient Alfa.
3. Submit the form with the select emptied via devtools (`required` removed) → „Wybierz firmę przed przypisaniem.”

## Performance Considerations

None — same single query pair as today.

## Migration Notes

None.

## References

- Roadmap: `context/foundation/roadmap.md` → S-06
- Similar implementation: `src/pages/admin/tickets.astro`, `src/components/admin/StaffTicketQueue.astro`, `context/archive/2026-10-28-staff-ticket-company-filter/plan.md`
- Smoke parser: `scripts/smoke.mjs:144`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `/admin/users` on the UI contract

#### Automated

- [x] 1.1 Lint passes with the page in the contract — 436fb15
- [x] 1.2 Type check passes — 436fb15
- [x] 1.3 Production build succeeds — 436fb15
- [x] 1.4 Smoke passes unchanged against the preview on a freshly reset local Supabase — 436fb15
- [x] 1.5 No palette/arbitrary/hex classes remain — 436fb15

#### Manual

- [x] 1.6 Kitchen-sink screenshot of every „Konta do przypisania” cell and the „Użytkownicy”-active UserBar looks like `/admin/tickets` — 436fb15
- [x] 1.7 As staff on `/admin/users`: Topbar active entry, account with „Założone: …”, assignment message and removal — 436fb15
- [x] 1.8 Keyboard focus ring on select and „Przypisz”; narrow viewport stacks without horizontal scroll — 436fb15
