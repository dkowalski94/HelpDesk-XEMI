# ERP Documentation Ingestion Pipeline Implementation Plan

## Overview

Build the offline pipeline that loads the existing ERP (XEMI) documentation into the shared
knowledge base: a Node script, run by a service-staff member on their own machine, that
extracts the text of each PDF, cuts it into ~800-token fragments, embeds them with OpenAI
`text-embedding-3-small`, and atomically replaces that document's entries in
`public.knowledge_base_entries` (`source = 'erp_doc'`) through database functions that check
`is_service_staff()`.

This is roadmap item **F-02** (FR-012). It unlocks S-01: the north star's "match against ERP
documentation" source has nothing to search until this pipeline has run at least once.

## Current State Analysis

What F-01 left in place, and what it does not cover:

- `public.knowledge_base_entries` exists with `source kb_source` (`ticket` | `erp_doc`),
  `error_text text NOT NULL`, `cause`, `steps`, `embedding extensions.vector(1536)` and an HNSW
  cosine index (`supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:133-163`).
  The column comment already names `text-embedding-3-small` and says populating it is F-02/S-01
  (`:151-152`).
- There is **no notion of "which document an entry came from"**. Replacing a re-ingested
  document's old entries — a roadmap requirement ("must replace a document's old entries rather
  than duplicate them") — is impossible without a schema change.
- `authenticated` holds INSERT/SELECT/UPDATE on `knowledge_base_entries` (staff-only via RLS) but
  **no DELETE** (`supabase/migrations/20260924090000_revoke_unused_write_grants.sql:29`). A
  replace needs a new, narrow write path.
- `public.knowledge_base_public` (definer-rights view, `…120100…sql:319-336`) projects
  `id, source, error_text, cause, steps` to clients and staff. It needs no change: new `erp_doc`
  rows appear in it automatically.
- `supabase/seed.sql:235-262` seeds one `erp_doc` entry (`…f102`) with no document behind it.
- `supabase/tests/rls.sql` pins the exact grant inventory for `anon`/`authenticated`/`PUBLIC`
  (`:157-214`, functions listed as `name()`), and asserts denied writes per persona.
- The profiles SELECT policy lets a user read their own row
  (`supabase/migrations/20260922120000_tenant_identity_foundation.sql:354-358`), so the script can
  read its own `role` right after sign-in.
- No AI/embedding dependency and no PDF parser exist yet. ESLint already lints
  `scripts/**/*.mjs` (`eslint.config.js:73-74`); `scripts/smoke.mjs` is the style precedent
  (plain Node ESM, no framework).
- `.gitignore` ignores `.env*` and unblocks only `.env.example`.

Settled upstream in the roadmap (F-02 "Resolved", 2026-09-24) and not re-asked here: PDF only,
up to ~20 files of ~200 MB each (mostly screenshots); text-only extraction, images dropped, no
OCR; documentation changes over time and service staff own re-ingestion; a script outside the
app, no in-app upload; run by a non-developer, so setup, credentials and errors must be usable
by one.

## Desired End State

A service-staff member with Node 22 and a clone of the repo runs:

```
npm run ingest -- "C:\Dokumentacja\Magazyn.pdf" "C:\Dokumentacja\Księgowość.pdf"
```

enters their HelpDesk password when prompted, and sees per-file progress and a final summary in
Polish. Afterwards each PDF is one row in `public.erp_documents` and N rows in
`public.knowledge_base_entries` (`source = 'erp_doc'`, `erp_document_id` set, embedding filled),
visible to clients through `knowledge_base_public`. Running the same command again skips
unchanged files (same SHA-256); running it on an edited file replaces that document's entries
in one transaction — never duplicates, never a half-loaded state. `npm run ingest -- --lista`
lists what is loaded; `npm run ingest -- --usun Magazyn.pdf` removes a document and its
entries. `--dry-run` prints the fragments without any network call.

Verify: `supabase/tests/rls.sql` passes (including new denied-write checks), the manual run
against a real ERP PDF on local Supabase produces the expected rows, and re-running it is a
no-op.

### Key Discoveries:

