<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tenant Data & Auth Foundation

- **Plan**: context/changes/tenant-data-and-auth-foundation/plan.md
- **Scope**: Phase 3 of 5
- **Reviewed phases**: 3
- **Date**: 2026-09-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations
- **Commit under review**: `901c68f` — 7 files, +208/-11

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

**Plan Adherence**: all five planned changes implemented with the planned intent; no MISSING items. One mechanism deviation — `/admin` is OR-ed into the existing anonymous-redirect guard rather than added to `PROTECTED_ROUTES` — produces the outcome the contract describes and is accepted.

**Scope Discipline**: no Phase 4 or Phase 5 work leaked. Verified absent: `src/pages/admin/`, the assignment endpoint, `supabase/tests/`, demo seed data, smoke isolation steps, the production runbook. `supabase/seed.sql` and `scripts/smoke.mjs` are untouched by this commit. The two forward references (`STAFF_ROUTES`, the `/admin/users` link) were both mandated by the Phase 3 contract. One unplanned addition: `.gitignore` (F8).

**Success Criteria**: 3.1–3.5 re-run independently this session against the committed tree and all pass. 3.6 and 3.7 confirmed by the user. But 3.5 is filed under Automated while nothing automates it — see F2.

## Verification note

Findings were not taken on trust from the scanning agents. The load-bearing claims were reproduced directly against the running app and the local database:

- **F1** — probed every reachable path shape against the live preview server. `/admin`, `/admin/users`, `/admin/users/`, `/administrators`, `/admin../dashboard`, `/admin%2Fusers` all return `302 → /auth/signin` for an anonymous caller; `/api/admin/assign-company` returns **404, not a redirect**, proving the gate does not see it. As a signed-in `client_user` in the unassigned company, `/admin` and `/admin/users` both return `302 → /dashboard` and `/dashboard` renders the waiting state — the role gate's positive path, which criterion 3.5 does not cover.
- **F5** — inserted a 1536-dimension vector into `knowledge_base_entries` and read it back over PostgREST. The column comes back as a JSON **string** (`"[0.5,0.5,…]"`), Python type `str`, not an array. The probe row was deleted afterwards.
- **F3** — grep confirms `Company`, `Profile`, `Ticket` and `KnowledgeBaseEntry` are imported nowhere in `src/`.
- `/ADMIN/users` and `/Admin/users` return 404 rather than a redirect: Astro builds route patterns without the `i` flag, so the uppercase path matches no route. Not a bypass, but the gate is not what stops it.

## Findings

### F1 — Staff gate does not cover `/api/admin/*`, where Phase 4's first profile-write endpoint lands

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:5,9
- **Detail**: `STAFF_ROUTES = ["/admin"]` and `PROTECTED_ROUTES = ["/dashboard", "/search"]`. `"/api/admin/assign-company".startsWith("/admin")` is `false`, and `/api/*` is in neither list. Phase 4 creates exactly that file (`plan.md:484` — `src/pages/api/admin/assign-company.ts`), the first surface in the project that writes to `profiles`. Confirmed by probe: an anonymous request to `/api/admin/assign-company` returns 404 — it falls through to routing rather than being redirected, so once the route exists the request reaches the handler with neither an authentication nor a role check from middleware. Phase 4's contract does specify its own `locals.profile.role !== 'service_staff'` rejection plus RLS, so this is a missing layer of defence in depth rather than an open door — but the plan describes the middleware as stopping non-staff "at the `/admin` boundary before any page code runs", and the boundary has a hole precisely where the next write surface goes.
- **Fix A ⭐ Recommended**: Extend the gate to `["/admin", "/api/admin"]` and return `403` instead of a redirect for paths under `/api/`.
  - Strength: Closes the hole before Phase 4 lands in it, and a 302 is the wrong contract for a `fetch` caller — it follows the redirect and receives HTML with status 200.
  - Tradeoff: Two branches in the guard instead of one; slightly more logic in middleware.
  - Confidence: HIGH — the gap is demonstrated by probe, and the endpoint path is named in the plan.
  - Blind spot: Whether Phase 4 will want a different error shape (redirect with a status param) for its form post.
- **Fix B**: Leave it to Phase 4's own handler check.
  - Strength: Keeps Phase 3 exactly as the plan specified; the endpoint contract already mandates a role check.
  - Tradeoff: Authorization depends on the endpoint author remembering, with no structural backstop — the failure mode the project already chose triggers over conventions for role immutability.
  - Confidence: MEDIUM — safe only if Phase 4 is implemented exactly as written.
  - Blind spot: Any future endpoint added under `/api/admin` by someone who assumes middleware covers it.
- **Decision**: FIXED via Fix A — `STAFF_ROUTES` now `["/admin", "/api/admin"]`; anonymous API callers get 401, signed-in non-staff get 403, pages keep their redirects. Verified by probe: page 302, API 403.

