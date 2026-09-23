<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tenant Data & Auth Foundation

- **Plan**: context/changes/tenant-data-and-auth-foundation/plan.md
- **Scope**: Phase 2 of 5
- **Reviewed phases**: 2
- **Date**: 2026-09-23
- **Verdict**: REJECTED
- **Findings**: 1 critical, 6 warnings, 3 observations
- **Commit under review**: `a13931d` — `supabase/migrations/20260922120100_tickets_and_knowledge_base.sql` (293 lines)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**Plan Adherence**: all ten Contract bullets implemented with the planned intent; no MISSING items. One declared DRIFT (`create extension ... with schema extensions`) is better than the plan's text and is accepted.

**Scope Discipline**: the "What We're NOT Doing" boundaries hold completely — nothing under `src/`, `scripts/`, `.github/` or `supabase/seed.sql` was touched. Three additions are not literally in the plan (`set_updated_at` triggers on both tables, `revoke execute` on the new trigger function, `comment on` statements); each is an implication of the Contract or of Phase 1's established house style rather than new product surface. A stricter reading would score this WARNING.

**Success Criteria**: every automated criterion was re-run this session against a fresh `npx supabase db reset` and passed. Manual 2.6 and 2.7 confirmed by the user. 2.12 remains open by design — but see F1: it must not be signed off in its current state.

## Verification note

Findings F1–F7 were **not taken on trust from the scanning agent**. Each was independently reproduced against the live local database inside a transaction that was rolled back. The reproduction output is quoted in each finding.

## Triage outcome (2026-09-23)

| | Findings | Count |
|---|---|---|
| Fixed | F1, F2, F3, F4, F5 (differently), F6, F7, F8, F10 | 9 |
| Accepted | F9 — deferred to S-03, constraint recorded in roadmap.md | 1 |
| Skipped | — | 0 |

The `Safety & Quality` FAIL that drove the REJECTED verdict was F1, now fixed and verified: all
three write verbs through `knowledge_base_public` return 42501, while the client read path is
unchanged. Every other finding was re-probed after its fix against a fresh `npx supabase db
reset`, and the original Phase 2 criteria (2.1-2.11) plus `npm run lint` were re-run afterwards
with no regression.

F5 was fixed **differently** from the proposal: the user supplied an explicit two-branch CHECK
after spotting that the proposed biconditional still admitted an unresolved ticket carrying
exactly one of `resolution` / `resolved_at`. The delivered constraint was verified against a
matrix of 3 valid and 5 invalid combinations.

Changes made during triage are **uncommitted** at the time of writing. The migration
`20260922120100_tickets_and_knowledge_base.sql` was edited in place rather than superseded by a
follow-up migration, which is safe only because it has not been applied to the hosted project
(criterion 5.6 is unchecked). If it has been pushed, these edits must be re-cut as a new
migration instead.

**Criterion 2.12** — the dedicated security review of migrations 1 and 2 that gates Phase 4 — is
still open. This review covered migration 2 only and was not framed as that sign-off.

## Findings

### F1 — Any logged-in user can insert into, rewrite and wipe the entire knowledge base through the definer view

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:254-271, 291-292
- **Detail**:
  `public.knowledge_base_public` is a single-table view over plain column references with no aggregate, DISTINCT or GROUP BY, so Postgres makes it **auto-updatable**. Because it is intentionally not `security_invoker`, writes through it execute as the owner `postgres`, which owns the base table and is exempt from its RLS.

  Line 291 revokes from `public` and `anon` but **not from `authenticated`**, which holds Supabase's default `ALL`. Line 292's `grant select` therefore adds nothing it did not already have. Confirmed from the catalog:

  ```
      grantee    | privilege_type
  ---------------+----------------
   authenticated | DELETE
   authenticated | INSERT
   authenticated | SELECT
   authenticated | TRUNCATE
   authenticated | UPDATE

        table_name       | is_insertable_into | is_updatable
   knowledge_base_public | YES                | YES
  ```

  Three exploits reproduced on the live database:

  ```
  F1.2 CONFIRMED: client UPDATE through view wrote 2 row(s); base table now reads "HACKED-BY-CLIENT"
  F1.1 CONFIRMED: unassigned user INSERTed through view; 1 poisoned row(s) in base table
  F1.3 CONFIRMED: client DELETE through view removed 3 row(s); knowledge base now holds 0 row(s)
  ```

  The INSERT succeeded as an account still sitting in the sentinel company — one that reads zero rows from both the table and the view. There is no `WITH CHECK OPTION`, so the view's WHERE gate never applies to writes; it only ever runs on SELECT. `public` is in `config.toml`'s exposed schemas, so all three are reachable as ordinary PostgREST POST/PATCH/DELETE with a normal user's JWT.

  This also falsifies the file's own claim at line 217 that "the base table is staff-only in all three directions", and it is exactly why criteria 2.3, 2.8 and 2.11 did not catch it: all three test reads.
