# Report-error View on the Design-System Contract — Implementation Plan

## Overview

Put `/report-error` (`src/pages/report-error.astro` + island `src/components/error-resolution/ErrorResolutionPanel.tsx`) on a design-system contract: the dark shadcn tokens become the app's one real theme, carrying today's cosmic colours; the view is built only from those tokens and from components in `src/components/ui`; every control covers the 7-state matrix; a dev-only kitchen-sink page is the visual gate; a CLAUDE.md rule and a scoped ESLint rule keep the next agent on the contract. Other views are not restyled.

## Current State Analysis

From `research.md` (charges C1–C5):

- **Dead token theme (C1).** `src/styles/global.css:6-39` holds stock shadcn light values, `:41-73` the gray dark set, reachable only via `.dark`, which nothing applies (`src/layouts/Layout.astro:14` renders `<html lang="en">` without a class). The visible theme is `bg-cosmic` (`global.css:113-115`, hex `#0a0e1a → #0f1529`) plus literal white/blue/purple classes. The view reads 0 token classes; the pre-audit scan finds 96 matches on 64 lines in the two view files.
- **No status roles (C2).** Success (`emerald-200`), warning/info (`amber-200`) have no token; destructive is split across `rose-200` and `red-100/300/400/500`; muted text uses four opacities of `blue-100`.
- **Hand-built primitives (C3).** 3 `<button>`, 2 `<textarea>`, 2 counters, 3 `role="alert"` boxes, 8 cards, 1 status label, 4 cause/steps blocks in the panel; only `button.tsx` exists in `src/components/ui`.
- **No visible focus (C4).** Buttons have `hover:` only; textareas use `focus:outline-none` (`ErrorResolutionPanel.tsx:164,309`), cancelling the global `outline-ring/50` (`global.css:119`).
- **Language/entry drift (C5).** `lang="en"` around Polish content, English Topbar and dashboard link, logged-out deep link returns to `/`; inconsistent headings across the four page branches (`report-error.astro:22,30,37,48`).
- **Tooling.** No screenshot tooling (`package.json`); ESLint runs in lint-staged on `*.{ts,tsx,astro}`.

## Amendment (2026-10-19) — XEMI brand, light theme

Decided with the user after analysing https://www.xemi.pl/ (white backgrounds, `#F4F4F4` sections, `#141414` text, brand blue `#009FE3`, light blue `#BFE5F5`, Lato 400/700/800, small radii 4–7 px, single-colour SVG logo `#009EE2`):

