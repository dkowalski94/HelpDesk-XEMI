# Service Staff Ticket Resolution Implementation Plan

## Overview

Service staff get a queue of every client company's `todo` tickets at `/admin/tickets` and record a resolution as **cause (optional) + steps (required)**. One `SECURITY DEFINER` function, `resolve_ticket()`, closes the ticket and creates a `source = 'ticket'` knowledge base entry in the same transaction. The entry's error text is **automatically sanitized** of company data before it is stored and embedded. If the embedding cannot be computed, the resolution is still saved without one, and a **"Przelicz"** button on the staff page fills the missing embeddings later. The client who filed the ticket sees the cause and steps next to it under "Moje zgłoszenia". Roadmap item S-02 covers FR-004, FR-005, FR-006 and FR-008.

## Current State Analysis

- **Schema is in place.**
  - `tickets` has `resolution`, `resolved_by` and `resolved_at`, plus a two-branch CHECK that ties them to `status` (`supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:98-110`).
  - `knowledge_base_entries` has `cause`, `steps`, `embedding vector(1536)`, `source_ticket_id` and `source_company_id` (`:133-146`).
  - The `kb_source` enum value for ticket-derived entries is `'ticket'` (`:60`).
- **Write grants today.**
  - Staff update tickets through the policy `"tickets are updatable by staff"` (`:275-280`) plus a column grant on `(status, resolution, resolved_by, resolved_at)` (`:370-371`).
  - Staff insert and update knowledge base rows through policies `:290-301` and column grants that omit `erp_document_id` (`supabase/migrations/20260924120000_erp_document_ingestion.sql`, §7).
  - Nothing in the app uses either write path yet.
- **Deferred to S-02 by earlier reviews.**
  - Staff can set `resolved_by` to any profile: `context/archive/2026-09-22-tenant-data-and-auth-foundation/reviews/security-review-migrations-1-2.md:110-121`, F2, "To S-02".
  - The staff KB UPDATE policy also covers `erp_doc` fragments: `context/archive/2026-09-24-erp-doc-ingestion-pipeline/reviews/impl-review.md:161-175`, F9, "narrow the UPDATE policy to `source = 'ticket'`".
  - The `(company_id, status)` index cannot serve a status-only staff queue: migration 2 `:119-124`.
- **The match side already renders ticket entries.**
  - `src/components/error-resolution/ErrorResolutionPanel.tsx:30-48` shows "Z rozwiązanych zgłoszeń" with the entry's `errorText`, then **Przyczyna** and **Kroki**.
  - `match_knowledge_base` skips rows whose `embedding` is null (`supabase/migrations/20260925120000_match_knowledge_base.sql:48`).
  - A ticket entry's `error_text` is therefore shown to *other* companies' users. That is why it must be sanitized: PRD NFR "Error content … from one client company are never visible to another".
- **Patterns to reuse.**
  - Staff page with a form POST and redirect: `src/pages/admin/users.astro` and `src/pages/api/admin/assign-company.ts`.
  - `STAFF_ROUTES = ["/admin", "/api/admin"]` already gates both (`src/middleware.ts:10`).
  - Embeddings: `embedText()` returns `null` without a key and throws `OpenAIRequestError` on failure (`src/lib/openai.ts:35`, `:81`).
  - Definer functions with a staff gate and 42501: F-02's `stage_/publish_/remove_erp_document`.
  - Ticket listing: `src/lib/services/tickets.ts` (`TICKET_COLUMNS`, `toTicketSummary`, `listVisibleTickets`).
- **Process rules** (`context/foundation/lessons.md`):
  - Assert the denied writes in the same phase that creates the surface.
  - Every new function revokes EXECUTE from `public`/`anon` in its own migration, verified through `information_schema`.

## Desired End State

- A service-staff member opens `/admin/tickets` (linked from `/dashboard`) and sees `todo` tickets from every client company, oldest first, 50 per page. Each shows the company name, filing time, error text and client comment. Each ticket has a form with "Przyczyna" (optional), "Kroki" (required) and a read-only preview of the sanitized text that will go to the knowledge base.
- Submitting the form runs `resolve_ticket()`, which in one transaction does three things:
  - moves the ticket `todo → resolved` with `resolved_by = auth.uid()`, `resolution = steps` and `resolution_cause = cause`;
  - inserts a `source = 'ticket'` knowledge base entry with the sanitized text, cause, steps, embedding (or null), `source_ticket_id` and `source_company_id`;
  - leaves the ticket unchanged if it is already resolved, and reports that.