- **Fix**: Extend the revoke at line 291 to cover `authenticated`, then re-grant only SELECT.
  ```sql
  revoke all on public.knowledge_base_public from public, anon, authenticated;
  grant select on public.knowledge_base_public to authenticated;
  ```
  - Strength: Mirrors the file's own pattern one line above, and migration 1's section 8 precedent. Closes all three write verbs at once; no behaviour change for reads.
  - Tradeoff: None material — the view is read-only by design and nothing writes through it today.
  - Confidence: HIGH — reproduced before and the fix is the same shape the repo already uses.
  - Blind spot: Does not make the view structurally non-updatable; a future `grant` could reopen it. `with (security_barrier = true)` would add that belt-and-braces (`security_invoker` must stay off).
- **Decision**: FIXED — revoke extended to `authenticated`, select re-granted. Verified: all three write verbs now return 42501; the client read path still returns its row.

### F2 — A client can file an already-"resolved" ticket carrying a fabricated answer attributed to real staff

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:198-206
- **Detail**:
  The INSERT policy pins `company_id`, `created_by` and company kind, but says nothing about `status`, `resolution`, `resolved_by`, `resolved_at` or `created_at`, and `authenticated` holds INSERT on all 11 columns. Reproduced as an ordinary client user:

  ```
  F2 CONFIRMED: status=resolved, resolved_by=00000000-0000-0000-0000-0000000000a1 (real staff),
                created_at=1999-01-01 00:00:00+00, resolution="XEMI mowi: przelej 10000 PLN"
  ```

  The comment at line 195 says `created_by` is pinned "so nobody can file on a colleague's behalf" — true, but `resolved_by` is pinned to nobody, so the client forges who answered. In a product whose deliverable is the staff resolution, and where resolutions are the feedstock for the knowledge base (F-02/S-01), this is an integrity break rather than cosmetics.
- **Fix**: Narrow the INSERT grant the way migration 1 narrowed UPDATE on `profiles` (lines 402-403).
  ```sql
  revoke insert on public.tickets from authenticated;
  grant insert (company_id, created_by, error_text, user_comment) on public.tickets to authenticated;
  ```
  - Strength: Column privileges are checked before RLS and before triggers, so this is structural rather than a property of a policy holding.
  - Tradeoff: S-01 must file tickets using exactly these columns; anything else fails loudly at insert time.
  - Confidence: HIGH — identical precedent in migration 1.
  - Blind spot: Interaction with S-03, which will need a client write path for `user_comment` (see F9).
- **Decision**: FIXED — column-scoped INSERT grant (company_id, created_by, error_text, user_comment). Verified: the forged resolved ticket is rejected, an ordinary client filing still works, and a client naming its own `id` is also rejected.

### F3 — Staff can rewrite the client's original error text and move a ticket to another tenant

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:210-215
- **Detail**:
  Migration 1 states the lesson explicitly at lines 393-403: "The update policy above authorizes rows, not columns." It is not carried forward here. Reproduced as the seeded staff account:

  ```
  F3 CONFIRMED: error_text now "REWRITTEN-BY-STAFF",
                company_id moved to 00000000-...-cb01 (was Alfa)
  ```

  A staff session can destroy the client's original evidence and relocate a ticket into a different client company — the kind trigger permits it, since the target is still `client`. That silently moves data across the tenant boundary the rest of the file defends. Note this is *conformant with the plan*, which asked for exactly "UPDATE for `is_service_staff()`"; the gap is in the plan as much as the implementation.
- **Fix**: Add the column-scoped grant, deliberately omitting `updated_at` per migration 1's precedent.
  ```sql
  revoke update on public.tickets from authenticated;
  grant update (status, resolution, resolved_by, resolved_at) on public.tickets to authenticated;
  ```
  - Strength: Makes the tenant boundary structural for tickets, matching how `profiles` is already protected.
  - Tradeoff: S-02's resolution-recording endpoint is constrained to these four columns.
  - Confidence: HIGH — same precedent, same shape.
  - Blind spot: `updated_at` is maintained by a BEFORE trigger writing NEW, which is not column-privilege checked — verified as the mechanism migration 1 relies on, not re-tested here.
