<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: ERP Documentation Ingestion Pipeline

- **Plan**: context/changes/erp-doc-ingestion-pipeline/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

Phases 1–3 were already reviewed one at a time (`impl-review-phase-{1,2,3}.md`). This review checked that those fixes are still in the code (they are), then focused on Phase 4, on consistency across phases and on the hosted rollout.

Automated checks run on 2026-09-25:
- `npm run lint`: exit 0. The 7 warnings are all in `src/lib/services/*`, which this change does not touch.
- `npm run build`: exit 0, and `dist/` does not contain `unpdf`.
- `supabase/tests/rls.sql` against the current local database (no fresh `db reset`): exit 0, "All RLS negative checks passed".
- `git check-ignore`: `.env.ingest` is ignored and `.env.ingest.example` is not.
- `npm run ingest -- --pomoc`: exit 0, Polish usage text.
- `--dry-run nieistniejacy.pdf`: exit 1, Polish message.
- With `OPENAI_API_KEY` empty, the script names the missing variable in Polish and exits 1 without asking for a password.
- 4.3 (CI green on the PR) could not be re-checked from here.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Hosted profile backfill was done by hand; no migration reproduces it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:123-157 (no backfill migration anywhere)
- **Detail**:
  - At step 4.6, a hosted account created before migration 20260922120000 had no `profiles` row, so `is_service_staff()` was false. This is recorded in lessons.md:26-31 and commit c809f1a.
  - The fix was applied to production by hand. `supabase/migrations/` has no `insert … select from auth.users`, so:
    - every other pre-migration hosted account still has no tenancy;
    - the migrations no longer reproduce the production state.
  - The defect comes from the tenant change, but this change is where it surfaced, and the new lesson's rule is still unapplied.
- **Fix A ⭐ Recommended**: New migration `…_backfill_missing_profiles.sql`. It inserts a `client_user` profile in the unassigned company for every `auth.users` row without one (`on conflict do nothing`). Verify it locally with an `auth.users` row inserted before the migration, then `db push`.
  - Strength: Applies the lesson this change just recorded. It fixes every remaining hosted account and keeps the migrations as the source of truth.
  - Tradeoff: A new migration has to be applied to hosted before the next merge. It also needs a pre-migration test, which the seed cannot provide.
  - Confidence: HIGH. The shape follows directly from the trigger in migration 1.
  - Blind spot: Not verified how many hosted accounts still lack a profile; it may already be zero.
- **Fix B**: Record the manual hosted fix, including the exact SQL, in the change folder, and check by hand that no other hosted account lacks a profile.
  - Strength: No new migration or deploy gate.
  - Tradeoff: Production stays out of sync with the migrations, and the next pre-existing account hits the same wall.
  - Confidence: MED. This only holds if nobody else signed up before migration 1.
  - Blind spot: The hosted `auth.users` contents have not been checked.
- **Decision**: ACCEPTED — per the user, no hosted account predating migration 20260922120000 remains, so a backfill migration would have nothing to do. The lesson in lessons.md still covers future trigger-maintained tables.

### F2 — plan.md still describes behaviour the phase-1 and phase-2 review fixes changed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/erp-doc-ingestion-pipeline/plan.md:125-128, 195, 198-200, 220-221, 276-279
- **Detail**:
  - The plan says publish cleans up "the caller's" staging rows older than 24 h. The code (migration :388-392) deletes everyone's rows older than 24 h. This is phase-1 F5, which is explicitly marked as "plan text not updated".
  - The Privileges and grant-inventory contracts do not mention the column-scoped INSERT/UPDATE regrant on `knowledge_base_entries` (migration :456-467, phase-1 F1).
  - Phase 2 §1 still shows `--env-file-if-exists=.env.ingest`, but `package.json:14` does not use it.
  - The rest of the phase-1 hardening (F3/F4/F6/F7) has no pointer in the plan. Phases 2 and 3 got addenda; Phase 1 did not.
- **Fix**: Add a Phase 1 addendum covering the global 24 h cleanup, the column-scoped grants and a one-line pointer to impl-review-phase-1 F3–F7, and correct the Phase 2 §1 script line.
- **Decision**: FIXED — plan.md now has a Phase 1 §1 addendum (global 24 h cleanup, column-scoped grants, pointer to phase-1 F3–F7), and the Phase 2 §1 script line matches package.json.

### F3 — Manual criterion 4.4 ticked without the staff member's feedback

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/erp-doc-ingestion-pipeline/plan.md:602
- **Detail**:
  - 4.4 requires a service-staff member (not the developer) to finish setup and one ingestion using only the runbook, and to "report where they got stuck".
  - It was ticked in 04e9c6c, the same commit that first added the runbook.
  - No report exists in the change folder, the plan or lessons.
  - This may be a false tick, or the result may simply not have been written down.
- **Fix**: Add the staff member's run notes (who, date, where they got stuck, what changed in the runbook) to the change folder. If the run never happened, untick 4.4.
- **Decision**: SKIPPED

### F4 — CLAUDE.md omits the column-scoped grant rule on `knowledge_base_entries`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: CLAUDE.md ("ERP documentation ingestion" section)
- **Detail**:
  - The section says `authenticated` has only SELECT on `erp_documents`.
  - It does not say that `authenticated`'s INSERT/UPDATE on `knowledge_base_entries` is now granted per column:
    - `erp_document_id` is left out of both;
    - `source` is also left out of UPDATE.
  - A future change, such as S-02 curation or a new column, that "just grants insert/update" would reopen the phase-1 F1 hole, which let staff attach entries to a document and have them cascade-deleted.
  - This is exactly the kind of non-obvious invariant that section exists to hold.