- Without an embedding, the staff page shows "N rozwiązań bez embeddingu" with a "Przelicz" button. The button fills up to 20 per click.
- A future client paste whose error resembles the resolved one gets that entry as a match. The match is sanitized and shows cause and steps.
- The filing client sees "Rozwiązane" plus the cause and steps on their own ticket.
- `rls.sql` proves the following: non-staff cannot call `resolve_ticket()` (42501); no role can UPDATE `tickets` or INSERT `knowledge_base_entries` directly; staff UPDATE of an `erp_doc` entry changes 0 rows. Smoke proves the end-to-end loop over HTTP.

### Key Discoveries:

- `ErrorResolutionPanel.tsx:35` renders `match.errorText` for ticket entries verbatim. This is the cross-tenant surface the sanitizer protects.
- `tickets.created_by`/`resolved_by` are `on delete set null`, and CHECK lets `resolved_by` be null on the resolved branch (migration 2 `:93-97`). The function must set `resolved_by` itself rather than rely on the CHECK.
- `enforce_ticket_company_kind` fires on every ticket UPDATE (migration 2 `:215-218`). Updates from the definer function still pass it, because the company does not change.
- PostgREST serialises `vector` as a string. The RPC argument is `JSON.stringify(vector)`, as in `error-resolution.ts`.
- CI smoke has no `OPENAI_API_KEY`, so every smoke resolution takes the no-embedding path. That is exactly the path the counter and the backfill must handle.

## What We're NOT Doing

- Editing, reopening or deleting a resolution once saved. Staff cannot change the sanitized KB text either: sanitization is automatic only, by user decision.
- Manual or AI-based sanitization. Only deterministic rules are used. Values the rules cannot recognize, such as a counterparty's name, are an accepted risk.
- Sorting, filtering, search or assignment in the staff queue (PRD FR-004: an unsorted list is enough). Showing resolved tickets to staff.
- Email notification to service (FR-009/FR-010, parked).
- S-03's "not helpful" write path for `user_comment`. S-03 adds its own client-scoped grant and policy, because this plan removes the direct staff UPDATE path (see Migration Notes).
- Retry or queueing of failed embeddings beyond the manual "Przelicz" button. There is no automatic background job.
- The `MATCH_THRESHOLD` calibration left open by S-01 (step 3.12).

## Implementation Approach

The pattern is database first, then server, then UI, the same order as S-01.

- **One write path.** `resolve_ticket()` is the only way a ticket becomes resolved and the only way a ticket entry enters the knowledge base. The direct grants and policies that could do either are removed in the same migration. This makes "resolved ⇒ has a KB entry" and "resolved_by = the real resolver" properties of the database.
- **Data each layer supplies.**
  - The server supplies the computed parts: the sanitized text and the embedding.
  - The function owns identity (`auth.uid()`), the company (read from the ticket row) and atomicity.
- **Sanitization runs on the server, on the ticket row it reads, never on form input.**
  - It lives in a dependency-free module, `src/lib/sanitize-error-text.ts`, so the staff page can render the preview with the same function.
  - The embedding is computed from the sanitized text: the stored text is the one that gets matched.

## Critical Implementation Details

- **Order inside `resolve_ticket()`.** First do the conditional `update … where id = p_ticket_id and status = 'todo' returning company_id`. Insert the KB row only if that update returned a row. Two staff members resolving the same ticket then produce one entry: the second caller gets `already-resolved`, and no orphan KB row is created.
- **Sanitizer rule order matters.** Specific patterns (e-mail, IBAN/account, NIP, phone, document number, amount) run before the generic run of 5 or more digits. Otherwise the generic rule eats them first and the preview shows an uninformative `[liczba]` instead of `[NIP]`.

## Phase 1: Database — resolution function and write-path hardening

### Overview

