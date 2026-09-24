<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: ERP Documentation Ingestion Pipeline

- **Plan**: context/changes/erp-doc-ingestion-pipeline/plan.md
- **Scope**: Phase 3 of 4
- **Reviewed phases**: 3
- **Date**: 2026-09-24
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated checks rerun during this review: `npm run lint` passed (0 errors, 7 warnings, none of them in `scripts/`). `npm run build` passed. For criterion 3.3, running `OPENAI_API_KEY="" npm run ingest -- plik.pdf` printed "Brak ustawienia OPENAI_API_KEY… .env.ingest", exited 1 and did not ask for a password. `rls.sql` passed against the local database.

## Findings

### F1 — Phase-1 review fixes are not committed; phase-3 manual checks ran on that uncommitted schema

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql, supabase/tests/rls.sql (working tree)
- **Detail**: The phase-1 review decisions F1–F7 were applied at 10:15 but left out of the phase-3 commit (13:57). They are still uncommitted:
  - column-scoped grants on `knowledge_base_entries` (a security fix)
  - the file-path and seq checks
  - the race guards in publish
  - `owner to postgres`
  - `#variable_conflict`
  - the matching `rls.sql` checks

  The local database runs this uncommitted version (`pg_proc` shows `variable_conflict`), so manual checks 3.4–3.10 were verified against a schema that is not in any commit. Pushing HEAD now would ship the migration without the security fix. The migration has not been applied to the hosted database yet (`migration list --linked`), so an in-place edit is still allowed.
- **Fix**: Commit the migration and `rls.sql` changes, together with the review reports, as a separate `fix(erp-doc-ingestion-pipeline): phase-1 review fixes` commit before phase 4.
- **Decision**: FIXED in commit d1c9ef8 (migration, rls.sql, reviews for phases 1–2, follow-ups/review-fixes.md), made on master like the earlier phase commits.

### F2 — Publishing a large document can hit authenticated's 8 s statement_timeout

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest/upload.mjs:185-188; supabase/migrations/20260924120000_erp_document_ingestion.sql (publish_erp_document)
- **Detail**: `rpc('publish_erp_document')` does all of this in one PostgREST statement run as `authenticated`: it deletes the old document (which cascades to its entries), inserts N entries, and maintains the HNSW index. Locally, `pg_roles` shows `authenticated` has `statement_timeout=8s`, and SECURITY DEFINER does not lift it. A document of several hundred fragments, published into a table that already holds the other ~19 documents, could fail with 57014. That shows up as a generic English `DB_FAILED`, fails the same way on every rerun, and leaves staging rows behind. Check 3.4 loaded only one PDF into an empty local table.
- **Fix A ⭐ Recommended**: Measure first, then map the error. Time a publish of the largest real PDF on local Supabase after loading a few documents, and map 57014 to a Polish message ("publikacja trwała za długo — skontaktuj się z administratorem").
  - Strength: settles the risk with evidence before any schema change, and the cost is one timed run.
  - Tradeoff: if it is close to the limit, a follow-up migration is still needed.
  - Confidence: MED — HNSW insert cost for a few hundred rows is usually well under 8 s, but it has not been measured here.
  - Blind spot: hosted compute tier may be slower than local Docker.
- **Fix B**: In a new migration (or in this one, since it is not yet pushed), let the function raise its own limit: `alter function publish_erp_document(...) set statement_timeout = '120s'`.
  - Strength: removes the failure mode outright, with one line.
  - Tradeoff: a function-level `SET` applies only to statements the function runs itself, not the outer statement already counting against the role timeout. It needs a test to confirm it helps. The other option is a dedicated role.
  - Confidence: LOW — the PostgREST/role timeout interaction is not verified.
  - Blind spot: whether Supabase's `supautils` allows it.
- **Decision**: FIXED via Fix A. Measured on local Supabase as staff (`authenticated`, `statement_timeout=8s`), rolled back: 7 consecutive publishes of 400 fragments each took 0.43–1.35 s while the table grew to 2,800 entries, well under 8 s. `messages.mjs` now maps 57014 to `DB_TIMEOUT` with a Polish message (not fatal). The migration is unchanged. Still unmeasured: the hosted compute tier.

