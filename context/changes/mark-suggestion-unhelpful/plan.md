# Mark Suggestion Unhelpful Implementation Plan

## Overview

A client user who got a matched suggestion (S-01 `matched` outcome) and found that it did not help can escalate the same error to service staff, with an optional comment (FR-011). The escalation files an ordinary ticket carrying the error text and the comment in `user_comment`, through the INSERT path that already exists. No migration, no new grant, no new policy.

## Current State Analysis

- A match files **no** ticket (`src/lib/services/error-resolution.ts:127-129`), so at the moment the client sees suggestions there is no ticket to update. The roadmap's S-03 risk text and the S-02 plan's *Migration Notes* both assume S-03 needs `grant update (user_comment)` plus a client UPDATE policy. That assumption is wrong for this flow: "not helpful" creates a ticket, it does not edit one.
- `authenticated` already holds column-scoped `INSERT (company_id, created_by, error_text, user_comment)` on `tickets` (`supabase/migrations/20260922120100_tickets_and_knowledge_base.sql:359`), guarded by the policy "tickets are insertable by client users for their own company" (same file, `:263-271`). `supabase/tests/rls.sql:256` pins that grant in the inventory.
- `authenticated` holds no UPDATE on `tickets` (revoked by `20261014120000`); `rls.sql:366-374` asserts denied status and company rewrites, but no check names `user_comment`.
- The staff queue already renders the comment (`src/pages/admin/tickets.astro:97-100`, `user_comment` in `QUEUE_COLUMNS`, `src/lib/services/ticket-resolution.ts:17`).
- `user_comment` never reaches the knowledge base: `resolve_ticket()` takes the error text from the ticket row and the staff-written cause/steps, so the comment needs no sanitization and is visible only to the filing company and staff.
- The server keeps no state between the `matched` response and a later click, so the escalation endpoint receives the error text back from the browser and re-validates it, exactly like `/api/resolve-error`.
- The duplicate rule (open `todo` ticket of the same caller with the same trimmed text → `already-reported`) lives inline in `resolveError()` (`error-resolution.ts:132-146`).

## Desired End State

Under a matched result on `/report-error`, a client user sees "Żadna z sugestii nie pomogła". It opens an optional comment field (max 1000 characters, with a counter) and a "Przekaż do serwisu" button. Submitting files a `todo` ticket for the error text that produced the match, with the comment in `user_comment`, or — when the user already has an open ticket with that exact text — shows "already reported" and saves nothing. The ticket appears under "Twoje zgłoszenia" and in the staff queue with the comment. Staff, unassigned and anonymous callers are rejected by the endpoint before any write.

Verify: smoke steps for the new endpoint pass, `rls.sql` passes with the new denied-update check, and the manual flow below works in the browser.

### Key Discoveries:

- INSERT of `user_comment` is already granted and policy-guarded — `20260922120100_tickets_and_knowledge_base.sql:359`, `:263-271`.
- Matched outcome files nothing — `src/lib/services/error-resolution.ts:127-129`.
- Duplicate lookup + insert to extract — `src/lib/services/error-resolution.ts:131-158`.
- Route gate pattern to copy — `src/pages/api/resolve-error.ts:23-66`.
- Staff queue already shows `userComment` — `src/pages/admin/tickets.astro:97`.
- Text limit constant lives in a dependency-free module the island imports — `src/lib/error-text.ts`.

## What We're NOT Doing

