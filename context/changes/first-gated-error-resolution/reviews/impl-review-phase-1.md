<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: First Gated Error Resolution Implementation Plan

- **Plan**: context/changes/first-gated-error-resolution/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-09-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- Diff (commit 38ab5f3): `supabase/migrations/20260925120000_match_knowledge_base.sql`, `supabase/tests/rls.sql`, `src/database.types.ts` — exactly the three files Phase 1 plans; no unplanned code files.
- Migration body matches the plan's contract snippet verbatim (definer, `stable strict`, `search_path = ''`, `operator(extensions.<=>)`, clamp 1..10, threshold outside the index-ordered subquery, owner `postgres`, revoke `public, anon`, grant `authenticated`, comment).
- `rls.sql` covers every contracted check (ordering and exact similarities, threshold, orthogonal query, null-embedding exclusion, clamp 3/1000/0, unassigned → 0, staff control, anon denied, result-signature pin, `stable`/definer/owner pin, grant inventory, fixture comment), all under a rolled-back savepoint. The function is read-only (`stable`, `language sql` select), so there is no write path to deny.
- `EXPLAIN` of the function's inner query (with `enable_seqscan = off`) shows `Index Scan using knowledge_base_entries_embedding_idx … Order By: (embedding <=> …)` — the HNSW index is reachable with the schema-qualified operator.
- Automated criteria, run 2026-09-25: `npx supabase db reset` OK; `rls.sql` → "All RLS negative checks passed"; `match_knowledge_base` present in `src/database.types.ts` (ASCII/UTF-8); `astro check` 0 errors/0 warnings/0 hints; `npm run lint` 0 errors, 7 `no-console` warnings, all in pre-existing files outside this phase.

## Findings

### F1 — Generated RPC types declare `cause`/`steps` non-null

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/database.types.ts:341-346
- **Detail**: `supabase gen types` types every column of a `returns table (…)` function as non-null, so `match_knowledge_base` returns `cause: string; steps: string`. At runtime `cause` is `null` for every `erp_doc` fragment (and both columns are nullable on `knowledge_base_entries` — the test inserts f201 without them). Phase 2's `KnowledgeMatch` correctly plans `cause: string | null; steps: string | null`, but a mapper that trusts the generated row type will compile a `.trim()`/`.length` on `cause` without complaint and crash or render "null" in Phase 3 for documentation matches.
- **Fix**: In Phase 2's mapping to `KnowledgeMatch`, type the RPC rows with `cause`/`steps` as `string | null` (a local row type or `?? null`), and add one line to plan Phase 2 §5 noting the generated type is wrong on nullability.
- **Decision**: FIXED — nullability note added to plan Phase 2 §5 step 2; the code change lands with Phase 2.

### F2 — Migration commit sits on local `master`; push deploys before `db push`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260925120000_match_knowledge_base.sql (commit 38ab5f3, `master…origin/master [ahead 1]`)
- **Detail**: The plan's Migration Notes and CLAUDE.md gate the hosted `db push` on "before merging to `master`", but the phase was committed directly on `master`, so the gate is now "before `git push`" — a push triggers `wrangler deploy`. Harmless for Phase 1 alone (no Worker code calls the function), but once Phase 2 lands on the same branch, a push without `db push` deploys a Worker whose every paste hits an RPC error and silently degrades to "ticket, search unavailable".
- **Fix**: Run `npx supabase db push --dry-run` / `npx supabase db push` against the hosted project before the next `git push` of this branch (or move the remaining phases to a feature branch so the PR-merge gate applies as written).
- **Decision**: FIXED — plan Migration Notes now gate `db push` on the next `git push`; the hosted `db push` itself is left to the user.