- `knowledge_base_entries.error_text` is `NOT NULL` and S-01 will display
  `error_text/cause/steps` of the matched entry — so for a document fragment `error_text` holds a
  source label (`"Magazyn.pdf — s. 12–13"`) and `steps` holds the fragment text
  (`…120100…sql:136-138`).
- pgvector's text input format `[0.1,0.2,…]` is exactly a JSON array, so a `jsonb` embedding
  casts with `(chunk->>'embedding')::extensions.vector(1536)` — no client-side SQL formatting.
- Migration 2 guards a hosted-only failure mode with an explicit `DO` block
  (`…120100…sql:35-49`); the new constraint needs the same treatment because `db reset` can
  never reproduce orphan `erp_doc` rows that a hosted database might hold.
- Lessons (`context/foundation/lessons.md`): assert denied **writes** on every new RLS surface in
  the same phase; revoke Supabase default privileges in the migration that creates the object and
  verify through `information_schema`, not by reading SQL; no lodash.

## What We're NOT Doing

- Word/Excel ingestion — the current corpus is PDF only (roadmap F-02).
- OCR, image extraction or storing screenshots — parked as nice-to-have in the roadmap.
- An in-app upload screen or any Worker route — ingestion never touches the Worker.
- The S-01 matching query / `match_knowledge_base` function and the Worker-side OpenAI call —
  that is S-01. This change only guarantees the vectors are there and in the same model/dimension.
- Structure-aware chunking (detecting per-error headings) — fixed-size fragments were chosen;
  revisit only if S-01 match quality on real documents is poor.
- Stripping repeated page headers/footers from extracted text.
- Stripping table-of-contents dot leaders (`Rozdział 3 ........ 12`) — the Phase 2 dry run on the
  real document showed they survive extraction and dilute fragments; accepted for now, revisit
  together with headers if S-01 match quality on real documents is poor.
- A packaged single-file executable — the script runs from the repo clone.
- An automated end-to-end ingestion test in CI with a fixture PDF and fake embeddings — test
  strategy belongs to Module 3; verification here is `rls.sql` plus `--dry-run` and a manual run.
- Using the `service_role` key anywhere.

## Implementation Approach

**Identity and replacement live in the database, not in the script.** A new
`public.erp_documents` registry (one row per file name, with its content hash) owns its entries
through `knowledge_base_entries.erp_document_id … ON DELETE CASCADE`. Replacing a document is
"delete the registry row, insert a new one with its entries" inside a single function call.

**Upload is staged, publish is atomic.** A 200 MB PDF can produce a few hundred fragments, and
each carries 1536 floats — several MB of JSON. Rather than one oversized RPC, the script sends
batches of ~50 fragments to `stage_erp_document_chunks(...)`, which writes into a private staging
table keyed by a client-generated `upload_id`. `publish_erp_document(upload_id, …)` then, in one
transaction, verifies the batch is complete, replaces the document and clears the staging rows.
`knowledge_base_entries` and the client view therefore never see a partial document, and the
staff member sees progress per batch.

**The script authenticates as the staff member.** It signs in with the staff member's own
HelpDesk email/password (anon/publishable key only), so RLS stays in force, `ingested_by`
records who loaded what, and no full-access key ever sits on a laptop. All writes go through
three `SECURITY DEFINER` functions that check `is_service_staff()` themselves; the new tables
grant `authenticated` nothing but staff-filtered SELECT on the registry.

**Everything expensive happens before the first write.** Per file: hash → skip if unchanged →
extract → chunk → embed all fragments → stage → publish. An OpenAI failure leaves the database
untouched; a crash mid-staging leaves only staging rows, which the next publish by the same user
cleans up.

## Critical Implementation Details

- **Constraint vs existing rows.** The new check `(source = 'erp_doc') = (erp_document_id is not
  null)` would fail on the seeded `…f102` entry and on any hosted `erp_doc` row inserted by hand.
  The seed gains a matching `erp_documents` row; the migration aborts with an explicit, actionable
  message if the hosted table holds orphan `erp_doc` rows, instead of a bare check violation.
- **Denial errcode.** The functions must raise the staff check with
  `errcode = 'insufficient_privilege'` (42501), which is what `rls.sql`'s `expect_denied()` and
  the script's Polish error mapping both key on. Validation failures (bad dimension, incomplete
  upload) raise plain `P0001` with a clear message.
