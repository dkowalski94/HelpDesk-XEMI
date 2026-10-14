<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Gated Error Resolution Implementation Plan

- **Plan**: context/changes/first-gated-error-resolution/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence

- Diff (commit 25f5c40): `astro.config.mjs`, `.env.example`, `src/lib/openai.ts`, `src/lib/error-text.ts`, `src/types.ts`, `src/lib/services/error-resolution.ts`, `src/pages/api/resolve-error.ts`, `src/pages/api/tickets.ts`, `src/lib/services/tickets.ts`, `scripts/smoke.mjs`, `CLAUDE.md`, plus `plan.md` checkboxes — exactly the files Phase 2 plans; nothing missing, nothing unplanned.
- Plan drift check: all nine "Changes Required" sections MATCH (gate order 401 → 500 → 403 → 503 before any OpenAI call; RPC threshold 0 with `MATCH_THRESHOLD` applied in TS; best similarity logged on every search; every search failure collapses to "unavailable"; dedupe lookup and insert columns as contracted; `searchUnavailable` on both ticket outcomes; Polish error strings; `?mine=1` only on the exact value `"1"`). Phase 1 review follow-up honoured: `MatchRow` widens `cause`/`steps` to `string | null`. Only extra: smoke also asserts `ticket.errorText` — harmless.
- Non-goals respected: no retries, no SDK, no caching, no CI OpenAI stub/secret, no RLS change, no DB uniqueness constraint, no seeded embeddings.
- Tenancy: `company_id`/`created_by` come from `locals`, never from the form; the tickets INSERT policy and column grant enforce the same. `src/lib/error-text.ts` is dependency-free; nothing client-side can reach `astro:env/server`.
- Automated criteria, run 2026-10-13: `npx astro sync && npx astro check` → 0 errors/0 warnings/0 hints; `npm run lint` → 0 errors, 13 `no-console` warnings (6 new in `error-resolution.ts`, consistent with the other services' logging; the similarity log is plan-mandated); `npm run build` → Complete. `rls.sql` and smoke **not re-run** — Docker Desktop not running (see F2).
- Manual criteria 2.6/2.7 are ticked; commit message records the evidence (best similarity 0.6449 / 0.5818 matched, 0.4629 in-doc and 0.4123 unrelated → ticket).

## Findings

### F1 — Non-string `errorText` / non-form body escapes as an HTML 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/resolve-error.ts:56-57
- **Detail**: `form.get("errorText") as string | null` is a cast, not a check: a multipart request with `errorText` as a file passes a `File` into `resolveError`, where `rawText.trim()` (`error-resolution.ts:109`) throws — breaking the "never throws to the route" contract and returning an unhandled 500 instead of the JSON union. Likewise `request.formData()` throws on a non-form body. Only reachable by hand-crafted requests; `assign-company.ts:16` already uses a `typeof` check.
- **Fix**: `const value = form.get("errorText"); const errorText = typeof value === "string" ? value : "";` and wrap `formData()` in try/catch returning 400 `empty-text`.
- **Decision**: FIXED — typeof check + try/catch around formData() (non-form body → 400 empty-text)

### F2 — RLS and smoke checks not re-verified in this review

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (plan Progress 2.4, 2.5)
- **Detail**: Docker Desktop was not running, so `supabase/tests/rls.sql` and `npm run smoke` against a freshly reset local Supabase could not be re-run. Both are ticked with 25f5c40 and CI's smoke job runs them on push, but they were not independently confirmed here.
- **Fix**: Start Docker, `npx supabase db reset`, run `rls.sql`, then `npm run build && npm run preview` + `npm run smoke` before pushing.
- **Decision**: FIXED — 2026-10-13, on a freshly reset local Supabase with F1+F5 applied: `rls.sql` exit 0 (146 checks ok), `npm run build` complete, `npm run smoke` all 38 steps passed; F1 also checked by hand (JSON body and file upload → 400 `empty-text`)

### F3 — Pre-push deployment gates for 25f5c40 unconfirmed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: plan.md Migration Notes
- **Detail**: `master` is 1 commit ahead of `origin/master`; pushing deploys the Worker that calls `match_knowledge_base`. The plan requires migration `20260925120000` on the hosted project and `OPENAI_API_KEY` as a Worker secret before that push. Without either, production degrades silently: every paste becomes a ticket with `searchUnavailable: true`. Neither is verifiable from the repo.
- **Fix**: Before `git push`: `npx supabase db push --dry-run` (expect nothing pending, or push it) and `npx wrangler secret list` shows `OPENAI_API_KEY`.
- **Decision**: ACCEPTED — pre-push gate owned by the user: `npx supabase db push --dry-run` + `npx wrangler secret list` (OPENAI_API_KEY) before `git push`

### F4 — Thin threshold margin; an in-document error fell to a ticket

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/lib/services/error-resolution.ts (`MATCH_THRESHOLD`)
- **Detail**: Recorded similarities: matched 0.6449 / 0.5818; an error that *is* explained in the PDF ("bufor") scored 0.4629 and filed a ticket; an unrelated sentence scored 0.4123. The gap between a real miss and noise is ~0.05, so a single threshold may not separate them. This is exactly Phase 3 check 3.12 — not a Phase 2 defect, but the data already exists.
- **Fix**: Keep 0.5 for now and treat 3.12 as a real calibration step with more samples (≥5 real, ≥5 unrelated). · Strength: decision based on data rather than 4 points. · Tradeoff: defers the decision to Phase 3. · Confidence: MED — 4 data points is too few to move the knob responsibly. · Blind spot: chunking quality may be the real cause, which is out of scope per "What We're NOT Doing".
- **Decision**: SKIPPED — deferred to Phase 3 check 3.12: keep 0.5, calibrate on ≥5 real and ≥5 unrelated samples

### F5 — Logging noise and masked key fragment in logs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/error-resolution.ts:38, 43; src/lib/openai.ts:51
- **Detail**: Missing key (a supported configuration) logs at `console.error` on every paste. On OpenAI 401 the full error body is logged, which echoes a masked key fragment (`sk-…abcd`) into Worker logs. Same pattern as `exa.ts`.
- **Fix**: Log missing key with `console.warn`; keep only `status` + OpenAI error `code` in `OpenAIRequestError.detail`.
- **Decision**: FIXED — missing key logs via console.warn; OpenAIRequestError.detail keeps only OpenAI's error code/type, never the message

### F6 — No rate limit on a credit-spending endpoint

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/resolve-error.ts
- **Detail**: Any client user can loop requests; each costs one embeddings call and may file a ticket. The plan does not require a limit and per-call cost is small; dedupe limits ticket spam for identical text only.
- **Fix**: Accept as risk for MVP; revisit with a Cloudflare rate-limiting rule if abuse appears.
- **Decision**: ACCEPTED — risk accepted for MVP; add a Cloudflare rate-limiting rule if abuse appears