- **Decision**: FIXED — column-scoped UPDATE grant (status, resolution, resolved_by, resolved_at); updated_at deliberately omitted. Verified: staff can no longer rewrite error_text or move a ticket across tenants, but can still record a resolution.

### F4 — Deleting a user account fails once that user has filed a ticket

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:46, 51
- **Detail**:
  `created_by uuid not null references public.profiles (id)` has no `on delete` clause, so `NO ACTION`. `profiles.id` is `on delete cascade` from `auth.users`, so migration 1 promises that deleting an account tears down its profile; this FK silently revokes that promise. Reproduced:

  ```
  F4 CONFIRMED: 23503 / update or delete on table "profiles" violates foreign key constraint
                "tickets_created_by_fkey" on table "tickets"
  ```

  Deleting a user from the dashboard, the Admin API or any GDPR erasure path now errors for every user who has ever filed a ticket — i.e. every real client user. `resolved_by` has the same shape. The author did reason about delete behaviour for `knowledge_base_entries` (lines 84-87 use `on delete set null` with a stated rationale), which makes the omission here look like an oversight rather than a decision.
- **Fix**: Decide the intent explicitly rather than inheriting `NO ACTION`. If tickets outlive their author: `on delete set null` on both columns plus dropping `not null` from `created_by`. If accounts are never hard-deleted: say so in a comment.
  - Strength: Either way the next person reads a decision instead of discovering it through a failed erasure request.
  - Tradeoff: Dropping `not null` on `created_by` weakens a real invariant; the alternative accepts that erasure needs an application-level path.
  - Confidence: MEDIUM — the right answer depends on a retention/erasure policy not stated in the PRD.
  - Blind spot: No GDPR/retention requirement is recorded anywhere in `context/foundation/`; this may be a question for the user rather than a code fix.
- **Decision**: FIXED — tickets outlive their author: `on delete set null` on created_by and resolved_by, `not null` dropped from created_by. Verified: erasing both the staff account that resolved a ticket and the client that filed it now succeeds, with the ticket surviving and attribution cleared.

### F5 — The resolved-ticket constraint is one-directional and ignores `resolved_at`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:58-61
- **Detail**:
  `status <> 'resolved' or (resolution is not null and resolved_by is not null)` constrains one direction and two of four facts. Both contradictory states are accepted — reproduced:

  ```
  F5: resolved with NULL resolved_at accepted = t ; todo carrying a resolution accepted = t
  ```

  The comment at lines 55-57 claims it "keeps the three facts consistent"; `resolved_at` is a fourth fact nobody checks and nothing auto-populates. A `todo` ticket carrying a stale resolution is the same failure the comment set out to prevent, mirrored.
- **Fix**: Make it biconditional across all four columns.
  ```sql
  constraint tickets_resolution_matches_status check (
    (status = 'resolved') = (resolution is not null and resolved_by is not null and resolved_at is not null)
  )
  ```
- **Decision**: FIXED DIFFERENTLY — user supplied an explicit two-branch CHECK instead of the proposed biconditional, which still admitted an unresolved ticket carrying exactly one of resolution/resolved_at. resolved_by is required NULL on the unresolved branch and left optional on the resolved branch so ON DELETE SET NULL does not fail the constraint. Verified against a 3-valid / 5-invalid combination matrix.

### F6 — Foreign keys without a leading-column index, contradicting the file's own stated rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:51, 86, 87
- **Detail**:
  Line 74 states the rule — "an unindexed foreign key would scan the table" — and applies it to `tickets.created_by`. Three FKs do not follow it. Confirmed by catalog query:

  ```
   tickets_resolved_by_fkey                      | tickets                | resolved_by       | f
   knowledge_base_entries_source_company_id_fkey | knowledge_base_entries | source_company_id | f
   knowledge_base_entries_source_ticket_id_fkey  | knowledge_base_entries | source_ticket_id  | f
  ```

  This bites hardest on `knowledge_base_entries`: both its FKs are `on delete set null`, so every ticket or company deletion scans the whole knowledge base — the table the product expects to grow largest.
- **Fix**: Add `knowledge_base_entries_source_ticket_id_idx` and `knowledge_base_entries_source_company_id_idx`. `resolved_by` carries no cascade action, so it is reasonable to skip with a note.
- **Decision**: FIXED — all three foreign keys indexed (tickets.resolved_by, knowledge_base_entries.source_ticket_id, source_company_id). Verified: every FK on both tables now reports has_index = t.