- **Case-insensitive file identity.** Staff run this on Windows, where `Magazyn.pdf` and
  `magazyn.PDF` are the same file; uniqueness and lookups use `lower(file_name)` of the base name
  (never the full path).

## Phase 1: Schema and the staff-only write path

### Overview

Add the document registry, the staging table, the link from knowledge-base entries to their
document, and the three functions that are the only way to write them — with privileges revoked
to nothing and denied writes asserted in `rls.sql` in this same phase.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260924120000_erp_document_ingestion.sql`

**Intent**: Give every ingested fragment a document to belong to, make "replace this document"
a single atomic database operation, and expose it to service staff only. Header comment in the
style of migrations 1–3 (Purpose / Affected / Notes).

**Contract**:
- Pre-check `DO` block: if `knowledge_base_entries` has any `source = 'erp_doc'` row, raise with a
  message telling the operator those rows predate document tracking and must be deleted (or
  re-ingested) before this migration runs.
- `public.erp_documents`: `id uuid pk`, `file_name text not null` (base name as given), unique
  index on `lower(file_name)`, `content_hash text not null` (check: 64 lowercase hex chars),
  `page_count integer not null`, `chunk_count integer not null`,
  `ingested_by uuid references public.profiles(id) on delete set null` (+ index),
  `ingested_at timestamptz not null default now()`, `created_at`, `updated_at`, and the existing
  `set_updated_at()` trigger. RLS on; one SELECT policy for `is_service_staff()`.
- `public.erp_document_upload_chunks` (staging): `upload_id uuid`, `seq integer` (pk
  `(upload_id, seq)`, `seq >= 0`), `file_name`, `content_hash`, `error_text text not null`,
  `steps text not null`, `embedding extensions.vector(1536) not null`,
  `uploaded_by uuid not null references public.profiles(id) on delete cascade` (+ index),
  `created_at`. RLS on, **no policies**.
- `public.knowledge_base_entries`: add `erp_document_id uuid references public.erp_documents(id)
  on delete cascade` (+ index) and constraint
  `knowledge_base_entries_erp_doc_has_document check ((source = 'erp_doc') = (erp_document_id is not null))`.
  Comment why this FK cascades while the provenance FKs set null: the entries *are* the
  document's content.
- `public.stage_erp_document_chunks(p_upload_id uuid, p_file_name text, p_content_hash text,
  p_chunks jsonb) returns integer` — `security definer`, `set search_path = ''`. Raises 42501 unless
  `is_service_staff()`. Rejects: non-array or empty `p_chunks`, more than 200 elements, an
  `upload_id` already holding rows from another user or for a different file/hash, elements
  missing `seq`/`error_text`/`steps`/`embedding`, blank `steps`. Inserts with
  `uploaded_by = auth.uid()`; returns rows inserted. Embedding cast:
  `(c->>'embedding')::extensions.vector(1536)` (a wrong dimension fails the cast — let it).
- `public.publish_erp_document(p_upload_id uuid, p_page_count integer)
  returns table (document_id uuid, chunk_count integer)` — definer, staff check. Requires staged
  rows for `p_upload_id` owned by `auth.uid()` whose `seq` values are exactly `0..n-1` (else raise
  "incomplete upload"). In one statement sequence: delete `erp_documents` where
  `lower(file_name) = lower(staged file_name)` (cascades old entries), insert the new registry row
  (`ingested_by = auth.uid()`), insert entries (`source = 'erp_doc'`, `cause` null), delete this
  upload's staging rows plus the caller's staging rows older than 24 h.
- `public.remove_erp_document(p_file_name text) returns boolean` — definer, staff check; deletes
  by `lower(file_name)`, returns whether a row existed.
- Privileges (lessons.md): `revoke all` on both new tables from `public, anon, authenticated`;
  `grant select on public.erp_documents to authenticated`. `revoke execute` on the three functions
  from `public, anon`; `grant execute … to authenticated`.
- *Addendum (impl review, phase 1):*
  - `publish_erp_document` clears this upload's staging rows plus **anyone's** staging rows older
    than 24 h (not only the caller's), so an abandoned upload never outlives a day of normal use.
  - `authenticated`'s table-level INSERT/UPDATE on `knowledge_base_entries` is replaced by
    column-scoped grants without `erp_document_id` (and without `source` for UPDATE), so staff
    cannot attach an entry to a document outside the function path; `rls.sql` pins the columns.
  - Further hardening (per-file advisory lock, mixed-upload and inserted-count checks, `seq`
    validation, path rejection in `file_name`, `page_count >= 1`, `owner to postgres`,
    `#variable_conflict use_column`): see `reviews/impl-review-phase-1.md` F3–F7.

