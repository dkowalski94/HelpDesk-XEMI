# First Gated Error Resolution Implementation Plan

## Overview

Roadmap slice **S-01**, the milestone's north star: a signed-in client user pastes the text of an ERP error on a new page and either sees up to three matching knowledge-base entries (cause/steps from resolved tickets, or fragments of ingested ERP documentation) or — when nothing matches, or the search itself is unavailable — gets a service ticket, told clearly which of the two happened. Covers US-01, FR-001, FR-002, FR-003, FR-007 (as a view of the user's own tickets) and FR-012 (query side).

## Current State Analysis

- **Ticket filing already works at the database layer.** `tickets` INSERT policy requires `company_id = current_company_id()`, `current_company_kind() = 'client'` and `created_by = auth.uid()`; the column grant allows only `(company_id, created_by, error_text, user_comment)`, so `status` always takes its default `'todo'` (`supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:263-271, 358-359`). Unassigned accounts and staff cannot file (`supabase/tests/rls.sql:458-463, 523-530`).
- **There is no similarity search.** No migration defines a match function. Clients cannot read `knowledge_base_entries` at all (staff-only RLS), and the client-readable definer view `knowledge_base_public` exposes `id, source, error_text, cause, steps` without `embedding` (`20260922120100_tickets_and_knowledge_base.sql:319-328`). The archived plans name the missing piece `match_knowledge_base` and assign it to S-01 (`context/archive/2026-09-24-erp-doc-ingestion-pipeline/plan.md:91-92`).
- **Vectors:** `embedding extensions.vector(1536)`, nullable, HNSW index with `vector_cosine_ops` (`20260922120100_tickets_and_knowledge_base.sql:139, 161-163`) — queries must order by cosine distance `<=>` to use it. The ingest side embeds with `text-embedding-3-small`, `encoding_format: "float"`, no `dimensions` param (`scripts/ingest/embeddings.mjs:8-9, 64`); the query side must match or every stored vector is unmatchable (CLAUDE.md, *ERP documentation ingestion*).
- **Entry shapes differ by source.** `source = 'ticket'` entries carry `cause` and `steps`; `source = 'erp_doc'` fragments have `error_text` = a source label (`"Plik.pdf — s. 12–13"`), `cause = null`, `steps` = the fragment text (`archive/2026-09-24-erp-doc-ingestion-pipeline/plan.md:73-76`).
- **Seeded knowledge-base rows have no embeddings** (`supabase/seed.sql:256-287`), so a fresh `db reset` matches nothing, and CI has no OpenAI key.
- **No OpenAI configuration in the app.** `astro.config.mjs:22-28` declares only `SUPABASE_URL`, `SUPABASE_KEY`, `EXA_API_KEY`; `OPENAI_API_KEY` exists only in `.env.ingest.example`.
- **`GET /api/tickets` is the smoke test's RLS probe.** `listVisibleTickets` deliberately has no application-level filter so an RLS regression surfaces in `scripts/smoke.mjs` (`src/lib/services/tickets.ts:11-15`); three smoke steps assert company-wide visibility (`scripts/smoke.mjs:153-163, 213-217, 263-267`).
- **UI is English today** (`src/layouts/Layout.astro` `lang="en"`, dashboard/search copy); the smoke test asserts the English "Client user" label.

## Desired End State

A client user at a `client` company opens `/report-error`, reads a Polish instruction on what to copy from the ERP, pastes up to 2000 characters and submits. Within a few seconds they see exactly one of:

- **Matched** — 1 to 3 knowledge-base entries whose cosine similarity to the pasted text is ≥ 0.5, best first, and an explicit note that no ticket was created;
- **Ticket created** — a new `todo` ticket in their company, with an extra note when the search was unavailable (no key, OpenAI error/timeout, match function error);
- **Already reported** — no new ticket, because the same user already has a `todo` ticket with the identical (trimmed) text.

