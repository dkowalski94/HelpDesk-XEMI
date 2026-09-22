# Tenant Data & Auth Foundation — Plan Brief

> Full plan: `context/changes/tenant-data-and-auth-foundation/plan.md`

## What & Why

HelpDesk XEMI is a multi-tenant support portal: client users from different companies paste ERP
errors, and an internal service team resolves what the knowledge base cannot match. Today the
app has Supabase auth but no concept of a company or a role, and no database at all. This change
lands the schema — companies, profiles, tickets, shared knowledge base — with RLS enforcing
per-company isolation from the first row, because retrofitting isolation after ticket and
knowledge-base rows exist is far riskier than building it in now.

## Starting Point

`supabase/migrations/` does not exist; there is no schema, no RLS, no seed. Auth works but is
flat: `src/middleware.ts:12` resolves a Supabase `User` into `context.locals.user`, and
`src/pages/api/auth/signup.ts:13` accepts any email with no company binding. Authorization is a
single-entry `PROTECTED_ROUTES = ["/dashboard"]`. `src/types.ts` — which `CLAUDE.md` names as the
home for shared entities — has never been created.

## Desired End State

Every logged-in user resolves to exactly one company and one role, and the database, not the UI,
is what stops Company A from reading Company B's data. Registration stays open to anyone; a new
account lands in a systemic "Nieprzypisani" company and sees nothing until a service-staff member
assigns it a client company through a new `/admin/users` screen. The shared knowledge base is
readable by everyone through a view carrying only matchable text, cause and steps, while its
provenance stays staff-only — and `npm run smoke` proves all of this on every push to `master`.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Where RLS reads identity | `profiles` table + `STABLE SECURITY DEFINER` helpers | One source of truth, role changes take effect immediately, canonical Supabase pattern; the extra round-trip costs latency, not Workers CPU budget. |
| Schema scope | All four tables plus pgvector now | F-02 needs a knowledge-base table to write into, and landing the vector column now avoids a second structural migration. |
| Registration | Open to anyone; admin assigns the company afterwards | Keeps onboarding self-service without an invite flow. Reversed mid-session from an earlier "invite-only" choice; email-domain mapping deferred to nice-to-have. |
| Knowledge base vs isolation | Split by surface: staff-only base table, client-readable view | Satisfies both PRD statements at once — genuinely shared, yet Company A's provenance never reaches Company B — by policy rather than by discipline. |
| Embedding contract | `vector(1536)` + HNSW, assuming OpenAI `text-embedding-3-small` | 1536 stays under pgvector's 2000-dimension index ceiling and is common enough to survive a provider swap. |
| Account provisioning | `supabase/seed.sql` + Supabase Studio | Keeps F-01 at schema, RLS and role model instead of growing an invite feature, and solves "who invites the first inviter". |
| Service-staff tenancy | Internal company row; `company_id` always `NOT NULL` | Removes the class of bug where `company_id IS NULL` behaves like a wildcard inside a policy. |
| Not-yet-assigned users | Systemic "Nieprzypisani" company row + trigger | Preserves the `NOT NULL` invariant, makes "sees nothing" structural, and gives the admin screen a trivial waiting-list query. |
| Assignment surface | Minimal `/admin/users` screen for staff | Makes open registration usable without database access, and is the first working proof that the role split holds end to end. |
| Isolation verification | Extend `scripts/smoke.mjs` with isolation steps | The guardrail the PRD calls a success condition becomes something CI re-checks, not something noticed in review. |
| Unassigned cut-off | Every domain policy names `current_company_kind() = 'client'` explicitly | Isolation must not rest on the sentinel company happening to hold no rows; added after plan review. |
| Role granting | Impossible through the app — trigger-enforced, out-of-band only | Separates "assign a company" from "grant staff", so no endpoint bug or policy mistake can escalate a client; added after plan review. |
| Elevated surfaces | `EXECUTE` revoked from `public`/`anon`, `search_path` pinned, view carries its own guard | Postgres grants `EXECUTE` to `PUBLIC` by default, which turns a `SECURITY DEFINER` helper into an escalation primitive; added after plan review. |
| Negative test coverage | Smoke covers write/escalation attempts; `supabase/tests/rls.sql` covers DB-only writes | Ticket-write endpoints belong to S-01, so asserting them over HTTP would mean inventing S-01 here; added after plan review. |

