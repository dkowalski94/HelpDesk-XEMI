<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tenant Data & Auth Foundation

- **Plan**: context/changes/tenant-data-and-auth-foundation/plan.md
- **Scope**: Full plan (only Phase 1 is complete; Phases 2–5 not started)
- **Reviewed phases**: 1
- **Date**: 2026-09-22
- **Verdict**: REJECTED at review time — **all ten findings resolved during triage the same day**; see Triage outcome below.
- **Findings**: 1 critical, 6 warnings, 3 observations

## Triage outcome (2026-09-22)

| | Findings | Count |
|---|---|---|
| Fixed | F1 (Fix A), F2 (narrowed), F3, F4 (immutability), F6, F7, F8 (both parts), F9 (differently), F10 (both layers) | 9 |
| Accepted | F5 — recorded as plan addendum 4 | 1 |
| Skipped | — | 0 |

The `Safety & Quality` FAIL that drove the REJECTED verdict was F1, now fixed and verified. Re-running the Phase 1 criteria after every fix: `npx supabase db reset` clean, RLS on both tables, both systemic companies present as singletons, nine definer functions all `anon`-revoked with `search_path` pinned, signup returns 200 and lands in `unassigned/client_user`, `npm run lint` and `npx astro check` (0 errors, 29 files) both green.

**Not verified**: `npm run build`. It fails at its own cleanup step with `EPERM, Permission denied: dist\client` inside `rmdirSync` — a Windows file lock on pre-existing build output from 12:15, which the OS refuses to delete or move. This is unrelated to the changes made here (all of which are `.sql` and `.md`), and `npm run build` is not a Phase 1 criterion; it appears as criteria 3.3 and 5.5, both still unchecked. It should be re-run after the lock clears.

Changes made during triage are **uncommitted**. The migration `20260922120000_tenant_identity_foundation.sql` was edited in place rather than superseded by a follow-up migration, which is safe only because it has not yet been applied to the hosted project (criterion 5.6 is unchecked). If it has been pushed, these edits must be re-cut as a new migration instead.

Commit under review: `e0b9b05` — `supabase/migrations/20260922120000_tenant_identity_foundation.sql` (260 lines), `supabase/seed.sql` (107 lines), `eslint.config.js` (+2 lines).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria — verified this session

All ten Phase 1 checkboxes were re-run against a fresh `npx supabase db reset`, not taken on trust.

| # | Criterion | Result |
|---|---|---|
| 1.1 | `npx supabase db reset` applies cleanly | PASS |
| 1.2 | RLS on `companies` and `profiles` | PASS (`rowsecurity = t` on both) |
| 1.3 | Signup creates exactly one profile in `unassigned` | PASS (1 row, `client_user`, `Nieprzypisani`) |
| 1.4 | `npm run lint` | PASS |
| 1.5 | `npx astro check` | PASS (0 errors, 29 files) |
| 1.6 | Systemic companies are singletons | PASS (both duplicate inserts rejected by `companies_systemic_kind_key`) |
| 1.7 | `service_staff` in a `client` company rejected | PASS (`enforce_profile_company_kind` raised) |
| 1.8 | No definer function executable by `anon`/`public` | PASS (0 rows; all six show `pub = f`) |
| 1.9 | `search_path = ''` pinned on every definer function | PASS (all six, not five — see note) |
| 1.10 | Role update rejected as `authenticated`, allowed as owner | PASS (both halves) |

Note on 1.9: the plan says "all five" functions; the migration creates six (three helpers + three trigger functions). The implementation hardened all six. The plan undercounted; no impact.

Note on 1.3: the HTTP form of this check could not be exercised, because `.env`/`.dev.vars` point the dev server at the hosted project `wjwqptobndpfovhiivkk.supabase.co` rather than local Supabase, and that project rejects `@example.com` addresses. The check was performed one layer down, against local GoTrue's `/auth/v1/signup` — the exact call `src/pages/api/auth/signup.ts:13` makes. This is a local-environment issue, not a defect in this change.

