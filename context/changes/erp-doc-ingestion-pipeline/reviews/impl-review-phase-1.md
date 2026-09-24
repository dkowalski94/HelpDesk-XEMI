<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: ERP Documentation Ingestion Pipeline

- **Plan**: context/changes/erp-doc-ingestion-pipeline/plan.md
- **Scope**: Phase 1 of 4
- **Reviewed phases**: 1
- **Date**: 2026-09-24
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated criteria re-run on 2026-09-24: `npx supabase db reset` exit 0; `rls.sql` exit 0 ("All RLS negative checks passed"); `npm run lint` 0 errors (7 pre-existing `no-console` warnings); `npm run build` exit 0 when built to a scratch `--outDir` (the default `dist/` was locked by a running `astro preview` on :4321, EPERM on `dist/client`); `npm run smoke` all steps passed against that running preview. No application code changed in Phase 1.

## Findings

### F1 — Staff can still write `erp_document_id` / `source` directly, bypassing the function path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:123-144 (with the table-level INSERT/UPDATE grants from 20260922120100_tickets_and_knowledge_base.sql and 20260924090000_revoke_unused_write_grants.sql:29)
- **Detail**: `authenticated` keeps table-level INSERT and UPDATE on `knowledge_base_entries`. A table-level grant covers columns added later, so it now also covers the new `erp_document_id` (confirmed through `information_schema.column_privileges`). Verified live as staff `a1`: `update knowledge_base_entries set source='erp_doc', erp_document_id='…d101' where id='…f101'` succeeds (then rolled back). The next `publish_erp_document`/`remove_erp_document` for `Dokumentacja-demo.pdf` would delete that ticket-derived entry through `ON DELETE CASCADE`. Staff could also insert `erp_doc` rows or move fragments between documents directly, so `erp_documents.chunk_count` would stop matching. This breaks the plan's claim that the three functions are "the only way to write them". It also goes against lessons.md "assert the denied write on every RLS surface": `rls.sql` has no denied-write test for the new column. Mitigating factor: only service staff can do this, and staff can already overwrite any entry's text.
- **Fix**: In this migration, revoke table-level INSERT/UPDATE on `knowledge_base_entries` from `authenticated` and grant back column-scoped privileges. INSERT would cover the existing columns minus `erp_document_id`. UPDATE would also leave out `source`, so a staff-inserted `erp_doc` row fails the check. Update the `rls.sql` grant inventory and add staff `expect_denied` cases for updating `erp_document_id`, updating `source`, and inserting an `erp_doc` row directly.
  - Strength: Closes the hole with privileges, which is the mechanism the project already uses (migration 3). The new check then works as a guard instead of only a consistency rule.
  - Tradeoff: The grant inventory in `rls.sql` gets column-level rows. S-02 (staff recording resolutions) must work within the column list.
  - Confidence: HIGH — confirmed against the reset local database.
  - Blind spot: Not verified that the migration hasn't already been pushed to the hosted project. If it has, the fix must go in a new migration, because an applied migration is immutable.
- **Decision**: FIXED. `supabase migration list --linked` showed 20260924120000 as not applied remotely, so the migration was edited in place. Section 7 now uses column-scoped INSERT/UPDATE grants without `erp_document_id` (and without `source` for UPDATE). `rls.sql` has an updated inventory and 4 new staff checks (3 × 42501, 1 × 23514). db reset and rls.sql pass.

### F2 — Non-staff `publish_erp_document` denial tests pass even if the staff check is removed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls.sql:420, :488
- **Detail**: For alfa and unassigned, `publish_erp_document(gen_random_uuid(), 1)` is asserted through `expect_denied`, which accepts both 42501 and P0001. Without the `is_service_staff()` guard, a random upload id still raises the "incomplete upload" P0001, so the test passes without testing the guard. The plan asks for these to be denied with 42501. The stage and remove variants are not affected, and neither are the anon variants.
- **Fix**: Assert all six non-staff function calls (alfa + unassigned × 3) with `expect_sqlstate(…, '42501')`.
- **Decision**: FIXED. The six calls in rls.sql (alfa and unassigned) now use `expect_sqlstate(…, '42501')`. rls.sql passes, and each call is rejected with the staff-check message.

