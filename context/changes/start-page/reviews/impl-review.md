<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Start page for guest, client and staff

- **Plan**: context/changes/start-page/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-10-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Notes: deviations from the plan (user bar rebuilt here instead of S-04, logo on the bar, no company name, full-height tiles, `max-w-5xl` client pages, smoke client steps checking bar entries) are user decisions recorded in `change.md` Notes. The route gate is intact: only the deleted `/dashboard` left `PROTECTED_ROUTES`, `/` is ungated so the redirect cannot loop, and the API twins are unchanged. There is no `set:html`; the email renders auto-escaped. The `/search` link disappearing is intentional: roadmap S-01 removes the page. Gates re-run during review: lint PASS, astro check PASS (0 errors), build PASS, both greps PASS. Smoke passed on a fresh DB at 90321f2; no code changed since.

## Findings

### F1 — Stale docs after the bar rebuild

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md:53, context/foundation/roadmap.md:86
- **Detail**: CLAUDE.md still says `ClientPageLayout` provides "Topbar, logo, `Card`", but the logo now lives in `UserBar`. The roadmap's S-01 Outcome still mentions removing "its user-bar link", which S-03 already removed (the Streams row at :63 says so).
- **Fix**: Change CLAUDE.md to "Topbar (with the XEMI logo), `Card`" and drop "its user-bar link" from the S-01 Outcome.
- **Decision**: FIXED

### F2 — Audience derivation duplicated in three places

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/Topbar.astro:8-15, src/pages/index.astro:11-22, src/layouts/ClientPageLayout.astro:29-30
- **Detail**: The three derivations agree today: lookup failure, then staff, then `isClientUser`, otherwise waiting. Staff entries never reach non-staff and client entries never reach waiting accounts. But each file repeats the logic, so a future rule (e.g. a new role) has to be changed in three places, and they can drift.
- **Fix A ⭐ Recommended**: Leave it as is; extract a shared `resolveAudience(locals)` in `src/lib/services/profile.ts` when the next role-dependent view arrives (S-04/S-05).
  - Strength: No churn in a just-approved look; the three copies are short and verified.
  - Tradeoff: The duplication stays until someone touches it.
  - Confidence: MED — depends on whether S-04/S-05 add role logic.
  - Blind spot: None significant.
- **Fix B**: Extract `resolveAudience()` now and use it in all three files.
  - Strength: One source of truth right away.
  - Tradeoff: A refactor after the plan closed; needs lint, check, build and smoke again.
  - Confidence: HIGH — mechanical change.
  - Blind spot: `ClientPageLayout` distinguishes staff from waiting differently in markup, so the helper's return type must cover it.
- **Decision**: FIXED via Fix A (deferred: resolveAudience() at S-04/S-05, noted in change.md)

### F3 — Smoke start-page checks only one side

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:166-174
- **Detail**: `guestStartPage` checks that "Zaloguj się" is present and the waiting notice is absent, but not that "Wyloguj" is absent. `clientEntries` checks the client entries are present, but not that `href="/admin/tickets"` is absent. A leak of the signed-in bar or the staff entries would not fail smoke.
- **Fix**: Add `!text.includes("Wyloguj")` to `guestStartPage` and `!text.includes('href="/admin/tickets"')` to `clientEntries`.
- **Decision**: FIXED

### F4 — `aria-current` prefix match

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/UserBar.astro:57-58
- **Detail**: `currentPath.startsWith(entry.href)` would also mark an entry active on `/my-tickets-old` or `/report-errors`. No such routes exist today.
- **Fix**: Match `currentPath === entry.href || currentPath.startsWith(entry.href + "/")`.
- **Decision**: FIXED

### F5 — Kitchen sink missing a few bar states

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/dev/ui-kitchen-sink.astro:30-37
- **Detail**: All five StartPage audiences and the guest, client (active), staff and none bars are covered. Missing: staff with an active entry on the light theme (only in the dark wrapper) and client with "Moje zgłoszenia" active. The kitchen sink is the screenshot gate.
- **Fix**: Add a light staff cell with `currentPath="/admin/tickets"` and a client cell with `currentPath="/my-tickets"`.
- **Decision**: FIXED

### F6 — Step titles shortened vs. plan

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/start/StartPage.astro:20-36
- **Detail**: The plan named the steps "Otrzymaj podpowiedź albo zgłoszenie" and "Serwis rozwiązuje i odpowiedź trafia do „Moje zgłoszenia”". The tiles use shorter titles and move that meaning into the description. This is not recorded in the `change.md` Notes.
- **Fix**: Add one line to the `change.md` Notes recording the shorter titles (the copy itself stays).
- **Decision**: FIXED (note added to change.md)
