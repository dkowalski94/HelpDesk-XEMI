<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Mark Suggestion Unhelpful

- **Plan**: context/changes/mark-suggestion-unhelpful/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan adherence: every planned change is MATCH (153585e, 1b5795d); `resolveError()` behaviour is unchanged after the extraction; the island escalates the submitted text, a new paste resets the escalation, and a successful escalation cannot be resubmitted. No EXTRA files.

Success criteria: `astro check` 0 errors, lint 0 errors, build, smoke and `rls.sql` all passed during implementation on a freshly reset database. A re-run of `rls.sql` at review time failed only its seed-only control count ("expected 2 row(s), got 3") because the local database holds smoke and manual-test data — the documented CLAUDE.md caveat, not a regression. All manual rows confirmed by the user.

## Findings

### F1 — Comment counter and server limit count line breaks differently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/error-resolution.ts:194, src/components/error-resolution/ErrorResolutionPanel.tsx:226
- **Detail**: The island counts `comment.trim().length` on the textarea value (LF line breaks), but a multipart `FormData` body normalizes LF to CRLF on the wire, so the server counts one extra character per line break. A multi-line comment the counter shows as valid near the limit gets 400 `comment-too-long`. The same mismatch already exists for `errorText` (S-01); the 1000 limit makes it easier to hit. Smoke posts urlencoded single-line comments, so it cannot catch it.
- **Fix**: Normalize `\r\n` to `\n` on the server before counting and storing, in `checkErrorText` and for the comment.
- **Decision**: FIXED — `normalizeLineBreaks()` in error-resolution.ts applied to the error text (both entry points) and the comment; astro check, eslint, build and smoke (fresh reset) pass.

### F2 — Migration comments still describe an S-03 UPDATE grant

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20261014120000_ticket_resolution.sql:23-25, supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:116-117
- **Detail**: Migration `20261014120000` says S-03 "adds its own client-scoped column grant and policy", and the `tickets.user_comment` column comment says "No screen writes it yet". S-03 writes the comment at insert time only and adds no grant (documented in CLAUDE.md and the plan's "What We're NOT Doing"). Applied migrations are immutable.
- **Fix**: Accept; update the column comment with `comment on column` in the next migration that has its own reason to exist.
- **Decision**: ACCEPTED — migrations are immutable; update the user_comment column comment in the next migration that exists for its own reason.

### F3 — Duplicate check is SELECT-then-INSERT

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/error-resolution.ts:121-143
- **Detail**: No partial unique index on `(created_by, error_text) where status = 'todo'`, so two concurrent requests (two tabs, or resolve-error and escalate at once) can file two tickets. The island blocks double submits. Inherited from S-01, whose comment accepts it ("a duplicate beats a lost report").
- **Fix**: Accept as risk.
- **Decision**: ACCEPTED — inherited from S-01 ("a duplicate beats a lost report"); the island blocks double submits.

### F4 — Comment limit is app-only, not a DB CHECK

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/escalate-error.ts
- **Detail**: The endpoint adds no new capability (the direct column-scoped INSERT including `user_comment` already exists), but neither the 1000-character comment limit nor the 2000-character error-text limit is enforced in the database, so a direct PostgREST insert bypasses both. Flooding only lengthens the oldest-first staff queue.
- **Fix**: Accept; add `check (char_length(user_comment) <= 1000)` in a future migration if needed.
- **Decision**: ACCEPTED — no new capability; add CHECK constraints on user_comment/error_text length in a future migration if needed.