## Findings

### F1 — Systemic company rows exist only in `seed.sql`, so signup breaks on any migrations-only database

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:117-123, supabase/seed.sql:21-25
- **Detail**: `handle_new_user()` raises when no `kind = 'unassigned'` company exists. The only statement that creates that row is `seed.sql:21-25`, and `supabase/config.toml:60-65` runs seeds only on `db reset` / `supabase start` — never on `db push`. On a database built by migrations alone, every registration aborts inside the `auth.users` INSERT and the user is redirected to `/auth/signup?error=…` by `src/pages/api/auth/signup.ts:15-17`. CI cannot catch this: the `smoke` job boots a local Supabase where the seed does run.

  Reproduced against the local database — deleting the `unassigned` row and inserting into `auth.users` gives:
  `ERROR: No company with kind = 'unassigned' exists; cannot create a profile for d2000610-…`
  `CONTEXT: PL/pgSQL function public.handle_new_user() line 10 at RAISE`

  This is a **plan defect faithfully implemented**, not drift. Phase 1's contract says the seed "inserts the internal and unassigned companies", and Phase 1 did exactly that. But Phase 5's runbook contract states `supabase/seed.sql` "is local/CI only and is never applied to production", while Phase 5 manual criterion 5.7 asserts "the hosted project contains the two systemic company rows". No phase in the plan ever puts them there. The gap is in the plan; the code inherited it.
- **Fix A ⭐ Recommended**: Move the two systemic company INSERTs into the Phase 1 migration (`on conflict (id) do nothing`), leaving only the staff *account* in the seed.
  - Strength: The rows are schema invariants — `company_id NOT NULL` and `handle_new_user` both hard-depend on them — so they belong with the schema. Fixes the gap before Phase 5 rather than after, and makes criterion 5.7 true by construction.
  - Tradeoff: Puts data in a migration, which some teams keep purely structural. The seed's `on conflict do nothing` then becomes a no-op for companies.
  - Confidence: HIGH — failure reproduced directly; `config.toml:60-65` confirms seed scope.
  - Blind spot: Whether the hosted project already has rows with different ids; an id-keyed `on conflict` would not merge with them.
- **Fix B**: Leave Phase 1 as is and add a dedicated bootstrap migration during Phase 5, alongside the runbook.
  - Strength: Keeps the Phase 1 commit untouched and groups the production path with the rest of the production work.
  - Tradeoff: Leaves a known-broken production schema in the repo across Phases 2–4; anyone who pushes in the meantime gets a dead signup flow.
  - Confidence: MEDIUM — depends on nobody running `db push` before Phase 5.
  - Blind spot: Phase 5 is the phase most likely to be deferred or split.
- **Decision**: FIXED via Fix A — the two INSERTs moved into the migration (after the singleton index, before `create table public.profiles`), without `on conflict` since the migration runs once against an empty table; `seed.sql:14-19` reduced to a pointer comment. Verified: `npx supabase db reset` green, both companies present from the migration alone, staff profile still resolves, a fresh GoTrue signup returns 200 and lands in `unassigned`, `npm run lint` clean.

### F2 — `profiles` UPDATE policy is not column-scoped; `authenticated` holds UPDATE on all seven columns

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:234-239
- **Detail**: The policy is correctly `to authenticated` and correctly carries `with check` — no row can be moved out of the caller's visibility. But it authorizes every column. Confirmed against the local database: `information_schema.column_privileges` shows `authenticated` holding UPDATE on `id`, `company_id`, `role`, `email`, `full_name`, `created_at`, `updated_at`. Acting as the seeded staff account over `set local role authenticated`, rewriting another profile's `email` to `attacker@evil.test` and its `created_at` to `1999-01-01` succeeded. `email` is the column the migration's own comment (`:59-60`) designates as the admin screen's identity display, and it has no unique constraint. `role` is held back only by the trigger in F8, whose predicate is a session heuristic rather than a privilege check.
- **Fix**: Add column-level grants alongside the policy — `revoke update on public.profiles from authenticated;` then `grant update (company_id, updated_at) on public.profiles to authenticated;`. Column privileges are checked before RLS and before triggers, so this closes `id`, `role`, `email` and `created_at` structurally rather than by convention.
  - Strength: Defense in depth that does not depend on the trigger holding; Phase 4's admin endpoint only ever needs `company_id`.
  - Tradeoff: A future column that staff legitimately edits must be added to the grant, or the write fails with a privilege error.
  - Confidence: HIGH — the over-broad privilege was reproduced directly.
  - Blind spot: Whether Phase 4's design intends staff to edit `full_name`.
