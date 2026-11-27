<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UI consistency pass (S-07)

- **Plan**: context/changes/ui-consistency-pass/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Code-level adherence: every planned change in phases 1–4 is MATCH (PageShell on every page with title = h1, `ui-classes.ts` with lint-compliant names, `FOCUS_RING` gone, full `ring-ring` + `aria-invalid:focus-visible:` destructive ring, `.dark`/`--cosmic-*`/LibBadge removed with `@custom-variant dark` kept, Banner on tokens, Europe/Warsaw dates, lint scope widened). No security, reliability or accessibility regressions; kitchen sink is still dev-only.

Automated criteria re-run 2026-11-27: lint (0 errors), `astro check` (0 errors), build, `grep bg-cosmic|cosmic-|class="dark"` (none), invalid-focus rule after both single rules in built CSS (offsets 43115 < 44519 < 44898), `max-w-5xl` only in PageShell, no `FOCUS_RING`, hard-coded scan 0 lines, PageShell lint regression caught, smoke on production preview after `db reset` — all PASS.

## Findings

### F1 — Visual gate evidence missing while 1.6 and 4.8 are ticked

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: context/changes/ui-consistency-pass/screenshots/ ; plan.md Progress 1.6, 4.8
- **Detail**: The plan makes before/after screenshots of all 9 pages (1280 + 375 px, with client/staff/waiting branches) the visual gate. `before/` holds 6 guest pages at 1280 px only (commit 0ace13d says "other pages/widths reviewed by eye"); `after/` is empty, yet 4.8 is ticked with 54a2f9c, which adds no images. The user confirmed the manual checks, but nothing on disk records the reduced gate.
- **Fix A ⭐ Recommended**: Capture `after/` for the 6 baseline pages at 1280 px (same names) plus the kitchen sink, and add a note to change.md that the remaining pages/widths were checked by eye
  - Strength: Gives the 6 baselines a real comparison and leaves an honest record of the reduced scope.
  - Tradeoff: ~10 minutes of screenshots; still no 375 px or signed-in evidence.
  - Confidence: HIGH — the preview and dev server run locally; the names are fixed by `before/`.
  - Blind spot: Branch pages (client/staff/waiting) stay without image evidence.
- **Fix B**: Record only — add a change.md note that 1.6 and 4.8 were satisfied by a manual visual walk confirmed by the user on 2026-11-27, no images
  - Strength: Zero effort; makes the Progress ticks truthful.
  - Tradeoff: The plan's screenshot gate is effectively dropped for this change.
  - Confidence: HIGH — documentation-only.
  - Blind spot: Future visual regressions have no baseline to compare against.
- **Decision**: FIXED (Fix A) — 6 after-shots at 1280 px + kitchen sink 1280/375 in `screenshots/after/`; deltas intended; scope note added to change.md

### F2 — Status heading texts duplicated across two files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/ClientPageLayout.astro:29-31 ; src/components/AccountStatusNotice.astro
- **Detail**: "Nie udało się wczytać Twojego konta" and "Konto czeka na przypisanie" are written in AccountStatusNotice (as the h1) and again in ClientPageLayout (as the tab title), held together only by "keep in sync" comments. Editing one makes the tab title and the h1 silently differ — the exact title = h1 contract this change introduced.
- **Fix**: Export both texts from a small dependency-free `.ts` module (e.g. next to AccountStatusNotice) and import them in both files.
- **Decision**: FIXED — `src/components/account-status.ts` exports both headings; AccountStatusNotice and ClientPageLayout import them

### F3 — Local class strings that duplicate or should be shared constants

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/start/StartPage.astro:45 ; src/layouts/ClientPageLayout.astro:43 + src/components/AccountStatusNotice.astro:20 ; src/pages/auth/signin.astro:27 + signup.astro:24
- **Detail**: `stepTitleClass = "text-lg font-bold text-foreground"` is byte-identical to `SECTION_HEADING_CLASS`; `cn(LEAD_CLASS, "mb-0")` is derived in two places; the auth footer paragraph `mt-4 text-center text-sm text-muted-foreground` is repeated on signin and signup. CLAUDE.md now says a string a second view needs goes into `ui-classes.ts`.
- **Fix**: Use `SECTION_HEADING_CLASS` in StartPage; add `STATUS_LEAD_CLASS` and `AUTH_FOOTER_CLASS` to `ui-classes.ts` and use them in the four call sites.
- **Decision**: FIXED — StartPage step titles use `SECTION_HEADING_CLASS`; `STATUS_LEAD_CLASS` (AccountStatusNotice, ClientPageLayout staff branch) and `AUTH_FOOTER_CLASS` (signin, signup) added to `ui-classes.ts`

### F4 — Stale smoke-test comment about the my-tickets title

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/smoke.mjs:184-185
- **Detail**: The comment says "Moje zgłoszenia" is the document title of every branch; since phase 2 the title follows the rendered branch (e.g. "Strona dla klientów" for staff). The assertions still hold because they also require the list's `aria-label`.
- **Fix**: Reword the comment: the title follows the branch, and the list's `aria-label` is what marks the client branch.
- **Decision**: FIXED — comment reworded (title follows the branch; the label also appears in the UserBar nav)

### F5 — Unrelated Progress stamps bundled into the phase 3 commit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: commit 5d2f60e — context/changes/testing-ticket-reaches-staff/plan.md:304-308
- **Detail**: The p3 commit also carries `— 34dfc91` stamps for a different change (already archived). Harmless and documented in the commit body, but it mixes two changes' history. (Also unlisted but expected: roadmap S-07 → in-progress in 0ace13d.)
- **Fix**: No code change; keep future phase commits to the change's own files (already the case for p4).
- **Decision**: ACCEPTED — history left as is (rewriting pushed commits is not worth it); future phase commits carry only the change's own files
