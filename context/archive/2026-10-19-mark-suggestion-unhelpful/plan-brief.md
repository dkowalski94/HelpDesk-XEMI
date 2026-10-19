# Mark Suggestion Unhelpful — Plan Brief

> Full plan: `context/changes/mark-suggestion-unhelpful/plan.md`

## What & Why

A client user who got a matched suggestion from the knowledge base and found it did not help can hand the error over to service staff, optionally with a comment (FR-011, roadmap S-03). Without it, a wrong match is a dead end: the matched view files no ticket and only says "contact the service team".

## Starting Point

S-01 returns up to 3 matched entries and files no ticket on a match; S-02 gives staff a queue that already displays `user_comment`. `authenticated` already holds column-scoped INSERT on `tickets` including `user_comment`, guarded by the client-only insert policy, and holds no UPDATE at all.

## Desired End State

Under a matched result, "Żadna z sugestii nie pomogła" opens an optional comment field and "Przekaż do serwisu". It files a `todo` ticket with the matched error text and the comment, or reports "already reported" when the user has an open ticket with the same text. The ticket shows under "Twoje zgłoszenia" and, with the comment, in the staff queue.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Write path | New ticket via the existing INSERT; no migration | A match creates no ticket, so there is nothing to update — the roadmap's `update (user_comment)` assumption does not apply. |
| Granularity | One button under all matched cards | A ticket is about the error, not an entry; one click = one ticket. |
| Comment | Optional, max 1000 characters (trimmed) | Fastest escalation; a blank comment is stored as `null`. |
| Open duplicate | Return `already-reported`, new comment not saved | Same rule as S-01, no client UPDATE path, no duplicate in the staff queue. |
| Track rejected entries | No | No schema change; staff see the error text and comment only. |
| Search on escalation | Skipped | The user has already seen the matches; no OpenAI call. |
| Text sent | The text that produced the match, kept in state | The textarea may have been edited after the match. |
| Shared logic | `fileTicket()` extracted from `resolveError()` | The duplicate rule cannot drift between fallback and escalation. |

## Scope

**In scope:** `fileTicket()` + `escalateUnhelpful()`, `POST /api/escalate-error`, `EscalationResponse` types, `COMMENT_MAX_LENGTH`, smoke steps, one denied-update check in `rls.sql`, CLAUDE.md, the escalation UI in `ErrorResolutionPanel`, the S-03 risk text in the roadmap.

**Out of scope:** migrations and UPDATE grants, per-card buttons, recording which entries were rejected, appending to an existing ticket, showing the comment to the client, server-side proof that a match happened, `MATCH_THRESHOLD` calibration.

## Architecture / Approach

Island (matched view) → `POST /api/escalate-error` (FormData `errorText`, `comment`; same gate as `/api/resolve-error`) → `escalateUnhelpful()` validates → `fileTicket()` looks up the caller's open ticket with the same text, else inserts with `user_comment` on the caller's session, so RLS enforces company and author.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server path | Helper extraction, service, endpoint, types, smoke, `rls.sql` check, docs | Extraction regresses S-01's fallback or duplicate rule |
| 2. UI | Escalation control in the matched view, result messages, roadmap fix | Escalating edited textarea content instead of the matched text |

**Prerequisites:** S-01 and S-02 landed (they have); local Supabase for smoke and `rls.sql`.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- A client can escalate any text, matched or not — accepted: `/api/resolve-error` already lets them file a ticket for any unmatched text.
- Smoke now files two Alfa tickets per run, so the seeded ticket falls off the first `/api/tickets` page after ~24 runs; reset more often.
- The column comment on `tickets.user_comment` stays stale ("No screen writes it yet") because changing it needs a migration.

## Success Criteria (Summary)

- A client whose suggestion did not help can reach the service team in two clicks, with or without a comment.
- Staff see the escalated error and the comment in their queue; other companies never do.
- No new write privilege on `tickets` exists after the change.
