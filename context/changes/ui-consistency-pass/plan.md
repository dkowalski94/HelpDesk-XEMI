# UI consistency pass (S-07) Implementation Plan

## Overview

Make all 9 pages — `/`, `/report-error`, `/my-tickets`, `/auth/{signin,signup,confirm-email}`, 404, `/admin/tickets`, `/admin/users` — read as one light XEMI app: one page shell, one set of heading/lead/link/control classes, focus rings fixed at their source, the dead cosmic theme removed, and a contract (rule + lint) that keeps the next view on it. Roadmap slice S-07 (`context/foundation/roadmap.md:160-171`), PRD MS-07.

## Current State Analysis

From `context/changes/ui-consistency-pass/research.md` (charges C1–C5):

- **Tokens are applied everywhere** — the hard-coded-value scan finds 0 hits in the 17 linted view globs (`eslint.config.js:100-118`). The only hits are `src/components/Banner.astro:27-41` (hex in `<style>`, C4), the shadcn primitives in `src/components/ui/`, and the dead `src/components/ui/LibBadge.astro`.
- **The page shell is copied, not shared (C1).** `min-h-screen bg-background p-4` → `max-w-5xl` → `<Topbar />` → `Card` is written out in 7 places (6 pages + `src/layouts/ClientPageLayout.astro:38-41`); `headingClass` has 9 definitions in 4 variants; card padding is `sm:p-10` on `/` and 404 vs `sm:p-8` elsewhere; lead text varies in size and width. S-04/S-05/S-06 plans told implementers to copy it.
- **Class strings are duplicated (C2).** `FOCUS_RING` ×4 + 1 inline, quiet link class ×6 in 2 hover styles, native `<select>` class ×2 byte-identical, class constants (`FOCUS_RING`, `INNER_CARD`, `FIXED_ROWS`, `BLOCKED_CLASS`) living in the feature file `src/components/error-resolution/format.ts` and imported by admin code.
- **Focus (C3).** Primitives default to `ring-ring/50` (1.91:1), so every view re-adds `FOCUS_RING`; on an `aria-invalid` field the `aria-invalid:ring-destructive/20` rule is emitted after `focus-visible:*` at equal specificity and wins (compiled-CSS order verified in research). Base layer `* { outline-ring/50 }` (`src/styles/global.css:141-143`).
- **Cosmic theme is dead (C5).** `bg-cosmic`/`--cosmic-*` have 0 consumers; `.dark` has 1 (kitchen-sink dark UserBar cell, `src/dev/ui-kitchen-sink.astro:169-183`); `CLAUDE.md:88,90` and `context/foundation/design-tokens.md` still describe un-migrated cosmic views.
- **Functional bug found on the way:** `src/components/admin/StaffTicketQueue.astro:57-59` has its own `formatDate` without `timeZone: "Europe/Warsaw"`, so staff ticket dates render in the Worker's UTC.

## Desired End State

- Every page renders through one `src/layouts/PageShell.astro` (Layout + wrapper + Topbar + Card) in one of three variants — `panel` (default), `narrow` (auth), `hero` (start page only) — and its tab title is `<page h1> — HelpDesk XEMI` (`/` stays `HelpDesk XEMI`).
- Shared class constants live in one linted module, `src/lib/ui-classes.ts`; no view defines its own heading/lead/link/select/focus string. `FOCUS_RING` no longer exists.
- Shadcn primitives draw a full-strength `ring-ring` on focus, and a full-strength `ring-destructive` when the focused field is invalid; the base outline is full `outline-ring`.
- `.dark`, `--cosmic-*`, `bg-cosmic`, the dark kitchen-sink cell and `LibBadge.astro` are gone; `@custom-variant dark` stays so the primitives' `dark:` classes stay inert.
- The Supabase-not-configured banner uses `destructive` tokens; `Layout.astro`, `Banner.astro`, `PageShell.astro` and `ui-classes.ts` are in `uiContractConfig`.
- CLAUDE.md's UI contract covers every view and names PageShell, `ui-classes.ts` and the post-`shadcn add` ring fix; `design-tokens.md` no longer describes cosmic.
- Verify: lint/check/build/smoke green, hard-coded-value scan has 0 hits outside `src/components/ui/`, before/after screenshots of all 9 pages (desktop + 375 px) show only the intended deltas.

