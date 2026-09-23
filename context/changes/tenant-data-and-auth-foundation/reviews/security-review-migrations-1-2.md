<!-- SECURITY-REVIEW-REPORT -->
# Security Review: Migrations 1 and 2 (criterion 2.12)

- **Plan**: context/changes/tenant-data-and-auth-foundation/plan.md
- **Criterion**: 2.12 — dedicated security review of migrations 1 and 2, gating Phase 4
- **Date**: 2026-09-23
- **Commit under review**: `a1d4a02` (migrations last touched in `05fe52d`)
- **Files**:
  - `supabase/migrations/20260922120000_tenant_identity_foundation.sql`
  - `supabase/migrations/20260922120100_tickets_and_knowledge_base.sql`
- **Recommendation**: SIGN OFF — no critical findings; the one warning (F1) is fixed and verified, see Triage outcome
- **Findings**: 0 critical, 1 warning, 4 observations
- **Sign-off**: signed off by the user, 2026-09-23 — criterion 2.12 checked, Phase 4 unblocked

## Scope

Both migrations reviewed together, in their final state after the Phase 1 and Phase 2 triage
fixes. The earlier reviews covered each migration alone; this one looks specifically at the
seams — the migration 1 helpers as consumed by the migration 2 policies and view — and at the
database as it actually exists after `db reset`, not as the SQL files describe it.

Covered: every RLS policy (per operation, per role), every `SECURITY DEFINER` function (owner,
`search_path`, EXECUTE grants), the `knowledge_base_public` definer view and its guard, table
and column privileges as granted, default privileges for future objects, trigger inventory,
Realtime publication membership.

## Method

Nothing here is taken from reading the SQL alone. Three probe scripts ran against the live
local database, each inside a transaction that was rolled back (row counts confirmed unchanged
afterwards):

1. **Inventory** — `information_schema.role_table_grants` / `column_privileges`, `pg_proc`
   (definer, owner, `proconfig`, `has_function_privilege` for `anon` and `authenticated`),
   `pg_class` (RLS, FORCE RLS, owner, `reloptions`), `pg_policies`, `pg_default_acl`,
   `pg_publication_tables`, trigger list.
2. **Behavioural matrix — 55 probes** as five personas, switching with `set local role` and
   `request.jwt.claims` exactly as PostgREST does: service staff, client user in company A,
   client user in company B (as the target), a user still in the sentinel company, and `anon`.
   Fixtures: two client companies, one ticket each, one knowledge base entry carrying company
   A's provenance.
3. **Targeted** — the definer view's query plan and a cast-error side channel against it, and
   `TRUNCATE` at the grant layer.

## Result of the behavioural matrix

All 55 probes returned the expected outcome. Grouped:

| Area | Result |
|---|---|
| Cross-tenant reads (tickets, profiles, companies) | Client sees own company only; sentinel user sees nothing but itself and the sentinel row |
| Knowledge base split | Client: base table 0 rows, view 1 row, `source_company_id` not a view column (42703); sentinel user: view 0 rows |
| Writes through the definer view | INSERT / DELETE denied (42501) |
| Ticket filing | Own company only; not for a colleague; not with `created_by` null; not pre-resolved (column grant, 42501); sentinel and internal companies rejected |
| Client writes to anything else | UPDATE / DELETE on profiles, companies, tickets, KB return 0 rows; INSERT on profiles, companies, KB rejected by RLS |
| Role escalation | `role` update denied to client and to staff alike (column grant, 42501) |
| Staff assignment (the Phase 4 write) | Unassigned user to client company: 1 row; client user to internal company and staff to client company: rejected by the constraint trigger |
| Staff overreach | Cannot move a ticket's company, rewrite `error_text` or `email`, file tickets, delete tickets, create or re-kind companies |
| `anon` | 0 rows on profiles / companies; denied on tickets, the view and the helper RPCs |

Other facts confirmed from the inventory:

- All nine `SECURITY DEFINER` functions are owned by `postgres` and pin `search_path=""`. Only
  the three helpers are executable by `authenticated`; none by `anon`. The helpers return only
  facts about the caller, so exposing them as RPCs leaks nothing.
