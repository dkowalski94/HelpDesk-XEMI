<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tenant Data & Auth Foundation

- **Plan**: context/changes/tenant-data-and-auth-foundation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-09-24
- **Verdict**: NEEDS ATTENTION at review time — **all nine findings fixed during triage the same day**; see Triage outcome below.
- **Findings**: 0 critical, 6 warnings, 3 observations

> Saved as `impl-review-full.md` rather than `impl-review.md` because that file already holds the
> triaged Phase 1 review. Phases 1–4 each have their own report; this pass reviews Phase 5
> (`ae494e5`) in full, plus how the phases fit together. It does not repeat findings those reports
> already triaged. The web-search change (`5082f07`) and course tooling (`a1d4a02`) landed in the
> same window but are separate changes, so they are out of scope.

## Triage outcome (2026-09-24)

| | Findings | Count |
|---|---|---|
| Fixed | F1, F2 (Fix A), F3, F4, F5 (differently), F6, F7, F8, F9 | 9 |
| Accepted / Skipped / Rule | — | 0 |

Re-verified after all fixes: `rls.sql` exit 0 (with a negative control proving the grant inventory
fails on a stray `TRUNCATE`), `npm run smoke` 35/35 on repeated runs, `npm run lint` 0 errors,
`npx astro check` 0 errors, `npm run build` green. The revoke migration
`20260924090000_revoke_unused_write_grants.sql` was pushed to the hosted project the same day;
`supabase migration list --linked` shows local and remote identical.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence

Every planned change in Phase 5 is in place: the seed, `GET /api/tickets`, the smoke isolation
steps, `rls.sql`, the CI step and the `CLAUDE.md` runbook. No later commit (`88ba3cd`, `05fe52d`,
`c926fae`, `b1d4a00`, `ae494e5`) breaks an earlier phase's contract. All Phase 4 hard constraints
still hold: the request-scoped client, a write to `company_id` only, exactly-one-row success, and
first assignment only. The queued follow-up from `impl-review-phase-4` F2 was honoured:
`expect_denied` accepts any 42501/P0001 error, and the owner-side digest proves the role did not
change.

Automated criteria were re-run for this review against the local Supabase:

| Criterion | Result |
|---|---|
| `npm run lint` | PASS (0 errors, 7 `no-console` warnings) |
| `npx astro sync && npx astro check` | PASS (42 files, 0 errors) |
| `npm run build` | PASS |
| `supabase/tests/rls.sql` via `psql -v ON_ERROR_STOP=1` | PASS (exit 0, "All RLS negative checks passed", rolled back) |
| `npm run smoke` against `npm run preview` | PASS (30/30 steps) |
| `npx supabase db reset` (1.1, 2.1, 5.1) | Not re-run, to avoid wiping local dev data. The seeded fixtures that `rls.sql` prechecks are present. |

Live grant inventory (`information_schema.role_table_grants`, `anon` and `authenticated`):
`anon` holds nothing, and no `TRUNCATE`, `TRIGGER` or `REFERENCES` grant remains. `authenticated`
still holds:

- `companies`: `DELETE,INSERT,SELECT,UPDATE`
- `profiles`: `DELETE,INSERT,SELECT` (plus the column-scoped update)
- `tickets`: `DELETE,SELECT` (plus the column-scoped insert/update)
- `knowledge_base_entries`: `DELETE,INSERT,SELECT,UPDATE`
- `knowledge_base_public`: `SELECT`

## Findings