### Key Discoveries:

- `uiContractConfig` matches class constants by name — `/Class(es)?$|_(CLASS|RING|CARD|ROWS)$|^(heading|hint)$/` (`eslint.config.js:96`) — so every constant in `ui-classes.ts` must follow that naming or lint will not check it.
- tailwind-merge (3.7.0) drops `ring-ring/50` when a `ring-ring` override is merged and keeps `ring-[3px]` (research, C3) — so after the primitive fix, `buttonVariants()` on `<a>` and `Button asChild` produce the same focus without extra classes.
- The kitchen sink renders `StartPage`, `NotFound`, `ConfirmEmailNotice` (which own a `Card` today) and the admin panels (wrapped in `Card` by the sink) as standalone components (`src/dev/ui-kitchen-sink.astro:5-11,186-260`).
- Smoke test reads only substrings: `Zgłoś błąd z systemu ERP`, `tylko treść komunikatu błędu`, `Moje zgłoszenia` + `aria-label="Lista zgłoszeń"`, `Zaloguj się` and `Wyloguj` on `/`, and `name="userId" value="…"` before `>email<` on `/admin/users` (`scripts/smoke.mjs:144-195,296`). None of them depends on a title, a heading class or the UserBar label.
- `--destructive` is 6.42:1 on white (`design-tokens.md:37`) — usable as a full-strength focus ring.

## What We're NOT Doing

- No dark mode and no new colour roles (no `--info`); `.dark` is removed, not redesigned.
- No shadcn `Select` / React island for the admin selects — the native GET-form select is a recorded S-05 decision; only its class is shared.
- No pending state / double-submit guard on the no-JS admin forms (new behaviour, roadmap scope guard `roadmap.md:170`).
- No unification of `disabled` (auth) vs `aria-disabled` (error-resolution, stays focusable on purpose) — both are shown in the kitchen sink instead.
- No `resolveAudience()` extraction (logic, start-page F2) — PageShell keeps `Topbar` resolving its own locals.
- No change to the my-tickets dense list item padding, the duplicated success-alert markup, or the `ServerError` icon.
- No forced-colors / High Contrast work (unverified finding; recorded for a later change).
- No new test runner or Playwright — the kitchen sink plus manual screenshots are the gate.

## Implementation Approach

Fix at the source first, then compose, then align, then lock in — the `/10x-ui` order (library → token values → view → states → rule). Phase 1 changes only primitives, `global.css`, Banner and dead code, so every page benefits before any page file moves. Phase 2 introduces the shell and the constants module and moves all 9 pages onto them in one phase, because a half-migrated shell is exactly the drift this change removes. Phase 3 aligns individual controls and fills the kitchen sink. Phase 4 writes the rule and widens lint.

## Critical Implementation Details

- **Baseline first.** Capture desktop (1280 px) and 375 px screenshots of all 9 pages, plus a signed-in client, staff and waiting variant where the page branches, **before the first edit** — into `context/changes/ui-consistency-pass/screenshots/before/`. Research could not take them (dev server down); without them the visual gate has nothing to compare against.
- **`aria-invalid` vs focus order.** The invalid-and-focused rule must come after both single-variant rules in the compiled CSS. Use a stacked variant (`aria-invalid:focus-visible:…`) and confirm the order in the built CSS (`npm run build`, grep `dist/` for the selector) or in the kitchen-sink cell — do not rely on class order in the source string.
- **Do not delete `@custom-variant dark`** (`global.css:4`). Without it Tailwind 4's `dark:` becomes `prefers-color-scheme: dark`, and the primitives' `dark:bg-input/30` etc. would switch on for users with an OS dark theme.