### F2 — Criterion 3.5 is filed under Automated but nothing automates it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/tenant-data-and-auth-foundation/plan.md:757
- **Detail**: "An anonymous request to `/admin/users` redirects to `/auth/signin`" sits under `#### Automated` and is ticked. `scripts/smoke.mjs` is not in this commit and was last touched at scaffold; it asserts `/dashboard` only. The check was performed by hand (curl) and left no artifact, so the one new authorization boundary this phase introduces has zero regression coverage while its checkbox claims otherwise. A future edit to `STAFF_ROUTES` would pass CI silently.
- **Fix**: Add the assertion to `scripts/smoke.mjs` beside the existing `/dashboard` case, following its dependency-free style — or move 3.5 under `#### Manual` so the checkbox stops over-claiming.
- **Decision**: FIXED — two assertions added to `scripts/smoke.mjs` (`/admin/users` 302, `/api/admin/assign-company` 401). Smoke is 10/10.

### F3 — The four row types describe a shape PostgREST never returns

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/types.ts:48-101
- **Detail**: `Company`, `Profile`, `Ticket` and `KnowledgeBaseEntry` are documented as "A row of `public.<table>`" but use camelCase (`companyId`, `fullName`, `errorText`) while PostgREST returns the raw snake_case column names. This commit demonstrates the gap itself: `src/lib/services/profile.ts:5-11` declares a second, snake_case `ProfileWithCompanyRow` rather than reuse the `Profile` it imports from the same module. All four are currently unused anywhere in `src/`, so nothing is broken today — but a Phase 4 or S-01 consumer writing `supabase.from("tickets").select("*")` and annotating it `Ticket[]` gets code that type-checks and is wrong at every field, because `SupabaseClient` is used ungenerified and TypeScript infers `any` from the query. The plan mandated these exports verbatim (`plan.md:393-395`), so this is a plan-level design point, not implementation drift.
- **Fix A ⭐ Recommended**: Keep them as app-side DTOs — rename or document them as such, and add one mapper per table following the pattern `getSessionProfile` already establishes.
  - Strength: Matches what the code already does; no new tooling or build step; the camelCase boundary stays inside the service layer where it belongs.
  - Tradeoff: One hand-written mapper per table, which drifts if the schema changes without someone updating it.
  - Confidence: HIGH — the pattern exists and works in this very commit.
  - Blind spot: How many tables S-01 and S-02 will actually consume.
- **Fix B**: Generate `database.types.ts` with `supabase gen types typescript` and parameterise `SupabaseClient<Database>`.
  - Strength: Row shapes come from the schema rather than being retyped by hand; the compiler catches column drift.
  - Tradeoff: Adds a generation step to the workflow and a generated file to the repo; needs a decision about when it is regenerated.
  - Confidence: MEDIUM — standard Supabase practice, but it is new tooling this project has not adopted.
  - Blind spot: Whether the generated types cooperate with the definer-rights `knowledge_base_public` view.
- **Decision**: FIXED via Fix B — `src/database.types.ts` generated from the schema; the four row types, four enums and a new `KnowledgeBasePublicEntry` derive from it; `createServerClient<Database>`; the duplicate `ProfileWithCompanyRow` is gone. Generated file excluded from ESLint.

### F4 — A failed lookup is indistinguishable from "no tenancy", and the user is told the wrong thing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/profile.ts:34-41, src/pages/dashboard.astro:16,30-37
- **Detail**: Three distinct states collapse into one `null`: a DB error, no profile row, and an unreadable company. For authorization this fails closed and is correct — a staff user hitting `/admin` during a PostgREST blip is sent to `/dashboard`. For the dashboard it is confidently wrong: a legitimately assigned client user sees "Your account is not linked to a company yet. The XEMI service team assigns new accounts" because of a transient network error, with the only trace a `console.error` in the Worker log. The project already settled the opposite idiom one directory over — `WebSearchResponse` (`src/types.ts:19-27`) is a discriminated union carrying a failure reason, which `src/pages/api/web-search.ts` maps to a status code. This is the one place the change diverges from an established local pattern.
- **Fix**: Return a discriminated union from `getSessionProfile` (`{ status: "ok"; profile } | { status: "unassigned" } | { status: "error" }`), mirroring `web-search.ts`, and give the error case its own dashboard copy.
- **Decision**: FIXED — `getSessionProfile` returns `{ status: "ok" | "missing" | "error" }`; middleware keeps `locals.profile` in its contracted shape and adds `locals.profileLookupFailed`; the dashboard renders a third state for a failed lookup.

