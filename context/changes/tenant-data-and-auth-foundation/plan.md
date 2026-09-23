# Tenant Data & Auth Foundation Implementation Plan

## Overview

Land the multi-tenant Postgres schema for HelpDesk XEMI — client companies, user profiles,
tickets and the shared knowledge base — with RLS enforcing per-company isolation from the
first row, and extend the existing generic Supabase auth model with a company reference and
a `client_user` / `service_staff` role split.

This is roadmap item **F-01**. It unlocks F-02 (ERP doc ingestion needs a knowledge-base
table to write into), S-01 and S-02 (neither can enforce FR-007 "see only your own company's
tickets" / FR-008 "see tickets from all companies" without this schema).

## Current State Analysis

**The database is empty.** `supabase/migrations/` does not exist — there is no schema, no RLS,
no seed. `supabase/config.toml` pins Postgres 17, has `[db.migrations].enabled = true` and
`[db.seed].sql_paths = ["./seed.sql"]`, so both migrations and seed apply automatically on
`supabase db reset` and on `supabase start` (which is what CI's `smoke` job runs).

**Auth is wired but completely flat.** `src/middleware.ts:12` calls `supabase.auth.getUser()`
and puts the raw Supabase `User` into `context.locals.user` (`src/env.d.ts:3`). There is no
company, no role, and no authorization beyond a single-entry `PROTECTED_ROUTES = ["/dashboard"]`
(`src/middleware.ts:4`). `src/pages/api/auth/signup.ts:13` is an open `signUp({ email, password })`
— any email creates an account tied to nothing.

**There is no `src/types.ts`,** although `CLAUDE.md` names it as the home for shared entities
and DTOs. This change creates it.

**Key constraints discovered:**

- CI's `smoke` job (`.github/workflows/ci.yml:39-47`) boots a local Supabase with
  `-x studio,imgproxy,mailpit,…` and writes the anon key into `.env`/`.dev.vars`. Because
  `supabase/config.toml:209` sets `enable_confirmations = false`, the existing open-signup
  step in `scripts/smoke.mjs:43` keeps working — this change does not break CI's current steps.
- **Nothing migrates the production database.** The `deploy` job (`.github/workflows/ci.yml:57-75`)
  runs `npm run build` then `npx wrangler deploy` and never runs `supabase db push`. From this
  change onward the deployed Worker depends on a schema, and `infrastructure.md` explicitly
  warns that `wrangler rollback` does not revert Supabase migrations.
- The Workers free-tier ceiling of 10 ms is **CPU time**, not wall-clock. Awaiting a Postgres
  round-trip does not consume it, so the profile lookup this plan adds to middleware costs
  latency, not CPU budget.

## Desired End State

A logged-in user always resolves to exactly one company and one role, and the database — not
the UI — is what stops a client of Company A from reading Company B's data.

Concretely, when this plan is done:

- Four tables (`companies`, `profiles`, `tickets`, `knowledge_base_entries`) exist with RLS
  enabled and per-operation, per-role policies.
- Anyone can still register at `/auth/signup`; the new account lands in a systemic
  "Nieprzypisani" company and can see nothing until a `service_staff` member assigns it a
  client company through `/admin/users`.
- The shared knowledge base is readable by every logged-in user through a view exposing only
  matchable text, cause and steps; its provenance columns are readable only by `service_staff`.
- `npm run smoke` proves the isolation guardrail over HTTP on every push to `master`.

Verify by running `npx supabase db reset && npm run build && npm run smoke` with the new
isolation steps green, and by signing in as each seeded persona.

### Key Discoveries:

- `src/middleware.ts:12` already performs one Supabase call per request; the profile lookup
  attaches to that same request path and needs no new lifecycle hook.
- `supabase/config.toml` `[db.seed].sql_paths = ["./seed.sql"]` — the file does not exist yet;
  creating it is all that is needed for CI to pick it up.
- `scripts/smoke.mjs` is deliberately dependency-free (its header says so) and drives the app
  over raw `fetch` with a manual cookie jar — new steps must follow that style, not add a test
  framework.
- `CLAUDE.md` states API routes read `FormData` directly with no schema-validation layer and
  that `zod` is not a dependency; the admin endpoint follows that, matching
  `src/pages/api/auth/signin.ts:5-7`.
- `context/foundation/lessons.md` forbids introducing lodash; all helper logic here is native
  TS/SQL, so the rule is satisfied by construction.

## What We're NOT Doing

- **Any matching or AI logic** — no embedding generation, no similarity search, no LLM calls.
  The `embedding` column and its index are created empty; populating them is F-02 and S-01.
- **The ERP documentation ingestion pipeline** (FR-012) — that is F-02.
- **The error-paste screen and ticket creation flow** (FR-001/002/003) — that is S-01.
- **The service-staff ticket dashboard and resolution recording** (FR-004/005/006) — that is
  S-02. This plan creates the `tickets` columns those features write to, and nothing else.
- **The "not helpful" escalation** (FR-011) — that is S-03. The `user_comment` column exists;
  no UI touches it.
- **Email-domain → company mapping** — explicitly moved to nice-to-have during planning.
- **An invite flow** — registration stays open; assignment is the admin's job.
- **Email notification to the service mailbox / ERP-UI display** (FR-009, FR-010) — parked.
- **Automated production migrations in CI** — the `supabase db push` gate stays manual and
  human-triggered, per `infrastructure.md`'s approval guidance.
- **A company-management screen** — client companies are created via seed or Supabase Studio.
- **Granting the `service_staff` role from the application** — deliberately excluded. Role
  changes happen only out of band (migration, seed, or Studio as `service_role`), enforced by a
  trigger rather than by convention. A staff-management screen is a separate change if one is
  ever wanted.

## Implementation Approach

Build the schema bottom-up in two migrations, then the application layer on top of it, then
the proof.

Identity comes first and alone (Phase 1) because everything else references it: the helper
functions that every later policy calls, the `company_id NOT NULL` invariant, and the trigger
that guarantees a profile exists for every account. Domain tables follow (Phase 2) so that a
mistake in the ticket or knowledge-base policies surfaces against an identity layer already
known to be correct.

Only then does the application learn about companies and roles (Phase 3), and only then does
the admin get a surface to assign them (Phase 4). The last phase (Phase 5) turns the guardrail
into something CI enforces, and writes down how a migration reaches production.

Two design choices drive most of the SQL:

**`company_id` is never null.** Both the service team and not-yet-assigned users get real
`companies` rows (`kind = 'internal'` and `kind = 'unassigned'`). This removes the class of
bug where `company_id IS NULL` silently behaves like a wildcard inside a policy, and it gives
the admin screen a trivial query for "who is waiting": profiles in the `unassigned` company.

**The knowledge base splits by surface, not by row.** Postgres RLS filters rows, and Supabase
gives every logged-in user the same `authenticated` role — so column-level `GRANT`s cannot tell
a client from a staff member. Instead the base table is staff-only under RLS, and clients read
a definer-rights view that projects only the safe columns.

## Critical Implementation Details

- **Seed ordering is load-bearing.** The `handle_new_user` trigger fires on insert into
  `auth.users`, so `supabase/seed.sql` must insert auth users *first* and then `UPDATE` the
  profiles the trigger created — inserting into `public.profiles` directly will collide with
  the trigger's row on the primary key.
- **The knowledge-base view must not be `security_invoker`.** It is intentionally definer-owned
  so it bypasses the base table's staff-only RLS and exposes the safe columns to every logged-in
  user. Adding `with (security_invoker = true)` would silently return zero rows to clients and
  make the shared knowledge base look empty.
- **`vector(1536)` is the indexable ceiling that matters.** pgvector refuses to build an HNSW or
  IVFFlat index above 2000 dimensions; 1536 is chosen to stay inside that limit while matching
  OpenAI `text-embedding-3-small`.
- **Supabase's default privileges already grant table access to `authenticated`.** RLS is what
  protects rows, so the knowledge-base base table needs its policies written before any data
  lands; do not rely on the absence of a `GRANT`.
- **Postgres grants `EXECUTE` to `PUBLIC` on every new function by default.** For a
  `SECURITY DEFINER` function that is an elevated surface handed to anyone who can reach the
  database, so every function this plan creates must be explicitly revoked from `public` and
  `anon` and granted only where it is actually needed. This is not optional hardening — it is
  the difference between a helper and a privilege-escalation primitive.
- **Role is immutable through the application.** Assigning a company and granting
  `service_staff` are deliberately separate operations: the former goes through the admin
  screen, the latter can only happen out of band (a migration, seed, or Supabase Studio acting
  as `service_role`). A `BEFORE UPDATE` trigger enforces this, so no policy mistake or endpoint
  bug can turn a client into staff.
- **"Unassigned" is cut off explicitly, not incidentally.** It would be tempting to rely on the
  sentinel company simply having no rows. Do not — every domain policy names
  `current_company_kind() = 'client'` directly, so a stray row with the sentinel's `company_id`
  can never become a shared inbox for every unassigned account.

---

## Phase 1: Identity foundation (companies, profiles, RLS helpers)

### Overview

Create the tenancy backbone: companies with a `kind` discriminator, profiles bound one-to-one
to `auth.users` with a non-null company and a role, the trigger that keeps that binding total,
and the `SECURITY DEFINER` helpers every later policy will call.

### Changes Required:

#### 1. Identity migration

**File**: `supabase/migrations/20260922120000_tenant_identity_foundation.sql`

**Intent**: Establish companies and profiles as the single source of truth for "which company
and which role is this request", so that every policy written later in this plan resolves
tenancy through one code path instead of re-deriving it.

**Contract**:

- Enums `public.user_role AS ENUM ('client_user','service_staff')` and
  `public.company_kind AS ENUM ('client','internal','unassigned')`.
- `public.companies(id uuid pk, name text not null, kind company_kind not null default 'client',
  created_at timestamptz, updated_at timestamptz)`, plus a partial unique index making the
  `internal` and `unassigned` rows singletons.
- `public.profiles(id uuid pk references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id), role user_role not null default
  'client_user', email text not null, full_name text, created_at, updated_at)`. `email` is
  denormalized from `auth.users` because the `authenticated` role cannot read the `auth` schema
  and the admin screen needs to show who it is assigning.
- Trigger `on auth.users after insert` running a `SECURITY DEFINER` function that inserts a
  profile into the `unassigned` company with role `client_user`.
- A constraint trigger enforcing the cross-table invariant: `service_staff` implies
  `company.kind = 'internal'`, `client_user` implies `company.kind IN ('client','unassigned')`.
- Three `STABLE SECURITY DEFINER` helpers with a pinned empty `search_path`:
  `public.current_company_id() → uuid`, `public.current_company_kind() → company_kind`,
  `public.is_service_staff() → boolean`.
- RLS enabled on both tables. `companies`: SELECT for `authenticated` where
  `is_service_staff() OR id = current_company_id()`; no write policies. `profiles`: SELECT where
  `id = auth.uid() OR is_service_staff()`; UPDATE for `is_service_staff()` only.
- A `BEFORE UPDATE` trigger `enforce_profile_role_immutable()` on `profiles` that raises unless
  `new.role = old.role`. Company assignment and role granting are separate operations; role
  changes happen only out of band, as `service_role` or via a migration, which the trigger
  distinguishes by checking the current role of the session.

The helper signature is a contract the rest of this plan depends on, so it is spelled out:

```sql
create function public.current_company_id() returns uuid
  language sql stable security definer set search_path = ''
as $$ select company_id from public.profiles where id = auth.uid() $$;
```

#### 2. Privilege hardening for elevated functions

**File**: `supabase/migrations/20260922120000_tenant_identity_foundation.sql` (same migration, closing section)

**Intent**: Make sure the `SECURITY DEFINER` surface this migration introduces is reachable only
by the callers that need it, rather than by everyone Postgres grants it to by default.

**Contract**: Every function created above is `SECURITY DEFINER` with `set search_path = ''` and
fully schema-qualified references. Closing the migration:

- `revoke execute on function … from public, anon` for all five functions.
- `grant execute` on the three read helpers (`current_company_id`, `current_company_kind`,
  `is_service_staff`) to `authenticated` only.
- No `grant execute` at all on `handle_new_user` or the two enforcement trigger functions —
  triggers run as the table owner, so nothing else needs to call them.

#### 3. Minimal seed (companies and the first staff account)

**File**: `supabase/seed.sql`

**Intent**: Give local development and CI the two systemic company rows the schema depends on,
plus one `service_staff` account — without which nobody can ever reach the admin screen.

**Contract**: Inserts the `internal` ("XEMI Service") and `unassigned` ("Nieprzypisani")
companies, one `auth.users` row for the staff account, then `UPDATE`s the profile the trigger
created to point at the internal company with role `service_staff`. That role write is exactly
the out-of-band path the immutability trigger permits — seed runs as the database owner, not as
`authenticated` — and it is the only place in the repository where a role is granted. Client
companies and demo data are added in Phase 5.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Both tables report RLS on: `select tablename, rowsecurity from pg_tables where schemaname = 'public'` returns `true` for `companies` and `profiles`
- Registering via `POST /api/auth/signup` creates exactly one `profiles` row in the `unassigned` company
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- No `SECURITY DEFINER` function in `public` is executable by `public` or `anon`: `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')` returns 0 rows
- Every `SECURITY DEFINER` function in `public` pins an empty `search_path`: `select proname, proconfig from pg_proc …` shows `search_path=` on all five
- Updating `profiles.role` as the `authenticated` role is rejected by the immutability trigger, while the same update as the database owner succeeds

#### Manual Verification:

- Supabase Studio shows exactly one `internal` and one `unassigned` company; inserting a second of either is rejected by the singleton index
- Attempting to set `role = 'service_staff'` on a profile in a `client` company is rejected by the constraint trigger

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

### Addenda (recorded during implementation review, 2026-09-22)

Changes made in Phase 1 that this plan did not originally call for. Recorded here so later
reviews read the plan as the source of truth rather than re-flagging them as drift.

4. **`eslint.config.js` — ignore `.claude/**`** (commit `e0b9b05`). `.claude/` is not in
   `.gitignore`, so `includeIgnoreFile(gitignorePath)` does not cover it, and the agent tooling
   installed there (`.claude/skills/10x-plan/scripts/metadata-guard.mjs` and its test) falls
   through to the type-checked `baseConfig` with no tsconfig coverage — which breaks
   `npm run lint` and therefore CI's `ci` job. Accepted as scope: build tooling only, no runtime
   or security surface. The tradeoff accepted knowingly is that agent tooling under `.claude/`
   stays unlinted from here on; the narrower alternative was extending `scriptsConfig`'s `files`
   glob to `.claude/**/*.mjs` instead.

5. **Systemic company rows moved from `seed.sql` into the migration** (review finding F1). The
   plan's Phase 1 contract put them in the seed, but Phase 5 states the seed is never applied to
   production while Phase 5 criterion 5.7 expects those rows in the hosted project — and no phase
   ever put them there, so signup would have failed on any database built by `db push`. Phase 5's
   seed contract now covers client companies and demo data only.

6. **Hardening added during review**: column-scoped `UPDATE` grant on `public.profiles`
   (`company_id` only), RLS helper calls wrapped in scalar subqueries, and
   `enforce_company_kind_immutable()` on `public.companies`. See
   `reviews/impl-review.md` findings F2, F3 and F4 for the reasoning.

---

## Phase 2: Domain tables (tickets and shared knowledge base)

### Overview

Add the two tables the product actually operates on, with the policies that realize FR-007 and
FR-008, and with the knowledge base split into a staff-only base table and a client-readable
view so the PRD's "shared knowledge base" and "no cross-client leakage" both hold.

### Changes Required:

#### 1. Domain migration

**File**: `supabase/migrations/20260922120100_tickets_and_knowledge_base.sql`

**Intent**: Create the ticket and knowledge-base storage that S-01, S-02 and F-02 will write to,
with isolation enforced at the row level and provenance hidden from client users.

**Contract**:

- `create extension if not exists vector;`
- Enums `public.ticket_status AS ENUM ('todo','resolved')` and
  `public.kb_source AS ENUM ('ticket','erp_doc')`.
- `public.tickets(id uuid pk, company_id uuid not null references companies(id),
  created_by uuid not null references profiles(id), error_text text not null,
  user_comment text, status ticket_status not null default 'todo', resolution text,
  resolved_by uuid references profiles(id), resolved_at timestamptz, created_at, updated_at)`,
  with a check constraint that `status = 'resolved'` requires `resolution` and `resolved_by`.
- `public.knowledge_base_entries(id uuid pk, source kb_source not null, error_text text not null,
  cause text, steps text, embedding vector(1536), source_ticket_id uuid references tickets(id)
  on delete set null, source_company_id uuid references companies(id) on delete set null,
  created_at, updated_at)`.
- HNSW index on `embedding` using `vector_cosine_ops`; btree indexes on `tickets(company_id, status)`
  and `tickets(created_by)`.
- `tickets` RLS: SELECT `is_service_staff() OR (current_company_kind() = 'client' AND
  company_id = current_company_id())` — the company-kind test is named explicitly so the
  sentinel company is cut off by the policy itself, not by happening to hold no rows;
  INSERT WITH CHECK `company_id = current_company_id() AND current_company_kind() = 'client'
  AND created_by = auth.uid()`; UPDATE for `is_service_staff()`; no DELETE policy.
- A `BEFORE INSERT OR UPDATE` trigger on `tickets` rejecting any `company_id` whose company
  `kind` is not `client`, so no code path — seed, migration or future endpoint — can attach a
  ticket to the internal or sentinel company.
- `knowledge_base_entries` RLS: SELECT and INSERT and UPDATE all gated on `is_service_staff()`.
- View `public.knowledge_base_public` selecting `id, source, error_text, cause, steps` only,
  deliberately left at definer rights so clients can read the shared base without reaching the
  table. Because it bypasses RLS, it carries its own authorization in its body:
  `where public.current_company_kind() = 'client' or public.is_service_staff()`. An unassigned
  account therefore reads an empty knowledge base rather than the whole one.
- Grants: `revoke all on public.knowledge_base_entries from anon`;
  `revoke all on public.knowledge_base_public from public, anon`;
  `grant select on public.knowledge_base_public to authenticated`. The view's owner is set
  explicitly rather than inherited from whoever runs the migration.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- The `vector` extension is installed and the HNSW index exists on `knowledge_base_entries.embedding`
- As a client user, `select * from knowledge_base_entries` returns 0 rows while `select * from knowledge_base_public` returns the seeded rows
- Inserting a ticket with another company's `company_id` is rejected by the WITH CHECK policy
- Linting passes: `npm run lint`
- As an unassigned user, `select * from knowledge_base_public` returns 0 rows while the same query as an assigned client returns the seeded rows
- As an unassigned user, inserting a ticket is rejected, and selecting from `tickets` returns 0 rows even when a row carrying the sentinel `company_id` is planted by the database owner
- Inserting a ticket whose company `kind` is `internal` or `unassigned` is rejected by the ticket company-kind trigger
- `knowledge_base_public` is not selectable by `anon`

#### Manual Verification:

- Reading the migration confirms `knowledge_base_public` exposes no `source_ticket_id`, `source_company_id`, `user_comment` or `embedding` column
- A user in the `unassigned` company cannot insert a ticket at all
- A dedicated security review of migrations 1 and 2 — every policy, every `SECURITY DEFINER` function and the view's guard — is completed and signed off before Phase 4 begins

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase. This pause is heavier than the others: Phases 1 and 2 are where
every isolation guarantee in the product is actually written, and a single over-permissive
policy or unguarded `SECURITY DEFINER` function here would expose every company's data. The
security review named above is a gate on starting Phase 4, not a formality to be batched with
the final review.

---

## Phase 3: Identity in the application layer

### Overview

Teach the running app who the user is beyond their email: attach the resolved profile to
`Astro.locals`, type it, gate routes by role, and give the not-yet-assigned user an honest
screen instead of an empty dashboard.

### Changes Required:

#### 1. Shared types

**File**: `src/types.ts`

**Intent**: Create the shared entity/DTO module `CLAUDE.md` mandates but which does not exist
yet, so middleware, pages and endpoints agree on one shape for identity.

**Contract**: Exports `UserRole`, `CompanyKind`, `TicketStatus`, `KbSource`, the row types
`Company`, `Profile`, `Ticket`, `KnowledgeBaseEntry`, and the DTO `SessionProfile`
(`{ id, email, role, companyId, companyName, companyKind }`) that middleware attaches.

#### 2. Profile lookup service

**File**: `src/lib/services/profile.ts`

**Intent**: Resolve the signed-in user's company and role in one query, keeping the middleware
free of Supabase query shapes.

**Contract**: `getSessionProfile(supabase, userId): Promise<SessionProfile | null>` — a single
select on `profiles` joined to `companies`, returning `null` when no profile row exists.

#### 3. Middleware: attach profile and gate by role

**File**: `src/middleware.ts`

**Intent**: Make the resolved profile available to every page and endpoint, and stop non-staff
users at the `/admin` boundary before any page code runs.

**Contract**: After the existing `getUser()` call, populate `context.locals.profile` (null when
there is no user or no profile). Add `STAFF_ROUTES = ["/admin"]`; a signed-in non-staff user
hitting one is redirected to `/dashboard`, an anonymous one to `/auth/signin` via the existing
`PROTECTED_ROUTES` behaviour.

#### 4. Locals typing

**File**: `src/env.d.ts`

**Intent**: Type the new locals entry so `astro check` catches misuse.

**Contract**: Adds `profile: import("@/types").SessionProfile | null` to `App.Locals`.

#### 5. Dashboard reflects tenancy

**File**: `src/pages/dashboard.astro`

**Intent**: Show the user which company and role they are acting as, and replace the generic
welcome with a clear waiting state when they have not been assigned yet.

**Contract**: Reads `Astro.locals.profile`; when `companyKind === 'unassigned'` renders a
"waiting for assignment" message instead of the normal content; staff additionally see a link
to `/admin/users`.

### Success Criteria:

#### Automated Verification:

- Type checking passes with `locals.profile` in use: `npx astro check`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- Existing smoke steps still pass unchanged: `npm run smoke`
- An anonymous request to `/admin/users` redirects to `/auth/signin`

#### Manual Verification:

- Signing in as the seeded staff account shows the internal company and a link to `/admin/users`
- Registering a brand-new account shows the "waiting for assignment" state, not an empty dashboard

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 4: Company assignment screen

### Overview

Give `service_staff` the one surface that makes open registration workable: a list of users
waiting for a company and a way to assign one, without touching the database by hand.

**Prerequisite**: the security review of migrations 1 and 2 from Phase 2 is signed off. This
phase builds the first surface that writes to `profiles`, so the policies underneath it must be
reviewed before it exists.

### Changes Required:

#### 1. Admin users page

**File**: `src/pages/admin/users.astro`

**Intent**: List the accounts sitting in the `unassigned` company and offer a company choice
for each, so onboarding a new client user stops requiring Supabase Studio.

**Contract**: Staff-only (enforced by middleware from Phase 3 and by RLS). Server-renders the
unassigned profiles and the `kind = 'client'` companies; each row is a plain
`<form method="POST" action="/api/admin/assign-company">` with the user id and a company
`<select>` — no React island, per the project's Astro-first convention. Renders success and
error state from a query parameter, matching the pattern in `src/pages/auth/signin.astro`.

#### 2. Assignment endpoint

**File**: `src/pages/api/admin/assign-company.ts`

**Intent**: Apply the assignment server-side with a role check that does not rely on the UI
having hidden the form.

**Contract**: `POST` export reading `userId` and `companyId` from `FormData` (no validation
layer, matching `src/pages/api/auth/signin.ts:5-7`). Rejects callers whose
`locals.profile.role !== 'service_staff'`; rejects a `companyId` whose company kind is not
`client`; updates **`profiles.company_id` and nothing else** — the endpoint never reads or
writes `role`, and the Phase 1 immutability trigger makes that structural rather than a matter
of the handler being written carefully; redirects back to `/admin/users` with a status
parameter.

**Hard constraint (from implementation review F8, 2026-09-22)**: this endpoint must issue the
update on the **caller's own `authenticated` session** — the request-scoped client from
`src/lib/supabase.ts` — and never on a `service_role` client. Both Phase 1 guards are scoped to
the `authenticated` path: `enforce_profile_role_immutable()` allowlists `service_role` by
design, and the column grant (`grant update (company_id) … to authenticated`) does not apply to
`service_role`, which bypasses RLS and column privileges outright. Reaching for a
`service_role` key here — a common reflex for an admin screen — silently removes every
structural protection against role escalation and re-opens `email`, `id` and `created_at` for
rewriting.

**Hard constraints (from the 2.12 security review F4 and F5, 2026-09-23)**:

- **Success means exactly one row changed.** RLS turns a non-staff update, or an update for a
  `userId` that does not exist, into a 0-row success with no error. The endpoint must request
  the affected rows back (e.g. `.select("id")` on the update) and treat anything other than
  exactly one row as failure; otherwise it redirects with a success status for a write that
  did not happen.
- **First assignment only.** The update filters on `company_id` = the unassigned company in
  addition to `id`, so a crafted POST cannot move an already-assigned user from one client
  company to another — which would silently hand them that company's tickets. The database
  permits re-assignment; the endpoint deliberately does not. Re-assignment, if ever wanted, is
  a new requirement.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Production build succeeds: `npm run build`
- `POST /api/admin/assign-company` as a signed-in client user does not modify any row
- `POST /api/admin/assign-company` with a company whose kind is `internal` is rejected
- A request carrying an extra `role=service_staff` field changes no role, and the same attempt made directly against the database as `authenticated` is rejected by the immutability trigger

#### Manual Verification:

- Staff assigns a freshly registered account to a client company through `/admin/users`, and that user's dashboard then shows the company
- After assignment the user no longer appears in the waiting list

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 5: Isolation proof and the production migration path

### Overview

Turn the PRD's isolation guardrail into something CI re-checks on every push, and write down
how a migration actually reaches the hosted database — the gap the current `deploy` job leaves
open.

### Changes Required:

#### 1. Demo seed data

**File**: `supabase/seed.sql`

**Intent**: Extend the Phase 1 seed with two client companies, their users and one ticket each,
plus two knowledge-base entries, so the isolation steps have something to compare.

**Contract**: Adds companies "Klient Alfa" and "Klient Beta" (`kind = 'client'`), one
`auth.users` row per company with a known password, profile updates pointing at them, one
`todo` ticket per company, and two `knowledge_base_entries` — one with `source = 'ticket'`
carrying provenance, one with `source = 'erp_doc'` without. Auth users are inserted before the
profile updates, per Critical Implementation Details.

#### 2. Read-only tickets endpoint

**File**: `src/pages/api/tickets.ts`

**Intent**: Expose the smallest HTTP surface over which isolation can be asserted, since no
ticket UI exists until S-01. S-01 and S-02 extend this route rather than replacing it.

**Contract**: `GET` export returning the tickets visible to the caller as JSON — the query is a
plain `select` with no company filter in application code, so the rows returned are exactly what
RLS permits. Returns 401 for an anonymous caller.

#### 3. Smoke test isolation steps

**File**: `scripts/smoke.mjs`

**Intent**: Make cross-company leakage a CI failure rather than something noticed in review.

**Contract**: Keeps the existing steps and adds, in the same dependency-free `fetch` style, two
groups.

*Read isolation*: sign in as the Klient Alfa user and assert `GET /api/tickets` returns only
Alfa's ticket; same for Klient Beta; sign in as staff and assert both are returned; assert a
freshly registered (unassigned) account gets an empty list.

*Write and escalation attempts* — every one asserts both the rejection **and** that no row
changed, re-reading state afterwards: a client user `POST`s to `/api/admin/assign-company` and
is rejected; a client user posts an assignment moving themselves to another company and is
rejected; staff posts an assignment naming the internal company and is rejected; a client user
posts an assignment carrying an extra `role=service_staff` field and remains a client user; an
unassigned account is redirected away from `/admin/users` while staff reaches it.

#### 4. Production migration runbook

**File**: `CLAUDE.md`

**Intent**: Record the manual gate for applying migrations to the hosted database, because the
`deploy` job never will and `wrangler rollback` does not undo a migration.

**Contract**: Adds a "Database migrations" subsection stating that a migration-bearing PR
requires `npx supabase db push` against the hosted project *before* merge to `master`, that
`supabase/seed.sql` is local/CI only and is never applied to production, and that rolling back a
deploy after a migration requires checking schema compatibility by hand.

#### 5. Policy-level negative checks

**File**: `supabase/tests/rls.sql`

**Intent**: Cover the write and escalation attempts that have no HTTP surface in this change —
ticket writes belong to S-01, so asserting them over `fetch` would mean inventing S-01's
endpoints here. These run where the policies actually live.

**Contract**: A single SQL script that, for each persona, uses `set local role authenticated`
with a matching `request.jwt.claims` setting and asserts the expected failure: inserting a
ticket for another company, inserting a ticket while unassigned, inserting a ticket against the
internal company, selecting `knowledge_base_entries` as a client, selecting
`knowledge_base_public` as an unassigned user, and updating `profiles.role`. Each assertion
raises on an unexpected success, so a non-zero exit is the failure signal.

#### 6. Wire the policy checks into CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run the negative checks on every push, in the job that already has a live database.

**Contract**: The `smoke` job gains one step after `supabase start` and before the build,
executing `supabase/tests/rls.sql` against the local database. No new secrets; no change to the
`ci` or `deploy` jobs.

### Success Criteria:

#### Automated Verification:

- Seed loads without error: `npx supabase db reset`
- Smoke passes including the new isolation steps: `npm run build && npm run smoke`
- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- The full CI sequence passes locally: `npx astro sync && npm run lint && npx astro check && npm run build`
- Every negative check passes: `supabase/tests/rls.sql` runs against the local database and exits zero
- The `smoke` job runs `supabase/tests/rls.sql` and fails the build when any assertion in it is removed

#### Manual Verification:

- `npx supabase db push` applies both migrations to the hosted Supabase project and the runbook in `CLAUDE.md` matches what actually happened
- The hosted project contains the two systemic company rows but none of the demo seed data
- Signing in as each of the three seeded personas shows the expected company and ticket visibility in the browser

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

The project has no unit-test runner and this change does not introduce one. Correctness here
lives in SQL policies, which are verified by exercising them as real users rather than by
mocking.

### Integration Tests:

Two layers, deliberately split by where the behaviour is reachable.

`scripts/smoke.mjs` covers everything with an HTTP surface:

- Client A sees only Company A's tickets; Client B only Company B's; staff sees both
- An unassigned account sees none and cannot reach `/admin/users`
- A client user cannot assign companies; cannot move themselves; cannot smuggle a role change
- Staff cannot assign a user to the internal company
- The existing auth-flow steps (signup, wrong password, signin, protected route, signout)

`supabase/tests/rls.sql` covers the write attempts that have no endpoint until S-01:

- Ticket insert for another company, while unassigned, and against the internal company
- Direct `select` on `knowledge_base_entries` as a client
- `select` on `knowledge_base_public` as an unassigned user
- `update profiles set role` as `authenticated`

### Manual Testing Steps:

1. `npx supabase db reset`, then sign in as the staff account and confirm `/admin/users` lists the unassigned demo user.
2. Register a new account at `/auth/signup`; confirm the dashboard shows the waiting state.
3. As staff, assign that account to "Klient Alfa"; confirm its dashboard now names the company.
4. As that user, confirm `/admin/users` redirects to `/dashboard`.
5. In Supabase Studio as a client role, confirm `knowledge_base_entries` returns nothing while `knowledge_base_public` returns rows.
6. Attempt to insert a ticket while in the `unassigned` company and confirm it is rejected.

## Performance Considerations

Phase 3 adds one Postgres round-trip per authenticated request on top of the existing
`getUser()` call. This is I/O latency, not Workers CPU time, so it does not consume the 10 ms
CPU ceiling `infrastructure.md` flags — but it does add to time-to-first-byte and should be the
first thing revisited if the dashboard feels slow.

Index sizing assumes the scale captured in the PRD (roughly 100-500 users, low QPS); the exact
QPS and data-volume ballparks remain an open question on the roadmap. Default HNSW parameters
(`m = 16`, `ef_construction = 64`) are appropriate at that size and should be revisited when
F-02 loads the real documentation volume.

## Migration Notes

There is no existing data — this is the project's first migration. The relevant migration risk
is forward-only: once these migrations are applied to the hosted database, rolling the Worker
back with `wrangler rollback` leaves the schema in place. Phase 5's runbook is the mitigation.

`supabase/seed.sql` must never run against the hosted project; it exists for `supabase db reset`
and for CI's `supabase start`.

## References

- Roadmap item F-01: `context/foundation/roadmap.md`
- Product requirements: `context/foundation/prd.md` (Access Control, FR-007, FR-008, FR-012)
- Platform constraints and risk register: `context/foundation/infrastructure.md`
- Recurring rules: `context/foundation/lessons.md`
- Existing auth flow to extend: `src/middleware.ts:1-25`, `src/pages/api/auth/signin.ts:1-20`
- CI jobs affected: `.github/workflows/ci.yml:27-75`
- Test harness to extend: `scripts/smoke.mjs:38-59`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Identity foundation (companies, profiles, RLS helpers)

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — e0b9b05
- [x] 1.2 Both tables report RLS on: `select tablename, rowsecurity from pg_tables where schemaname = 'public'` returns `true` for `companies` and `profiles` — e0b9b05
- [x] 1.3 Registering via `POST /api/auth/signup` creates exactly one `profiles` row in the `unassigned` company — e0b9b05
- [x] 1.4 Linting passes: `npm run lint` — e0b9b05
- [x] 1.5 Type checking passes: `npx astro check` — e0b9b05
- [x] 1.8 No `SECURITY DEFINER` function in `public` is executable by `public` or `anon`: `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')` returns 0 rows — e0b9b05
- [x] 1.9 Every `SECURITY DEFINER` function in `public` pins an empty `search_path`: `select proname, proconfig from pg_proc …` shows `search_path=` on all five — e0b9b05
- [x] 1.10 Updating `profiles.role` as the `authenticated` role is rejected by the immutability trigger, while the same update as the database owner succeeds — e0b9b05

#### Manual

- [x] 1.6 Supabase Studio shows exactly one `internal` and one `unassigned` company; inserting a second of either is rejected by the singleton index — e0b9b05
- [x] 1.7 Attempting to set `role = 'service_staff'` on a profile in a `client` company is rejected by the constraint trigger — e0b9b05

### Phase 2: Domain tables (tickets and shared knowledge base)

#### Automated

- [x] 2.1 Migration applies cleanly: `npx supabase db reset` — a13931d
- [x] 2.2 The `vector` extension is installed and the HNSW index exists on `knowledge_base_entries.embedding` — a13931d
- [x] 2.3 As a client user, `select * from knowledge_base_entries` returns 0 rows while `select * from knowledge_base_public` returns the seeded rows — a13931d
- [x] 2.4 Inserting a ticket with another company's `company_id` is rejected by the WITH CHECK policy — a13931d
- [x] 2.5 Linting passes: `npm run lint` — a13931d
- [x] 2.8 As an unassigned user, `select * from knowledge_base_public` returns 0 rows while the same query as an assigned client returns the seeded rows — a13931d
- [x] 2.9 As an unassigned user, inserting a ticket is rejected, and selecting from `tickets` returns 0 rows even when a row carrying the sentinel `company_id` is planted by the database owner — a13931d
- [x] 2.10 Inserting a ticket whose company `kind` is `internal` or `unassigned` is rejected by the ticket company-kind trigger — a13931d
- [x] 2.11 `knowledge_base_public` is not selectable by `anon` — a13931d

#### Manual

- [x] 2.6 Reading the migration confirms `knowledge_base_public` exposes no `source_ticket_id`, `source_company_id`, `user_comment` or `embedding` column — a13931d
- [x] 2.7 A user in the `unassigned` company cannot insert a ticket at all — a13931d
- [x] 2.12 A dedicated security review of migrations 1 and 2 — every policy, every `SECURITY DEFINER` function and the view's guard — is completed and signed off before Phase 4 begins — signed off 2026-09-23, see `reviews/security-review-migrations-1-2.md`

### Phase 3: Identity in the application layer

#### Automated

- [x] 3.1 Type checking passes with `locals.profile` in use: `npx astro check` — 901c68f
- [x] 3.2 Linting passes: `npm run lint` — 901c68f
- [x] 3.3 Production build succeeds: `npm run build` — 901c68f
- [x] 3.4 Existing smoke steps still pass unchanged: `npm run smoke` — 901c68f
- [x] 3.5 An anonymous request to `/admin/users` redirects to `/auth/signin` — 901c68f

#### Manual

- [x] 3.6 Signing in as the seeded staff account shows the internal company and a link to `/admin/users` — 901c68f
- [x] 3.7 Registering a brand-new account shows the "waiting for assignment" state, not an empty dashboard — 901c68f

### Phase 4: Company assignment screen

#### Automated

- [x] 4.1 Linting passes: `npm run lint` — 37e17b7
- [x] 4.2 Type checking passes: `npx astro check` — 37e17b7
- [x] 4.3 Production build succeeds: `npm run build` — 37e17b7
- [x] 4.4 `POST /api/admin/assign-company` as a signed-in client user does not modify any row — 37e17b7
- [x] 4.5 `POST /api/admin/assign-company` with a company whose kind is `internal` is rejected — 37e17b7
- [x] 4.8 A request carrying an extra `role=service_staff` field changes no role, and the same attempt made directly against the database as `authenticated` is rejected by the immutability trigger — 37e17b7

#### Manual

- [x] 4.6 Staff assigns a freshly registered account to a client company through `/admin/users`, and that user's dashboard then shows the company — 37e17b7
- [x] 4.7 After assignment the user no longer appears in the waiting list — 37e17b7

### Phase 5: Isolation proof and the production migration path

#### Automated

- [x] 5.1 Seed loads without error: `npx supabase db reset`
- [x] 5.2 Smoke passes including the new isolation steps: `npm run build && npm run smoke`
- [x] 5.3 Linting passes: `npm run lint`
- [x] 5.4 Type checking passes: `npx astro check`
- [x] 5.5 The full CI sequence passes locally: `npx astro sync && npm run lint && npx astro check && npm run build`
- [x] 5.9 Every negative check passes: `supabase/tests/rls.sql` runs against the local database and exits zero
- [x] 5.10 The `smoke` job runs `supabase/tests/rls.sql` and fails the build when any assertion in it is removed

#### Manual

- [ ] 5.6 `npx supabase db push` applies both migrations to the hosted Supabase project and the runbook in `CLAUDE.md` matches what actually happened
- [ ] 5.7 The hosted project contains the two systemic company rows but none of the demo seed data
- [x] 5.8 Signing in as each of the three seeded personas shows the expected company and ticket visibility in the browser