### F7 — `revoke all on public.tickets from anon` is missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:285
- **Detail**:
  Line 285 revokes `anon` on `knowledge_base_entries`; there is no equivalent for `tickets`. Confirmed:

  ```
   table_name             | anon_grants
   knowledge_base_entries |           0
   tickets                |           7
  ```

  RLS blocks `anon` today (no `anon` policies), so this is not currently exploitable. But the file's own justification at line 284 — "the grant is what a future policy would silently widen" — applies verbatim to `tickets`, which is the more sensitive table. Applying the reasoning to one of two new tables reads as deliberate to a later maintainer.
- **Fix**: `revoke all on public.tickets from anon;`
- **Decision**: FIXED — `revoke all on public.tickets from anon`. Verified: anon now holds 0 grants on tickets, knowledge_base_entries and knowledge_base_public.

### F8 — `create extension if not exists vector` may behave differently on the hosted project

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:26
- **Detail**:
  **Not verified — no access to the hosted project.** Locally `vector` lands in `extensions` and everything resolves. The conditional risk: if pgvector is already enabled into `public` on the hosted project, `if not exists` makes line 26 a silent no-op and `extensions.vector(1536)` at line 83 then fails with "type does not exist" — a mid-migration failure on `db push` that `supabase db reset` can never reproduce.
- **Fix**: Before the first `db push`, run `select extnamespace::regnamespace from pg_extension where extname = 'vector'` against the hosted project. This belongs with Phase 5's production migration runbook.
- **Decision**: FIXED — a DO block after the create extension raises a named diagnosis if pgvector is installed outside `extensions`, instead of failing later with a bare "type does not exist". Still unverified against the hosted project by nature.

### F9 — FR-011 escalation has no client write path (appears intentional)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:67-68
- **Detail**:
  A client updating `user_comment` on their own ticket yields `UPDATE 0` — there is no client UPDATE policy. The column comment says "No screen writes it yet" and the plan defers escalation to S-03, so this is deferred rather than broken. Flagged so the triage is a decision: S-03 will need a client UPDATE policy scoped to `user_comment` alone, and F2/F3's column grants should be designed so the two do not collide.
- **Fix**: Accept as deferred; note the S-03 dependency in the roadmap entry for `mark-suggestion-unhelpful`.
- **Decision**: ACCEPTED — deferred to S-03 as the plan intends. The constraint it inherits is recorded in the S-03 entry of context/foundation/roadmap.md.

### F10 — Documentation and pattern-consistency drift (consolidated)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:7-10, 32, 71-72, 254-271
- **Detail**:
  Four small items, batched:
  1. **Line 71-72** — the index comment claims `(company_id, status)` serves "the staff dashboard [filtering] by status". A staff queue listing all `todo` tickets across every company does not filter on `company_id`, and `status` is the trailing column, so the index will not help it. The comment credits the index with a query it cannot serve, which may stop someone adding the right partial index later.
  2. **Line 32** — `ticket_status` has no `comment on type` while `kb_source` does, and `company_kind` did in migration 1.
  3. **Lines 7-10** — the `Affected:` header omits the three new triggers and the privilege changes; migration 1's header covers both.
  4. **Supabase's linter** will flag `knowledge_base_public` as `security_definer_view`. It is deliberate and well-argued, but once F1 is fixed the entry should be explicitly acknowledged so a future maintainer does not "fix" it by adding `security_invoker = true` — which would silently return zero rows rather than error.
- **Fix**: Batch into the same edit as F1/F7 — correct the index comment, add the missing `comment on type`, extend the header, and note the linter exception in the change record.
- **Decision**: FIXED — index comment corrected (it cannot serve a status-only staff queue; S-02 will want its own partial index), comment on type added for ticket_status, Affected: header extended to cover the triggers and privilege changes, and the Supabase linter exception acknowledged on the view comment.

## Process observation (candidate for `/10x-lesson`)

Every Phase 2 success criterion tests a **read**: `select ... returns 0 rows`, `is not selectable by anon`, `returns the seeded rows`. Not one tests a denied **write** against the new surfaces. That is precisely the blind spot F1, F2 and F3 slipped through — and F1 is critical.

The plan does describe write-attempt tests, but schedules them for Phase 5 (`#### 5. Policy-level negative checks`), which is *after* the Phase 4 gate this migration is supposed to clear. The reusable rule: **for every RLS surface, assert the denied write, not just the denied read — and assert it in the phase that creates the surface.**