### F3 — BOM or UTF-16 `.env.ingest` reports a present variable as missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest/upload.mjs:31-39
- **Detail**: `process.loadEnvFile` does not strip a UTF-8 BOM (verified: the first key becomes `﻿SUPABASE_URL`), and it cannot read UTF-16 at all. A non-developer on Windows who creates the file with PowerShell 5.1 `>`/`Out-File`, or with Notepad set to "UTF-8 with BOM", gets "Brak ustawienia SUPABASE_URL" even though the line is in the file.
- **Fix**: Read the file yourself. Strip a leading BOM, detect `FF FE`/`FE FF` and show a Polish "zapisz plik jako UTF-8" message, then parse with `util.parseEnv` without overriding variables already set.
- **Decision**: FIXED. `upload.mjs` has a new `loadEnvFile()` (readFileSync, UTF-16 BOM → `CONFIG_ENCODING`, UTF-8 BOM stripped, `parseEnv`, `??=` so existing variables win), and `messages.mjs` has the `CONFIG_ENCODING` message. The BOM stripping, UTF-16 detection and no-override behaviour were checked with node; lint passes and 3.3 passes. It was not run end to end with a real BOM file, because that test would have swapped out `.env.ingest`.

### F4 — `http://` SUPABASE_URL is accepted for any host, so the password can travel in cleartext

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest/upload.mjs:49-50
- **Detail**: The URL check accepts `http:` for any hostname. A mistyped `http://<ref>.supabase.co` sends the staff member's email and password without encryption.
- **Fix**: Allow `http:` only for `localhost`, `127.0.0.1` and `::1`, and otherwise require `https:` with a Polish message.
- **Decision**: FIXED. `http:` is now accepted only for localhost, 127.0.0.1 and [::1], and every other `http:` URL gives `CONFIG_BAD_URL`. Verified with 6 URLs (3 local http OK, https OK, remote http and ftp rejected); lint passes.

### F5 — No request timeouts; a stalled connection is silent for up to ~25 min

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest/embeddings.mjs:58-80; scripts/ingest/upload.mjs:107-109
- **Detail**: No `signal` is passed to any request, so undici's default 300 s timeouts apply. With 5 retries, one stuck OpenAI batch can go about 25 min without a progress line, and each Supabase RPC can sit silent for 5 min. Also, `response.json()` on an OK response is read outside the retry path, so a connection dropped mid-body becomes a non-retried `OPENAI_BAD_RESPONSE`.
- **Fix**: Add `signal: AbortSignal.timeout(60_000)` per OpenAI attempt and treat Timeout/AbortError as a retryable network error. Move `response.json()` inside the retried block. Give `createClient` a `global.fetch` wrapper with the same timeout.
- **Decision**: FIXED.
  - `embeddings.mjs`: a 60 s timeout per attempt, the body read with `text()` inside the retried try, then `JSON.parse`. A final timeout is reported as `OPENAI_NETWORK (ETIMEDOUT)`.
  - `upload.mjs`: `fetchWithTimeout` (60 s, combined with any existing signal) as `global.fetch` for supabase-js.
  - `eslint.config.js`: `AbortSignal` added to the globals for `scripts/`.
  - Verified with a local stalling server: a stall mid-body gives TimeoutError (retried), and a stalled RPC gives status 0 (`DB_NETWORK`). A real request through the wrapper works, and lint passes.

### F6 — Plan text not updated for the deliberate phase-3 drifts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/erp-doc-ingestion-pipeline/plan.md:353-357, 367-369
- **Detail**: The implementation departs from the plan in three justified ways: embedding batches are capped at about 8k estimated tokens as well as 64 inputs (the 40k TPM tier limit), `OPENAI_API_KEY` is required only for loads and not for `--lista`/`--usun`, and `.env.ingest` is resolved against the repo root. Only the commit message records them. The phase-2 review set a precedent of adding plan addenda for drifts like these.
- **Fix**: Add a short "*Addendum (impl review, phase 3)*" under Phase 3 §1–2 listing the three drifts.
- **Decision**: FIXED. `plan.md` Phase 3 §1 and §2 now have addenda covering the three drifts and the fixes for F2–F5.