- The view is owned by `postgres`, which also owns the base table and is therefore exempt from
  its RLS — the intended mechanism. No table uses FORCE RLS, which is what keeps that true.
- No table is in the `supabase_realtime` publication.
- The view's guard compiles to a **One-Time Filter** over the scan. For a sentinel user the
  scan never executes, so a filter that would error on row content
  (`where error_text::int > 0`) returns 0 rows instead of leaking the text. `security_barrier`
  is therefore not needed: a client who passes the guard already sees every projected column,
  and user filters can only reference projected columns.

## Findings

### F1 — `TRUNCATE` bypasses RLS and every table still grants it to `authenticated` (and two to `anon`)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — latent today, cheap to close, and the next phases add surfaces
- **Location**: migration 1 section 8, migration 2 section 7 (what they do not revoke)
- **Detail**: Supabase's default privileges grant `arwdDxtm` on every new table. Both
  migrations narrow INSERT and UPDATE carefully, but leave `TRUNCATE`, `REFERENCES`, `TRIGGER`
  and `DELETE` in place for `authenticated` on all four tables, and leave the **full** default
  set for `anon` on `companies` and `profiles` (migration 2 revoked `anon` on its own tables;
  migration 1 never did). `TRUNCATE` is not subject to RLS. Reproduced: as the sentinel user,
  `truncate public.knowledge_base_entries` succeeds and the shared knowledge base drops to 0
  rows. `anon` `truncate public.profiles cascade` failed only because the cascade reached
  `tickets`, where `anon` was revoked.
- **Why not critical**: neither PostgREST nor pg_graphql can issue `TRUNCATE`, `authenticated`
  and `anon` are NOLOGIN, and no function in the schema runs dynamic SQL. There is no path to
  this today. It becomes one the first time a `SECURITY INVOKER` RPC with dynamic SQL, or any
  other statement-level path, is added — and the project's stated posture (migration 1
  section 8, migration 2 section 7) is that the grant layer, not the absence of a path, is the
  guarantee.
- **Fix A ⭐ Recommended**: in migration 1 section 8 and migration 2 section 7, add
  `revoke truncate, references, trigger on <table> from anon, authenticated` for all four
  tables, and `revoke all on public.companies, public.profiles from anon`. Optionally also
  revoke `delete` from `authenticated` everywhere — no table has a DELETE policy, so it changes
  nothing observable and removes the grant a future policy would silently widen.
  - Strength: makes the grant layer match the policies; consistent with how migration 2
    already treats `anon`.
  - Tradeoff: editing migrations in place again. Safe only while criterion 5.6 (hosted
    `db push`) is unchecked — it is.
  - Confidence: HIGH — reproduced.
- **Fix B**: accept as risk until Phase 5's `supabase/tests/rls.sql` exists, and add the
  revokes there as assertions first.
  - Tradeoff: the grant stays open through Phase 4, the first phase that adds a write surface.

### F2 — Staff can attribute a resolution to any profile, including a client user

- **Severity**: 👁 OBSERVATION
- **Impact**: 🪶 LOW — staff are trusted; matters for audit, not isolation
- **Location**: migration 2, `tickets are updatable by staff` + `grant update (… resolved_by …)`
- **Detail**: Reproduced: staff set `resolved_by` to a `client_user`'s id and the update
  succeeded. Nothing ties `resolved_by` to the caller or to a `service_staff` profile. Not a
  tenancy break — staff can already see every tenant — but "who answered this" is forgeable by
  any staff account.
- **Suggestion**: defer to S-02 (the resolution screen), where the write path is actually
  designed. A BEFORE trigger setting `resolved_by := auth.uid()` whenever `status` becomes
  `resolved` would remove the column from the client's control entirely.

### F3 — Future objects in `public` inherit the wide defaults

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — recurring cost, not a current hole
- **Location**: `pg_default_acl` for `postgres` in `public`
- **Detail**: every future table gets `arwdDxtm` for `anon` and `authenticated`, and every
  future function gets EXECUTE for `anon`. Both migrations compensate by hand; F1 shows the
  hand-written revokes already missed part of the set. Every later migration has to repeat the
  whole ritual correctly.