## Scope

**In scope:** two migrations (identity: `companies`, `profiles`, signup trigger, RLS helpers;
domain: `tickets`, `knowledge_base_entries`, pgvector) with policies realizing FR-007 and FR-008;
`src/types.ts`, a profile lookup service, `locals.profile` and role-gated routes; the
`/admin/users` screen with `POST /api/admin/assign-company`; `supabase/seed.sql`, a read-only
`GET /api/tickets`, isolation and escalation steps in `scripts/smoke.mjs`, policy-level negative
checks in `supabase/tests/rls.sql` wired into CI; a `CLAUDE.md` migration runbook.

**Out of scope:** all matching and AI logic, embedding generation and similarity search (F-02,
S-01); the ERP doc ingestion pipeline (F-02); the error-paste flow (S-01), staff resolution
recording (S-02) and "not helpful" escalation (S-03); email-domain → company mapping (now
nice-to-have), any invite flow, FR-009/FR-010; automated production migrations in CI; any
company-management screen.

## Architecture / Approach

Two migrations build the schema bottom-up. Identity comes first and alone, because every later
policy calls the same three helpers (`current_company_id()`, `current_company_kind()`,
`is_service_staff()`) and a trigger on `auth.users` guarantees every account has a profile —
so a mistake in the ticket or knowledge-base policies surfaces against an identity layer already
known to be correct.

Two choices drive most of the SQL. `company_id` is never null: the service team and unassigned
users both get real company rows discriminated by a `kind` enum, removing the failure mode where
a null silently behaves like a wildcard. And the knowledge base splits by surface rather than by
row — Supabase gives every logged-in user the same `authenticated` role, so column grants cannot
separate client from staff; the base table is staff-only under RLS and clients read a
definer-rights view projecting only the safe columns. The app layer then reads that identity once
per request in middleware, and the last phase turns the guardrail into a CI assertion.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Identity foundation | `companies` + `profiles` with RLS, signup trigger, helper functions | The cross-table invariant (role ↔ company kind) needs a constraint trigger, not a check constraint |
| 2. Domain tables | `tickets` + `knowledge_base_entries`, pgvector, isolation policies | The view must stay definer-rights *and* carry its own guard — the single highest-risk object in the change |
| 3. App-layer identity | `src/types.ts`, `locals.profile`, role-gated routes, honest dashboard | Adds a Postgres round-trip to every authenticated request |
| 4. Assignment screen | `/admin/users` + `POST /api/admin/assign-company` | Gated on the Phase 2 security review; first product UI inside a foundation phase |
| 5. Isolation proof | Seed, `GET /api/tickets`, smoke + `supabase/tests/rls.sql`, migration runbook | Nothing currently migrates the hosted database; the gate stays manual on purpose |

**Security gate:** Phases 1-2 carry every isolation guarantee in the product and get a dedicated
security review — of each policy, each `SECURITY DEFINER` function and the view's guard — that
must be signed off before Phase 4 starts.

**Prerequisites:** Docker running for `npx supabase start`; access to the hosted Supabase project
for the Phase 5 manual step. No roadmap prerequisites — F-01 has none.

**Estimated effort:** ~3-4 sessions across 5 phases; Phases 1 and 2 are the bulk of the work.

## Open Risks & Assumptions

- **QPS and data volume are still unknown** — the roadmap's own F-01 unknown, owned by the user and non-blocking. The plan assumes ~100-500 users and low QPS with default HNSW parameters; revisit when F-02 loads real documentation volume.
- **The embedding provider is not formally chosen.** `vector(1536)` is the contract, OpenAI `text-embedding-3-small` the assumed default; a provider with a different dimension forces a column rebuild.
- **Granting `service_staff` has no application path at all.** Plan review rejected letting the assignment screen touch `role`, so promoting someone now requires database access. That is the intended trade: safe by default, manual by consequence.
- **Production migration stays manual.** Merging a migration-bearing PR without running `supabase db push` leaves the deployed Worker pointing at a schema that does not exist yet.

## Success Criteria (Summary)

- A client user signing in sees their own company's tickets and no one else's, and a service-staff member sees every company's — enforced by the database, not the interface.
- A newly registered user is told they are waiting for assignment, and a staff member can assign them a company from a screen without touching the database.
- `npm run smoke` fails on `master` if cross-company leakage is ever reintroduced.