- **Decision**: FIXED (narrowed on the user's instruction) — `revoke update on public.profiles from authenticated;` plus `grant update (company_id) on public.profiles to authenticated;` appended to the hardening section. `updated_at` was deliberately **not** granted: the user's call is that it be maintained by F6's `BEFORE UPDATE` trigger writing `NEW.updated_at`, which is not column-privilege checked. `full_name`, `role`, `email`, `id`, `created_at` and `updated_at` are all non-editable through `authenticated`. Verified after `db reset`: `column_privileges` shows exactly one row (`UPDATE company_id`); as staff over `authenticated`, rewriting `email`/`created_at` and escalating `role` both fail with `permission denied for table profiles`, while assigning `company_id` still succeeds.
- **Depends on**: F6 — until the touch trigger exists, `updated_at` can no longer be written by the application at all, so it will stay at its insert value. F6 is now a required follow-up rather than an optional one.

### F3 — RLS helper calls are not wrapped in scalar subqueries, forcing per-row evaluation

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:223, 230, 238-239
- **Detail**: Policies call `public.is_service_staff()`, `public.current_company_id()` and `auth.uid()` bare. `STABLE` alone does not hoist these out of the per-row qualifier — Postgres only caches the result as an InitPlan when the call is written as a scalar subquery. As written, each helper runs a full `SELECT` against `public.profiles` once per candidate row. This is the documented Supabase RLS anti-pattern. It barely matters on `profiles` today, but Phase 2's `tickets` and `knowledge_base_entries` policies are specified to key on these same helpers, and they will copy whatever call style Phase 1 established.
- **Fix**: Rewrite each call site as `(select public.is_service_staff())`, `(select public.current_company_id())`, `(select auth.uid())`.
  - Strength: One-line-each change with an order-of-magnitude effect on large result sets; fixes the pattern before Phase 2 propagates it to the tables where row counts actually grow.
  - Tradeoff: None functional — the semantics are identical.
  - Confidence: HIGH — well-documented Postgres planner behaviour.
  - Blind spot: Not benchmarked on this schema; at current row counts the difference is unmeasurable.
- **Decision**: FIXED — all five call sites across the three policies wrapped, with a comment above the policy block recording why so later phases copy the style. Verified after `db reset`: `pg_policies` stores `( SELECT is_service_staff() …)` / `( SELECT current_company_id() …)` / `( SELECT auth.uid() …)` in every `qual` and `with_check`, and isolation is unchanged — staff sees 3 companies / 2 profiles, a client user sees 1 / 1.

### F4 — The cross-table invariant is enforced from the `profiles` side only

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:173-177
- **Detail**: `enforce_profile_company_kind` is a genuine `CONSTRAINT TRIGGER`, fires on both INSERT and UPDATE, and covers both directions of the role↔kind rule. But the invariant spans two tables and nothing guards `public.companies`. A single `update public.companies set kind = 'client' where kind = 'internal'` silently leaves every `service_staff` profile attached to a client company, after which `current_company_kind()` returns `'client'` for staff — the exact predicate Phase 2's ticket policies are specified to key on. RLS blocks `authenticated` here (there are no write policies on `companies`), so the reachable paths are Studio, `service_role` and migrations — which are precisely the paths the plan designates for company management ("client companies are created via seed or Supabase Studio").
- **Fix**: Add a mirror `after update of kind on public.companies` trigger that re-validates the profiles pointing at the changed row, or make `companies.kind` immutable after insert.
  - Strength: Closes the invariant from the side the design actually uses for company management; `kind` has no legitimate reason to change after creation.
  - Tradeoff: A second trigger to maintain, on a table with no write policies — arguably guarding a path only an operator can take.
  - Confidence: MEDIUM — the hole is real, but no automated path reaches it today.
  - Blind spot: Whether any future admin flow needs to convert a company's kind.
- **Decision**: FIXED via the immutability option — added `public.enforce_company_kind_immutable()` (`security definer`, `search_path = ''`, revoked from `public, anon, authenticated`) and a `before update on public.companies … when (old.kind is distinct from new.kind)` trigger, placed directly after the profiles-side constraint trigger with a comment explaining the two-table gap. A migration that genuinely needs to re-kind a company drops the trigger, does it, and re-validates by hand. Verified after `db reset`: flipping `internal → client` as the database owner raises `companies.kind is immutable (… is internal, cannot become client)`, renaming a company still succeeds, and all seven definer functions remain `anon`-inexecutable with `search_path=""`.

### F5 — Unplanned `eslint.config.js` change exempts all of `.claude/**` from linting

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:82-83
- **Detail**: The commit adds `{ ignores: [".claude/**"] }` with the comment "Agent tooling installed under .claude/ is not project source". Phase 1's Changes Required does not mention `eslint.config.js`. Root cause is real and confirmed: `.claude/` is not in `.gitignore`, so `includeIgnoreFile(gitignorePath)` does not cover it, and `.claude/skills/10x-plan/scripts/metadata-guard.mjs` plus its test file fall through to `baseConfig`'s type-checked rules with no tsconfig coverage, breaking `npm run lint`. The change is build-tooling only with zero runtime or security surface, and the commit message declares it. It is nonetheless an undeclared scope addition made for a reason unrelated to the tenancy work, and it silently exempts all future agent tooling from linting.
- **Fix**: Either accept it and note it in the plan as an addendum, or narrow it by extending `scriptsConfig`'s `files` glob (eslint.config.js:73-78) to cover `.claude/**/*.mjs` instead of ignoring the whole tree.
- **Decision**: ACCEPTED — the ignore stays; recorded as addendum 4 under Phase 1 in `plan.md`, together with the knowingly accepted tradeoff (agent tooling under `.claude/` stays unlinted) and the narrower alternative that was not taken. Addenda 5 and 6 in the same section record the F1 relocation and the F2/F3/F4 hardening, so later reviews read the plan as the source of truth.

### F6 — `updated_at` is declared on both tables but never maintained

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:33, 53
- **Detail**: Both tables declare `updated_at timestamptz not null default now()` and nothing ever advances it. There is no `BEFORE UPDATE` touch trigger; `seed.sql:106` sets it by hand, the only place it is ever correct. Confirmed: an UPDATE against a profile left `updated_at` at its insert value. After Phase 4's admin screen assigns a company, `profiles.updated_at` will still read account-creation time. Per F2 it is also directly writable by any staff member.
- **Fix**: Add the standard `set_updated_at()` BEFORE UPDATE trigger on both tables.
- **Decision**: FIXED — added `public.set_updated_at()` (`security definer`, `search_path = ''`, revoked from `public, anon, authenticated`) with `set_companies_updated_at` and `set_profiles_updated_at` BEFORE UPDATE triggers. This closes the dependency F2 created. Verified after `db reset`: a staff company assignment issued over `authenticated` — which holds UPDATE on `company_id` only — still advances `updated_at`, confirming a BEFORE trigger writing `NEW` is not column-privilege checked. Across two transactions, `updated_at` moved from `12:51:32.959` to `12:51:35.504` and now exceeds `created_at`. All eight definer functions remain `anon`-revoked with `search_path` pinned.

### F7 — `profiles.email` silently diverges from `auth.users.email`

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:51, 59-60
- **Detail**: The column is denormalized with the stated purpose that "the admin screen must show who it is assigning". Only `on_auth_user_created` (AFTER INSERT) populates it. Supabase Auth email changes go through an `auth.users` UPDATE that no trigger observes, so the admin screen will show a stale address for any user who changes their email — defeating the column's only reason to exist.
- **Fix**: Add an `after update of email on auth.users` trigger that syncs `public.profiles.email`.
- **Decision**: FIXED — added `public.sync_profile_email()` (`security definer`, `search_path = ''`, revoked from `public, anon, authenticated`) and an `after update of email on auth.users … when (old.email is distinct from new.email)` trigger. Verified after `db reset`: changing `auth.users.email` from `old@test.local` to `new@test.local` propagates to the profile, and an `auth.users` update touching only `raw_user_meta_data` leaves it untouched. All nine definer functions remain `anon`-revoked with `search_path` pinned; `npm run lint` clean.

### F8 — The role-immutability predicate allowlists `service_role`, so it may contribute nothing on Phase 4's likely path

- **Severity**: OBSERVATION
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:193-199, 205-208
- **Detail**: The mechanism is sound for the PostgREST path and the migration's reasoning is technically correct: `SECURITY DEFINER` swaps `current_user` but does not change the `role` GUC, so `current_setting('role')` still names what PostgREST's `SET LOCAL ROLE` issued. Verified — acting as the seeded staff member over `authenticated`, the escalation raised `profiles.role is immutable through the application`. Two residual gaps, neither reachable today. First, `'none'` identifies the *absence of a role switch*, not a privileged caller; the comment at `:191-192` overstates it as meaning "a migration, the seed, or a direct owner session". Second, `'service_role'` is allowlisted by design — which means that if Phase 4's admin endpoint is written against a `service_role` client (a very plausible choice for an admin screen), this trigger permits the write and every staff member gains role escalation through the normal endpoint. Worth recording as a hard constraint on Phase 4 rather than changing now, especially if F2's column grants land.
- **Fix**: Record "the admin assign-company endpoint must use the user's `authenticated` session, never a `service_role` client" as a Phase 4 constraint; optionally add `when (old.role is distinct from new.role)` to the `CREATE TRIGGER` so the function is not invoked on every profile update.
  - Strength: Keeps the guard meaningful on the one path that would otherwise bypass it, at the moment the decision is actually made.
  - Tradeoff: It is a note, not an enforcement — a future implementer can still ignore it. F2's column grants are the enforcing version.
  - Confidence: MEDIUM — depends entirely on how Phase 4 is written.
  - Blind spot: Phase 4 is not yet designed in enough detail to know which client it will use.
- **Decision**: FIXED (both parts) — (a) the constraint is now written into the plan as a **Hard constraint** under Phase 4's assignment-endpoint contract, spelling out that both Phase 1 guards are scoped to the `authenticated` path and that a `service_role` client removes all of them; (b) added `when (old.role is distinct from new.role)` to the trigger, with a comment recording what the allowlist does and does not cover. Verified after `db reset`: company assignment over `authenticated` succeeds (the trigger correctly does not fire), role escalation is denied by the column grant, and with the grant temporarily widened in a rolled-back transaction the trigger itself still raises `profiles.role is immutable through the application` — so the two layers are independent, not redundant.

### F9 — The two branches of the same invariant disagree about NULL

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:159, 164
- **Detail**: Line 159 uses the NULL-safe `target_kind is distinct from 'internal'`; line 164 uses `target_kind not in ('client', 'unassigned')`, which evaluates to NULL — and therefore raises nothing — if `target_kind` were NULL. The `NOT NULL` FK on `profiles.company_id` and `NOT NULL` on `companies.kind` make this unreachable today, so it is defense-in-depth only. But one branch fails closed and the other fails open, which is the kind of asymmetry that survives a refactor.
- **Fix**: Use `coalesce(target_kind, 'client'::public.company_kind) not in (…)` so both branches fail closed.
- **Decision**: FIXED DIFFERENTLY — the coalesce sentinel was rejected as arbitrary. Instead an explicit NULL guard now runs before either branch and raises `Company % has no kind; cannot validate profile %`, so neither branch has to have an opinion about NULL. Verified after `db reset`: the happy path (`client_user` into a `client` company) still succeeds, `service_staff` in a `client` company is still rejected, and pointing a profile at a nonexistent company is still caught by `profiles_company_id_fkey` first — confirming the guard is genuine defense-in-depth rather than a reachable path.

### F10 — `full_name` stores an unbounded attacker-controlled value

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922120000_tenant_identity_foundation.sql:131
- **Detail**: `nullif(new.raw_user_meta_data ->> 'full_name', '')` reads a field fully controlled by the caller at signup via `options.data`. The value is only ever displayed, Astro escapes by default, and `astro/no-set-html-directive` is `"error"` in eslint.config.js:67 — so this is not an injection risk. But there is no length bound, so an unauthenticated request can store an arbitrarily large string. Worth noting that the trigger correctly reads `new.email` rather than `raw_user_meta_data ->> 'email'` and never reads a role out of metadata; both classic Supabase footguns are avoided.
- **Fix**: Add `check (char_length(full_name) <= 200)` on the column, or `left(…, 200)` in the trigger.
- **Decision**: FIXED — both layers, after the CHECK alone proved to have a sharp edge. With only the constraint, a 250-character `full_name` made signup fail with **HTTP 500** and GoTrue echoed the raw Postgres error back to the caller, row contents included (`company_id`, `role`, `email`). Unreachable through the app — `src/pages/api/auth/signup.ts:13` sends only `{ email, password }` — but reachable by any direct API caller. Final shape: `full_name text check (full_name is null or char_length(full_name) <= 200)` on the column as a backstop, and `left(…, 200)` in `handle_new_user` so the signup path trims instead of failing. Verified after `db reset`: a 250-char name returns HTTP 200 and stores 200 characters, a normal name is untouched, and a 250-char UPDATE on any other path is still rejected by `profiles_full_name_check`.

## What was checked and found clean

Recorded so a later review does not re-litigate it:

- **Plan adherence**: all eleven planned Phase 1 items verified MATCH. No MISSING, no DRIFT. The three helpers reproduce the plan's exact signature contract character-for-character, including `language sql` / `stable` / `security definer` / `set search_path = ''`.
- **Definer hygiene**: every one of the six functions pins `search_path = ''` and schema-qualifies every reference. EXECUTE is revoked from `public` and `anon` on all six — including the trigger functions, which the plan's contract required and which is the step most often skipped. The implementation went further than the plan by also revoking `authenticated` on the three trigger functions.
- **Scope boundaries**: nothing under `src/`, no `tickets` or `knowledge_base` tables, no `supabase/tests/`, no smoke changes, no Phase 5 demo data. The "What We're NOT Doing" list is respected apart from F5.
- **Seed ordering**: companies → `auth.users` → `UPDATE profiles`, exactly as the plan's load-bearing note requires. No direct `insert into public.profiles` anywhere, so the PK-collision trap is avoided. The unplanned `auth.identities` row (seed.sql:71-96) is necessary — GoTrue resolves password sign-in through it — and completes the plan's intent rather than exceeding it.
- **Pattern consistency**: migration filename matches `YYYYMMDDHHmmss_short_description.sql`; RLS is enabled on both tables with per-operation, per-role policies (never `for all`, every policy carries `to authenticated`) as CLAUDE.md requires.
- **Data safety**: no `DROP`, no destructive statement, no `if exists` masking failure. The migration is deliberately non-idempotent, which is correct under Supabase's once-per-file migration ledger.
- **Seed credential**: the hardcoded staff password at seed.sql:56 is correctly confined — `config.toml:60-65` runs seeds only on `db reset`/`start`, and no workflow applies it to the hosted project. The residual risk is a human running `supabase db reset --linked`.
- **`profiles_company_id_idx`** (migration:64) is an unplanned but benign addition; `current_company_id()` reads that column on every request.
