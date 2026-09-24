<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tenant Data & Auth Foundation

- **Plan**: context/changes/tenant-data-and-auth-foundation/plan.md
- **Scope**: Phase 4 of 5
- **Reviewed phases**: 4
- **Date**: 2026-09-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

Commit `37e17b7` touches exactly the planned surface: `src/pages/admin/users.astro`,
`src/pages/api/admin/assign-company.ts`, `src/lib/services/company-assignment.ts` (service
extraction per `CLAUDE.md`), `src/types.ts` (DTOs) and the plan's Progress section.

Every hard constraint in the plan holds:

- **F8 (no `service_role`)**: the endpoint uses the request-scoped `createClient()`; no
  service-role key is referenced anywhere in the diff.
- **Only `company_id` is written**: `.update({ company_id: companyId })`; `role` is never read
  from `FormData`.
- **2.12 F4 (exactly one row)**: `.select("id")` on the update, `updated.length === 1`, anything
  else maps to `not-updated`.
- **2.12 F5 (first assignment only)**: the update filters on `company_id = <unassigned id>`.
- **Defence in depth**: the endpoint re-checks `role === 'service_staff'` independently of the
  middleware's `STAFF_ROUTES`, and rejects non-`client` companies before writing.
- **XSS**: the page maps `?error=` codes to fixed strings; user emails render through Astro's
  escaping.
- **CSRF**: Astro's `security.checkOrigin` defaults to `true`
  (`node_modules/astro/dist/core/config/schemas/defaults.js:44`) and `astro.config.mjs` does not
  override it, so the cookie-authenticated form POST rejects cross-origin submissions.

Success criteria, re-run during this review against a fresh build (`npm run preview`) and the
local Supabase:

| Criterion | Result |
|---|---|
| 4.1 `npm run lint` | PASS (0 errors; 6 `no-console` warnings, same pattern as `profile.ts`, `web-search.ts`) |
| 4.2 `npx astro check` | PASS (0 errors, 0 warnings) |
| 4.3 `npm run build` | PASS (first attempt hit EPERM on `dist/client` held by a stale `astro preview`; passed after stopping it) |
| 4.4 client user POST | PASS: 403; target profile still `unassigned/client_user`; client moving self to internal with `role=service_staff` also 403, unchanged |
| 4.5 internal company | PASS: `?error=invalid-company`; profile unchanged |
| 4.8 extra `role` field | PASS: assignment succeeds, role stays `client_user`; direct `update profiles set role` as `authenticated` rejected |
| Extra: re-assignment | PASS: `?error=not-updated` |
| Extra: malformed `userId` | PASS: `?error=error`, not a false success |

Manual items 4.6 and 4.7 are ticked; the HTTP run above reproduced both (the assigned user left
the unassigned company).

## Findings

### F1 — Stale smoke-test comment says the endpoint does not exist yet

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs:42-43
- **Detail**: The comment above "admin api rejects anonymous user" says the endpoint "arrives in a later change". Phase 4 shipped it, so the comment now misdescribes what the step proves.
- **Fix**: Reword the comment when Phase 5 edits `scripts/smoke.mjs` anyway.
- **Decision**: FIXED — comment reworded during triage (uncommitted; lands with Phase 5's `scripts/smoke.mjs` edits)

### F2 — Criterion 4.8's direct DB attempt is stopped by the column grant, not the trigger

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md criterion 4.8; supabase/migrations/20260922120000_tenant_identity_foundation.sql (column-scoped `update (company_id)` grant)
- **Detail**: `update profiles set role = …` as `authenticated` fails with `permission denied for table profiles` because the Phase 1 addendum limited the UPDATE grant to `company_id`. `enforce_profile_role_immutable()` is never reached on this path. The outcome the criterion protects (no role change) holds, with two layers instead of one, but the wording "rejected by the immutability trigger" no longer describes what happens. If Phase 5's `rls.sql` matches on the trigger's own error message, it will fail.
- **Fix**: In Phase 5's `supabase/tests/rls.sql`, assert that the role update raises *any* error and that the role is unchanged. Don't match on the trigger's message.
- **Decision**: DEFERRED TO PHASE 5 — queued in `follow-ups/review-fixes.md`; `rls.sql` asserts a generic failure plus an unchanged role

### F3 — Waiting list is unpaginated

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/company-assignment.ts:14-18
- **Detail**: `listPendingAssignments` loads every unassigned profile. At the PRD's 100–500 users this is harmless, and the list drains as staff assign people.
- **Fix**: None now; add `.limit()` or paging if the waiting list ever grows past a screen.
- **Decision**: ACCEPTED — risk accepted at the PRD's 100–500 user scale; the list drains as staff assign