One migration adds `tickets.resolution_cause`, the `resolve_ticket()` function, the queue index, and replaces the direct write grants and policies. The same phase extends `rls.sql` with the denied writes and regenerates the types.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261014120000_ticket_resolution.sql`

**Intent**: Make resolving a ticket and feeding the knowledge base one atomic, staff-only operation that records the real resolver. Close F2, F9 and the missing queue index.

**Contract**:

- `alter table public.tickets add column resolution_cause text`. Drop and recreate `tickets_resolution_matches_status`, adding `resolution_cause is null` to the unresolved branch. On the resolved branch it stays optional, because cause is optional.
- `create function public.resolve_ticket(p_ticket_id uuid, p_steps text, p_kb_error_text text, p_cause text default null, p_embedding extensions.vector(1536) default null) returns text`, with `language plpgsql`, `security definer` and `set search_path = ''`. Not `strict`. The two optional parameters come last and carry `default null`. This matters because `supabase gen types` types every argument without a default as required and non-null (`src/database.types.ts:335-366`), so passing `null` would fail `astro check`. With the default they generate as `p_cause?: string` / `p_embedding?: string`, and the caller omits them. Behaviour:
  - Raise 42501 unless `(select public.is_service_staff())`.
  - Raise 22023 when `p_steps` or `p_kb_error_text` is null or blank after `btrim`. Store the trimmed values, and store `nullif(btrim(p_cause), '')`.
  - `update public.tickets set status = 'resolved', resolution = …, resolution_cause = …, resolved_by = auth.uid(), resolved_at = now() where id = p_ticket_id and status = 'todo' returning company_id`.
  - If no row came back, return `'not-found'` when the ticket does not exist and `'already-resolved'` otherwise.
  - Insert `knowledge_base_entries (source, error_text, cause, steps, embedding, source_ticket_id, source_company_id)` with `'ticket'`, the sanitized text, the cause, the steps, `p_embedding`, the ticket id and the ticket's company. Return `'resolved'`.
  - Comment the function (same style as `match_knowledge_base`): what it writes, the gate, and why it is definer.
- Privileges, per lessons:
  - `alter function … owner to postgres`.
  - `revoke execute … from public, anon`, then `grant execute … to authenticated`.
- Write-path hardening:
  - `drop policy "tickets are updatable by staff"`, then `revoke update on public.tickets from authenticated`. This closes F2, because `resolved_by` is now set only by the function.
  - `drop policy "knowledge base entries are insertable by staff"`, then `revoke insert on public.knowledge_base_entries from authenticated`. Ticket entries are created only by the function, and erp_doc entries only by the F-02 functions.
  - Replace `"knowledge base entries are updatable by staff"` with a policy whose `using` and `with check` are `(select public.is_service_staff()) and source = 'ticket'`. This closes F9. The column-scoped UPDATE grant from migration `20260924120000` stays as is, and the embedding backfill relies on it.
- `create index tickets_todo_created_at_idx on public.tickets (created_at, id) where status = 'todo'` for the staff queue: oldest first, with `id` as the tiebreak.
- Header comment in the house style (Purpose / Affected / Notes), naming F2 and F9 as closed and noting that S-03 adds its own client UPDATE path.

#### 2. Policy-level tests

**File**: `supabase/tests/rls.sql`

**Intent**: Pin the new write surface with denied-write assertions in this phase (lessons.md). Update the existing grant/policy inventory checks that the migration changes.

**Contract**: new or updated checks, each run as the seeded persona:

- `resolve_ticket` is executable by `authenticated` only. `anon` and `public` lack EXECUTE (`information_schema.routine_privileges`).
- A client user and an unassigned user calling `resolve_ticket` get 42501, and the ticket is unchanged.
- Staff resolve a seeded `todo` ticket and get `'resolved'`:
  - `resolved_by` equals the staff uid and `resolution_cause` and `resolution` are stored;
  - exactly one KB row has `source = 'ticket'` and `source_ticket_id` equal to the ticket, with `source_company_id` equal to the ticket's company;
  - a second call returns `'already-resolved'` and the KB count is unchanged;
  - a random uuid returns `'not-found'`.
- Staff calling with blank steps or blank KB text get 22023 and no write.
- Direct `update public.tickets` as staff fails with 42501 at the grant layer. Direct `insert into public.knowledge_base_entries` as staff fails the same way.
- Staff `update knowledge_base_entries set steps = …` on an `erp_doc` row changes 0 rows. The same update on a `ticket` row changes 1 row.
- Setting `resolution_cause` on a `todo` ticket violates the CHECK (run as the table owner).
- Grant inventory edits (`rls.sql:243-285`):
  - remove the four `tickets.{resolution,resolved_at,resolved_by,status}` UPDATE rows (`:275-278`);
  - remove the ten `knowledge_base_entries.*` INSERT rows (`:248-257`);
  - add `('resolve_ticket()', 'authenticated', 'EXECUTE')`;
  - keep the anon `has_function_privilege` check (`:306-310`) passing, which needs the migration's `revoke execute … from public, anon`.
- Existing checks that change semantics because of the revokes. Both now fail at the grant layer:
  - `:377` "alfa: resolving its own ticket touches no row" changes `expect_rows(…, 0)` → `expect_denied`;
  - `:599` "staff: inserting an erp_doc entry without a document" changes `expect_check_violation` → `expect_denied`. The CHECK itself stays covered as the owner at `:842`.
- Reword the now-stale comment at `:586-588` ("staff keeps its other knowledge-base writes"): staff keep only UPDATE of `ticket` entries.

#### 3. Generated types

**File**: `src/database.types.ts`

**Intent**: Expose `resolve_ticket` and `tickets.resolution_cause` to TypeScript.

**Contract**: `npx supabase gen types typescript --local > src/database.types.ts` from Git Bash. In PowerShell use `| Out-File -Encoding utf8`, as documented in the S-01 plan. `Functions` gains `resolve_ticket`, with the vector argument typed `string`.

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly on a fresh database: `npx supabase db reset`
- RLS and function checks pass: `psql … -f supabase/tests/rls.sql`
- `src/database.types.ts` contains `resolve_ticket` and `resolution_cause` after regeneration
- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Supabase Studio's Advisors list shows no new warnings beyond the expected `authenticated_security_definer_function_executable` for `resolve_ticket`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Server path — sanitizer, services, endpoints, smoke

### Overview

The pure sanitizer, the staff services (queue, resolve, backfill), two staff endpoints, the resolution fields on the existing ticket listing, and smoke steps for the loop.

### Changes Required:

#### 1. Sanitizer

**File**: `src/lib/sanitize-error-text.ts`

**Intent**: Strip company-identifying data from an error text before it becomes shared knowledge. The module is dependency-free, so both the server and the staff page can import it. It must never import `astro:env`.

**Contract**: `sanitizeErrorText(text: string, companyName: string | null): string`. The function is pure. Rules are applied in this order, each replacing its match with a Polish placeholder:

1. e-mail → `[e-mail]`
2. bank account or IBAN (`PL` optional, 26 digits with optional spaces) → `[konto]`
3. NIP (`\d{3}-?\d{3}-?\d{2}-?\d{2}`, or the same with the dashes moved to the 3-2-2-3 layout) → `[NIP]`
4. phone number (`+48` optional, 9 digits in groups) → `[telefon]`
5. document number: a token of letters and digits containing `/` and at least one digit, e.g. `FV/123/2026` or `ZK/12/09/26` → `[nr dokumentu]`
6. amount (`\d[\d  ]*,\d{2}` with an optional `zł`/`PLN`) → `[kwota]`
7. any remaining run of 5 or more digits → `[liczba]`
8. the reporting company's name, case-insensitive literal match, when given → `[firma]`

Whitespace is collapsed and trimmed afterwards. Digit runs of 1–4 digits (ERP error codes, years, short counts) are kept. The function is exported along with a short comment stating that a deterministic, incomplete filter is the accepted design.

#### 2. Staff ticket services

**File**: `src/lib/services/ticket-resolution.ts`

**Intent**: The business logic for the staff page and endpoints. No function throws to the route.

**Contract**:

- `listTodoQueue(supabase, { offset })`
  - Selects `todo` tickets, oldest first with `id` as tiebreak, 50 per page plus one row to detect a next page (the same paging trick as `listVisibleTickets`).
  - Joins the company name through PostgREST embedding (`companies(name)`). Staff can select companies, per the policy in migration 1.
  - Each item carries `kbPreview: sanitizeErrorText(errorText, companyName)`.
  - Returns `{ status: "ok", tickets, nextOffset } | { status: "error" }`.
- `resolveTicket(supabase, { ticketId, cause, steps })`
  - Reads the ticket's `error_text` and company name under the staff session; a missing row returns `not-found`.
  - Sanitizes the text and tries `embedText(sanitized)`. A null key or a thrown error becomes `embedding = null`, logged in the same style as `error-resolution.ts`.
  - Calls `rpc("resolve_ticket", …)`, passing `p_embedding: JSON.stringify(vector)` only when there is a vector and `p_cause` only when it is non-blank. Otherwise the key is omitted, never set to `null`; see the Phase 1 signature.
  - Returns `"resolved" | "resolved-no-embedding" | "already-resolved" | "not-found" | "invalid" | "error"`.
  - Input limits are enforced here before any OpenAI call: `steps` is required, and `steps` and `cause` are each at most `RESOLUTION_TEXT_MAX_LENGTH = 4000` after trim. Breaking either returns `invalid`.
- `countMissingEmbeddings(supabase)`: `select count, head` on `knowledge_base_entries` where `source = 'ticket'` and `embedding is null`. Returns `number | null`.
- `backfillEmbeddings(supabase)`
  - Fetches up to `BACKFILL_BATCH = 20` such rows (`id, error_text`) and embeds each.
  - Updates each with `.update({ embedding }).eq("id", id).is("embedding", null)`, so a concurrent backfill never overwrites.
  - Stops at the first embedding failure.
  - Returns `{ status: "ok", filled, remaining } | { status: "unavailable" } | { status: "error" }`.

#### 3. Staff endpoints

**Files**: `src/pages/api/admin/resolve-ticket.ts`, `src/pages/api/admin/backfill-embeddings.ts`

**Intent**: Form-POST endpoints in the `assign-company.ts` style, already gated by `STAFF_ROUTES`.

**Contract**: both start with the same in-route `service_staff` check as `assign-company.ts` (401 when anonymous, 403 otherwise), then answer with `context.redirect`.

- `resolve-ticket` reads FormData `ticketId`, `cause` and `steps`, then redirects to `/admin/tickets?status=<resolved|resolved-no-embedding>` or `?error=<code>`.
- `backfill-embeddings` takes no fields and redirects to `/admin/tickets?status=backfilled&filled=<n>` or `?error=<unavailable|error>`. Only digits are echoed into the URL.

#### 4. Ticket listing carries the resolution

**Files**: `src/lib/services/tickets.ts`, `src/types.ts`

**Intent**: The client's "Moje zgłoszenia" can show cause and steps. Under RLS the client can only read its own company's rows, which it may see unsanitized.

**Contract**:

- `TICKET_COLUMNS` gains `resolution, resolution_cause, resolved_at`.
- `TicketSummary` gains `resolution: string | null`, `resolutionCause: string | null` and `resolvedAt: string | null`, mapped in `toTicketSummary`.
- New types in `src/types.ts`: `StaffQueueTicket` (summary + `companyName`, `userComment`, `kbPreview`) and `ResolveTicketOutcome`.
- `GET /api/tickets` behaviour is otherwise unchanged.

#### 5. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove the loop and its gate over HTTP against the production preview.

**Contract**: new steps after the existing client-files-a-ticket step:

- A client POST to `/api/admin/resolve-ticket` gets 403. An anonymous POST gets 401.
- Staff `GET /admin/tickets` returns 200, and the HTML contains the smoke ticket's id.
- Staff resolve that ticket. The redirect `Location` matches `status=resolved-no-embedding` (CI has no OpenAI key) or `status=resolved`.
- A second resolve redirects with `error=already-resolved`.
- The client's `GET /api/tickets?mine=1` shows that ticket `resolved` with the submitted steps.
- A client POST to `/api/admin/backfill-embeddings` gets 403.

The queue check assumes the smoke ticket is on page 1. The queue is oldest-first, 50 per page, and the smoke ticket is the newest `todo`. This holds because every successful run resolves its own ticket. A failed run, or the backlog of unresolved smoke tickets from before this change, can push it to page 2 after about 48 leftovers. The remedy is the same `npx supabase db reset` that CLAUDE.md already prescribes for the smoke test.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- RLS and function checks still pass: `psql … -f supabase/tests/rls.sql`
- Smoke passes against the production preview on a freshly reset local Supabase

#### Manual Verification:

- With the key present, resolving a locally filed ticket redirects with `status=resolved`. A client then pasting a similar error gets the "Z rozwiązanych zgłoszeń" match, showing the sanitized text, cause and steps.
- Without the key, resolving redirects with `status=resolved-no-embedding`. After the key is restored, backfill fills the entry, and the same paste then matches.
- `sanitizeErrorText` run on 3–5 real XEMI error messages masks company data and keeps the ERP error code readable. The inputs and outputs are recorded in `change.md`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: UI — staff queue page and the client's resolution view

### Overview

The staff page, its dashboard link, and the cause and steps on the client's own tickets. Staff-facing text is Polish, like `/report-error`.

### Changes Required:

#### 1. Staff queue page

**File**: `src/pages/admin/tickets.astro`

**Intent**: A server-rendered queue in the `admin/users.astro` style. Rendering is server-side only, so no island is needed.

**Contract**:

- `Layout` + `Topbar`, `lang="pl"`. Status and error messages come from a fixed `Record<string, string>` keyed by the query-string code, as in `admin/users.astro`.
- Counter line: "N rozwiązań czeka na embedding" with a POST form to `/api/admin/backfill-embeddings` ("Przelicz"). Shown only when N > 0.
- One card per ticket, showing:
  - the company name, the filing time (`pl-PL`), the error text (`whitespace-pre-line`) and the client comment when present;
  - the read-only preview "Do bazy wiedzy trafi:" with `kbPreview`;
  - a form with a hidden `ticketId`, a `cause` textarea (optional, `maxlength` 4000), a `steps` textarea (`required`, `maxlength` 4000) and the button "Zapisz rozwiązanie".
- Empty state: "Brak zgłoszeń do rozwiązania." Load-error state: an error message asking the user to reload. A "Starsze/Dalej" link goes to `?offset=` when `nextOffset` is not null.
- Never use `set:html`.

#### 2. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Staff can reach the queue.

**Contract**: next to "Manage users", for `isStaff` only, add a link to `/admin/tickets` labelled "Zgłoszenia do rozwiązania".

#### 3. Client's resolved ticket

**File**: `src/components/error-resolution/ErrorResolutionPanel.tsx`

**Intent**: The filing client sees what service answered.

**Contract**: in the "Moje zgłoszenia" list, a `resolved` ticket shows "Przyczyna" (when not null) and "Kroki" under its status, using the same markup as `MatchCard`. Nothing changes for `todo` tickets.

#### 4. Project guide

**File**: `CLAUDE.md`

**Intent**: The next agent learns S-02's invariants without reading the code.

**Contract**:

- New section "Ticket resolution (S-02)" next to "Error resolution (S-01)", stating:
  - `resolve_ticket()` is the only path that resolves a ticket and the only path that creates a `ticket` KB entry; direct `tickets` UPDATE and KB INSERT are revoked from `authenticated`, so do not re-grant them;
  - the KB UPDATE policy is limited to `source = 'ticket'`;
  - KB text is sanitized server-side by `src/lib/sanitize-error-text.ts` (dependency-free, importable by pages) and embedded from the sanitized text;
  - a missing embedding is filled with "Przelicz".
- The Auth flow "API endpoints" line gains `src/pages/api/admin/{resolve-ticket,backfill-embeddings}.ts` (staff-only).
- The `npm run smoke` description now says that each run resolves the Klient Alfa ticket it files. It no longer says that nothing touches them; tickets still accumulate as `resolved` in the newest-first `/api/tickets` listing.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase

#### Manual Verification:

- Staff see `todo` tickets from both seeded client companies, oldest first, with company names. Resolved tickets disappear from the queue.
- The preview under each ticket shows masked company data. Submitting with empty "Kroki" is blocked in the browser.
- After a resolution without the key, the counter shows 1 and "Przelicz" (with the key restored) clears it.
- A client user opening `/admin/tickets` is redirected to `/dashboard`. The dashboard shows the queue link to staff only.
- The filing client sees "Rozwiązane" plus cause and steps under "Moje zgłoszenia". A client from the other company never sees that ticket.
- Polish diacritics render correctly, and the queue is usable at phone width.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

There is no unit-test runner yet (Module 3 introduces one). Coverage comes from the following:

### Unit Tests:

- None automated. `sanitizeErrorText` is checked by hand on real XEMI messages (Phase 2, manual). The recorded inputs and outputs become the first fixtures once a test runner exists.

### Integration Tests:

- `supabase/tests/rls.sql`: every denied write, the function's outcomes and the grant inventory (Phase 1).
- `scripts/smoke.mjs`: the gate (401/403), resolve, `already-resolved`, and the client seeing the resolution (Phase 2).

### Manual Testing Steps:

1. As `serwis@xemi.local`, open `/admin/tickets` and confirm that tickets from both client companies are listed oldest first.
2. Resolve one ticket with the key present. As a client of another company, paste a similar error and confirm the sanitized match.
3. Remove the key, resolve another ticket and see the counter. Restore the key, click "Przelicz" and confirm that the counter clears.
4. As the filing client, confirm that the cause and steps appear under "Moje zgłoszenia".

## Performance Considerations

- The queue query uses the new partial index `(created_at, id) where status = 'todo'`, so it is a range scan over unresolved rows only.
- Resolving makes one embedding call (8 s timeout, `openai.ts`). That is within the Workers request budget. The backfill batch of 20 sequential calls is bounded to stay within it.

## Migration Notes

- **Apply to the hosted project before merging to `master`** (`npx supabase db push`), per CLAUDE.md. The Worker from this change calls `resolve_ticket()`.
- **Rollback.** The migration revokes staff's direct UPDATE on `tickets`. The previous Worker never wrote tickets as staff, so a `wrangler rollback` across this migration stays functional.
- **S-03 note.** The roadmap's S-03 risk text assumes the column-scoped `tickets` UPDATE grant still exists. After this change there is no `authenticated` UPDATE on `tickets` at all. S-03 grants `update (user_comment)` together with its own client-scoped policy.
- No backfill of existing data is needed. No ticket is `resolved` in production yet, because nothing could resolve one.

## References

- Roadmap item: `context/foundation/roadmap.md` — S-02
- PRD: `context/foundation/prd.md` — FR-004, FR-005, FR-006, FR-008, NFR on cross-company isolation
- Deferred findings closed here:
  - `context/archive/2026-09-22-tenant-data-and-auth-foundation/reviews/security-review-migrations-1-2.md` F2
  - `context/archive/2026-09-24-erp-doc-ingestion-pipeline/reviews/impl-review.md` F9
- Similar implementations:
  - `supabase/migrations/20260925120000_match_knowledge_base.sql` (definer function and privilege hardening)
  - `src/lib/services/error-resolution.ts` (embedding and failure handling)
  - `src/pages/admin/users.astro` + `src/pages/api/admin/assign-company.ts` (staff form POST)
- Previous plan: `context/archive/2026-09-25-first-gated-error-resolution/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database — resolution function and write-path hardening