### F1 — `rls.sql` does not assert the denied write on every RLS surface

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls.sql
- **Detail**: This breaks the lessons.md rule "Assert the denied write on every RLS surface" and the third lesson's "verify via `role_table_grants`". Several write paths have no check in CI:
  - `TRUNCATE`: the security review's F1 revoke has no regression test.
  - The `anon` role is never assumed, so criterion 2.11 and the `revoke all … from anon` lines are unchecked.
  - Spoofed `created_by`: filing a ticket for your own company under a colleague's id, which is the `created_by = auth.uid()` clause at migration 2 :270.
  - Profiles INSERT and DELETE, and companies DELETE, as a client.
  - Staff filing into a *client* company. The only staff check (`:266-268`) targets the internal company and is denied by `enforce_ticket_company_kind`, not by the missing INSERT policy.

  The 2.12 security review tested several of these by hand. None of them is in CI, so a later migration that re-grants `TRUNCATE`, or a changed Supabase default, would pass.
- **Fix**: Add an owner-side block to `rls.sql` that asserts the exact `(table, grantee, privilege)` set from `information_schema.role_table_grants`. It fails on any extra grant, `TRUNCATE` included. Then add persona checks for: a spoofed `created_by`, staff filing into Klient Alfa, and client INSERT/DELETE on `profiles`/`companies`.
  - Strength: One inventory assertion covers `TRUNCATE`, `anon` and future default-privilege drift at once, which is exactly what lesson 3 prescribes.
  - Tradeoff: The expected grant set must be updated deliberately with every migration that changes grants. That is the point, but it adds friction.
  - Confidence: HIGH — the query already exists (it was run for this review), and `expect_denied` already handles the persona checks.
  - Blind spot: If F2 is fixed with a new migration, the expected set has to match the post-F2 state.
- **Decision**: FIXED — `rls.sql` gained an exact grant inventory (`role_table_grants` + column-only grants + function EXECUTE for PUBLIC/anon/authenticated), TRUNCATE denials on all four tables, spoofed/null `created_by`, client profile insert/delete and company delete, unassigned KB writes, staff filing into Klient Alfa and creating/deleting companies, and an `anon` persona. Re-run exits 0; a temporary `grant truncate on tickets` inside the transaction makes it fail with "grant inventory drifted" (exit 3). Uncommitted.

### F2 — `authenticated` keeps write grants that no policy uses

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:402-411; supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:358-382
- **Detail**: No policy uses the following grants:
  - `companies`: INSERT, UPDATE, DELETE
  - `profiles`: INSERT, DELETE
  - `tickets`: DELETE
  - `knowledge_base_entries`: DELETE

  RLS alone denies them today. Lesson 3 says to grant back only what a policy needs. The 2.12 triage left DELETE on purpose ("no DELETE policy, so it has no effect"). INSERT/UPDATE on `companies` and INSERT on `profiles` were tested as RLS-denied but were never discussed as grants. The risk is latent: a future permissive policy, such as a staff INSERT on `companies` for a company-management screen, would silently widen to every write the grant allows. Both migrations are already on the hosted project (5.6/5.7), so they are immutable.
- **Fix A ⭐ Recommended**: New migration: revoke `insert, update, delete` on `companies`, `insert, delete` on `profiles`, and `delete` on `tickets` and `knowledge_base_entries` from `authenticated`. Push it to the hosted project before merging.
  - Strength: The grant layer then matches the policies exactly, which fulfils lesson 3. The change is observably inert, because RLS already denies all of these.
  - Tradeoff: It is a migration-bearing PR, so it goes through the manual `db push` gate for a change with no visible effect.
  - Confidence: HIGH — the revokes are the same shape as migration 2 section 7.
  - Blind spot: Whether F-02 or S-02 plans to add staff writes on `companies`. If so, they would re-grant narrowly.
- **Fix B**: Accept as risk and record why. Every future policy on these tables is then reviewed together with its grant.
  - Strength: No migration and no hosted push.
  - Tradeoff: It contradicts an accepted project rule, and the safeguard depends on reviewer memory.
  - Confidence: MED — this holds only while someone remembers.
  - Blind spot: Future contributors who never read the 2.12 review.