- **Fix**: Add one bullet: the INSERT/UPDATE grants on `knowledge_base_entries` are column-scoped (no `erp_document_id`, no `source` on UPDATE); a new column means extending that list, never a table-level grant; `rls.sql` pins the inventory.
- **Decision**: FIXED — CLAUDE.md "ERP documentation ingestion" has a new bullet on the column-scoped grants.

### F5 — Runbook contradicts the script on fatal errors and on Git Bash

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: docs/wgrywanie-dokumentacji-erp.md:268-270, :289; scripts/ingest/messages.mjs:114-122, :142-144
- **Detail**:
  - Fatal errors:
    - The runbook says every error about the key, the account or the connection stops the whole run with "Przerwano — pozostałe pliki…".
    - `FATAL_CODES` does not include `OPENAI_NETWORK`, so after 5 retries the script moves on to the next file.
    - Account and config errors happen before the loop, so they print only `BŁĄD:` and never "Przerwano".
  - Git Bash:
    - The runbook says not to use Git Bash.
    - The `NO_TERMINAL` message itself suggests `winpty npm.cmd run ingest` in Git Bash.
- **Fix**: Reword the runbook paragraph to say which errors stop the run (OpenAI key/quota, database connection/permissions/missing migration) and that the account is checked before any file is read. Then pick one Git Bash stance and use it in both places.
- **Decision**: FIXED — the runbook §3 paragraph now matches `FATAL_CODES` and the pre-loop account/config check, and `NO_TERMINAL` no longer suggests `winpty` in Git Bash (one stance: PowerShell / Wiersz polecenia / Windows Terminal).

### F6 — `src/database.types.ts` not regenerated for the new schema

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/database.types.ts:47-70
- **Detail**:
  - The file has no `erp_documents` table, no `knowledge_base_entries.erp_document_id` and none of the three RPCs.
  - The previous change regenerated it after each schema change (41d28de).
  - Nothing in `src/` reads the new objects yet. S-01 will be the first consumer.
- **Fix**: `npx supabase gen types typescript --local > src/database.types.ts` + Prettier, now or as the first step of S-01.
- **Decision**: FIXED — regenerated from local Supabase. Kept the file's existing `interface Database` / `Record<never, never>` style, so the diff is 115 added lines covering only the new objects. `astro check` reports 0 errors, and lint is unchanged (7 pre-existing warnings).

### F7 — follow-ups/review-fixes.md still lists a done item as queued

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/erp-doc-ingestion-pipeline/follow-ups/review-fixes.md
- **Detail**:
  - The phase-2 F3 item (drop `--env-file-if-exists`, use an own loader) is done.
  - It was done differently from the queued wording, through phase-3 F3's `loadEnvFile()` in `upload.mjs:89-101`.
  - The file still says "Review fixes — queued" and has no resolved marker.
- **Fix**: Mark the item "Done — superseded by impl-review-phase-3 F3 (`upload.mjs` loader)".
- **Decision**: FIXED — status line added to follow-ups/review-fixes.md.

### F8 — NFC file identity is enforced only by the script

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:79-80, 196-204; scripts/ingest/upload.mjs:196-198
- **Detail**:
  - CLAUDE.md says identity is the base name in NFC, case-insensitive.
  - The unique index, the publish DELETE and `remove_erp_document` compare only with `lower(file_name)`.
  - If a writer ever stored an NFD name, the script would report "Zastąpiono" while publish left the old document in place. The result would be two documents with both sets of fragments.
  - This cannot happen today, because the script is the only writer and always sends NFC.
- **Fix**: Accept as risk. Alternatively, in a later migration, have stage raise P0001 when `p_file_name is distinct from normalize(p_file_name, NFC)`.
- **Decision**: ACCEPTED — the script is the only writer and always sends NFC.

### F9 — Staff can still edit the content of `erp_doc` entries directly

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:456-467; 20260922120100_tickets_and_knowledge_base.sql:296-301
- **Detail**:
  - The staff UPDATE policy covers all rows.
  - The re-granted columns include `error_text`, `steps` and `embedding`.
  - So a staff member can edit an `erp_doc` fragment outside the function path:
    - the edit survives hash-skip re-runs, and then disappears silently on `--wymus`;
    - the vector can stop matching the text.
  - There is no escalation, since this is staff only. The migration comment "exactly one write path" overstates what is enforced.
- **Fix**: Accept as risk; when S-02 defines staff curation, either narrow the UPDATE policy to `source = 'ticket'` or reword the comment.
- **Decision**: ACCEPTED — staff-only and no escalation; revisit when S-02 defines staff curation.

### F10 — Registry reads depend on the PostgREST 1000-row cap

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/ingest/upload.mjs:193-199, 246-251
- **Detail**:
  - `findDocument` reads the whole registry for each file, and `--lista` reads it without paging.
  - Above 1000 documents:
    - the unchanged-file skip would silently stop working, which costs OpenAI credits;
    - `--lista` would truncate.
  - The replace itself stays correct, because it happens on the server.
  - The expected corpus is ~20 documents, and a code comment states that assumption.
- **Fix**: Accept for now; if the corpus grows, filter server-side by name and page `--lista` with `.range()`.
- **Decision**: ACCEPTED — the corpus is ~20 documents; revisit if it grows toward the row cap.
