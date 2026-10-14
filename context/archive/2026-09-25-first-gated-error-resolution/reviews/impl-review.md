<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Gated Error Resolution Implementation Plan

- **Plan**: context/changes/first-gated-error-resolution/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

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

- Diff `38ab5f3^..HEAD`: 19 files outside `context/`, exactly the files the three phases plan; nothing missing, nothing unplanned.
- Plan drift: every planned change MATCH, including cross-phase checks (the island handles all three outcomes and every failure reason via `payload.error`; it imports only `error-text`, `utils`, the hook and type-only `@/types`; Phase 3 smoke steps are read-only, so seeded personas never change). Post-review decisions from the Phase 2 triage (F1 non-form body, F5 log hygiene) and the deferred calibration comment at `MATCH_THRESHOLD` are implemented as recorded.
- Safety: definer function hardened per lessons (owner postgres, EXECUTE revoked from public/anon, count clamped 1..10, no embedding/provenance columns); no `dangerouslySetInnerHTML`/`set:html`; gates 401 → 500 → 403 before any OpenAI call; ticket insert still pinned by RLS. Dedupe race is the plan's documented non-goal ("What We're NOT Doing") — not reported.
- Automated criteria, 2026-10-13 at `0d719b4`: `astro check` 0 errors/0 warnings; `npm run lint` 0 errors (13 pre-existing `no-console` warnings); `npm run build` Complete. `rls.sql` **fails** on the current local DB — see F2; it passed on a fresh reset during Phase 2 triage and no SQL changed since. Smoke not re-run (dev server in use for manual testing); it passed at the Phase 3 gate on code identical except for a comment, and the break-check proved the new gate step bites.
- Manual: 3.5–3.11 and 3.13 confirmed by the user; 3.12 (calibration) deliberately left open — deferred, rationale in `change.md`.

## Findings

### F1 — Non-JSON error responses shown as "could not reach the server"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/error-resolution/ErrorResolutionPanel.tsx:117-118; src/hooks/useMyTickets.ts:9-11
- **Detail**: Both call `response.json()` without checking `response.ok` or content type. A non-JSON error page (Cloudflare 502/524, an HTML 500) throws on parse and the user sees "Nie udało się połączyć z serwerem" although the server was reached. `WebSearchPanel.tsx` does the same, so it is consistent with the existing pattern — only the message is misleading.
- **Fix**: On a parse failure with a non-ok response, show a Polish "server error, try again later" line instead of the network-failure line.
- **Decision**: FIXED — panel and hook parse with `response.json().catch(() => null)`; an unreadable body shows a Polish server-error line, a thrown `fetch` keeps the network line

### F2 — `rls.sql` fails after the plan's own manual-testing step (local PDF ingest)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls.sql (`knowledge_base_public returns the shared entries (control)`); CLAUDE.md (rls.sql command)
- **Detail**: The script's control counts assume a seed-only database: after `npm run ingest` of one PDF (Manual Testing Steps, step 1) it fails with "expected 2 row(s), got 58". Not a code defect — `db reset` fixes it — but nothing tells a developer that, so a red `rls.sql` after manual testing looks like an RLS regression.
- **Fix**: Note in CLAUDE.md next to the `rls.sql` command that it expects a seed-only database (`npx supabase db reset` first; ingested docs or smoke-run tickets change its counts).
- **Decision**: FIXED — CLAUDE.md notes next to the rls.sql command that it needs a seed-only database (`npx supabase db reset` first)

### F3 — Ticket column list and row mapping duplicated across services

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/error-resolution.ts:23, 88-102 vs src/lib/services/tickets.ts:30, 47-53
- **Detail**: The `select` column list and the row → `TicketSummary` mapping are copied rather than shared; a column added to `TicketSummary` later can drift in one copy.
- **Fix**: Export `TICKET_COLUMNS` and `toTicketSummary` from `tickets.ts` and import them in `error-resolution.ts`.
- **Decision**: FIXED — `TICKET_COLUMNS` and `toTicketSummary` exported from `src/lib/services/tickets.ts`, used by both services; smoke passed after the change

### F4 — "Already reported" ignores inner whitespace and line-ending differences

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/error-resolution.ts:233
- **Detail**: Dedupe compares the text trimmed at the ends only. The same error pasted with CRLF vs LF or different inner spacing files a second ticket. Matches the plan's "identical (trimmed) text" contract, so it is behaviour, not drift.
- **Fix**: Skip for MVP; if duplicates appear, normalise line endings and inner whitespace before storing and comparing.
- **Decision**: SKIPPED — matches the plan's trimmed-text contract; revisit only if duplicates appear