- **Light theme is the active theme**: XEMI brand values go into `:root`; `class="dark"` added to `<html>` in phase 1 (229825b) is removed in phase 2. The cosmic values written into `.dark` stay as the dark variant.
- **`bg-cosmic` becomes theme-independent** (own `--cosmic-*` variables with today's navy) so the 12 other views, which still use white literal text on `bg-cosmic`, are not turned white-on-white. `/report-error` stops using `bg-cosmic` and uses `bg-background`.
- **Topbar moves into scope, minimally**: it switches to token classes; the dark pages that render it (`search.astro`, `admin/tickets.astro`) get `class="dark"` on their wrapper so it stays dark there, and renders light on `/report-error`. Topbar language and `<html lang>` stay deferred.
- **Brand blue contrast**: `#009FE3` is ≈3.0:1 on white — kept as `--brand` for the logo and large accents; `--primary`/`--ring` use a darker brand blue meeting 4.5:1 / 3:1.
- **Logo** `public/logo-xemi.svg` (official file from xemi.pl) in the view's page header; **font** Lato via `@fontsource/lato` as `--font-sans`.

Sections below reflect the amendment; where an earlier sentence conflicts (e.g. "`<html>` carries `class=\"dark\"`"), this amendment wins.

## Desired End State

- The light XEMI theme in `:root` is active (no `class="dark"` on `<html>`): white background, `#F4F4F4` surfaces, `#141414` text, brand blue accents, Lato. `.dark` holds the cosmic dark variant used by the Topbar on dark pages. `bg-cosmic` keeps today's navy via theme-independent variables. `--success`, `--warning`, `--brand` (+ `-foreground` where needed) exist in `:root`, `.dark` and `@theme inline`. Values, sources and contrast are recorded in `context/changes/report-error-ui-contract/tokens.md`.
- `report-error.astro` and every component of the panel use token classes and `src/components/ui` components only; the hard-coded-value scan returns **0** matches on the view files.
- Every control on the view covers default, hover, focus-visible, disabled, error, empty and loading — shown in a dev-only kitchen sink at `/dev/ui-kitchen-sink` or marked N/A with a reason; desktop and one mobile screenshot recorded.
- CLAUDE.md has a UI block (outside the 10x-cli block) and `eslint.config.js` rejects palette/arbitrary colour classes in the view's files.
- Visually, `/report-error` follows xemi.pl: light page with the XEMI logo in its header, brand-blue primary actions, Lato; other views look as today (dark), with the Topbar dark on them.

Verify with the automated criteria per phase plus the kitchen-sink screenshots.

### Key Discoveries:

- `button.tsx:8` is already token-based with `focus-visible:ring-ring/50 ring-[3px]`, and its `outline` variant has `dark:` styles (`dark:bg-input/30 dark:border-input`) that only work once `.dark` is active.
- `@custom-variant dark (&:is(.dark *))` (`global.css:4`) matches descendants of `.dark`, so the class must sit on an ancestor (`<html>`), not on `<body>` content only.
- Only `auth/SubmitButton.tsx:3` imports `Button`, and it overrides colours with literals, so `.dark` on `<html>` changes no visible colour there except its focus ring (now `--ring`).
- `body` uses `bg-background text-foreground` (`global.css:121-123`); every page wraps content in `bg-cosmic min-h-screen`, so the body colour change is covered.
- `@theme inline` publishes no `--color-destructive-foreground`, `--color-success`, `--color-warning` (`global.css:75-111`).

## What We're NOT Doing

- Restyling any other view (`dashboard`, `search`, `admin/*`, auth pages, `Welcome`, `WebSearchPanel`) — they keep their literal classes; only the global token layer and `<html class="dark">` reach them.
- `Topbar.astro` beyond switching its colours to tokens (amendment) — its English labels, `<html lang="pl">`, the English dashboard link and a post-login `returnTo` stay deferred (C5), recorded in `research.md`.
- Moving the other dark views to the light theme — they keep `bg-cosmic` and literals until their own changes.
- Fixing `auth/SubmitButton.tsx`'s literal overrides.
- A user-facing theme switcher.
- A brand-gradient token — the client heading becomes `text-foreground`.
- Playwright/Storybook or any screenshot test runner — the gate is the kitchen-sink page.
- Changing behaviour or API calls of the panel (`/api/resolve-error`, `/api/escalate-error`, `/api/tickets?mine=1`).

## Implementation Approach

Phases follow the `/10x-ui` order: environment/library → token values → one view → states. The contract is fixed before the pixels: phase 1 switches the theme on and adds the components without touching the view; phase 2 makes the token values reproduce today's look; phase 3 swaps the view's literals for roles and components; phase 4 hardens states, adds the gate and the guardrail. After each visual phase: desktop + one mobile screenshot and the scan.

Hard-coded-value scan used by every phase (`VIEW_FILES` = `src/pages/report-error.astro`, `src/components/error-resolution/*.tsx`, and from phase 4 the kitchen-sink files):

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' $VIEW_FILES
```

## Critical Implementation Details

- **Token values in three places.** A new role exists only when it is defined in `:root`, in `.dark` and published in `@theme inline` as `--color-<role>`; raw colours written straight into `@theme inline` break the theme split.
- **Contrast.** The `.dark` values must keep body text and muted text readable on the navy background (target WCAG AA 4.5:1 for text, 3:1 for the focus ring and borders of controls); check each pair once in phase 2 and record it in `tokens.md`.

## Phase 1: Environment and library

### Overview

Switch the token theme on app-wide and add the shadcn components the view needs, without changing the view.

### Changes Required:

#### 1. Dark theme on the document

**File**: `src/layouts/Layout.astro`

**Intent**: Make the dark token set the active theme for every page, so `dark:` variants and token classes resolve to the dark values.

**Contract**: `<html lang="en" class="dark">` — `lang` unchanged (deferred, C5).

#### 2. shadcn components

**File**: `src/components/ui/{textarea,alert,card,badge}.tsx` (new, via `npx shadcn@latest add textarea alert card badge`)

**Intent**: Bring in the shared primitives that charge C3 needs, through the repo's documented shadcn path (`components.json`, style `new-york`).

**Contract**: Components land in `src/components/ui/` unmodified; any new dependency the CLI adds is listed in the phase commit. Do not run `shadcn init`. Update the CLAUDE.md line that says only `Button` is installed.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase

#### Manual Verification:

- `/report-error`, `/dashboard`, `/search`, `/admin/tickets` and `/auth/signin` look the same as before at desktop width (body colour change fully covered by `bg-cosmic`)
- Keyboard focus on the sign-in submit button shows the `--ring` focus ring

**Implementation Note**: After automated verification passes, pause for manual confirmation before the next phase.

---

## Phase 2: XEMI brand tokens (light theme)

### Overview

Make the light `:root` theme carry the XEMI brand (amendment), switch the app back to it, keep the cosmic dark variant in `.dark`, make `bg-cosmic` theme-independent, add the status and brand roles, and add Lato.

### Changes Required:

#### 1. Light theme active

**File**: `src/layouts/Layout.astro`

**Intent**: Revert phase 1's `class="dark"` so `:root` (XEMI light) is the active theme.

**Contract**: `<html lang="en">` without a theme class.

#### 2. XEMI values in `:root`

**File**: `src/styles/global.css`

**Intent**: Map xemi.pl's palette onto role names.

**Contract**: `--background` `#FFFFFF`, `--foreground` `#141414`, `--card`/`--popover` white, `--muted` `#F4F4F4`, `--muted-foreground` a xemi.pl gray meeting 4.5:1 on both white and `#F4F4F4` (≈ `#6F6F6F`), `--border` light gray (≈ `#DDDDDD`), `--input` a gray meeting 3:1 on white (≈ `#8F8F8F`), `--accent` light blue `#BFE5F5` with `--accent-foreground` `#141414`, `--brand` `#009FE3` (logo, large accents; ≈3.0:1 on white — not for text or small controls), `--primary` a darker brand blue meeting 4.5:1 with white `--primary-foreground`, `--ring` brand blue meeting 3:1 on white, `--destructive` a red meeting 4.5:1, `--success`/`--warning` meeting 4.5:1 on white (+ `-foreground`), `--radius` ≈ 0.375rem (xemi.pl uses 4–7 px). All values as `oklch(...)`; `.dark` keeps the cosmic values already staged (plus `--brand` for completeness).

#### 3. Roles published

**File**: `src/styles/global.css`

**Intent**: Make every new role usable as a class.

**Contract**: `@theme inline` publishes `--color-brand`, `--color-success(-foreground)`, `--color-warning(-foreground)`, `--color-destructive-foreground`, and `--font-sans` (Lato first, then system sans).

#### 4. `bg-cosmic` independent of the theme

**File**: `src/styles/global.css`

**Intent**: Keep the 12 dark views (white literal text on `bg-cosmic`) unchanged now that the active theme is light.

**Contract**: `@utility bg-cosmic` reads theme-independent `--cosmic-from` (`#0a0e1a`) and `--cosmic-via` (`#0f1529`) defined once in `:root` as oklch; it does not read `--background`. No hex anywhere in `global.css`.

#### 5. Lato

**File**: `package.json`, `src/layouts/Layout.astro` (or `global.css`)

**Intent**: Use the XEMI typeface without a request to an external font server.

**Contract**: `@fontsource/lato` dependency; weights 400, 700, 800 imported once globally; `body` font comes from `--font-sans` through the existing base layer.

#### 6. Recorded values

**File**: `context/changes/report-error-ui-contract/tokens.md`

**Intent**: Keep the chosen values, their xemi.pl source and contrast in the repo.

**Contract**: Rewritten for the light theme: role → value → xemi.pl source → contrast vs `--background`/`--muted`; a short section keeping the dark (cosmic) values; one line above `:root` in `global.css` pointing to this file.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- `global.css` contains no hex colour: `grep -nE '#[0-9a-fA-F]{3,8}' src/styles/global.css` returns nothing
- Smoke passes against the production preview on a freshly reset local Supabase

#### Manual Verification:

- `tokens.md` lists every role with its xemi.pl source and a contrast meeting AA for text pairs and 3:1 for ring/input border
- `/dashboard`, `/search`, `/admin/tickets` and `/auth/signin` still look as before (dark `bg-cosmic`, readable text)
- Body text renders in Lato

**Implementation Note**: After automated verification passes, pause for manual confirmation before the next phase.

---

## Phase 3: One view on tokens and components

### Overview

Rebuild `/report-error` from token classes and `src/components/ui` components, extracting the repeated local pieces.

### Changes Required:

#### 1. Panel split into presentational components

**File**: `src/components/error-resolution/` (`ErrorResolutionPanel.tsx` plus new sibling files)

**Intent**: Separate state/fetch logic from presentation so each piece uses shared components and the kitchen sink (phase 4) can render every state with static props. Behaviour and API calls are unchanged.

**Contract**: `ErrorResolutionPanel` stays the default export mounted by the page and keeps all state, fetch and `useMyTickets` logic. Presentational components (names indicative): `ErrorTextForm`, `ResolutionOutcome` (matched cards / ticket-created / already-reported), `EscalationControl`, `MyTicketsList`, plus local `FieldCounter` (shared by both text fields) and `CauseSteps` (shared by match cards and resolved tickets). Each takes its data and callbacks as props.

#### 2. Literals → roles and components

**File**: same files + `src/pages/report-error.astro`

**Intent**: Apply the role table from `research.md` (View → source): surfaces → `Card`/`bg-card`/`bg-muted`, text → `text-foreground` / `text-muted-foreground`, fields → `Textarea`, buttons → `Button` (`outline` for secondary actions, `default` for the primary submit), errors → `Alert variant="destructive"`, ticket status → `Badge` with success/warning, outcome headings → `text-success` / `text-warning`, counter over limit → `text-destructive`.

**Contract**: No palette class, arbitrary value or colour function remains in the view files (scan = 0). `cn()` for conditional classes (CLAUDE.md).

#### 3. Page branches

**File**: `src/pages/report-error.astro`

**Intent**: Make the four branches (profile error, staff, client, unassigned) one consistent pattern (C5, view-level part).

**Contract**: One heading style (`text-foreground`, no gradient) and one hint style for all branches; the profile-error branch uses `text-destructive` or an `Alert`; staff and unassigned get distinct headings (e.g. "Strona dla klientów" vs "Konto czeka na przypisanie"); the panel container becomes a `Card`. All texts stay Polish. The page wrapper uses `bg-background` instead of `bg-cosmic` (amendment).

#### 4. XEMI logo in the page header

**File**: `public/logo-xemi.svg` (new, official file from `https://www.xemi.pl/wp-content/themes/xemi/img/logo-xemi.svg`), `src/pages/report-error.astro`

**Intent**: Brand the view as XEMI (amendment).

**Contract**: The logo renders above the page heading in every branch, `alt="XEMI"`, sized by height (≈ 32–40 px desktop, smaller at ≈390 px), with explicit width/height to avoid layout shift. The SVG's own `#009EE2` fill stays as shipped (the hex scan covers view files, not assets).

#### 5. Topbar on tokens

**File**: `src/components/Topbar.astro`, `src/pages/search.astro`, `src/pages/admin/tickets.astro`

**Intent**: Keep the shared Topbar readable on the light `/report-error` while it stays dark on the other pages that render it (amendment).

**Contract**: Topbar uses only token classes (e.g. `bg-card/…`, `border-border`, `text-muted-foreground`, links `text-primary` with focus-visible ring); `search.astro` and `admin/tickets.astro` add `class="dark"` to their outermost wrapper so tokens resolve to the cosmic `.dark` values there. Labels and `lang` unchanged (deferred).

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase
- Hard-coded-value scan on `src/pages/report-error.astro`, `src/components/error-resolution/*.tsx` and `src/components/Topbar.astro` returns 0 matches

#### Manual Verification:

- `/report-error` as Klient Alfa: paste → matched, ticket-created, already-reported, escalation with comment all work as before (no behaviour change)
- Desktop and one mobile (≈390 px) screenshot of the client view: light XEMI look, logo in the header, brand-blue primary actions, Lato
- Staff, unassigned and profile-error branches render with the shared heading/hint pattern and the logo
- Topbar is readable on `/report-error` (light) and still dark on `/search` and `/admin/tickets`

**Implementation Note**: After automated verification passes, pause for manual confirmation before the next phase.

---

## Phase 4: States, visual gate and guardrail

### Overview

Cover the 7-state matrix for every control, add the dev-only kitchen sink with screenshots, and leave the rule and lint check that keep the contract.

### Changes Required:

#### 1. State matrix

**File**: `src/components/error-resolution/*.tsx`

**Intent**: Close the gaps in `research.md` → 7-state matrix.

**Contract**:
- focus-visible: every button via `Button`; fields via `Textarea` (no `outline-none` overrides); ring from `--ring`.
- disabled: keep native `disabled`; show why the main submit is blocked (empty paste → hint "Wklej treść błędu, aby wysłać"; too long → counter message), linked via `aria-describedby`.
- error: `aria-invalid` on a field over its limit; the submit-failure `Alert` sits directly under the form it belongs to.
- loading: `aria-busy` on the form/list while pending; outcome region is a `role="status"` live region; the result area and the list keep a minimum height (or skeleton rows) so content arriving does not shift the layout.
- empty: list empty state kept; matched result with 0 entries renders the no-match message instead of an empty list.
- hover: from `Button` variants.

#### 2. Kitchen sink

**File**: `src/pages/dev/ui-kitchen-sink.astro` (new) + a React island under `src/components/error-resolution/` that renders the presentational components with static props

**Intent**: One page that shows every state of the view side by side — the visual gate and review evidence.

**Contract**: Returns 404 when `import.meta.env.DEV` is false (production build and preview); renders each component in default, disabled, error, empty and loading (hover/focus-visible demonstrated by keyboard on the same page), plus the Topbar in the light theme and inside a `class="dark"` wrapper; Polish copy; no API calls. Screenshots (desktop + ≈390 px) are saved to `context/changes/report-error-ui-contract/screenshots/`.

#### 3. Agent rule

**File**: `CLAUDE.md`

**Intent**: Tell the next agent where tokens and components live and forbid literals (`/10x-ui` *Utrwal to*).

**Contract**: New `### UI contract` subsection under *Key conventions*, **outside** the `<!-- BEGIN/END @przeprogramowani/10x-cli -->` block: tokens in `src/styles/global.css` (`.dark` is the active theme, values in `context/.../tokens.md`), components in `src/components/ui` (check before creating; add via `npx shadcn@latest add <name>`), no palette classes / arbitrary values / colour functions in views — use roles, kitchen sink at `/dev/ui-kitchen-sink` (dev only), the ESLint rule below. Update the shadcn component-set line.

#### 4. Lint guardrail

**File**: `eslint.config.js`

**Intent**: Fail lint (and lint-staged) when a palette or arbitrary colour class is added to the cleaned files.

**Contract**: A config block scoped by `files` to `src/pages/report-error.astro`, `src/components/error-resolution/**`, `src/components/Topbar.astro` and the kitchen-sink files, using `no-restricted-syntax` on string literals in `class`/`className` attributes and in `cn(...)` arguments, matching the scan's palette/arbitrary/colour-function pattern, with a message pointing to the CLAUDE.md UI contract. No new dependency.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `npx astro sync && npx astro check`
- Lint passes: `npm run lint`
- Production build passes: `npm run build`
- Smoke passes against the production preview on a freshly reset local Supabase
- Hard-coded-value scan on the view and kitchen-sink files returns 0 matches
- Lint guardrail fires: adding `text-blue-200` to a class in `ErrorResolutionPanel.tsx` makes `npx eslint src/components/error-resolution` fail (reverted after)
- `/dev/ui-kitchen-sink` returns 404 on the production preview

#### Manual Verification:

- Kitchen sink in `npm run dev` shows every cell of the 7-state matrix for the error form, escalation control, outcomes and list, or an N/A with a reason; screenshots (desktop + ≈390 px) saved in the change folder
- Keyboard-only pass on `/report-error`: every control reachable with a visible focus ring; disabled reason announced; result and errors announced by a screen reader (or verified via the accessibility tree)
- No layout jump when the ticket list loads or a result arrives
- Polish diacritics correct; the page usable at ≈390 px

**Implementation Note**: After automated verification passes, pause for manual confirmation, then run `/10x-impl-review` — UI findings are not skipped as cosmetic by default.

---

## Testing Strategy

### Integration Tests:

- Existing smoke (`npm run smoke`) guards that the API behaviour behind the view is unchanged after the panel split.

### Visual gate:

- Kitchen sink (`/dev/ui-kitchen-sink`, dev only) with desktop + ≈390 px screenshots after phases 3 and 4.
- Hard-coded-value scan after each visual phase; the count must fall (96 → 0) and never rise.

### Manual Testing Steps:

1. As Klient Alfa: matched paste, unmatched paste, duplicate, escalation with/without comment, comment over limit.
2. Keyboard only: Tab through the page, check focus rings, disabled reasons, alerts.
3. As staff and as the unassigned account: branch headings.
4. Kitchen sink at desktop and ≈390 px; compare with phase-3 screenshots.

## Performance Considerations

None: CSS variables and the same component tree; the panel split adds no requests.

## Migration Notes

- No database change. Rolling back the Worker restores the previous look.
- `.dark` on `<html>` is global; phase 1's manual check covers the other views.

## References

- Research: `context/changes/report-error-ui-contract/research.md` (charges C1–C5, role table, 7-state matrix)
- UI checklist: `.claude/skills/10x-ui/references/ui-quality-checklist.md`
- Similar implementation: `src/components/ui/button.tsx:8` (token-based focus ring)
- Previous plans touching the view: `context/archive/2026-09-25-first-gated-error-resolution/plan.md`, `context/archive/2026-10-19-mark-suggestion-unhelpful/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Environment and library

#### Automated

- [x] 1.1 Type-check passes: `npx astro sync && npx astro check` — 229825b
- [x] 1.2 Lint passes: `npm run lint` — 229825b
- [x] 1.3 Production build passes: `npm run build` — 229825b
- [x] 1.4 Smoke passes against the production preview on a freshly reset local Supabase — 229825b

#### Manual

- [x] 1.5 `/report-error`, `/dashboard`, `/search`, `/admin/tickets` and `/auth/signin` look the same as before at desktop width (body colour change fully covered by `bg-cosmic`) — 229825b
- [x] 1.6 Keyboard focus on the sign-in submit button shows the `--ring` focus ring — 229825b

### Phase 2: XEMI brand tokens (light theme)

#### Automated

- [x] 2.1 Type-check passes: `npx astro sync && npx astro check` — 1e9dbc0
- [x] 2.2 Lint passes: `npm run lint` — 1e9dbc0
- [x] 2.3 Production build passes: `npm run build` — 1e9dbc0
- [x] 2.4 `global.css` contains no hex colour: `grep -nE '#[0-9a-fA-F]{3,8}' src/styles/global.css` returns nothing — 1e9dbc0
- [x] 2.5 Smoke passes against the production preview on a freshly reset local Supabase — 1e9dbc0

#### Manual

- [x] 2.6 `tokens.md` lists every role with its xemi.pl source and a contrast meeting AA for text pairs and 3:1 for ring/input border — 1e9dbc0
- [x] 2.7 `/dashboard`, `/search`, `/admin/tickets` and `/auth/signin` still look as before (dark `bg-cosmic`, readable text) — 1e9dbc0
- [x] 2.8 Body text renders in Lato — 1e9dbc0

### Phase 3: One view on tokens and components

#### Automated

- [x] 3.1 Type-check passes: `npx astro sync && npx astro check`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 Production build passes: `npm run build`
- [x] 3.4 Smoke passes against the production preview on a freshly reset local Supabase
- [x] 3.5 Hard-coded-value scan on `src/pages/report-error.astro`, `src/components/error-resolution/*.tsx` and `src/components/Topbar.astro` returns 0 matches

#### Manual

- [x] 3.6 `/report-error` as Klient Alfa: paste → matched, ticket-created, already-reported, escalation with comment all work as before (no behaviour change)
- [x] 3.7 Desktop and one mobile (≈390 px) screenshot of the client view: light XEMI look, logo in the header, brand-blue primary actions, Lato
- [x] 3.8 Staff, unassigned and profile-error branches render with the shared heading/hint pattern and the logo
- [x] 3.9 Topbar is readable on `/report-error` (light) and still dark on `/search` and `/admin/tickets`

### Phase 4: States, visual gate and guardrail

#### Automated

- [ ] 4.1 Type-check passes: `npx astro sync && npx astro check`
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 Production build passes: `npm run build`
- [ ] 4.4 Smoke passes against the production preview on a freshly reset local Supabase
- [ ] 4.5 Hard-coded-value scan on the view and kitchen-sink files returns 0 matches
- [ ] 4.6 Lint guardrail fires: adding `text-blue-200` to a class in `ErrorResolutionPanel.tsx` makes `npx eslint src/components/error-resolution` fail (reverted after)
- [ ] 4.7 `/dev/ui-kitchen-sink` returns 404 on the production preview

#### Manual

- [ ] 4.8 Kitchen sink in `npm run dev` shows every cell of the 7-state matrix for the error form, escalation control, outcomes and list, or an N/A with a reason; screenshots (desktop + ≈390 px) saved in the change folder
- [ ] 4.9 Keyboard-only pass on `/report-error`: every control reachable with a visible focus ring; disabled reason announced; result and errors announced by a screen reader (or verified via the accessibility tree)
- [ ] 4.10 No layout jump when the ticket list loads or a result arrives
- [ ] 4.11 Polish diacritics correct; the page usable at ≈390 px