## Phase 1: Primitives, base layer and theme cleanup

### Overview

Raise focus to full strength where it is defined, make the invalid-field focus visible, put the banner on tokens, and delete the dead cosmic theme and `LibBadge`. Page files are not touched yet.

### Changes Required:

#### 1. Baseline screenshots

**File**: `context/changes/ui-consistency-pass/screenshots/before/` (new)

**Intent**: Freeze today's look of all 9 pages so later phases can be compared against it.

**Contract**: One PNG per page × {desktop 1280 px, 375 px}, plus the client/staff/waiting branches of `/`, `/report-error` and `/my-tickets`; file names `<route>-<audience>-<width>.png`. Needs `npx supabase db reset` + `npm run dev` and the seeded personas.

#### 2. Shadcn primitives

**File**: `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/badge.tsx`

**Intent**: Replace `focus-visible:ring-ring/50` with full `focus-visible:ring-ring` (keep `ring-[3px]` and `border-ring`), and on `input`/`textarea` make a focused invalid field show a full-strength destructive ring instead of `destructive/20`.

**Contract**: Focus ring at full `--ring` on every variant; `aria-invalid` + `focus-visible` → `ring-destructive` + `border-destructive` at full alpha, emitted after the plain `focus-visible:*` and `aria-invalid:*` rules. Variant-level `focus-visible:ring-destructive/20` on the destructive button/badge may stay (destructive surface). `dark:` classes untouched. Header comment in each edited file: "focus ring raised to full strength for the UI contract (S-07) — re-apply after `npx shadcn@latest add`".

#### 3. Base layer and theme

**File**: `src/styles/global.css`

**Intent**: Full-strength base outline; remove the unused cosmic theme.

**Contract**: `* { @apply border-border outline-ring; }`; delete `--cosmic-from`/`--cosmic-via` (`:46-48`), the whole `.dark { … }` block (`:51-89`) and `@utility bg-cosmic` (`:137-139`); keep `@custom-variant dark` with a one-line comment why.

#### 4. Banner on tokens

**File**: `src/components/Banner.astro`

**Intent**: Replace the hex `<style>` block with token classes so the only page-level message outside the contract matches the app.

**Contract**: Variants `error` → `border-b border-destructive/40 bg-destructive/10 text-destructive`, `warning` → the `warning` equivalent; drop `info` (0 callers, no `--info` role). Links inside get a full-strength outline focus. Props and `role` behaviour unchanged; `Layout.astro` callers unchanged.

#### 5. Dead code and the dark cell

**File**: `src/components/ui/LibBadge.astro` (delete), `src/dev/ui-kitchen-sink.astro`, `src/components/UserBar.astro`

**Intent**: Remove the component with 0 consumers and the last `.dark` consumer.

**Contract**: Delete `LibBadge.astro`; remove the dark UserBar cell and its description (`ui-kitchen-sink.astro:169-183`); update the `UserBar.astro:8` comment to drop the `.dark` sentence.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Astro type check passes: `npx astro sync && npx astro check`
- Production build passes: `npm run build`
- No cosmic leftovers in source: `grep -rnE "bg-cosmic|cosmic-|class=\"dark" src` returns nothing
- The invalid-and-focused rule is emitted after the plain focus rule in the built CSS (grep `dist/` for both selectors and compare offsets)

#### Manual Verification:

- Baseline screenshots of all 9 pages (desktop + 375 px, with branches) are in `screenshots/before/`
- Tabbing through `/report-error`, `/auth/signin` and `/admin/tickets` shows the same full-strength blue ring as before on every control
- Submitting sign-in with an empty field and tabbing back into it shows a clearly visible red focus ring
- With `SUPABASE_URL` unset, the banner renders in the app's destructive red with readable text and a visible link focus
- With the OS set to dark mode, no page changes appearance

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Shared class module and PageShell