- **Decision**: FIXED (Fix A) — new migration `supabase/migrations/20260924090000_revoke_unused_write_grants.sql`; `rls.sql` inventory narrowed and the 7 affected 0-row checks switched to `expect_denied`. Applied locally with `npx supabase migration up`; `rls.sql` exit 0 and `npm run smoke` all green. Pushed to the hosted project 2026-09-24 (verified via `supabase migration list --linked`). Uncommitted.

### F3 — The smoke escalation steps never reach `assign-company.ts`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:195-246
- **Detail**: Three client-side steps all get a 403 from the middleware's `STAFF_ROUTES` before the endpoint runs: assign, move self, and smuggle `role=service_staff`. So CI exercises one gate three times. The endpoint's own `service_staff` re-check (`assign-company.ts:8-10`) is never exercised. The case that matters is staff posting an extra `role=service_staff` while the target stays `client_user`. Only the Phase 4 review verified that, by hand. Staff also only takes the `invalid-company` path. No step proves that a successful assignment works, meaning `.eq("company_id", unassigned.id)` plus `.select("id")` returning one row, so a broken happy path passes CI. Each local run also leaves another `smoke-<ts>@example.com` account on the waiting list.
- **Fix**: Add a final step: staff assigns the throwaway account to Klient Alfa and includes `role=service_staff`. Expect `?status=assigned`. Then re-read: the account has left the waiting list, and after signing in as it, the dashboard says "Client user at Klient Alfa" and `/admin/users` redirects.
  - Strength: It covers the happy path and the real role-smuggling path in one step, and it drains the waiting list the run filled.
  - Tradeoff: Smoke now performs a successful write to the local DB. This is harmless in CI (the DB is throwaway) but mutates a dev's local data a little more.
  - Confidence: HIGH — the observables (waiting list, dashboard label, redirect) are already used by neighbouring steps.
  - Blind spot: None significant.
- **Decision**: FIXED — 5 closing steps in `scripts/smoke.mjs`: staff assigns the throwaway account to Klient Alfa with a smuggled `role=service_staff` (`?status=assigned`), then re-reads that it left the waiting list, sees only Alfa's tickets, its dashboard says "Client user at Klient Alfa", and `/admin/users` still redirects. Smoke 35/35 green; eslint + prettier clean. Uncommitted.

### F4 — The smoke redirect check uses a prefix match, so `"/"` accepts any redirect

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:254
- **Detail**: `actual.location.startsWith(expected.location)` with `expected.location: "/"` also matches `/auth/signin?error=…`. So "signin accepts correct password", the three persona sign-ins, "new account signs in again" and "signout clears session" report PASS even when sign-in fails. A later step usually fails, so CI does not go green, but the log blames the wrong step.
- **Fix**: Compare exactly when the expected location has no `?`, and keep the prefix match only for the `?error=` expectations.
- **Decision**: FIXED — `locationMatches()` in `scripts/smoke.mjs`: exact match for bare paths, prefix only when the expectation carries a query string. Smoke 35/35 green on two consecutive runs. Uncommitted.

### F5 — Criterion 5.10 is ticked, but nothing enforces it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md:643 / :806 (criterion 5.10)
- **Detail**: The criterion requires the smoke job to fail "when any assertion in it is removed". Deleting a `select pg_temp.expect_*` line from `rls.sql` still exits 0, because there is no assertion-count guard. What actually holds is weaker: any assertion that *fails* fails the job (`ON_ERROR_STOP` plus `raise`). So this is a possibly false tick.
- **Fix**: Reword 5.10 in the plan to what is enforced ("fails the build when any assertion fails"). If the original intent matters, add a counter to `rls.sql` that is compared to an expected total at the end.
- **Decision**: FIXED (differently) — Progress titles are immutable per `progress-format.md`, so the Progress entry is untouched; an inline note under criterion 5.10 in the Phase 5 block states the effective criterion (fails when any assertion fails; removal is not detected). Uncommitted.