- No migration, no UPDATE grant or policy on `tickets` (the roadmap note's `update (user_comment)` is not needed for this flow).
- No per-card "not helpful" button; one button under the whole list.
- No record of which knowledge base entries were shown or rejected (no new column); staff see only the error text and comment.
- No appending a comment to an existing open ticket: with an open duplicate the new comment is not saved (the UI says so).
- No verification on the server that the text actually produced a match — a client can already file a ticket for any text through `/api/resolve-error`; escalating unmatched text grants nothing new.
- No display of the client's own comment under "Twoje zgłoszenia" (`TicketSummary` stays unchanged).
- No change to the stale `COMMENT ON COLUMN tickets.user_comment` text ("No screen writes it yet") — changing it needs a migration, which this plan avoids.
- No `MATCH_THRESHOLD` calibration (S-01 step 3.12 stays open).

## Implementation Approach

Server first, then UI, the same order as S-01 and S-02.

- **One filing path.** Extract the duplicate lookup + insert from `resolveError()` into `fileTicket()`; both the no-match fallback and the escalation call it, so the duplicate rule cannot drift between them.
- **Escalation skips the search.** `escalateUnhelpful()` validates the text (same rules and messages as `resolveError()`) and the comment, then calls `fileTicket()` directly — no embedding, no OpenAI call.
- **The island sends the text that matched**, kept in state at submit time, not the textarea's current value, which the user may have edited since.

## Phase 1: Server path — filing helper, escalation service, endpoint, smoke

### Overview

Extract the shared filing helper, add the escalation service and route, types and the comment limit, extend smoke and `rls.sql`, and document the endpoint.

### Changes Required:

#### 1. Comment limit

**File**: `src/lib/error-text.ts`

**Intent**: Add the comment limit next to the error-text limit so the island and the service share one number.

**Contract**: `export const COMMENT_MAX_LENGTH = 1000;` — counted on the trimmed comment in JS string length, same convention as `ERROR_TEXT_MAX_LENGTH`.

#### 2. Shared filing helper and escalation service

**File**: `src/lib/services/error-resolution.ts`

**Intent**: Move the "return the caller's open ticket for the same text, else insert one" block into a helper that also accepts a comment; `resolveError()` calls it with no comment and keeps its behaviour and `searchUnavailable` flag. Add `escalateUnhelpful()` for FR-011. Extract the existing empty/too-long text validation into a shared private function so both entry points return identical reasons and messages.

**Contract**:
- `fileTicket(supabase, { userId, companyId }, trimmedText, comment: string | null)` → `{ outcome: "ticket-created" | "already-reported"; ticket: TicketSummary } | null` (`null` = insert failed). Lookup error still falls through to insert ("a duplicate beats a lost report"). The duplicate lookup ignores the comment. Insert sets `user_comment` to the comment or `null`.
- `escalateUnhelpful(supabase, { userId, companyId }, rawText, rawComment)` → `Promise<EscalationResponse>`, never throws. Trim both; blank text → `empty-text`, text over `ERROR_TEXT_MAX_LENGTH` → `too-long`, comment over `COMMENT_MAX_LENGTH` → `comment-too-long` ("Komentarz może mieć najwyżej 1000 znaków."), blank comment → `null`. Insert failure → `error` ("Nie udało się przekazać zgłoszenia. Spróbuj ponownie.").

#### 3. Types

**File**: `src/types.ts`

**Intent**: Add the escalation response union next to the error-resolution types.

**Contract**:
- `EscalationSuccess = { ok: true; outcome: "ticket-created" | "already-reported"; ticket: TicketSummary }`
- `EscalationFailureReason = ErrorResolutionFailureReason | "comment-too-long"`
- `EscalationFailure = { ok: false; reason: EscalationFailureReason; error: string }`
- `EscalationResponse = EscalationSuccess | EscalationFailure`

#### 4. Endpoint

**File**: `src/pages/api/escalate-error.ts` (new)

**Intent**: `POST` that mirrors `/api/resolve-error` gate for gate — anonymous 401, profile lookup failure 500, anyone but a client user of a client company 403 `not-a-client`, missing Supabase 503 — then reads FormData fields `errorText` and `comment` (missing/non-string → empty) and calls `escalateUnhelpful()`. Not in `PROTECTED_ROUTES`: it answers 401 itself, like `/api/resolve-error` and `/api/tickets`.

**Contract**: status map adds `"comment-too-long": 400`; other reasons map as in `resolve-error.ts`. Success → 200 with `EscalationSuccess`.

#### 5. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Prove the endpoint's gates, validation, filing with a comment, the duplicate rule, and that staff see the comment. Use a distinct per-run text (`${errorText} eskalacja`) so the escalation does not collide with the resolve-error ticket that S-02 steps later resolve.

**Contract**: new helper `escalateError(as, text, comment)`; steps placed after the resolve-error block and before the S-02 block:
- anonymous → 401; staff → 403; unassigned → 403 (`not-a-client`)
- blank text → 400 `empty-text`; comment of 1001 characters → 400 `comment-too-long`
- smoke account with text + comment → 200 `ticket-created`, Alfa company, same text
- same text again with a different comment → 200 `already-reported`, same ticket id
- staff `GET /admin/tickets` → HTML contains the first comment (and not the second)

Update the header comment: each run now files **two** Klient Alfa tickets and resolves one, so the seeded ticket falls off the first page after roughly 24 runs instead of 49.

#### 6. RLS check

**File**: `supabase/tests/rls.sql`

**Intent**: Pin the decision that clients write `user_comment` only at insert time: add a denied-write check next to the existing ticket update checks.

**Contract**: `pg_temp.expect_denied('alfa: rewriting the comment on its own ticket', update public.tickets set user_comment = … where id = e101)`. Grant inventory unchanged.

#### 7. Documentation

**File**: `CLAUDE.md`

**Intent**: Add a short *Suggestion escalation (S-03)* section (endpoint, gate, the fact that it reuses the S-01 duplicate rule and the existing INSERT grant with no UPDATE path), list `escalate-error.ts` among API endpoints, and update the `npm run smoke` note (two tickets per run, reset every couple of dozen runs).

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- RLS and function checks pass, including the new denied `user_comment` update: `psql … -f supabase/tests/rls.sql` on a freshly reset database
- Smoke passes against the production preview on a freshly reset local Supabase, including the new escalation steps

#### Manual Verification:

- With `OPENAI_API_KEY` set, a paste that previously returned `ticket-created` still does, and a matched paste still files nothing (no regression from the extraction)
- `POST /api/escalate-error` as a client with a comment creates a ticket whose comment is visible to staff in `/admin/tickets`

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: UI — escalation from the matched view, roadmap fix

### Overview

Add the escalation control to the matched outcome in `ErrorResolutionPanel`, show its result, refresh "Twoje zgłoszenia", and correct the roadmap's S-03 risk text.

### Changes Required:

#### 1. Escalation control

**File**: `src/components/error-resolution/ErrorResolutionPanel.tsx`

**Intent**: Under the matched cards, replace the sentence "Jeśli poniższe wskazówki nie pomogą, skontaktuj się z zespołem serwisowym." with a "Żadna z sugestii nie pomogła" button that reveals an optional comment textarea (label "Komentarz (opcjonalnie)", hint asking what the user already tried, counter `n / 1000` turning red above the limit) and a "Przekaż do serwisu" submit. Posts FormData `errorText` + `comment` to `/api/escalate-error`; the text sent is the one submitted to `/api/resolve-error` that produced this match, kept in component state at submit time.

**Contract**:
- State: the submitted text alongside `result`; escalation pending/error/result local to the matched view. A new paste resets the escalation state.
- Submit disabled while pending or comment over the limit; server failure messages shown in the same alert style as the main form.
- `ticket-created` → "Przekazaliśmy błąd do zespołu serwisowego XEMI." (with "razem z Twoim komentarzem" when a comment was sent); `already-reported` → "Ten błąd został już zgłoszony" with the ticket date and a line that the new comment was not added. Both call `reload()` on `useMyTickets`. After success the button and form are replaced by the message, so the same match cannot be escalated twice.

#### 2. Roadmap risk text

**File**: `context/foundation/roadmap.md`

**Intent**: Rewrite the S-03 **Risk** line: S-03 files a new ticket through the existing column-scoped INSERT (`user_comment` included) because a match creates no ticket; no UPDATE grant or policy is added; point to the S-02 plan at its archived path `context/archive/2026-10-14-service-staff-ticket-resolution/plan.md`.

**Contract**: only the S-03 `- **Risk:**` line changes (status lines are owned by `/10x-implement` and `/10x-archive`).

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase

#### Manual Verification:

- After a matched paste, "Żadna z sugestii nie pomogła" opens the comment form; sending with a comment shows the confirmation and the ticket appears under "Twoje zgłoszenia" as "Do zrobienia"
- Sending without a comment works and staff see the ticket without a comment
- Escalating the same text again (from a new paste) shows "already reported" and creates no second ticket
- Editing the textarea after the match does not change the text that is escalated
- Counter turns red above 1000 characters and the submit is disabled
- Staff see the comment in `/admin/tickets`; a Klient Beta user does not see the ticket
- Polish diacritics render correctly; the form is usable at phone width

**Implementation Note**: After automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Integration Tests (smoke):

- Gates: anonymous 401, staff and unassigned 403.
- Validation: blank text, comment over 1000 characters.
- Filing: ticket-created with comment; duplicate → already-reported with the same id; staff queue HTML contains the first comment only.

### Database checks (`rls.sql`):

- Denied direct `user_comment` update on the client's own ticket.

### Manual Testing Steps:

1. Ingest or seed a knowledge base entry, paste a matching error as `alfa@klient-alfa.local`, escalate with a comment.
2. Sign in as staff, find the ticket and comment in `/admin/tickets`.
3. Paste the same error again, escalate again — "already reported", no new ticket.
4. Sign in as Klient Beta — the ticket is not visible.

## Performance Considerations

None: escalation is one indexed lookup and one insert, with no OpenAI call.

## Migration Notes

- No migration; nothing to apply to the hosted project before merge.
- Rollback: the previous Worker simply lacks the endpoint; tickets filed with a comment remain valid rows.

## References

- Roadmap item: `context/foundation/roadmap.md` — S-03
- PRD: `context/foundation/prd.md` — FR-011
- Previous plans: `context/archive/2026-09-25-first-gated-error-resolution/plan.md`, `context/archive/2026-10-14-service-staff-ticket-resolution/plan.md` (*Migration Notes*, S-03 note superseded here)
- Similar implementation: `src/pages/api/resolve-error.ts`, `src/lib/services/error-resolution.ts:131-158`
- Lessons: `context/foundation/lessons.md` — "Assert the denied write on every RLS surface" (applied as the `user_comment` denied-update check)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server path — filing helper, escalation service, endpoint, smoke

#### Automated

- [x] 1.1 Type-check passes: `npx astro sync && npx astro check`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Production build passes: `npm run build`
- [x] 1.4 RLS and function checks pass, including the new denied `user_comment` update: `psql … -f supabase/tests/rls.sql` on a freshly reset database
- [x] 1.5 Smoke passes against the production preview on a freshly reset local Supabase, including the new escalation steps

#### Manual

- [x] 1.6 With `OPENAI_API_KEY` set, a paste that previously returned `ticket-created` still does, and a matched paste still files nothing (no regression from the extraction)
- [x] 1.7 `POST /api/escalate-error` as a client with a comment creates a ticket whose comment is visible to staff in `/admin/tickets`

### Phase 2: UI — escalation from the matched view, roadmap fix

#### Automated

- [ ] 2.1 Type-check passes: `npx astro sync && npx astro check`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Production build passes: `npm run build`
- [ ] 2.4 Smoke passes against the production preview on a freshly reset local Supabase

#### Manual

- [ ] 2.5 After a matched paste, "Żadna z sugestii nie pomogła" opens the comment form; sending with a comment shows the confirmation and the ticket appears under "Twoje zgłoszenia" as "Do zrobienia"
- [ ] 2.6 Sending without a comment works and staff see the ticket without a comment
- [ ] 2.7 Escalating the same text again (from a new paste) shows "already reported" and creates no second ticket
- [ ] 2.8 Editing the textarea after the match does not change the text that is escalated
- [ ] 2.9 Counter turns red above 1000 characters and the submit is disabled
- [ ] 2.10 Staff see the comment in `/admin/tickets`; a Klient Beta user does not see the ticket
- [ ] 2.11 Polish diacritics render correctly; the form is usable at phone width