### Overview

Create the one place for shared classes and the one page shell, move all 9 pages and `ClientPageLayout` onto them, and delete every local copy.

### Changes Required:

#### 1. Shared class module

**File**: `src/lib/ui-classes.ts` (new), `src/components/error-resolution/format.ts`

**Intent**: Move the class constants out of the feature file into a shared module and add the page-level typography constants every view currently re-derives.

**Contract**: `ui-classes.ts` exports (names must match the lint selector `_(CLASS|RING|CARD|ROWS)$`): `PAGE_CARD_CLASS` (panel `gap-0 p-6 sm:p-8`), `HERO_CARD_CLASS` (`flex-1 gap-0 p-6 sm:p-10`), `NARROW_CARD_CLASS` (centred `max-w-md` panel), `HEADING_CLASS` (`mb-2 text-2xl font-bold text-foreground`), `HERO_HEADING_CLASS` (`text-3xl sm:text-4xl` variant), `SECTION_HEADING_CLASS` (one h2 style, used by the start page and `ResolutionOutcome`), `LEAD_CLASS` (`mb-6 text-sm text-muted-foreground`), `HERO_LEAD_CLASS`, `LINK_CLASS` (the UserBar quiet-link style: `text-primary`, hover colour change + underline, full outline focus), `SELECT_CLASS` (native select, with `focus-visible:ring-3 ring-ring border-ring` and `disabled:` styles matching `Input`), plus the moved `INNER_CARD`, `FIXED_ROWS`, `BLOCKED_CLASS`. `format.ts` keeps only `formatDate`. Exact values may be tuned against the screenshots; the set of names is the contract. The auth `mb-6` and confirm-email `mb-3` heading variants go away (heading + lead spacing comes from `HEADING_CLASS`/`LEAD_CLASS`).

#### 2. PageShell

**File**: `src/layouts/PageShell.astro` (new)

**Intent**: One component for `Layout` + wrapper + `Topbar` + `Card`, so no page writes the frame again.