### F7 — Raw English server messages and user-facing strings outside messages.mjs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/ingest/embeddings.mjs:79,92,106,111,115,118; scripts/ingest/messages.mjs (DB_FAILED fallback)
- **Detail**: Polish detail strings are hardcoded in `embeddings.mjs`, although the script header says all user-facing text lives in `messages.mjs`. The `DB_FAILED`/`OPENAI_FAILED` fallbacks also pass English server text straight to staff, including the migration's own P0001 texts ("incomplete upload …", "upload … changed while publishing; run it again"). The plan allows a generic fallback, but the known P0001 cases are predictable.
- **Fix**: Move the detail templates into `MSG`, and map the known P0001 messages (incomplete upload, changed while publishing) to Polish.
- **Decision**: FIXED.
  - The five OPENAI_BAD_RESPONSE details are now in `MSG` (`badJson`, `vectorCount`, `vectorOrder`, `vectorDimensions`, `vectorValues`).
  - P0001 "incomplete upload …", "changed while publishing" and "mixes fragments" now map to `DB_UPLOAD_INTERRUPTED`, a Polish "uruchom ponownie" message that is not fatal. Other P0001 texts still go to DB_FAILED.
  - Checked with node on 4 cases; lint passes.

### F8 — File names are not Unicode-normalized (NFC vs NFD Polish letters)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest-erp-docs.mjs:162, 273; scripts/ingest/upload.mjs:149
- **Detail**: `lower()`/`toLowerCase()` do not normalize. "Księgowość.pdf" copied from a ZIP or macOS in NFD form would become a second document, and `--usun` typed in NFC would miss it.
- **Fix**: Apply `.normalize("NFC")` to the base name before lookup, stage and remove.
- **Decision**: FIXED.
  - `ingest-erp-docs.mjs` has a new helper, `documentName()` (basename + NFC), used for duplicate detection, dry-run, load (which feeds stage) and `--usun`.
  - `findDocument` normalizes both sides of the comparison.
  - Checked: an NFD and an NFC "Księgowość.pdf" differ without normalization and match with it. Lint passes and `--pomoc` still runs.

### F9 — `--usun --lista` reports "opcja --usun nie przyjmuje wartości"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest-erp-docs.mjs:120-121
- **Detail**: `parseArgs` reports this case as "argument is ambiguous" (ERR_PARSE_ARGS_INVALID_OPTION_VALUE), and the mapping sends it to the "does not take a value" message, which is false.
- **Fix**: Route "ambiguous" to the missing-value message.
- **Decision**: FIXED. "ambiguous" now goes to `missingOptionValue`. Checked all three cases: `--usun --lista` says it needs a value, `--lista=x` says it takes none, and `--usun` alone says it needs a value. Lint and prettier pass.

### F10 — Minor credential hygiene: sign-out gap, Backspace redraw, secret key not refused

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest/upload.mjs:54, 72-77, 115-116
- **Detail**: Three small gaps:
  - If the profile read fails after a successful sign-in, the error is thrown without `signOut`.
  - Backspace in the password prompt makes readline redraw the line directly, which erases the prompt text and puts the cursor where the password's length can be seen. `_writeToOutput` is a private API.
  - Nothing refuses a `service_role`/`sb_secret_` key in `SUPABASE_KEY`. It is not exploitable through the script, but it would leave a master key on a laptop.
- **Fix**: Call `signOut` before rethrowing the profile error, and refuse `sb_secret_`/service_role JWT keys with a Polish message. The prompt redraw can stay as is.
- **Decision**: FIXED (points 1 and 3; point 2 accepted as is).
  - `signIn` now signs out before rethrowing a profile-read error.
  - `loadConfig` refuses `sb_secret_…` keys and JWTs whose role is `service_role`, with `CONFIG_SECRET_KEY`.
  - Checked with 4 keys: the local anon key and `sb_publishable_` are OK; the local service_role key and `sb_secret_` are refused.
  - Lint, prettier and criteria 2.3, 2.4 and 3.3 pass.

## Triage summary

- **Fixed**: F1 (commit d1c9ef8), F2 (Fix A: measured + 57014 message), F3, F4, F5, F6, F7, F8, F9, F10 (points 1 and 3)
- **Skipped / accepted**: F10 point 2 (Backspace redraw in the password prompt) accepted as is
- **Post-triage checks**: `npm run lint`, prettier, `npm run build`, and criteria 2.3, 2.4 and 3.3 pass. The phase-3 fixes (`scripts/`, `eslint.config.js`, `plan.md` addenda) are not committed yet.
- **Not re-run after the fixes**: the manual online checks 3.4–3.10 (sign-in, load, re-run, `--wymus`, kill mid-upload, `--usun`). The changed paths (env loader, URL check, fetch wrapper, error mapping, name normalization) are on that route.
