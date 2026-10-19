<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Service Staff Ticket Resolution

- **Plan**: context/changes/service-staff-ticket-resolution/plan.md
- **Mode**: Deep
- **Date**: 2026-10-14
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
8/8 paths ✓, 7/7 symbols ✓, brief↔plan ✓

Deep verification also confirmed:
- `STAFF_ROUTES` already gates `/admin/tickets` and `/api/admin/*`, and nothing in `public/` or any `prerender` bypasses it.
- No code in `src/` or `scripts/` writes `tickets` or `knowledge_base_entries` through an `authenticated` session, apart from the kept ticket INSERT.
- Adding fields to `TicketSummary` breaks no smoke assertion.

## Findings

### F1 — Nullable RPC args won't type-check

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 → Phase 2 §2
- **Detail**: `supabase gen types` types every function argument without a DEFAULT as required and non-null (`src/database.types.ts:335-366`), so passing `null` for `p_cause` / `p_embedding` would fail `astro check`.
- **Fix**: Move both parameters last with `default null`; the service omits them instead of passing null.
- **Decision**: FIXED

### F2 — rls.sql: two existing checks change semantics

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §2
- **Detail**: After the revokes, `rls.sql:377` (`expect_rows(…,0)`) and `:599` (`expect_check_violation`) get 42501 instead. The grant inventory needs `:248-257` and `:275-278` removed and `EXECUTE resolve_ticket` added. The comment at `:586-588` becomes stale.
- **Fix**: List these edits explicitly in Phase 1 §2.
- **Decision**: FIXED

### F3 — Smoke: ticket must be on queue page 1

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §5
- **Detail**: The queue is oldest-first, 50 per page, and the smoke ticket is the newest `todo`. About 48 or more unresolved leftovers (failed runs, the backlog from before this change) push it to page 2.
- **Fix**: Note in Phase 2 §5 that the check relies on every successful run resolving its own ticket, with `db reset` as the remedy.
- **Decision**: FIXED

### F4 — No phase updates CLAUDE.md

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3
- **Detail**: S-02 adds endpoints, a page, `resolve_ticket()`, the sanitizer and a one-write-path rule, and changes the smoke behaviour. CLAUDE.md documents the equivalents for S-01 and F-02.
- **Fix**: Add Phase 3 §4 covering the CLAUDE.md section, the endpoint list and the smoke description.
- **Decision**: FIXED
