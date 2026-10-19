<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Service Staff Ticket Resolution

- **Plan**: context/changes/service-staff-ticket-resolution/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-19
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Drift check: every planned change is a MATCH; no DRIFT, no MISSING. Extras are defensive and harmless
(UUID check and early `already-resolved` in `resolveTicket`, `missing-fields`/`not-configured` codes,
`StaffQueueResult`/`BackfillEmbeddingsResult` types, additional smoke and `rls.sql` steps).

Success criteria re-run on 2026-10-19: `rls.sql` passes on a freshly reset database; smoke passes
against the production preview. Type-check, lint and build passed in Phase 3 on the same code. All
manual items are confirmed by the user.

## Findings

### F1 — Staff-written cause and steps reach other companies unsanitized

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/ticket-resolution.ts:130-135
- **Detail**: Only `error_text` is sanitized. `p_steps` and `p_cause` go verbatim into both the ticket and the shared KB entry, which `match_knowledge_base` shows to every client company. A staff member writing "nadaj uprawnienia KOWALSKI DAWID w Klient Alfa, FV/12/2026" leaks exactly what the error-text sanitizer exists to hide. The plan never considered the cause and steps as a cross-tenant surface.
- **Fix A ⭐ Recommended**: New migration giving `resolve_ticket()` separate `p_kb_cause`/`p_kb_steps` for the KB row; the service passes the raw text for the ticket and `sanitizeErrorText(…, companyName)` for the KB, and the page previews both.
  - Strength: The filing client keeps the unmasked answer on its own ticket; other companies get the masked one — same split as `error_text`.
  - Tradeoff: Migration + types + `rls.sql` + preview; must be pushed to production before merge.
  - Confidence: HIGH — mirrors the existing `p_kb_error_text` pattern.
  - Blind spot: Masking may garble steps that legitimately contain all-caps phrases or 5+ digit values.
- **Fix B**: Accept as risk and add a UI hint on the form ("Nie wpisuj danych klienta — rozwiązanie zobaczą inne firmy").
  - Strength: No schema change; staff are trusted and write the text deliberately.
  - Tradeoff: Relies on discipline; nothing enforces it.
  - Confidence: MED — depends on staff habits.
  - Blind spot: Copy-pasted client data in steps.
- **Decision**: FIXED — Fix A: migration 20261019120000 recreates resolve_ticket() with p_kb_steps/p_kb_cause; service passes sanitizeResolutionText() copies; page previews them in a <script>; rls.sql asserts the entry gets the sanitized copies and the ticket the originals.

### F2 — Staff can still rewrite KB text directly, bypassing the sanitizer

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_erp_document_ingestion.sql:465-467 (kept by 20261014120000)
- **Detail**: `authenticated` keeps `update (id, error_text, cause, steps, embedding, source_ticket_id, source_company_id, created_at, updated_at)` on `knowledge_base_entries`, and the S-02 policy lets staff update any `ticket` entry. A direct PostgREST call can replace a sanitized `error_text` with raw text or repoint `source_company_id`/`source_ticket_id`. The plan states "staff cannot change the sanitized KB text", but only the UI enforces it; the backfill needs `embedding` alone.
- **Fix**: New migration revoking that UPDATE grant and re-granting `update (embedding)` only (plus `updated_at` if a trigger needs it), with the `rls.sql` column inventory and a denied `error_text` update added in the same change.
  - Strength: Makes the plan's "no edit" decision a database property, like `resolve_ticket()` already does for INSERT.
  - Tradeoff: One more migration to push before merge.
  - Confidence: HIGH — backfill is the only app writer (`ticket-resolution.ts:203-207`).
  - Blind spot: Check that no ingestion path relies on the direct grant (F-02 writes through definer functions).
- **Decision**: FIXED — same migration: UPDATE on knowledge_base_entries revoked and re-granted on (embedding) only; rls.sql inventory updated and denied error_text/steps/source_company_id updates asserted.

### F3 — Company name masked last and only with exact spacing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/sanitize-error-text.ts:66-70
- **Detail**: Rule 8 runs after the number rules, so a name containing 5+ digits or a document-like token (e.g. "Firma 12345") is already partly replaced and no longer matches; a double space or a line break inside the name also defeats the literal match. A mixed-case name then is not caught by rule 9 either.
- **Fix**: Mask the company name first, with whitespace runs in the name matched as `\s+`.
- **Decision**: FIXED — company name masked first, words joined by \s+ (sanitize-error-text.ts).

### F4 — Backfill `filled` overcounts under concurrent clicks

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/ticket-resolution.ts:203-213
- **Detail**: The guarded update can match 0 rows when another backfill won, but `filled++` still runs. Nothing is overwritten; only the displayed number and one wasted OpenAI call per row are affected.
- **Fix**: Add `.select("id")` to the update and count only rows actually returned.
- **Decision**: FIXED — update returns .select("id") and filled counts returned rows; unavailable now keyed on an embedding failure.

### F5 — Backfill worst case is 20 sequential 8 s calls

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/ticket-resolution.ts:197-214
- **Detail**: With OpenAI slow but not failing, one click can take ~160 s. Waiting on `fetch` does not count against Workers CPU time and the batch stays under the subrequest limit, so the plan's bound holds; the cost is a long spinner.
- **Fix**: Accept; revisit only if staff report it.
- **Decision**: ACCEPTED — waiting on fetch is not Workers CPU time and the batch stays under the subrequest limit; revisit if staff report it.

### F6 — Roadmap S-03 risk text is stale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:142
- **Detail**: It still says `tickets` grants `authenticated` UPDATE on `(status, resolution, resolved_by, resolved_at)`. After this change there is no `authenticated` UPDATE on `tickets` at all (plan, Migration Notes), so the next S-03 agent would plan against a grant that no longer exists. (S-02's own `in-progress` status is flipped by `/10x-archive`.)
- **Fix**: Rewrite the S-03 risk text: S-03 must grant `update (user_comment)` with its own client-scoped policy, as no ticket UPDATE grant remains.
- **Decision**: FIXED — roadmap S-03 risk text rewritten for the no-UPDATE-on-tickets state.
