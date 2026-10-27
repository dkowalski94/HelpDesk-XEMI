<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Report-error View on the Design-System Contract

- **Plan**: context/changes/report-error-ui-contract/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Live region wraps the whole outcome, including the escalation form

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/error-resolution/ResolutionOutcome.tsx:123
- **Detail**: `OutcomeRegion` puts `role="status"` (implicitly `aria-atomic`) around match cards, the escalation trigger, the comment textarea and its button. The comment `FieldCounter` (`aria-live`) sits inside, so typing a comment can make a screen reader re-read all match cards; there are nested live regions (`EscalationControl` status cards, `ErrorAlert` `role="alert"`). Before the change only the escalation-result cards were live.
- **Fix**: Keep `OutcomeRegion` as a plain wrapper (with `aria-busy` + min height) and announce through a separate `sr-only` `role="status"` line with a short summary ("Znaleźliśmy 2 rozwiązania", "Utworzono zgłoszenie", "Szukam rozwiązania...").
  - Strength: Satisfies the plan's "outcome announced" without making interactive content atomic; summary text is derivable from `result.outcome` / `matches.length`.
  - Tradeoff: One more element and a small summary function; kitchen sink cells unchanged.
  - Confidence: HIGH — standard live-region pattern; WAI-ARIA warns against interactive content in `status`.
  - Blind spot: Not verified with a real screen reader (NVDA/VoiceOver).
- **Decision**: FIXED — `OutcomeRegion` no longer a live region; always-mounted `sr-only` `role="status"` line announces a Polish summary (plural via `Intl.PluralRules("pl")`).

### F2 — Screenshots required by 4.8 (and 3.7) were never saved

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/report-error-ui-contract/screenshots/ (missing)
- **Detail**: Phase 4 §2 and Progress 4.8 require desktop + ≈390 px screenshots in the change folder; 3.7 asks for them for the client view. The folder does not exist; both rows are ticked (user accepted the manual check without them).
- **Fix**: Capture kitchen sink + `/report-error` at desktop and 390 px and commit them to `screenshots/`.
- **Decision**: FIXED — `screenshots/kitchen-sink-{desktop,390}.png`, `screenshots/report-error-{desktop,390}.png` (Klient Alfa, headless Chrome).

### F3 — Layout still shifts when a result arrives

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/error-resolution/ResolutionOutcome.tsx:123
- **Detail**: `min-h-24` applies only while `pending || result`; idle the region is 0 px, so submit pushes "Twoje zgłoszenia" down ~96 px, and a tall result (several match cards) pushes it again. `empty:mb-0` has no effect on an element that always has the region div. Plan 4.10: "No layout jump when … a result arrives".
- **Fix A ⭐ Recommended**: Accept the shift caused by content growth (a variable-length result cannot be reserved) and record it in the plan; keep `min-h-24` only for the pending→result step, which is the jump the plan targets.
  - Strength: No visual change; the remaining shift is user-initiated (after pressing "Wyślij"), which CLS treats as expected.
  - Tradeoff: 4.10 is met only in its narrower reading.
  - Confidence: MED — depends on how strictly the user reads 4.10.
  - Blind spot: None significant.
- **Fix B**: Move "Twoje zgłoszenia" above the outcome or reserve a fixed height with internal scroll for the outcome.
  - Strength: Truly no shift.
  - Tradeoff: Changes the view's layout/reading order; scroll inside a card hurts mobile.
  - Confidence: LOW — a layout decision the plan never discussed.
  - Blind spot: Effect on the upcoming separate „Moje zgłoszenia” page (roadmap) — the list may leave this view anyway.
- **Decision**: ACCEPTED (Fix A) — shift from variable-length content after the user presses "Wyślij" is accepted; `min-h-24` covers the placeholder→result step. 4.10 read as "no jump between placeholder and result". Dead `empty:mb-0` removed. The list moves to its own page in the next milestone.

### F4 — ESLint guardrail false positives and duplicates

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: eslint.config.js:82-113
- **Detail**: The `VariableDeclarator` context matches every string in any variable declaration, so copy/fixture text like `"Błąd zapisu (kod #4012)"` fails lint (hex pattern) — likely in KitchenSink sample ERP errors. A `cn()` call inside `className` is reported twice. `style={{…}}` is not covered.
- **Fix**: Restrict the `VariableDeclarator` selector to class constants (`id.name` matching `/Class$|^[A-Z_]+$|^(heading|hint)$/`), and add `JSXAttribute[name.name='style']`.
- **Decision**: FIXED — declarator context limited to `/Class(es)?$|_(CLASS|RING|CARD|ROWS)$|^(heading|hint)$/`, `style` attribute added, `cn()` inside a class attribute no longer double-reported; probe confirmed copy text with `#4012` passes and palette classes/`style` colours fail.

