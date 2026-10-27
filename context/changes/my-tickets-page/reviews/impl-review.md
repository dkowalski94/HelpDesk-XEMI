<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: "Moje zgłoszenia" as a Separate Page

- **Plan**: context/changes/my-tickets-page/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Offset past the end shows "no tickets" and has no way back

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/my-tickets.astro:14-33
- **Detail**: The offset is clamped only to `MAX_SAFE_INTEGER`. With `?offset=1000` and 10 tickets, the page shows the empty-account message "Nie masz jeszcze żadnych zgłoszeń.", which is wrong for a user who has tickets. The only link back is "Nowsze zgłoszenia", and it steps back 50 at a time (950, 900, …). Near `MAX_SAFE_INTEGER`, `offset + limit` also loses precision. The page is reachable only through a hand-edited URL, but it is the page's only edge case with misleading text.
- **Fix A ⭐ Recommended**: When `offset > 0` and the page is empty, redirect to `/my-tickets`.
  - Strength: A single branch in the page frontmatter (`Astro.redirect`). No new text, no change to the list component, and the empty message stays true.
  - Tradeoff: Costs one extra round trip on a URL the UI never produces itself.
  - Confidence: HIGH. `nextOffset` is non-null only when a further row exists, so the UI's own links never land on an empty page.
  - Blind spot: A ticket deleted between two clicks could still produce a redirect. That is harmless.
- **Fix B**: Show a separate message, "Brak zgłoszeń na tej stronie", with a link to the first page.
  - Strength: The URL stays as typed and the user sees why the page is empty.
  - Tradeoff: Needs a new state in `MyTicketsList` plus a kitchen-sink cell, so it touches the UI contract.
  - Confidence: MED. It is more code for a case that is reached only by hand.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A)

### F2 — The client-audience rule is written twice (page and layout)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/my-tickets.astro:10-12, src/layouts/ClientPageLayout.astro:27-28
- **Detail**: Both files repeat `profile.role === "client_user" && profile.companyKind === "client"`. The page uses it to decide whether to query; the layout uses it to decide whether to render the slot. If one changes without the other, the page could query for an audience the layout hides, or show the error state to a valid client.
- **Fix**: Extract `isClientUser(profile)` to `src/lib/` and use it in both files.
- **Decision**: FIXED: `isClientUser()` in `src/lib/services/profile.ts`, used by both files. `dashboard.astro` and the API `not-a-client` gates keep their inline checks, which are outside this change.

### F3 — Unplanned extras (intro text, CLAUDE.md prettier churn, api/tickets.ts comment)

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/my-tickets.astro:40, CLAUDE.md, src/pages/api/tickets.ts:10-12
- **Detail**: Three changes go beyond the plan:
  - The intro hint on /my-tickets.
  - Prettier changed `*x*` to `_x_` in unrelated CLAUDE.md lines.
  - A stale comment was corrected in `api/tickets.ts`, with no code change.
  All three are harmless and consistent with the change.
- **Fix**: Accept them as they are (no change).
- **Decision**: ACCEPTED: all three extras stay as they are.

### F4 — Unused default heading in MyTicketsList

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/error-resolution/MyTicketsList.tsx:34
- **Detail**: The `heading = "Twoje zgłoszenia"` default, together with its h2 and top-rule branch, has no remaining caller. /my-tickets and every kitchen-sink cell pass `heading={null}`.
- **Fix**: Drop the `heading` prop and make `aria-label="Lista zgłoszeń"` unconditional.
- **Decision**: FIXED: the `heading` prop and its h2 branch are removed, and `heading={null}` is dropped from `my-tickets.astro` and `KitchenSink.tsx`.

### F5 — Staff message "Konto serwisowe nie zgłasza błędów." reads oddly on /my-tickets

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/layouts/ClientPageLayout.astro:50-52
- **Detail**: The plan kept the staff text verbatim; smoke only matches its first sentence, "Ta strona jest przeznaczona dla użytkowników klienta". On /my-tickets the second sentence is slightly off-topic.
- **Fix**: Make the second sentence generic, for example "Konto serwisowe nie ma własnych zgłoszeń klienta." Smoke still passes, because it checks only the first sentence.
- **Decision**: FIXED: the second sentence now reads "Konto serwisowe nie zgłasza błędów i nie ma własnych zgłoszeń." and fits both pages.

### F6 — CLAUDE.md understates how often smoke needs a DB reset

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: CLAUDE.md (Commands → `npm run smoke`)
- **Detail**: CLAUDE.md says to reset roughly every 24 runs. With `OPENAI_API_KEY` set, the ticket that one run resolves becomes a knowledge-base entry. The next run's error text is then matched against it (similarity 0.89), no ticket is filed, and 15 steps fail. Observed in this session: the second run without a reset failed.
- **Fix**: Change the smoke note in CLAUDE.md to say that a reset is needed before every run when `OPENAI_API_KEY` is set.
- **Decision**: FIXED: the CLAUDE.md smoke note now says to reset before every run when `OPENAI_API_KEY` is set.