- **Suggestion**: record as a `/10x-lesson` ("every new table/function in `public` must revoke
  the Supabase defaults explicitly, including TRUNCATE"), or later add
  `alter default privileges in schema public revoke …` in its own migration. Changing default
  privileges is a project-wide decision and should not ride along with F1.

### F4 — Phase 4: an unauthorized UPDATE is a silent 0-row success, not an error

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — directly shapes the Phase 4 endpoint
- **Location**: `profiles are updatable by staff` (behaviour, not a defect)
- **Detail**: confirmed across the matrix: a non-staff UPDATE on `profiles` returns 0 rows
  with no error, and so does an update whose `userId` does not exist. The Phase 4 endpoint must
  therefore check the number of rows affected (e.g. `.select("id")` on the update and require
  exactly one row) before redirecting with a success status. Otherwise criterion 4.4 passes
  while the UI reports success for something that did not happen.

### F5 — Phase 4: the database permits re-assignment between client companies

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — a product decision the Phase 4 contract does not state
- **Detail**: the constraint trigger accepts moving a `client_user` from client A to client B
  (and back to the sentinel company). The moved user instantly loses A's tickets and gains all
  of B's. The Phase 4 screen lists only unassigned users, but the endpoint contract accepts any
  `userId`. If the intended scope is "first assignment only", the endpoint should filter the
  update on `company_id = <sentinel>` so a crafted POST cannot re-home an assigned user. If
  re-assignment is wanted, it should be a stated requirement.

## Checked and found clean

- Every `SECURITY DEFINER` function: owner `postgres`, `search_path=""`, fully qualified
  references, EXECUTE revoked from `public`/`anon`; trigger functions revoked from
  `authenticated` too.
- `handle_new_user()` controls `role` and `company_id` itself; the only caller-controlled value
  is `full_name`, bounded to 200 characters. Accounts without an email are unreachable: SMS
  signup is disabled in `config.toml`.
- Role immutability holds at two layers (column grant, then trigger); the trigger's `service_role`
  allowlist is documented and bounded by the F8 constraint already in the Phase 4 contract.
- Company kind is immutable; the profile/company invariant is enforced from both tables.
- Ticket integrity: column grants on INSERT and UPDATE, a two-branch status CHECK, and a
  company-kind trigger that holds against RLS-bypassing paths.
- The definer view: writes revoked from `authenticated`, the owner pinned, the guard evaluated
  once and ahead of the scan, no provenance or embedding columns projected.
- No table is published to Realtime.

## Triage outcome (2026-09-23)

| | Findings | Decision |
|---|---|---|
| Fixed | F1 | Fix A: `revoke truncate, references, trigger … from authenticated` on all four tables, `revoke all … from anon` on `companies` and `profiles`. DELETE left granted (no DELETE policy exists, so it has no effect). |
| Carried into Phase 4 contract | F4, F5 | Both recorded as hard constraints under Phase 4, change 2 in `plan.md`. F5 decided as **first assignment only**. |
| Recurring rule | F3 | Recorded via `/10x-lesson`. |
| Deferred | F2 | To S-02, where the resolution write path is designed. |

**F1 verification.** Both migrations were edited in place — safe because criterion 5.6
(hosted `db push`) is unchecked — then `npx supabase db reset` applied cleanly. Re-run against
the fresh database:

- the full behavioural matrix, now 62 probes including seven new ones: `TRUNCATE` as `anon`
  (profiles, companies), as the sentinel user (knowledge base, tickets), as a client (profiles),
  as staff (companies), and `CREATE TRIGGER` as a client — all 42501; every earlier probe
  unchanged, except `anon` reads of `profiles` / `companies` now fail with 42501 rather than
  returning 0 rows;
- the grant inventory: no `TRUNCATE`, `TRIGGER` or `REFERENCES` remains for `authenticated`,
  and `anon` holds nothing on any table in `public`;
- criteria 1.2, 1.6, 1.8, 1.9, 2.2 and 2.11 by query; 1.3 and 1.10 by inserting into
  `auth.users` inside a rolled-back transaction, which fires the same `handle_new_user()`
  trigger a real signup does — the profile lands as `client_user` in the sentinel company, and
  the owner's role change succeeds. The revoke from `anon` on `profiles` does not affect signup
  because the trigger runs with definer rights.