### F5 — Unplanned `dark` wrapper on Welcome, missing from CLAUDE.md

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Welcome.astro:5
- **Detail**: f982a26 added `dark` to Welcome's wrapper so the Topbar stays dark on `/`. Consistent with the amendment's intent, but the plan names only search/admin-tickets and the CLAUDE.md UI contract lists only those two.
- **Fix**: Add Welcome (`/`) to the dark-wrapper list in CLAUDE.md.
- **Decision**: FIXED — CLAUDE.md UI contract lists `/` via `Welcome.astro`.

### F6 — Kitchen sink JS chunk ships in the production build

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dev/ui-kitchen-sink.astro (now src/dev/ui-kitchen-sink.astro)
- **Detail**: The route returns 404 with an empty body in production, but `dist/client/_astro/KitchenSink.*.js` (fixture data only, no secrets) is still emitted as a public static asset.
- **Fix**: Accept (fixtures only); revisit if the kitchen sink ever gets real data.
- **Decision**: FIXED (user chose a fix over accepting) — page moved to `src/dev/ui-kitchen-sink.astro`; a `devOnlyRoutes` integration in `astro.config.mjs` injects `/dev/ui-kitchen-sink` only under `astro dev`. Production build has no route (plain 404 on preview, verified) and no `KitchenSink` chunk in `dist/` (verified). ESLint scope and CLAUDE.md updated to the new path.

### F7 — Escalation request not aborted on a new paste

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/error-resolution/ErrorResolutionPanel.tsx:16-55
- **Detail**: A new paste while an escalation is pending unmounts `Escalation`; its fetch still files the ticket for the old text and calls `reload()`. Pre-existing behaviour (S-03), not introduced here; `useMyTickets` already ignores stale responses.
- **Fix**: Accept; the ticket is intentionally filed once the user pressed "Przekaż".
- **Decision**: FIXED (user chose a fix over accepting) — `Escalation` reports its pending state through `onPendingChange`; the panel's `blocked` includes it, so a new paste cannot be sent (and unmount the control) while an escalation is in flight. No abort: the server would file the ticket anyway.

### F8 — Badge destructive variant uses `text-white`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/badge.tsx:14
- **Detail**: Upstream `text-white` kept although `--destructive-foreground` now exists; `ui/` is outside the lint scope.
- **Fix**: Replace with `text-destructive-foreground`.
- **Decision**: FIXED — `ui/badge.tsx` destructive variant uses `text-destructive-foreground`.

### F9 — Small cleanups: unused Lato 900, `format.ts` holds class constants, duplicated `formatDate`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/Layout.astro:2-4; src/components/error-resolution/format.ts
- **Detail**: `@fontsource/lato/900.css` loads on every page but no `font-black`/`font-extrabold` is used. `format.ts` mostly holds `FOCUS_RING`/`INNER_CARD`/`FIXED_ROWS`; `formatDate` also exists in `admin/tickets.astro`.
- **Fix**: Drop the 900 import; leave the file split for the next change that touches admin/tickets.
- **Decision**: FIXED — `@fontsource/lato/900.css` import removed (no `font-black`/`font-extrabold` in `src`), `tokens.md` note updated; `format.ts`/`formatDate` split left for a later change.

### F10 — Disabled submit drops focus; counter announces every keystroke

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/error-resolution/ErrorTextForm.tsx; EscalationControl.tsx; FieldCounter.tsx
- **Detail**: Native `disabled` while pending moves keyboard focus to `<body>`; `aria-describedby` on a disabled button is reachable only in browse mode. `FieldCounter` is `aria-live` and reads "n / max" on every keystroke (pre-existing). Plan explicitly asked to keep native `disabled`.
- **Fix**: Accept for this change; consider `aria-disabled` + the existing `if (blocked) return` guard in a later a11y pass.
- **Decision**: FIXED (user chose a fix; deliberate deviation from the plan's "keep native `disabled`") — both submits use `aria-disabled` + `BLOCKED_CLASS` (format.ts), the handlers' `if (blocked) return` guards submission, focus stays on the button and its `aria-describedby` reason is read on focus. `FieldCounter` no longer `aria-live`; a separate `sr-only` `role="status"` line announces only the too-long message.