#### Automated

- [x] 1.1 Migrations apply cleanly on a fresh database: `npx supabase db reset`
- [x] 1.2 RLS and function checks pass: `psql … -f supabase/tests/rls.sql`
- [x] 1.3 `src/database.types.ts` contains `resolve_ticket` and `resolution_cause` after regeneration
- [x] 1.4 Type-check passes: `npx astro sync && npx astro check`
- [x] 1.5 Lint passes: `npm run lint`

#### Manual

- [x] 1.6 Supabase Studio's Advisors list shows no new warnings beyond the expected definer-function one for `resolve_ticket`

### Phase 2: Server path — sanitizer, services, endpoints, smoke

#### Automated

- [ ] 2.1 Type-check passes: `npx astro sync && npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Production build passes: `npm run build`
- [ ] 2.4 RLS and function checks still pass: `psql … -f supabase/tests/rls.sql`
- [ ] 2.5 Smoke passes against the production preview on a freshly reset local Supabase

#### Manual

- [ ] 2.6 With the key, a resolved ticket redirects `status=resolved` and a similar client paste matches it with sanitized text, cause and steps
- [ ] 2.7 Without the key, resolving redirects `status=resolved-no-embedding`; backfill with the key restored makes the same paste match
- [ ] 2.8 `sanitizeErrorText` on 3–5 real XEMI messages masks company data and keeps the error code; samples recorded in `change.md`

### Phase 3: UI — staff queue page and the client's resolution view

#### Automated

- [ ] 3.1 Type-check passes: `npx astro sync && npx astro check`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Production build passes: `npm run build`
- [ ] 3.4 Smoke passes against the production preview on a freshly reset local Supabase

#### Manual

- [ ] 3.5 Staff see todo tickets from both client companies, oldest first, with company names; resolved ones leave the queue
- [ ] 3.6 Preview shows masked company data; empty "Kroki" cannot be submitted
- [ ] 3.7 Counter shows tickets without embedding and "Przelicz" clears it
- [ ] 3.8 Client user is redirected away from `/admin/tickets`; queue link shown to staff only
- [ ] 3.9 Filing client sees "Rozwiązane" with cause and steps; the other company never sees the ticket
- [ ] 3.10 Polish diacritics render correctly; queue usable at phone width