### F5 — `embedding: number[] | null` is wrong; the column comes back as a string

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/types.ts:95-96
- **Detail**: The field is typed `number[] | null` with the comment "comes back as a plain array of numbers". Verified false: inserting a 1536-dimension vector and reading it back over PostgREST returns a JSON **string** (`"[0.5,0.5,…]"`), because `extensions.vector` is not a type PostgREST knows and it serialises through the type's text output function. Unused today, so no live bug — but combined with F3, an F-02 consumer writing `entry.embedding.length` gets the string length instead of 1536, silently.
- **Fix**: Type it `string | null` and add a `parseEmbedding()` helper, or drop the field from the DTO until F-02 needs it.
- **Decision**: FIXED as a side effect of F3 — the generated type gives `embedding: string | null`, matching the PostgREST probe.

### F6 — Second sequential round trip on every session-carrying request

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:21
- **Detail**: `getSessionProfile` is awaited after `supabase.auth.getUser()`, which already hits GoTrue to validate the JWT. Both land in TTFB, and it runs for surfaces that never read `locals.profile`: `POST /api/auth/signout`, `POST /api/web-search`, `/`, `/auth/*`, `/search`, and every 404. The plan budgeted exactly this and named it the first thing to revisit if the dashboard feels slow (`plan.md:681-684`), so it is accepted risk rather than drift. Recorded because the mitigation is cheap: resolve eagerly only for `isStaffRoute` and expose a memoized resolver for pages that ask.
- **Fix**: None required — accepted by the plan. Revisit if TTFB becomes a complaint.
- **Decision**: ACCEPTED as risk — the plan budgeted this round trip and named it the first thing to revisit if the dashboard feels slow.

### F7 — The gate's correctness is borrowed from framework and platform behaviour

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/middleware.ts:27-39
- **Detail**: Two properties outside this file are load-bearing for the gate. First, Astro normalizes `context.url.pathname` — full percent-decoding, duplicate-slash collapsing, dot-segment resolution — before middleware runs, which is why `/admin%2Fusers` and `/admin../dashboard` are gated rather than slipping through; a mismatch between what a gate sees and what the router matches is a recurring SSR-framework CVE pattern. Second, `wrangler.jsonc` serves `./dist` as static assets with no `run_worker_first`, so any asset matching the request is served **before** the Worker runs: a single `export const prerender = true` on a future `/admin` page, or one file in `public/admin/`, would remove the gate from that path with no error anywhere. Neither invariant is visible from `src/middleware.ts`.
- **Fix**: Record both invariants in `CLAUDE.md`'s auth-flow section, one line each. Good `/10x-lesson` candidate as a recurring rule.
- **Decision**: FIXED (documented) — both invariants recorded in `CLAUDE.md`'s auth-flow section. Not written to `lessons.md` by the user's choice.

### F8 — `.gitignore` change is unplanned scope

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .gitignore:19,23
- **Detail**: Adds `.env.hosted` and `.dev.vars.hosted`. No phase of the plan mentions `.gitignore`. Both files exist untracked and hold hosted-Supabase credentials, so this is real secret-leak prevention discovered during the phase rather than gold-plating, and it is disclosed in the commit message. Nothing leaked: `.env.example` is the only env-shaped file ever added to history. The enumeration pattern is fragile — the next variant (`.env.local`, `.dev.vars.staging`) is tracked by default, and whoever creates it will be mid-debugging.
- **Fix**: Broaden to `.env*` with `!.env.example`, plus `.dev.vars*`.
- **Decision**: FIXED — `.gitignore` broadened to `.env*` with `!.env.example`, and `.dev.vars*`. Verified that variants are ignored and the template stays tracked.

### F9 — The "Manage users" link 404s until Phase 4

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:46
- **Detail**: `href="/admin/users"` points at a route Phase 4 creates. A staff user signing in today sees the link, passes the gate and gets Astro's 404. This is the plan's own sequencing — the Phase 3 contract mandates the link — and manual check 3.6 accepted it. Recorded so it is a known state of `master` rather than a surprise.
- **Fix**: None — resolved by Phase 4.
- **Decision**: ACCEPTED — deliberate transitional state; Phase 4 resolves it.

### F10 — Middleware comment misstates why the staff gate is protected

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/middleware.ts:7-8
- **Detail**: The comment reads "Staff-only routes. They are also protected routes, so an anonymous visitor is sent to sign in by the check below". `/admin` is not in `PROTECTED_ROUTES`; the claim holds only because of the `isStaffRoute ||` at line 29. Someone "simplifying" that OR back to the original form on the strength of this comment would silently open `/admin` to anonymous requests.
- **Fix**: Reword to name the actual mechanism — the OR at line 29, not membership in `PROTECTED_ROUTES`.
- **Decision**: FIXED — the comment was rewritten as part of F1 and now names the actual mechanism.