**Contract**: Props `title?: string` (the page's h1 text; rendered as `${title} — HelpDesk XEMI`, absent → `HelpDesk XEMI`), `variant?: "panel" | "narrow" | "hero"` (default `panel`). Renders `Layout` with that title, `bg-background p-4` wrapper, `mx-auto max-w-5xl` frame (flex-column + `flex-1` for `hero`), `<Topbar />`, and `Card` with the variant's card class around the default slot.

#### 3. Pages and ClientPageLayout onto PageShell

**File**: `src/pages/index.astro`, `src/pages/404.astro`, `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/pages/admin/tickets.astro`, `src/pages/admin/users.astro`, `src/layouts/ClientPageLayout.astro`

**Intent**: Replace each hand-written frame with `PageShell`; titles become the page's h1.

**Contract**: `/` → `variant="hero"`, no title. 404 → `panel`, title "Nie znaleziono strony". Auth pages → `narrow`, titles = their h1 ("Zaloguj się", "Załóż konto", confirm-email's `{heading}`). Admin pages → `panel`, titles "Zgłoszenia do rozwiązania" / "Konta do przypisania". `ClientPageLayout` composes `PageShell` and passes the title of the branch it renders (client → `heading` prop, so `/report-error` becomes "Zgłoś błąd z systemu ERP"; staff → "Strona dla klientów"; waiting / profile-error → the `AccountStatusNotice` heading text). `ClientPageLayout`'s `title` prop is removed if every caller's title equals its heading; branch logic and texts unchanged.

#### 4. Components that owned a Card or local classes

**File**: `src/components/start/StartPage.astro`, `src/components/NotFound.astro`, `src/components/auth/ConfirmEmailNotice.astro`, `src/components/AccountStatusNotice.astro`, `src/components/admin/StaffTicketQueue.astro`, `src/components/admin/StaffUserAssignment.astro`, `src/components/error-resolution/{ErrorTextForm,EscalationControl,MyTicketsList,ResolutionOutcome}.tsx`, `src/components/auth/{FormField,SubmitButton,PasswordToggle}.tsx`, `src/components/UserBar.astro`, `src/pages/report-error.astro`

**Intent**: Drop the `Card` these components render (PageShell owns it now) and replace every local `headingClass`/`hint`/`linkClass`/`selectClass`/`FOCUS_RING` with the shared constants.

**Contract**: `StartPage` keeps the hero heading/lead (`HERO_*`); `NotFound` switches to `HEADING_CLASS`/`LEAD_CLASS` (decision: 404 is a panel, not a hero); `ConfirmEmailNotice` keeps its centred icon layout inside the narrow card. No local `FOCUS_RING` or `cn(…, FOCUS_RING)` remains anywhere — primitives carry the ring after phase 1; native selects use `SELECT_CLASS`; plain links use `LINK_CLASS`. Imports move from `@/components/error-resolution/format` to `@/lib/ui-classes` for class constants.

#### 5. UTC date bug

**File**: `src/components/admin/StaffTicketQueue.astro`

**Intent**: Staff ticket dates show in UTC because of a local `formatDate` without a time zone; use the shared one.

**Contract**: Delete the local `formatDate` (`:57-59`), import `formatDate` from `@/components/error-resolution/format` (`Europe/Warsaw`). Separate commit within the phase (functional fix).

#### 6. Kitchen sink follows the shell

**File**: `src/dev/ui-kitchen-sink.astro`

**Intent**: Cells that render `StartPage`/`NotFound`/`ConfirmEmailNotice` lost their built-in card; wrap them like the admin cells.

**Contract**: Each such cell wraps the component in `Card` with the matching `PAGE_CARD_CLASS`/`HERO_CARD_CLASS`/`NARROW_CARD_CLASS`; admin cells switch to `PAGE_CARD_CLASS`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Astro type check passes: `npx astro sync && npx astro check`
- Production build passes: `npm run build`
- No local frame left: `grep -rn "max-w-5xl" src/pages src/layouts src/components` matches only `src/layouts/PageShell.astro`
- No local focus constant left: `grep -rn "FOCUS_RING" src` returns nothing
- No local heading/link/select constants: `grep -rnE "const (headingClass|hint|linkClass|selectClass|quietLinkClass) =" src` returns nothing
- Smoke test passes against the dev server after `npx supabase db reset`: `npm run smoke`

#### Manual Verification:

- Every page's tab reads `<h1> — HelpDesk XEMI` (start page: `HelpDesk XEMI`), including the staff and waiting branches of `/report-error` and `/my-tickets`
- 404 now looks like an app panel (2xl heading, same card padding as `/admin/tickets`); the start page keeps its large heading
- Heading size, heading-to-lead spacing and card padding are identical between `/report-error`, `/my-tickets`, `/admin/tickets`, `/admin/users` and 404 (compare with `screenshots/before/`)
- Staff ticket dates in `/admin/tickets` match Polish local time (compare one ticket's `created_at` in Supabase Studio)
- 375 px: no horizontal scroll on any page; auth cards stay centred and narrow

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Control alignment and states

### Overview

Close the remaining per-control differences the user decided on and make every state of the shared pieces visible in the kitchen sink.

### Changes Required:

#### 1. Links and primary actions

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/components/auth/ConfirmEmailNotice.astro`, `src/pages/report-error.astro`

**Intent**: One link behaviour everywhere (`LINK_CLASS`), and confirm-email's next step as a primary button like the 404's.

**Contract**: Auth footer links and the report-error link use `LINK_CLASS` (size modifiers via `cn` only). "Przejdź do logowania" → `<a>` with `buttonVariants({ variant: "default" })`. Convention recorded for phase 4: in `.astro` button-styled links use `buttonVariants()` on `<a>`, in `.tsx` `Button asChild` — same classes.

#### 2. UserBar label

**File**: `src/components/UserBar.astro`

**Intent**: The staff entry „Użytkownicy” opens a page titled „Konta do przypisania”; make them match (deferred by S-06).

**Contract**: Label „Konta do przypisania”; `href` and `isCurrent` unchanged. Check the 375 px bar wraps cleanly.

#### 3. Spinner accessibility

**File**: `src/components/error-resolution/ErrorTextForm.tsx`, `src/components/error-resolution/EscalationControl.tsx`

**Intent**: Match `SubmitButton.tsx:20` and `ResolutionOutcome.tsx:151`.

**Contract**: `aria-hidden="true"` on the `Loader2` at `ErrorTextForm.tsx:78` and `EscalationControl.tsx:124`.

#### 4. Kitchen-sink state matrix for the shared pieces

**File**: `src/dev/ui-kitchen-sink.astro`, `src/components/auth/AuthKitchenSink.tsx` (if the field cell lives there)

**Intent**: Every state of what this change made shared is visible at once — the screenshot gate.

**Contract**: New section "Wspólna powłoka i kontrolki" with: PageShell card variants (panel / narrow / hero) with heading + lead; Banner `error` and `warning`; `LINK_CLASS` link; `SELECT_CLASS` select (default, disabled); Input and Textarea in default / invalid / disabled, with a note to tab into the invalid one (focus is not statically renderable — the cell's caption says so); Button default / outline / disabled and the `aria-disabled` + `BLOCKED_CLASS` form. Empty and loading states stay in their existing feature cells; the section caption lists the 7 states with "N/A — <reason>" where a state does not apply (e.g. Banner hover).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Astro type check passes: `npx astro sync && npx astro check`
- Production build passes: `npm run build`
- `aria-hidden` present on every `Loader2`: `grep -rn "<Loader2" src --include=*.tsx` lines all contain `aria-hidden`

#### Manual Verification:

- `/dev/ui-kitchen-sink` shows the new section with every listed state, desktop and 375 px
- Tabbing into the invalid Input/Textarea in the sink shows the full red ring; valid ones the full blue ring; select shows the blue ring
- Links on signin, signup, confirm-email, report-error and the UserBar change colour and underline the same way on hover
- Confirm-email's "Przejdź do logowania" is a button matching the 404's
- Staff UserBar shows „Konta do przypisania” active on `/admin/users`, wrapping cleanly at 375 px

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Lock it in

### Overview

Widen lint to every new and shell file, rewrite the contract docs, and run the final visual gate.

### Changes Required:

#### 1. Lint scope

**File**: `eslint.config.js`

**Intent**: Every view-level file is under the contract, including the ones this change created or found outside it.

**Contract**: Add `src/layouts/**`, `src/components/Banner.astro`, `src/lib/ui-classes.ts` to `uiContractConfig.files` (collapse existing per-file entries into globs where equivalent). Update the comment above `UI_CLASS_CONTEXTS` to name `ui-classes.ts` as the home of shared constants. Note in the comment that `<style>` blocks are invisible to the rule — none may be added in views.

#### 2. CLAUDE.md UI contract

**File**: `CLAUDE.md` (section "UI contract", outside any 10x-cli block)

**Intent**: Describe the contract as it now is, so the next agent uses the shell and constants instead of copying a page.

**Contract**: Applies to every view (drop the file list and the "Other views still use literals on `bg-cosmic`" sentence). New bullets: new pages render through `src/layouts/PageShell.astro` (variants panel/narrow/hero, title = h1); shared class strings live in `src/lib/ui-classes.ts` — check it before writing a class string, add there rather than locally; button-styled links: `buttonVariants()` on `<a>` in `.astro`, `Button asChild` in `.tsx`; after `npx shadcn@latest add`, raise any `ring-ring/50` to `ring-ring` and keep the invalid-focus rule; no `<style>` blocks with colours in views. Token bullet: one light theme, a new role goes in `:root` and `@theme inline`; `@custom-variant dark` is kept only so primitive `dark:` classes stay inert. Kitchen-sink bullet: mention the shared-pieces section. Update the shadcn component-set line (LibBadge removed).

#### 3. Design tokens doc

**File**: `context/foundation/design-tokens.md`

**Intent**: The foundation doc matches the code.

**Contract**: Remove the `--cosmic-*` rows, the "12 views on bg-cosmic" note and the dark-variant section; update the "Focus ring at half alpha" and "Global side effect" notes to say the primitives and base layer now use full `--ring`, and add the invalid-focus `--destructive` ring (6.42:1). Edit in place (foundation convention).

#### 4. Final visual gate

**File**: `context/changes/ui-consistency-pass/screenshots/after/` (new)

**Intent**: Prove the end state against the baseline.

**Contract**: Same set and names as `before/`, plus the kitchen sink at desktop and 375 px. Every visible delta is one this plan intends (heading/padding on 404, titles, confirm-email button, UserBar label, link hover, banner colour); anything else is fixed or listed as a finding for `/10x-impl-review`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Astro type check passes: `npx astro sync && npx astro check`
- Production build passes: `npm run build`
- Hard-coded-value scan finds nothing outside `src/components/ui/`: the `/10x-ui` scan regex over `src/pages src/layouts src/components src/lib/ui-classes.ts --include=*.astro --include=*.tsx --include=*.ts`, excluding `src/components/ui/`, returns 0 lines
- Lint catches a regression: temporarily adding `text-blue-500` to a class in `src/layouts/PageShell.astro` makes `npm run lint` fail (revert after)
- Smoke test passes against the production preview after `npx supabase db reset`: `npm run build && npm run preview` + `npm run smoke`
- No stale references: `grep -nE "cosmic|LibBadge" CLAUDE.md context/foundation/design-tokens.md` returns nothing

#### Manual Verification:

- After-screenshots of all 9 pages and the kitchen sink are in `screenshots/after/`, and every delta against `before/` is intended
- Walking guest → sign-in → client pages → sign-out → staff pages → an unknown URL shows one consistent look (width, heading, spacing, buttons, focus, user bar)
- CLAUDE.md UI contract reads correctly to someone adding a new page (PageShell, ui-classes, shadcn ring fix)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — the repo has no unit-test runner for components, and this change adds no logic beyond a title string.

### Integration Tests:

- `npm run smoke` (auth flow, tenant isolation, `/admin/users` waiting-list parser) after phase 2 and at the end; `npx supabase db reset` before each run (CLAUDE.md, smoke notes).

### Manual Testing Steps:

1. Before any edit: baseline screenshots (phase 1, step 1).
2. Keyboard pass on every page: Tab through all controls, confirm a full-strength ring; tab into an invalid field, confirm a red ring.
3. OS dark mode on: no page changes.
4. `SUPABASE_URL` unset: banner on tokens, link focus visible.
5. Final walk across all roles and 404; after-screenshots vs before.

## Performance Considerations

None — class strings and one layout component; CSS shrinks slightly with the `.dark` block removed.

## Migration Notes

No data or schema changes. Rollback is a plain Worker rollback. The primitives in `src/components/ui/` now differ from the shadcn registry; CLAUDE.md records how to re-apply the ring fix after `shadcn add`.

## References

- Research: `context/changes/ui-consistency-pass/research.md` (charges C1–C5)
- Roadmap slice: `context/foundation/roadmap.md:160-171`
- Tokens: `context/foundation/design-tokens.md`
- Prior shell decisions: `context/archive/2026-10-28-staff-ticket-company-filter/plan.md:27,35,71`, `context/archive/2026-10-30-admin-users-ui-contract/plan.md:13,32,63`, `context/archive/2026-10-29-polish-sign-in/plan.md:85,220,241`
- Smoke markers: `scripts/smoke.mjs:144-195,296`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Primitives, base layer and theme cleanup

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Astro type check passes: `npx astro sync && npx astro check`
- [x] 1.3 Production build passes: `npm run build`
- [x] 1.4 No cosmic leftovers in source: `grep -rnE "bg-cosmic|cosmic-|class=\"dark" src` returns nothing
- [x] 1.5 The invalid-and-focused rule is emitted after the plain focus rule in the built CSS

#### Manual

- [x] 1.6 Baseline screenshots of all 9 pages (desktop + 375 px, with branches) are in `screenshots/before/`
- [x] 1.7 Tabbing through `/report-error`, `/auth/signin` and `/admin/tickets` shows the same full-strength blue ring on every control
- [x] 1.8 Tabbing back into an invalid sign-in field shows a clearly visible red focus ring
- [x] 1.9 With `SUPABASE_URL` unset, the banner renders in the app's destructive red with a visible link focus
- [x] 1.10 With the OS set to dark mode, no page changes appearance

### Phase 2: Shared class module and PageShell

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Astro type check passes: `npx astro sync && npx astro check`
- [ ] 2.3 Production build passes: `npm run build`
- [ ] 2.4 No local frame left: `max-w-5xl` only in `src/layouts/PageShell.astro`
- [ ] 2.5 No local focus constant left: `grep -rn "FOCUS_RING" src` returns nothing
- [ ] 2.6 No local heading/link/select constants remain
- [ ] 2.7 Smoke test passes against the dev server after `npx supabase db reset`: `npm run smoke`

#### Manual

- [ ] 2.8 Every page's tab reads `<h1> — HelpDesk XEMI` (start page: `HelpDesk XEMI`), including staff and waiting branches
- [ ] 2.9 404 looks like an app panel; the start page keeps its large heading
- [ ] 2.10 Heading size, heading-to-lead spacing and card padding are identical across the panel pages
- [ ] 2.11 Staff ticket dates in `/admin/tickets` match Polish local time
- [ ] 2.12 375 px: no horizontal scroll on any page; auth cards stay centred and narrow

### Phase 3: Control alignment and states

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Astro type check passes: `npx astro sync && npx astro check`
- [ ] 3.3 Production build passes: `npm run build`
- [ ] 3.4 `aria-hidden` present on every `Loader2`

#### Manual

- [ ] 3.5 `/dev/ui-kitchen-sink` shows the new section with every listed state, desktop and 375 px
- [ ] 3.6 Invalid fields show the full red focus ring, valid fields and the select the full blue ring
- [ ] 3.7 Links on signin, signup, confirm-email, report-error and the UserBar behave the same on hover
- [ ] 3.8 Confirm-email's "Przejdź do logowania" is a button matching the 404's
- [ ] 3.9 Staff UserBar shows „Konta do przypisania” active on `/admin/users`, wrapping cleanly at 375 px

### Phase 4: Lock it in

#### Automated

- [ ] 4.1 Lint passes: `npm run lint`
- [ ] 4.2 Astro type check passes: `npx astro sync && npx astro check`
- [ ] 4.3 Production build passes: `npm run build`
- [ ] 4.4 Hard-coded-value scan finds nothing outside `src/components/ui/`
- [ ] 4.5 Lint catches a regression in `src/layouts/PageShell.astro`
- [ ] 4.6 Smoke test passes against the production preview after `npx supabase db reset`
- [ ] 4.7 No stale `cosmic`/`LibBadge` references in CLAUDE.md and design-tokens.md

#### Manual

- [ ] 4.8 After-screenshots of all 9 pages and the kitchen sink are in `screenshots/after/`, every delta intended
- [ ] 4.9 Walking all roles and an unknown URL shows one consistent look
- [ ] 4.10 CLAUDE.md UI contract reads correctly to someone adding a new page