Below the form they see a list of the tickets **they** filed (not the whole company's). Staff, unassigned and anonymous users cannot use the flow. Verified by `supabase/tests/rls.sql` (match function semantics and privileges), `npm run smoke` (HTTP flow, CI without an OpenAI key), and a manual run with a real key against locally ingested documentation.

### Key Discoveries:

- Definer-function conventions to copy: `security definer`, `set search_path = ''`, owner pinned to `postgres`, `revoke execute … from public, anon`, `grant execute … to authenticated` (`supabase/migrations/20260924120000_erp_document_ingestion.sql:440-454`).
- `rls.sql` fails on any grant not listed in its inventory (`supabase/tests/rls.sql:231-316`); functions are listed as `name()`.
- Integration pattern to mirror: `src/lib/exa.ts` (plain `fetch`, `isExaConfigured()`, returns `null` when unconfigured, throws a typed error on non-ok) + `src/lib/services/web-search.ts` (never throws to the route; returns a discriminated union) + `src/pages/api/web-search.ts` (FormData input, `FAILURE_STATUS` map).
- Smoke idempotency rule: seeded personas are only signed in as and attacked, never changed (`scripts/smoke.mjs:10-12`). The throwaway account the smoke run registers ends up assigned to Klient Alfa (`scripts/smoke.mjs:253-267`) — it is the one that may file tickets.
- Helper calls inside SQL use the `(select public.fn())` form so Postgres evaluates them once (`20260922120000_tenant_identity_foundation.sql:340-343`).

## What We're NOT Doing

- **"Not helpful" marking / escalation with a comment (FR-011)** — that is S-03. The matched view gets no button for it.
- **Staff dashboard, recording resolutions, feeding resolved tickets into the knowledge base (FR-004–FR-006)** — that is S-02. The client list shows status only, never a resolution.
- **Changing RLS so a client sees only their own tickets.** "Only my tickets" is a view filter (`?mine=1`); `tickets` SELECT stays company-wide as PRD FR-007 states. A client calling the API without the parameter still gets their company's tickets.
- **A database-enforced uniqueness for open tickets.** Deduplication is an application check on the same user's `todo` tickets with identical text; two truly concurrent requests may still file two tickets.
- **Translating existing screens.** Only the new page, its island and the new endpoint's messages are Polish; the dashboard link to the page stays English like the rest of the dashboard.
- **An OpenAI stub or an OpenAI secret in CI.** The matched path over HTTP is verified manually; CI covers the match function in SQL and the ticket path over HTTP.
- **Retries of the embeddings call, a second provider, or caching of query embeddings.** One attempt with a timeout; failure falls back to a ticket.
- **Seeding embeddings in `supabase/seed.sql`.** Tests plant vectors inside rolled-back transactions instead.
- **Showing screenshots from ERP documentation, email notification (FR-009/FR-010), analytics** — parked in the roadmap.
- **Tuning HNSW parameters or re-chunking documents.** Revisit only if manual verification shows poor match quality.

## Implementation Approach

Build bottom-up so each phase ends in a green, independently verifiable state: the match function and its SQL tests first (no app code depends on it yet), then the server path and its HTTP smoke coverage, then the client page. The server orchestration is a service that never throws: validate → embed + match → (if no match) dedupe → insert. Every search failure collapses into "unavailable", which the flow treats exactly like "no match" except for a flag the UI surfaces — so a user's report is never lost, and CI (which has no OpenAI key) exercises the full ticket path over HTTP.

## Critical Implementation Details

- **Operators under `search_path = ''`.** Inside the definer function, the pgvector distance operator must be schema-qualified as `operator(extensions.<=>)`, and the index is only used when the query orders by that distance directly with a `LIMIT`. Apply the similarity threshold *outside* the index-ordered subquery (see the Phase 1 contract snippet).
- **Client bundle boundary.** The React island must not import anything that imports `astro:env/server` (i.e. `src/lib/openai.ts` or the service). The 2000-character limit therefore lives in a small dependency-free module both the server and the island import.
- **Vector over PostgREST.** Pass the query embedding to the RPC in pgvector's text form (`JSON.stringify(vector)` → `"[0.1,…]"`), consistent with how `src/types.ts:79-81` documents pgvector values crossing PostgREST.

## Phase 1: Match function in the database

### Overview

Add `public.match_knowledge_base`, the only way a client session can run a similarity search, and pin its semantics and privileges in `rls.sql` with fixed vectors.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260925120000_match_knowledge_base.sql`

**Intent**: Create a read-only definer function that returns the closest knowledge-base entries at or above a similarity threshold, exposing only the columns `knowledge_base_public` already exposes plus the similarity, and returning nothing to anyone the view would return nothing to. Harden privileges in the same migration (lessons: revoke defaults in the migration that creates the object).

**Contract**: `public.match_knowledge_base(p_query_embedding extensions.vector(1536), p_match_threshold double precision, p_match_count integer) returns table (id uuid, source public.kb_source, error_text text, cause text, steps text, similarity double precision)` — `language sql stable strict security definer set search_path = ''`; similarity = `1 - cosine distance`; rows ordered by similarity descending; `p_match_count` clamped to `1..10`; entries with a null `embedding` never returned; zero rows unless `current_company_kind() = 'client'` or `is_service_staff()` (same gate as `knowledge_base_public`). Owner pinned to `postgres`; `revoke execute … from public, anon`; `grant execute … to authenticated`; a `comment on function` stating the gate and that it exposes no provenance or embedding. Body shape:

```sql
select m.id, m.source, m.error_text, m.cause, m.steps, m.similarity
from (
  select e.id, e.source, e.error_text, e.cause, e.steps,
         1 - (e.embedding operator(extensions.<=>) p_query_embedding) as similarity
  from public.knowledge_base_entries e
  where e.embedding is not null
    and ((select public.current_company_kind()) = 'client' or (select public.is_service_staff()))
  order by e.embedding operator(extensions.<=>) p_query_embedding
  limit least(greatest(p_match_count, 1), 10)
) m
where m.similarity >= p_match_threshold
order by m.similarity desc;
```

#### 2. RLS / privilege tests

**File**: `supabase/tests/rls.sql`

**Intent**: Assert the function's semantics and its denials with deterministic vectors, following the lesson "assert the denied path on every RLS surface in the phase that creates it". All planted data lives under a savepoint that is rolled back, so the end-of-script digest still proves nothing changed.

**Contract**:
- Grant inventory gains `('match_knowledge_base()', 'authenticated', 'EXECUTE')` — and nothing for `anon`/`PUBLIC`.
- A temp helper builds a 1536-dim vector from a few non-zero coordinates (e.g. unit basis vectors and `0.8·e1 + 0.6·e2`).
- New section under a savepoint, in this order. As the owner, set `f101.embedding = e1` and `f102.embedding = e2`. Then:
  - alfa, query `0.8·e1 + 0.6·e2`, threshold 0.5, count 3 → f101 then f102, similarities 0.8 and 0.6; threshold 0.7 → f101 only; query `e3` (orthogonal to both) → 0 rows;
  - as the owner, insert one `source = 'ticket'` entry with `embedding = null` and 12 more `source = 'ticket'` entries with `embedding = e1` (never `erp_doc`: the `knowledge_base_entries_erp_doc_has_document` check would reject them without a document);
  - every "as the owner" step switches with `reset role` and returns with `set local role authenticated` + `pg_temp.act_as(...)` for the next persona, since the script runs under `set local role authenticated` (`rls.sql:322`);
  - alfa, query `e1`, threshold 0.5: count 3 → 3 rows, the first with similarity 1; count 1000 → exactly 10 rows; count 0 → 1 row;
  - an entry with `embedding = null` is never returned;
  - unassigned (a4) → 0 rows; staff (a1) → rows (control); anon → `expect_denied`;
  - the function's result signature (`pg_get_function_result`) is pinned to the six columns above — no `embedding`, `source_ticket_id`, `source_company_id`, `erp_document_id`;
  - `pg_proc` shows it `stable` and `security definer`, owned by `postgres`.
- Fixture comment block at the top lists the new surface.

#### 3. Generated types

**File**: `src/database.types.ts`

**Intent**: Regenerate so `supabase.rpc("match_knowledge_base", …)` is typed.

**Contract**: `npx supabase gen types typescript --local > src/database.types.ts`, run from Git Bash — Windows PowerShell 5.1's `>` writes UTF-16 LE with a BOM (the same trap CLAUDE.md documents for `.env.ingest`); in PowerShell use `| Out-File -Encoding utf8` instead, and confirm the file is UTF-8 before committing. The `Functions` block gains `match_knowledge_base` (the vector argument is typed `string`).

### Success Criteria:

#### Automated Verification:

- Migrations apply cleanly on a fresh database: `npx supabase db reset`
- RLS and function checks pass: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql`
- `src/database.types.ts` contains `match_knowledge_base` after regeneration
- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`

**Implementation Note**: No manual verification for this phase — it has no user-visible surface.

---

## Phase 2: Server path — embeddings, resolution service, endpoints, smoke

### Overview

Wire the Worker side: OpenAI configuration and client, the resolution service, `POST /api/resolve-error`, the `?mine=1` filter on `GET /api/tickets`, and smoke coverage of the HTTP flow (CI has no OpenAI key, so it exercises the "search unavailable → ticket" path).

### Changes Required:

#### 1. Configuration

**Files**: `astro.config.mjs`, `.env.example`

**Intent**: Declare the key the Worker needs, optional like the others so the app still boots without it.

**Contract**: `OPENAI_API_KEY: envField.string({ context: "server", access: "secret", optional: true })`; `.env.example` gains `OPENAI_API_KEY=`. (`.dev.vars` is gitignored — the developer adds the key there by hand; production gets it via `wrangler secret put OPENAI_API_KEY`.)

#### 2. OpenAI embeddings client

**File**: `src/lib/openai.ts`

**Intent**: Embed one text with exactly the model the ingest side used, over plain `fetch` (no SDK, workerd-safe), shaped like `src/lib/exa.ts`.

**Contract**: exports `EMBEDDING_MODEL = "text-embedding-3-small"`, `EMBEDDING_DIMENSIONS = 1536` (comment cross-referencing `scripts/ingest/embeddings.mjs` — change both or neither), `isOpenAIConfigured()`, `embedText(text: string): Promise<number[] | null>` (`null` when no key), and `OpenAIRequestError(status, detail)`. Request body `{ model, input: text, encoding_format: "float" }` to `https://api.openai.com/v1/embeddings`; `AbortSignal.timeout(8000)`; no retries; throws `OpenAIRequestError` on non-ok and on a response whose vector is not 1536 finite numbers.

#### 3. Shared limit

**File**: `src/lib/error-text.ts`

**Intent**: One dependency-free source for the paste limit, importable by the server and the island.

**Contract**: `export const ERROR_TEXT_MAX_LENGTH = 2000;` — counted on the trimmed text, in JS string length.

#### 4. DTOs

**File**: `src/types.ts`

**Intent**: The response union of the new endpoint, camelCase per the file's convention.

**Contract**:
- `KnowledgeMatch { id; source: KbSource; errorText: string; cause: string | null; steps: string | null; similarity: number }`
- `ErrorResolutionSuccess = { ok: true; outcome: "matched"; matches: KnowledgeMatch[] } | { ok: true; outcome: "ticket-created" | "already-reported"; ticket: TicketSummary; searchUnavailable: boolean }`
- `ErrorResolutionFailureReason = "unauthorized" | "not-a-client" | "empty-text" | "too-long" | "not-configured" | "error"`
- `ErrorResolutionFailure { ok: false; reason; error: string }`, `ErrorResolutionResponse = Success | Failure`

#### 5. Resolution service

**File**: `src/lib/services/error-resolution.ts`

**Intent**: Orchestrate one paste end to end without ever throwing to the route: validate, search, and only when there is no match, dedupe then file.

**Contract**: `resolveError(supabase, { userId, companyId }, rawText): Promise<ErrorResolutionResponse>`; exports `MATCH_THRESHOLD = 0.5` and `MATCH_COUNT = 3` (the single calibration knob, with a comment that 0.5 is a starting point to calibrate on real queries).
1. `trimmed = rawText.trim()`; empty → `empty-text`; `trimmed.length > ERROR_TEXT_MAX_LENGTH` → `too-long`.
2. Search: `embedText(trimmed)` → `supabase.rpc("match_knowledge_base", { p_query_embedding: JSON.stringify(vector), p_match_threshold: 0, p_match_count: MATCH_COUNT })`, then keep only rows with `similarity >= MATCH_THRESHOLD` in TypeScript. The threshold is applied here, not in SQL, so near misses stay observable: `console.log` the best similarity of every search (matched or not) — this is what the calibration checks read, and changing the threshold needs no migration. Not configured, `OpenAIRequestError`, timeout/network error, or an RPC error → "unavailable" (`console.error` the cause). ≥ 1 row left after filtering → return `matched` with those rows mapped to `KnowledgeMatch`; **no ticket**. The generated RPC row type declares `cause`/`steps` as `string`, but `supabase gen types` marks every `returns table` column non-null; both are nullable (`cause` is always null for `erp_doc`), so the mapper types them `string | null` itself rather than trusting `src/database.types.ts`.
3. No match or unavailable → look up the user's own open ticket: `tickets` where `created_by = userId`, `status = 'todo'`, `error_text = trimmed`, newest first, limit 1. Found → `already-reported`. A lookup error is logged and treated as "not found" (a duplicate beats a lost report).
4. Insert `{ company_id: companyId, created_by: userId, error_text: trimmed }` returning `id, company_id, status, error_text, created_at` → `ticket-created`. Insert error → `error`.
5. `searchUnavailable` is `true` on both ticket outcomes when step 2 was unavailable.
All user-facing `error` strings are Polish.

#### 6. Endpoint

**File**: `src/pages/api/resolve-error.ts`

**Intent**: The client-only HTTP surface for the flow, following `src/pages/api/web-search.ts`.

**Contract**: `POST`, FormData field `errorText`. Gates in order: no `locals.user` → `unauthorized` 401; `locals.profileLookupFailed` → `error` 500; profile missing, `role !== "client_user"` or `companyKind !== "client"` → `not-a-client` 403 (before any OpenAI call); `createClient()` null → `not-configured` 503. Then `resolveError(...)`. Status map: `unauthorized` 401, `not-a-client` 403, `empty-text` 400, `too-long` 400, `not-configured` 503, `error` 500; every success 200. JSON with `Content-Type: application/json`. Not added to `PROTECTED_ROUTES` — like `/api/tickets`, it answers 401 itself.

#### 7. "My tickets" filter

**Files**: `src/pages/api/tickets.ts`, `src/lib/services/tickets.ts`

**Intent**: Let the client page list only the caller's own tickets without weakening the route's role as the smoke test's RLS probe.

**Contract**: `GET /api/tickets?mine=1` passes `createdBy: locals.user.id` to `listVisibleTickets`, which then adds `created_by = createdBy`; any other value or no parameter keeps today's unfiltered behaviour. Update both doc comments: the default stays unfiltered on purpose (RLS probe); `mine` is a view filter, not a security boundary.

#### 8. Smoke coverage

**File**: `scripts/smoke.mjs`

**Intent**: Cover the endpoint's denials and the ticket path over HTTP without changing any seeded persona.

**Contract**: a `resolveError(as, errorText)` helper POSTing the form field; a unique throwaway text per run (e.g. `smoke-${Date.now()} …` with nonsense words, so a developer's local ingested docs will not match it). Steps:
- anonymous → 401;
- the throwaway account while still unassigned → 403; staff → 403 (placed where those sessions already exist);
- after the throwaway account is assigned to Klient Alfa: blank text → 400 `empty-text`; 2001 characters → 400 `too-long`; the unique text → 200 `ticket-created` with `ticket.companyId === COMPANY.alfa`; the same text again → 200 `already-reported` with the same ticket id; `GET /api/tickets?mine=1` as the throwaway account → exactly that ticket; `GET /api/tickets` as the seeded Alfa user → still only Alfa's tickets and includes the new one (company-wide visibility unchanged); `GET /api/tickets?mine=1` as the seeded Alfa user → includes its own seeded ticket `e101` (filed by `a2` in `supabase/seed.sql`) and not the new one; `GET /api/tickets` as Beta → does not include it.
- The file header states that each run files one Klient Alfa ticket that nothing deletes (no DELETE policy): after ~49 runs against the same database, seeded `e101` falls off the first page and the staff check and the three `onlyTicketsOf(COMPANY.alfa, TICKET.alfa)` steps fail — run `npx supabase db reset` every few dozen local runs.

#### 9. Documentation

**File**: `CLAUDE.md`

**Intent**: Record the new integration and its contracts where future agents look first.

**Contract**: new *Error resolution (S-01)* subsection under Architecture (service, endpoint, match function, threshold constant, fallback-to-ticket rule, `?mine=1` semantics, the shared embedding model contract with `scripts/ingest/embeddings.mjs`); `OPENAI_API_KEY` added to the Environment list and to the deploy notes (`wrangler secret put`); the `npm run smoke` line under Commands notes that each run files one Klient Alfa ticket and the local database needs a `db reset` every few dozen runs.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- RLS and function checks still pass: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql`
- Smoke passes against the production preview on a freshly reset local Supabase: `npx supabase db reset`, then `npm run preview` and `npm run smoke`

#### Manual Verification:

- With `OPENAI_API_KEY` in `.dev.vars` and one real PDF ingested locally (`npm run ingest`), POSTing as a client user 2–3 real ERP error messages whose explanation is in that PDF (the error text a user would copy, not a sentence copied from the PDF) returns `outcome: "matched"` with that document's fragment first; the best similarity logged by the service is recorded for each
- With the key present, an unrelated sentence returns `ticket-created` with `searchUnavailable: false`

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Client page

### Overview

The Polish-language page a client user actually uses: form with instruction and counter, the three outcome views, and a list of their own tickets.

### Changes Required:

#### 1. Route gate

**File**: `src/middleware.ts`

**Intent**: Anonymous visitors to the page are redirected to sign-in like `/dashboard`.

**Contract**: `PROTECTED_ROUTES` gains `"/report-error"`.

#### 2. Page

**File**: `src/pages/report-error.astro`

**Intent**: Render the right state for who is looking, server-side, and mount the island only for client users of a client company.

**Contract**: `Layout` + `Topbar`, card layout like `src/pages/search.astro`; content wrapper `lang="pl"`. States from `Astro.locals`: lookup failed → error message; staff → "this page is for client users" message; unassigned → "account waiting for assignment" message; client → heading, short explanation and `<ErrorResolutionPanel client:load />`. All copy Polish.

#### 3. Island and hook

**Files**: `src/components/error-resolution/ErrorResolutionPanel.tsx`, `src/hooks/useMyTickets.ts`

**Intent**: The interactive flow, modelled on `src/components/search/WebSearchPanel.tsx` (FormData POST, pending state, `role="alert"` errors, `cn()`), in Polish.

**Contract**:
- Labelled `<textarea>` with an instruction telling the user to copy only the error message text from the ERP error window, not a whole log; a live counter `n / 2000` on the trimmed length that turns red over the limit; submit disabled while pending, when blank or over the limit.
- Outcome views:
  - `matched` — "found a possible solution" heading, a note that no ticket was created, one card per match. `ticket` source: "Przyczyna" (`cause`) and "Kroki" (`steps`). `erp_doc` source: labelled as coming from the documentation with `errorText` as the source label and `steps` as the text. Multi-line text keeps its line breaks.
  - `ticket-created` — "no solution found, passed to the service team". When `searchUnavailable` is set, an extra line says the search was temporarily unavailable.
  - `already-reported` — "you already reported this, it is waiting for the service team" with the ticket's date.
  - Failure — the server's Polish `error` message; a network failure gets a Polish "could not reach the server" line.
- `useMyTickets()` fetches `GET /api/tickets?mine=1` on mount and exposes a `reload()` the panel calls after `ticket-created`/`already-reported`. The list shows error text (truncated), a status label (`todo` → "Do zrobienia", `resolved` → "Rozwiązane") and the date formatted for `pl-PL`, with an empty state and a load-error state. First page only.

#### 4. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Give client users a way to reach the page.

**Contract**: for an assigned `client_user`, a link to `/report-error` styled like the staff "Manage users" link, English label ("Report an ERP error") to match the rest of the dashboard.

#### 5. Smoke coverage for the page

**File**: `scripts/smoke.mjs`

**Intent**: Prove the page gate and the per-role rendering over HTTP.

**Contract**: anonymous `/report-error` → 302 to `/auth/signin`; seeded Alfa user → 200 and the HTML contains the page heading; staff → 200 and the HTML contains the staff message, not the form's instruction; the throwaway account while unassigned → 200 with the waiting message.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase: `npx supabase db reset`, then `npm run preview` and `npm run smoke`

#### Manual Verification:

- As Klient Alfa with a real key and ingested docs: pasting a sentence from a document shows the matched view with 1–3 cards, the documentation card shows the file/page label and the fragment text, and no ticket appears in "my tickets"
- Pasting an unrelated error creates a ticket; the view says it went to the service team and the ticket appears in the list as "Do zrobienia"
- Submitting the same text again shows the "already reported" view and no second ticket appears
- With the key removed from `.dev.vars` (dev server restarted), a paste creates a ticket and the view mentions the search was unavailable
- The counter turns red above 2000 characters and the button is disabled; blank input cannot be submitted
- Signed in as the throwaway account assigned to Klient Alfa, the list shows only that account's tickets, not Anna's
- Staff and an unassigned account see their messages instead of the form; the dashboard link appears only for client users
- Calibration check: from the service's logged best similarity, the real error messages from 2.6 and 2 unrelated errors are separated by `MATCH_THRESHOLD` — if not, set it between the two groups and note the recorded values next to the constant
- Polish diacritics render correctly and the page is usable at phone width

**Implementation Note**: After automated verification passes, pause for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- None — the repo has no unit-test runner (test strategy arrives in Module 3). The logic that matters is covered at its real boundary: the match function in SQL, the flow over HTTP.

### Integration Tests:

- `supabase/tests/rls.sql`: match-function threshold, ordering, clamp, null-embedding exclusion, per-persona results, anon denial, result-column pin, privilege inventory.
- `scripts/smoke.mjs`: endpoint gates (401/403/400), ticket creation, deduplication, `?mine=1` vs company-wide visibility, cross-tenant invisibility of the new ticket, page gates per role.

### Manual Testing Steps:

1. `npx supabase db reset`; add `OPENAI_API_KEY` to `.dev.vars`; ingest one real PDF with `npm run ingest`.
2. `npm run dev`; sign in as `alfa@klient-alfa.local`; open `/report-error` from the dashboard link.
3. Paste a sentence from the ingested PDF → matched view; paste an unrelated error → ticket; paste it again → already reported.
4. Remove the key, restart, paste → ticket with the "search unavailable" note.
5. Sign in as staff and as a fresh signup → messages instead of the form.

## Performance Considerations

One request does at most: one OpenAI embeddings call (I/O, 8 s timeout), one RPC, one ticket lookup and one insert — all I/O, which does not consume the Workers CPU-time ceiling (`archive/2026-09-22-tenant-data-and-auth-foundation/plan.md:40-42`). Serialising a 1536-float vector to text is sub-millisecond. The HNSW index is used because the inner query orders by distance with a `LIMIT`.

## Migration Notes

- The new migration must be applied to the hosted project **before** merging to `master` — or, since this change is committed directly on `master`, **before the next `git push`**, because every push deploys the Worker (`npx supabase db push --dry-run`, then `npx supabase db push`), per CLAUDE.md *Database migrations*.
- `OPENAI_API_KEY` must be set on the production Worker (`npx wrangler secret put OPENAI_API_KEY`) before merge; without it production silently degrades to "every paste becomes a ticket".
- Rollback: the function is additive; an older Worker never calls it, so rolling the Worker back needs no schema change.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` (US-01, FR-001–FR-003, FR-007, FR-012)
- Upstream contracts: `context/archive/2026-09-22-tenant-data-and-auth-foundation/plan.md`, `context/archive/2026-09-24-erp-doc-ingestion-pipeline/plan.md`
- Patterns: `src/lib/exa.ts`, `src/lib/services/web-search.ts`, `src/pages/api/web-search.ts`, `src/components/search/WebSearchPanel.tsx`, `supabase/migrations/20260924120000_erp_document_ingestion.sql:425-467`
- Lessons applied: `context/foundation/lessons.md` (denied path per surface, revoke default privileges, no lodash)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Match function in the database

#### Automated

- [x] 1.1 Migrations apply cleanly on a fresh database: `npx supabase db reset` — 38ab5f3
- [x] 1.2 RLS and function checks pass: `psql … -f supabase/tests/rls.sql` — 38ab5f3
- [x] 1.3 `src/database.types.ts` contains `match_knowledge_base` after regeneration — 38ab5f3
- [x] 1.4 Type-check passes: `npx astro sync && npx astro check` — 38ab5f3
- [x] 1.5 Lint passes: `npm run lint` — 38ab5f3

### Phase 2: Server path — embeddings, resolution service, endpoints, smoke

#### Automated

- [ ] 2.1 Type-check passes: `npx astro sync && npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Production build passes: `npm run build`
- [ ] 2.4 RLS and function checks still pass: `psql … -f supabase/tests/rls.sql`
- [ ] 2.5 Smoke passes against the production preview on a freshly reset local Supabase

#### Manual

- [ ] 2.6 2–3 real ERP error messages explained in a locally ingested PDF return `matched` with its fragment first; logged similarities recorded
- [ ] 2.7 With the key present, an unrelated sentence returns `ticket-created` with `searchUnavailable: false`

### Phase 3: Client page

#### Automated

- [ ] 3.1 Type-check passes: `npx astro sync && npx astro check`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Production build passes: `npm run build`
- [ ] 3.4 Smoke passes against the production preview on a freshly reset local Supabase

#### Manual

- [ ] 3.5 Matched view shows 1–3 cards incl. documentation label and fragment; no ticket in "my tickets"
- [ ] 3.6 Unrelated error creates a ticket shown as "Do zrobienia"
- [ ] 3.7 Same text again shows "already reported" and no second ticket
- [ ] 3.8 Without the key, a paste creates a ticket and mentions the search was unavailable
- [ ] 3.9 Counter turns red above 2000 characters; blank and over-limit input cannot be submitted
- [ ] 3.10 The throwaway Alfa account's list shows only its own tickets
- [ ] 3.11 Staff and unassigned see messages instead of the form; dashboard link only for client users
- [ ] 3.12 Calibration: logged similarities of real vs unrelated errors are separated by `MATCH_THRESHOLD`; adjusted and noted if not
- [ ] 3.13 Polish diacritics render correctly; page usable at phone width