### F3 — Some failures reach the script as raw constraint errors, not 42501/P0001

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:250-262, 329-334
- **Detail**: Some failures come back with raw error codes instead of 42501/P0001:
  - A negative `seq` fails with 23514, a non-integer `seq` with 22P02, and a duplicate `seq` with 23505.
  - Two staff publishing the same file name at the same moment get a raw 23505 on `erp_documents_file_name_key`. When an old row exists, the READ COMMITTED DELETE skips the row the other transaction already deleted, and the INSERT then collides with its newly committed row.
  No data is at risk: the call rolls back and staging stays in place. The plan says validation errors should be P0001, and Phase 3's error mapping only covers 42501 plus a generic fallback.
- **Fix**: Take `pg_advisory_xact_lock(hashtext(lower(v_file_name)))` before the DELETE in publish, and check `seq >= 0` explicitly in stage. Or accept it, since Phase 3's generic fallback prints the server message.
- **Decision**: FIXED.
  - Stage now rejects a `seq` that is not a non-negative int4 with P0001. Duplicate `seq` values are still left to the primary key (23505), as the stage comment documents.
  - Publish takes a per-file advisory lock before the DELETE.
  - `rls.sql` has two new P0001 checks, for a negative `seq` and for `seq` 1.5; both pass.
  - The concurrent-publish path cannot be tested in a single session and has not been tested.

### F4 — Publish relies on stage's consistency checks, which are not concurrency-safe

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:303-340
- **Detail**: Publish has three consistency gaps:
  - It takes `min(file_name)`/`min(content_hash)` without checking that there is only one distinct value. Stage's "mixed upload" check has no lock, so two concurrent stage calls for a new `upload_id` can both pass it.
  - `FOR UPDATE` locks existing rows only. A stage call that commits between the count and the entries INSERT is published, but `chunk_count` stores `v_total` rather than `v_inserted`.
  - Only the upload's owner can trigger either case, and the script is sequential, so the risk is low.
- **Fix**: Add `count(distinct file_name) = 1 and count(distinct content_hash) = 1` to the completeness check, and `raise` if `v_inserted <> v_total`.
- **Decision**: FIXED. Publish now raises P0001 when an upload mixes files or hashes, and when the number of inserted entries differs from the counted total. rls.sql still passes. No new test was added, because neither race can be reproduced in a single session.

### F5 — Abandoned staging rows are only cleaned by the same user's next publish

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:346-348
- **Detail**: When a run crashes, its staging rows (several MB of vectors per upload) stay until the same staff member publishes again. If that person never publishes again, the rows stay until their profile is deleted.
- **Fix**: Remove the `uploaded_by = auth.uid()` condition from the stale-row cleanup. The 24-hour threshold already separates dead uploads from ones still in progress.
- **Decision**: FIXED. Any publish now clears every staging row older than 24 hours, and rls.sql passes. This is a deliberate deviation from plan.md:124-125 and plan.md:192, which say the caller's own rows. The plan text has not been updated.

### F6 — File base name is not enforced in the database

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:195-197
- **Detail**: The plan defines file identity as `lower(file_name)` of the base name, "never the full path". Stage rejects only null or blank names, so `C:\Dokumentacja\Magazyn.pdf` and `Magazyn.pdf` would become two separate documents. As written, the plan leaves this to the Phase 2/3 script.
- **Fix**: In stage, reject `p_file_name ~ '[/\\]'` with P0001, or record in Phase 3 that the script must pass `path.basename`.
- **Decision**: FIXED. Stage now rejects a file name containing `/` or `\` with P0001. rls.sql has two new checks, one for a Windows path and one for a forward-slash path, and both pass.

### F7 — Function hygiene: ownership not pinned, OUT columns shadow table columns

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:171-376 (and :276)
- **Detail**: Access to staging (RLS on, no policies) depends on the definer functions being owned by the table owner. That holds today but is implicit. Migration 2 pinned its definer view with `alter view … owner to postgres` for this reason; migration 1's functions do not pin ownership. Separately, `publish_erp_document`'s OUT parameter `chunk_count` shadows `erp_documents.chunk_count`, so a future unqualified reference in WHERE or SET would raise 42702.
- **Fix**: Optional: `alter function … owner to postgres` for the three functions, and qualify column references (or add `#variable_conflict use_column`) in publish.
- **Decision**: FIXED. The three functions are now owned by `postgres` (confirmed in `pg_proc`), and publish has `#variable_conflict use_column`. db reset, rls.sql, smoke and lint pass.

## Triage summary

- Fixed: F1–F7 (7). Skipped: none. No lessons recorded.
- All edits went into the migration in place: `supabase migration list --linked` shows 20260924120000 not yet applied to the hosted project. This is only allowed while it stays unpushed.
- Deliberate deviation from the plan: F5 (the stale-staging cleanup is global, not caller-scoped). plan.md:124-125 and :192 still describe the old behaviour.