#### 2. Seed

**File**: `supabase/seed.sql`

**Intent**: Keep the local/CI seed valid under the new constraint.

**Contract**: Insert one `erp_documents` row with a fixed id (e.g. `…0000d101`, file name
`Dokumentacja-demo.pdf`, a 64-hex hash, page/chunk counts 1) before the knowledge-base insert,
and set `erp_document_id` on `…f102`. `on conflict (id) do nothing` like the rest of the seed.

#### 3. Policy tests

**File**: `supabase/tests/rls.sql`

**Intent**: Prove the new surfaces deny every write to everyone but the function path, and that
the function path does what it claims — in this phase (lessons.md).

**Contract**:
- Grant inventory gains `('erp_documents','authenticated','SELECT')` and `EXECUTE` rows for
  `stage_erp_document_chunks()`, `publish_erp_document()`, `remove_erp_document()`.
- Client (alfa) and unassigned: `erp_documents` selects 0 rows; INSERT/UPDATE/DELETE/TRUNCATE on
  `erp_documents` and SELECT/INSERT/DELETE on the staging table denied; each of the three
  functions denied (42501).
- anon: EXECUTE on each function denied.
- Staff, denied: direct INSERT/UPDATE/DELETE on `erp_documents` and direct INSERT on staging
  (no grant); publishing an upload with a gap in `seq` denied; staging a vector of the wrong
  dimension denied; publishing an upload whose staging rows belong to another user (owner-side
  insert attributed to alfa's profile) denied.
- Staff, positive controls: stage 2 fragments + publish → one registry row, 2 `erp_doc` entries
  linked to it, staging empty; stage 1 fragment for the same file name in different case + publish
  → still one registry row, exactly 1 entry (replacement, not duplication); alfa then sees that
  entry through `knowledge_base_public`; `remove_erp_document` → registry row and its entries gone.
- Owner-side: inserting an `erp_doc` entry with `erp_document_id` null fails the check. The
  existing `expect_denied()` only accepts 42501/P0001 — add a small `expect_check_violation()`
  helper (SQLSTATE 23514) rather than widening `expect_denied()`.
- The final "nothing changed" fingerprint section must still pass (everything above runs in
  subtransactions or is undone by the rollback).

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies all migrations and the seed without error
- `supabase/tests/rls.sql` passes against the reset database (exit code 0), including the new grant inventory and denied-write checks
- `npm run lint` passes
- `npm run build` passes (no application code changed)
- `npm run smoke` passes against the local preview

#### Manual Verification:

- Supabase Studio's database linter shows no new warning other than the already-accepted `security_definer_view`, or each new one is explained in the migration comment
- On a scratch copy of the local DB, inserting an orphan `erp_doc` entry and re-running the migration's pre-check block aborts with the actionable message

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: PDF extraction and chunking (dry run)

### Overview

The offline half of the script: read a PDF, hash it, extract text per page, cut it into
fragments and print them — no network, no credentials. This is also the tool a staff member uses
to see what a document will turn into before loading it.

### Changes Required:

#### 1. Dependency and npm script

**File**: `package.json`

**Intent**: Add a PDF text extractor that runs in plain Node without native canvas, and the entry
point staff will type.

**Contract**: `unpdf` in **devDependencies** (never imported from `src/`, so it never enters the
Worker bundle; `npm ci` still installs it for staff). Script
`"ingest": "node scripts/ingest-erp-docs.mjs"`; `.env.ingest` is read by the script's own loader
(Phase 3 addendum), not `--env-file-if-exists`, which printed an English notice when the file was
absent.

#### 2. Script entry and CLI

**File**: `scripts/ingest-erp-docs.mjs`

**Intent**: Parse arguments, expand inputs, and drive each file through the pipeline, printing
Polish progress and a summary; exit 1 if any file failed, continuing past per-file failures.

**Contract**:
- Positional arguments: PDF files and/or folders (a folder means its `*.pdf`, non-recursive,
  case-insensitive extension). Non-PDF or missing paths are reported and skipped.
- Flags: `--dry-run` (this phase), `--lista`, `--usun <nazwa-pliku>`, `--wymus` (Phase 3),
  `--pomoc` / no arguments → Polish usage text.
- Output language: Polish for every user-facing line; no stack traces unless `DEBUG=1`.
- Uses `node:util` `parseArgs`; no CLI framework, no lodash.
- *Addendum (impl review, phase 2):* two inputs with the same case-insensitive base name are
  rejected (the second is reported and skipped, since they would replace each other in the
  database), and a folder without PDFs counts as a failure (exit 1).

#### 3. Extraction and chunking modules

**File**: `scripts/ingest/pdf-text.mjs`, `scripts/ingest/chunking.mjs`, `scripts/ingest/messages.mjs`

**Intent**: Keep the pure, testable-by-eye steps separate from the network steps added in
Phase 3, and keep all Polish strings in one place.

**Contract**:
- `pdf-text`: `sha256` of the file bytes (hex, lowercase) via `node:crypto`; per-page text via
  `unpdf` (`extractText(…, { mergePages: false })`), whitespace-normalized. Returns
  `{ pageCount, pages: string[] }`. A document whose total text is under ~200 characters is an
  error ("PDF nie zawiera tekstu — możliwe, że to skan") rather than zero fragments.
- `chunking`: fragments of at most ~3200 characters (~800 tokens) with ~400 characters of overlap,
  preferring paragraph, then sentence, then word boundaries; fragments shorter than ~80 characters
  are merged into a neighbour or dropped. Each fragment carries `{ seq, firstPage, lastPage,
  text }`; `seq` is 0-based and contiguous. Label `error_text` = `"<file name> — s. N"` or
  `"<file name> — s. N–M"`.
- `messages`: every Polish string and the error-to-message mapping used by Phase 3.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (covers `scripts/**/*.mjs`)
- `npm run build` passes and the built Worker bundle does not contain `unpdf`
- `npm run ingest -- --pomoc` prints the Polish usage text and exits 0
- `npm run ingest -- --dry-run nieistniejacy.pdf` reports the missing file in Polish and exits 1

#### Manual Verification:

- `npm run ingest -- --dry-run <real ~200 MB ERP PDF>` completes, prints page count, fragment count and the first fragments with page labels, with memory staying reasonable on a staff-class laptop
- Fragment boundaries read sensibly on the real document (no fragment cut mid-word, page labels match the PDF)
- A PDF with no text layer produces the "możliwe, że to skan" message, not an empty success

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Embeddings, sign-in and publish

### Overview

The online half: sign in as the staff member, skip unchanged documents, embed fragments with
OpenAI, stage them in batches and publish — plus `--lista`, `--usun` and `--wymus`.

### Changes Required:

#### 1. Embeddings client

**File**: `scripts/ingest/embeddings.mjs`

**Intent**: Turn fragment texts into 1536-dimension vectors with the model the schema was sized
for, surviving rate limits.

**Contract**: `POST https://api.openai.com/v1/embeddings` via global `fetch`, model
`text-embedding-3-small`, inputs batched (~64 per request). Retry on 429/5xx/network errors with
exponential backoff honouring `retry-after`, up to 5 attempts; 401 → "Klucz OpenAI jest
nieprawidłowy"; 429 with `insufficient_quota` → quota message, no retry. Every returned vector is
checked to have length 1536. No SDK (keeps the dependency surface to one package).

*Addendum (impl review, phase 3):* each request is capped at ~8000 estimated tokens as well as
64 inputs (at the lowest OpenAI tier, 40k TPM, 64 full fragments are one oversize request), and
each attempt times out after 60 s. The body is read inside the retry, so a stalled or dropped
response is retried as a network error.

#### 2. Supabase session and upload

**File**: `scripts/ingest/upload.mjs`

**Intent**: Authenticate as the person running the script and move fragments into the database
only through the Phase 1 functions.

**Contract**:
- Config from env (`.env.ingest`): `SUPABASE_URL`, `SUPABASE_KEY` (publishable/anon key, same as
  the app), `OPENAI_API_KEY`, optional `HELPDESK_EMAIL`. Missing values → one Polish message
  naming the variable and the file. Validation happens before any file is read.
- Email from env or prompt; password always prompted with hidden input (`node:readline`, output
  muted); never read from env or written anywhere.
- `@supabase/supabase-js` client with `persistSession: false`; `signInWithPassword`; then read own
  `profiles.role` — anything but `service_staff` → "To konto nie jest kontem serwisanta" and exit
  before touching any file.
- Per file: look up `erp_documents` by `lower(file_name)`; same `content_hash` and no `--wymus` →
  "bez zmian, pominięto". Otherwise embed all fragments, then `rpc('stage_erp_document_chunks')` in
  batches of 50 with a fresh `crypto.randomUUID()` upload id (progress "wysyłanie 3/8"), then
  `rpc('publish_erp_document')`. Report replaced vs newly added.
- `--lista`: table of file name, loaded at, loaded by (email if readable, else "—"), pages,
  fragments. `--usun <nazwa>`: `rpc('remove_erp_document')`, Polish confirmation or "nie
  znaleziono".
- Error mapping (in `messages.mjs`): invalid credentials, 42501 from any RPC, network/DNS failure,
  PostgREST "function does not exist" (→ "baza nie ma jeszcze migracji — skontaktuj się z
  administratorem"), and a generic fallback that prints the server message.
- *Addendum (impl review, phase 3):*
  - `.env.ingest` is resolved against the repo root and read by the script's own loader. A UTF-8
    BOM is stripped, UTF-16 gets a Polish "zapisz jako UTF-8" message, and variables already in
    the environment win.
  - `OPENAI_API_KEY` is required only to load documents, not for `--lista`/`--usun`.
  - `SUPABASE_URL` must be `https:`; `http:` is accepted only for localhost.
  - Database requests time out after 60 s, reported as a network error.
  - 57014 (statement timeout) has its own Polish message. Publishing 7 × 400 fragments measured
    0.4–1.4 s against authenticated's 8 s limit.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- With `.env.ingest` missing a variable, `npm run ingest -- plik.pdf` names the missing variable in Polish and exits 1 without prompting for a password

#### Manual Verification:

- Against local Supabase (`db reset`) signed in as `serwis@xemi.local`: ingesting a real ERP PDF creates one `erp_documents` row and N `erp_doc` entries with non-null embeddings; `--lista` shows it
- Re-running the same command prints "bez zmian, pominięto" and changes no row (`updated_at` unchanged)
- Re-running with `--wymus` (or on an edited copy with the same name) replaces the entries: same single registry row, entry ids all new, total `erp_doc` count equals the new fragment count
- Signing in as `alfa@klient-alfa.local` stops with "To konto nie jest kontem serwisanta" before any file is read
- A wrong password, a wrong OpenAI key and a stopped Supabase each produce a single readable Polish message
- Killing the script mid-upload leaves `knowledge_base_entries` unchanged; the next successful run publishes cleanly
- `--usun <nazwa>` removes the document and its entries; the client view (as alfa) no longer returns them

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Staff runbook and production rollout

### Overview

Make the script usable by a non-developer, document it for agents, apply the migration to the
hosted project and load the real documentation once.

### Changes Required:

#### 1. Staff runbook

**File**: `docs/wgrywanie-dokumentacji-erp.md`

**Intent**: A Polish, step-by-step guide a service-staff member can follow alone.

**Contract**: One-time setup (install Node 22 LTS and Git, clone, `npm ci`, copy
`.env.ingest.example` to `.env.ingest` and fill it — where each value comes from and that the
file must never be shared); everyday use (load files/folder, `--dry-run`, `--lista`, `--usun`,
`--wymus`); what each common message means and what to do; updating the tool (`git pull` +
`npm ci`).

#### 2. Config template

**File**: `.env.ingest.example`, `.gitignore`

**Intent**: Give staff a template without ever committing real keys.

**Contract**: Template lists `SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY`, `HELPDESK_EMAIL`
with Polish comments; `.gitignore` gains `!.env.ingest.example` next to `!.env.example`.

#### 3. Agent documentation

**File**: `CLAUDE.md`

**Intent**: Record the new command and the non-obvious rules for future changes.

**Contract**: `npm run ingest` under Commands; a short "ERP documentation ingestion" section:
offline only, writes solely through the three functions, `erp_doc` entries must have a document,
embedding model/dimension is shared with S-01's query side, `unpdf` stays a devDependency.

#### 4. Production rollout (operational, no file)

**Intent**: Follow CLAUDE.md "Database migrations": the migration reaches the hosted project
before the merge that ships it, then the real corpus is loaded.

**Contract**: `npx supabase db push --dry-run` shows exactly the new migration pending, then
`npx supabase db push`; the first real ingestion is run by a service-staff member with the
runbook.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `git check-ignore .env.ingest` reports it ignored and `git check-ignore .env.ingest.example` reports it not ignored
- CI (`ci` and `smoke` jobs) is green on the PR

#### Manual Verification:

- A service-staff member (not the developer) completes the setup and one ingestion using only the runbook, and reports where they got stuck
- `npx supabase db push --dry-run` against the hosted project lists only `20260924120000_erp_document_ingestion.sql`, and `db push` applies it before the PR is merged
- After the first production run, `--lista` shows all current ERP PDFs and a client account sees `erp_doc` entries through `knowledge_base_public`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None added — the project has no unit-test runner yet (test strategy is Module 3). Chunking is
  inspected through `--dry-run` on real documents instead.

### Integration Tests:

- `supabase/tests/rls.sql`: grant inventory, denied writes per persona on both new tables and all
  three functions, the replace/remove positive controls and the orphan-entry check violation
  (Phase 1). Runs in CI's `smoke` job already.

### Manual Testing Steps:

1. `npx supabase db reset`, then `npm run ingest -- --dry-run <real PDF>` — inspect fragments.
2. `npm run ingest -- <real PDF>` as `serwis@xemi.local` — check rows in Studio.
3. Same command again — "bez zmian"; then with `--wymus` — replaced, no duplicates.
4. Sign in as alfa — refused before reading files; `knowledge_base_public` as alfa shows the entries.
5. Kill mid-upload, re-run — clean publish, no partial rows ever visible.
6. `--usun` — entries gone.

## Performance Considerations

- ~20 files × a few hundred fragments is a few thousand vectors: one-off embedding cost is cents,
  HNSW insert cost is negligible. Batches of 50 keep each RPC body around 1–2 MB.
- A ~200 MB PDF is read fully into memory once for hashing and parsing; text extraction does not
  decode images. Verified on the real file in Phase 2.
- Unchanged files are skipped by hash before parsing, so routine re-runs over the whole folder are
  fast.

## Migration Notes

- Hosted: the migration aborts if any `erp_doc` entry already exists without a document. None is
  expected (nothing has written `erp_doc` rows in production); if the abort fires, delete those
  rows by hand and re-run — the real documentation is re-ingested by this pipeline anyway.
- Rolling back the Worker is unaffected: no Worker code reads the new tables or column.
- Apply with `db push` before merging (CLAUDE.md "Database migrations"); never `--include-seed`.

## References

- Roadmap item: `context/foundation/roadmap.md` — F-02 (resolved questions 2026-09-24)
- PRD: `context/foundation/prd.md` — FR-012, Business Logic
- Infrastructure: `context/foundation/infrastructure.md` — "Documentation ingestion", Risk Register
- Lessons: `context/foundation/lessons.md`
- Schema: `supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:133-172, 319-397`
- Grant precedent: `supabase/migrations/20260924090000_revoke_unused_write_grants.sql`
- Policy tests: `supabase/tests/rls.sql:157-214`
- Script precedent: `scripts/smoke.mjs`
- Previous change: `context/archive/2026-09-22-tenant-data-and-auth-foundation/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema and the staff-only write path

#### Automated

- [x] 1.1 `npx supabase db reset` applies all migrations and the seed without error — 5f318ef
- [x] 1.2 `supabase/tests/rls.sql` passes against the reset database (exit code 0), including the new grant inventory and denied-write checks — 5f318ef
- [x] 1.3 `npm run lint` passes — 5f318ef
- [x] 1.4 `npm run build` passes (no application code changed) — 5f318ef
- [x] 1.5 `npm run smoke` passes against the local preview — 5f318ef

#### Manual

- [x] 1.6 Supabase Studio's database linter shows no new warning other than the already-accepted `security_definer_view`, or each new one is explained in the migration comment — 5f318ef
- [x] 1.7 On a scratch copy of the local DB, inserting an orphan `erp_doc` entry and re-running the migration's pre-check block aborts with the actionable message — 5f318ef

### Phase 2: PDF extraction and chunking (dry run)

#### Automated

- [x] 2.1 `npm run lint` passes (covers `scripts/**/*.mjs`) — dde7409
- [x] 2.2 `npm run build` passes and the built Worker bundle does not contain `unpdf` — dde7409
- [x] 2.3 `npm run ingest -- --pomoc` prints the Polish usage text and exits 0 — dde7409
- [x] 2.4 `npm run ingest -- --dry-run nieistniejacy.pdf` reports the missing file in Polish and exits 1 — dde7409

#### Manual

- [x] 2.5 `npm run ingest -- --dry-run <real ~200 MB ERP PDF>` completes, prints page count, fragment count and the first fragments with page labels, with memory staying reasonable on a staff-class laptop — dde7409
- [x] 2.6 Fragment boundaries read sensibly on the real document (no fragment cut mid-word, page labels match the PDF) — dde7409
- [x] 2.7 A PDF with no text layer produces the "możliwe, że to skan" message, not an empty success — dde7409

### Phase 3: Embeddings, sign-in and publish

#### Automated

- [x] 3.1 `npm run lint` passes — e93b278
- [x] 3.2 `npm run build` passes — e93b278
- [x] 3.3 With `.env.ingest` missing a variable, `npm run ingest -- plik.pdf` names the missing variable in Polish and exits 1 without prompting for a password — e93b278

#### Manual

- [x] 3.4 Against local Supabase (`db reset`) signed in as `serwis@xemi.local`: ingesting a real ERP PDF creates one `erp_documents` row and N `erp_doc` entries with non-null embeddings; `--lista` shows it — e93b278
- [x] 3.5 Re-running the same command prints "bez zmian, pominięto" and changes no row (`updated_at` unchanged) — e93b278
- [x] 3.6 Re-running with `--wymus` (or on an edited copy with the same name) replaces the entries: same single registry row, entry ids all new, total `erp_doc` count equals the new fragment count — e93b278
- [x] 3.7 Signing in as `alfa@klient-alfa.local` stops with "To konto nie jest kontem serwisanta" before any file is read — e93b278
- [x] 3.8 A wrong password, a wrong OpenAI key and a stopped Supabase each produce a single readable Polish message — e93b278
- [x] 3.9 Killing the script mid-upload leaves `knowledge_base_entries` unchanged; the next successful run publishes cleanly — e93b278
- [x] 3.10 `--usun <nazwa>` removes the document and its entries; the client view (as alfa) no longer returns them — e93b278

### Phase 4: Staff runbook and production rollout

#### Automated

- [x] 4.1 `npm run lint` passes — 04e9c6c
- [x] 4.2 `git check-ignore .env.ingest` reports it ignored and `git check-ignore .env.ingest.example` reports it not ignored — 04e9c6c
- [x] 4.3 CI (`ci` and `smoke` jobs) is green on the PR — 541a4ff

#### Manual

- [x] 4.4 A service-staff member (not the developer) completes the setup and one ingestion using only the runbook, and reports where they got stuck — 04e9c6c
- [x] 4.5 `npx supabase db push --dry-run` against the hosted project lists only `20260924120000_erp_document_ingestion.sql`, and `db push` applies it before the PR is merged — 04e9c6c
- [x] 4.6 After the first production run, `--lista` shows all current ERP PDFs and a client account sees `erp_doc` entries through `knowledge_base_public` — 541a4ff