### F6 — The plan text no longer matches the Phase 2/3 contracts; changes live only in review decisions

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md Phase 2 (:301-341), Phase 3 (:383-433), criterion 1.9 (:252)
- **Detail**: Phase 1 has an Addenda section. Phases 2 and 3 do not, although review fixes changed their contracts:
  - Phase 2: `tickets.created_by` is nullable with `on delete set null` (the plan says `not null`). The resolved CHECK requires `resolved_at`, and `resolved_by` is optional. There are column-scoped ticket grants, and `vector` lives in `extensions`.
  - Phase 3: `getSessionProfile` returns `SessionProfileResult`, not `SessionProfile | null`. There is `locals.profileLookupFailed`, `STAFF_ROUTES` includes `/api/admin`, and types are generated in `src/database.types.ts`.
  - Phase 1 addendum 6 omits F6/F7/F9/F10 (`sync_profile_email`, `set_updated_at`, `full_name` CHECK). Criterion 1.9 still says "all five" SECURITY DEFINER functions, but there are nine.
  - Phase 5 seed: the unassigned demo persona `oczekujacy@xemi.local` is not in the seed contract. It is justified, because manual step 1 and `rls.sql` rely on it.

  After archiving, the plan is what S-01/S-02 will read as the contract.
- **Fix**: Add short "Addenda" sections to Phases 2, 3 and 5 that point to the review findings which changed each contract, and correct "all five" in 1.9.
- **Decision**: FIXED — `plan.md`: Phase 1 addendum 7 (F6/F7/F9/F10 hardening; 1.9 now "all nine"), new Addenda sections under Phases 2, 3 and 5 pointing to the review findings that changed each contract. Progress titles untouched. Uncommitted.

### F7 — Review artifacts are uncommitted and a Studio snippet sits in the tree

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: reviews/impl-review-phase-4.md, follow-ups/review-fixes.md, supabase/snippets/Untitled query 921.sql
- **Detail**: The change is marked `implemented` (`109346e`), but the Phase 4 review and the follow-up queue are untracked. `supabase/snippets/` is a Supabase Studio auto-save: an ad-hoc INSERT of a ticket into the unassigned company. It holds no secrets, but it is not gitignored and could be committed by accident.
- **Fix**: Commit the two review artifacts, and add `snippets/` to `supabase/.gitignore` (or delete the file).
- **Decision**: FIXED — `snippets` added to `supabase/.gitignore` (verified: `supabase/snippets/` no longer shows as untracked). The two untracked review artifacts are left for the commit carrying this triage. Uncommitted.

### F8 — `GET /api/tickets` is unbounded and silently capped at 1000 rows

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/tickets.ts:18-21
- **Detail**: There is no `.limit()` or `.range()`. PostgREST `max_rows = 1000` (`supabase/config.toml:18`) truncates without telling the caller. Staff sees every company's tickets, so staff hits the cap first. This is harmless at today's volume.
- **Fix**: Add pagination when S-01/S-02 extend this route (the plan already says they will).
- **Decision**: FIXED — `GET /api/tickets?limit=&offset=` (default 50, clamped 1–100; non-numeric falls back to default), ordered `created_at desc, id desc`, fetches `limit + 1` to derive `nextOffset` (`null` on the last page); `TicketPage` in `src/types.ts`; smoke asserts `nextOffset === null` for staff. Probed as staff: `limit=1` → e102 next=1, `offset=1` → e101 next=null, garbage params → defaults. Lint/check/build/smoke green. Uncommitted.

### F9 — CI installs an unpinned Supabase CLI

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:37
- **Detail**: With `version: latest`, a CLI release that changes `supabase status -o env` keys or the default images can break the smoke job with no code change.
- **Fix**: Pin the CLI version to the one that currently passes locally.
- **Decision**: FIXED — `.github/workflows/ci.yml` pins `supabase/setup-cli` to `2.117.0` (the version `package-lock.json` resolves), with a comment to bump both together. Not exercised in CI yet. Uncommitted.
