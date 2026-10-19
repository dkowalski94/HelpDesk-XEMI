---
date: 2026-10-19T15:02:40+02:00
researcher: Claude (Opus 5.5) for dkowalski94
git_commit: 45b3d56
branch: master
repository: HelpDesk-XEMI
topic: "Two-way design-system audit of the /report-error view"
tags: [research, ui, design-tokens, shadcn, tailwind, report-error, ErrorResolutionPanel]
status: complete
last_updated: 2026-10-19
last_updated_by: Claude (Opus 5.5)
---

# Research: Two-way design-system audit of the /report-error view

**Date**: 2026-10-19T15:02:40+02:00
**Researcher**: Claude (Opus 5.5) for dkowalski94
**Git Commit**: 45b3d56
**Branch**: master
**Repository**: HelpDesk-XEMI

## Research Question

Audit `/report-error` (`src/pages/report-error.astro` + island `src/components/error-resolution/ErrorResolutionPanel.tsx`) in two directions: (1) source → views — which tokens in `src/styles/global.css` and which components in `src/components/ui` the view, `Topbar` and `Layout` read, and whether `.dark` is ever applied; (2) view → source — for each scan hit, which token or component should have covered it. Record 3–5 charges (missing token / missing shared component / accidental architecture) with file, line and user impact, and the 7-state matrix (default, hover, focus-visible, disabled, error, empty, loading) for the error form, the escalation form and the "Twoje zgłoszenia" list. Note whether changing the shared `Topbar` leaves the one-view scope.

## Summary

- The token source exists but describes a theme the app does not show. `global.css:6-39` holds stock shadcn **light** grayscale values (`--background` white, `--primary` near-black); the dark set at `global.css:41-73` is only reached through the `.dark` class, and a search of `src/` for `dark`, `classList`, `data-theme` and `prefers-color-scheme` finds no place that applies it (only the definitions at `global.css:4,41`; `Layout.astro:14` renders `<html lang="en">` with no class). Every view instead paints `bg-cosmic` — a hex gradient `#0a0e1a → #0f1529` at `global.css:113-115` — and literal white/blue text.
- The view reads **0** token classes and **0** `@/components/ui` imports across the four inspected files (`report-error.astro`, `ErrorResolutionPanel.tsx`, `Topbar.astro`, `Layout.astro`). The hard-coded-value scan finds 96 matches on 64 lines in the two view files (12 on 9 lines in the page, 84 on 55 lines in the panel).
- The literals collapse into about a dozen roles (surface, card, foreground, three muted-text opacities, input, focus, destructive, success, warning, accent). All but **success**, **warning** and the **brand gradient** map onto an existing shadcn token; those three have no token today.
- The panel hand-builds primitives that `button.tsx` or missing shadcn components should cover: 3 `<button>`, 2 `<textarea>`, 2 counters, 3 `role="alert"` boxes, 8 cards, 1 status label.
- Keyboard focus is the weakest state: no button on the view has a `focus-visible:` style, and both textareas set `focus:outline-none` (`ErrorResolutionPanel.tsx:164,309`), cancelling the global `outline-ring/50` from `global.css:119`.
- None of the inspected entry paths (logged out, profile lookup failed, staff, unassigned, client, Supabase unconfigured) renders raw JSON or an empty frame (`report-error.astro:20-54`, `middleware.ts:27-39`). Architecture charges are about language and navigation: `<html lang="en">` around Polish content, an English Topbar and an English dashboard link to this Polish page, and a logged-out deep link that loses its destination.
- Tooling: no Playwright/Storybook/screenshot test exists (`package.json`), so the visual gate has to be a kitchen-sink page. ESLint runs in lint-staged and could host a scoped hard-coded-colour rule.

## Charges

Five charges, ordered by user impact. Each names the evidence and the fix category; the plan maps each to a phase or defers it.

### C1 — Dead token theme: tokens are light defaults, the app is dark, and the view reads none of them (missing tokens)

- **Evidence**: `src/styles/global.css:6-39` (`:root` light values), `:41-73` (`.dark` never applied — see Summary), `:113-115` (`bg-cosmic` hex `#0a0e1a`, `#0f1529`), `src/pages/report-error.astro:16,19` (`bg-cosmic`, `bg-white/10 border-white/10 text-white`), 96 scan matches in the two view files.
- **User impact**: the screen has no single source of colour, so the same role is painted differently across this view and 12 others (`admin/tickets.astro`, `dashboard.astro`, `search.astro`, auth pages…), and any shadcn component dropped in today would render the light theme (near-black `bg-primary`) on the dark cosmic background.
- **Fix**: give the app one theme the tokens actually describe — apply the dark set (e.g. `class="dark"` on `<html>`) or retune `:root` to the cosmic palette — move `bg-cosmic`'s colours into tokens, then make this view read roles (`bg-card`, `text-muted-foreground`, `border-border`, `bg-input`). Recording the chosen values in the change folder is part of the fix.

### C2 — Status colours have no semantic role; one role, several hues (missing tokens)

- **Evidence**: success `text-emerald-200` (`ErrorResolutionPanel.tsx:208,364`); warning/attention `text-amber-200` (`report-error.astro:30,48`; `ErrorResolutionPanel.tsx:121,223,236,364`), where amber also means "info / already reported" (`:121,236`); destructive split between `text-rose-200` (`report-error.astro:22`) and `red-100/300/400/500` (`ErrorResolutionPanel.tsx:170,188,315,335,346`); muted text in four opacities `text-blue-100/40,/50,/60,/80` (e.g. `:31,42,46,164` and 28 more anchors in the role table below).
- **User impact**: the same meaning (error, success, "waiting") arrives in different colours on one screen, and nothing keeps contrast of these faded tints in check against the background.
- **Fix**: add `--success` and `--warning` (each with `-foreground`) to `:root`/`.dark` and `@theme inline`; use `--destructive` for every error; collapse muted text to `text-muted-foreground` (+ one `foreground/80` body level if needed). No `--color-destructive-foreground` is published today (`global.css:75-111`).

### C3 — Hand-built primitives instead of the repo's Button and missing shadcn components (missing shared component)

- **Evidence**: `<button>` ×3 (`ErrorResolutionPanel.tsx:134,175,320`) duplicating `Button variant="outline"` from `src/components/ui/button.tsx`; `<textarea>` ×2 (`:155,300`, identical classes); counter ×2 (`:167,312`); `role="alert"` box ×3 (`:188,335,346`); card ×8 (`:27,38,109,120,148,222,235,356`) plus the page panel (`report-error.astro:19`); status label ×1 (`:361-368`); "Przyczyna/Kroki" block ×4 (`:44-53`, `:372-381`).
- **User impact**: the three buttons differ from the shared one (radius `rounded-lg` vs `rounded-md`, no focus ring, hand-rolled disabled look), and every copy drifts separately — the escalation form added in S-03 already duplicated the main form wholesale.
- **Fix**: use `Button`; add `Textarea`, `Alert`, `Card`, `Badge` via `npx shadcn@latest add <name>` (CLAUDE.md: the shadcn path); extract the counter and the cause/steps block as local components. `Button` is currently imported only by `auth/SubmitButton.tsx:3`, which overrides it with `bg-purple-600 … text-white` — out of this view's scope, noted for a later change.

### C4 — No visible keyboard focus on any control of the view (missing tokens / states)

- **Evidence**: buttons `ErrorResolutionPanel.tsx:134-143,175-185,320-330` have `hover:` only; textareas `:164,309` use `focus:border-purple-300/60 focus:outline-none`, which removes the global `outline-ring/50` (`global.css:119`) and leaves a faint border change; Topbar links (`Topbar.astro:10-19`) rely on the browser default.
- **User impact**: a keyboard user cannot reliably see which control is active — the form, the escalation button and the comment field are effectively unfocusable to the eye.
- **Fix**: drive focus from `--ring` (`focus-visible:ring-ring/50 ring-[3px]` as `button.tsx:8` already does); remove `outline-none` from fields; verify in both the state matrix and the kitchen sink. Moving the accent does not move the focus token — check it separately.

### C5 — Language and entry-point drift around a Polish view (accidental architecture)

- **Evidence**: `<html lang="en">` (`Layout.astro:14`) with `lang="pl"` only on the content div (`report-error.astro:19`), so `<title>` and Topbar sit under `en`; Topbar labels are English ("Dashboard", "Web search", "Sign out" — `Topbar.astro`) and the only link to this page is English ("Report an ERP error", `dashboard.astro:73-79`); a logged-out visitor is redirected to `/auth/signin` (`middleware.ts:5,36-39`) and after sign-in lands on `/` (`api/auth/signin.ts:19`), not back on `/report-error`; staff and unassigned branches share one heading with no distinction (`report-error.astro:30,48`) and the client heading is the only gradient (`:37`).
- **User impact**: a Polish user reaches this page through English labels, a screen reader reads the chrome with English pronunciation, and someone who follows a shared link to report an error is dropped on the home page after logging in.
- **Fix**: within this change — Polish labels and `lang="pl"` for this view's chrome, consistent headings across the four branches (one heading component, status via token). **Deferred candidates** (reach outside one view): app-wide `<html lang="pl">` and a Polish Topbar touch `search.astro` and `admin/tickets.astro`; a `returnTo` after sign-in touches the auth flow.

## Detailed Findings

### Source → views

- Tokens: `:root` and `.dark` both define background, foreground, card, popover, primary, secondary, muted, accent (each with `-foreground`), destructive, border, input, ring, chart-1..5 and sidebar*; `@theme inline` publishes them as `--color-*` plus `--radius-sm/md/lg/xl` (`global.css:75-111`). No font tokens.
- `@layer base` sets `* { border-border outline-ring/50 }` and `body { bg-background text-foreground }` (`global.css:117-124`) — the only token-driven styling that reaches the view, immediately covered by `bg-cosmic` and literal text colours.
- Components: `button.tsx` has variants default/destructive/outline/secondary/ghost/link and sizes default/sm/lg/icon, fully token-based with a focus-visible ring (`button.tsx:8`). `LibBadge.astro` uses palette literals and is imported nowhere in `src/`. `components.json`: style `new-york`, baseColor `neutral`, `cssVariables: true`, css `src/styles/global.css`, ui alias `@/components/ui`.
- Shared chrome: `Topbar.astro` uses palette literals only (`border-white/10 bg-white/5 text-white/80` line 5, `text-blue-100/70` lines 8 and 25, `text-purple-300 hover:text-purple-100` ×5) and is imported by `report-error.astro`, `search.astro` and `admin/tickets.astro`. **Changing it leaves the one-view scope.**
- The same palette idiom (glass card `rounded-2xl border-white/10 bg-white/10 backdrop-blur-xl`, `text-blue-100/*`, purple accents, `bg-cosmic`) repeats with 0 token classes in each of: `admin/tickets.astro`, `admin/users.astro`, `Welcome.astro`, `WebSearchPanel.tsx`, `dashboard.astro`, `search.astro`, `auth/signin|signup|confirm-email.astro`, `FormField.tsx` (grep counts; these files were not read line by line).

### View → source: literals by role

| Role | Literals (anchors) | Count | Token that should cover it |
|---|---|---|---|
| Panel surface | `bg-white/10 border-white/10 text-white` (`report-error.astro:19`) | 3 | `bg-card border-border text-card-foreground` |
| Inner card | `bg-white/5` (`tsx:27,38,109,120,148,222,235,356`), `border-white/10` (same + `:342`) | 17 | `bg-card` / `bg-muted`, `border-border` |
| Foreground / headings | `text-white` (`tsx:45,51,149,294,343,373,379`) | 7 | `text-foreground` |
| Body text /80 | `text-blue-100/80` (`tsx:32,46,52,110,122,224,237,358,374,380`) | 10 | `text-foreground/80` or `text-card-foreground` |
| Hint text /60 | `text-blue-100/60` (`astro:23,31,40,49`; `tsx:42,126,152,209,226,297,344,351`) | 12 | `text-muted-foreground` |
| Meta text /50 | `text-blue-100/50` (`tsx:31,170,315,369`) | 4 | `text-muted-foreground` |
| Placeholder /40 | `placeholder:text-blue-100/40` (`tsx:164,309`) | 2 | `placeholder:text-muted-foreground` |
| Success | `text-emerald-200` (`tsx:208,364`) | 2 | none — new `--success` |
| Warning / info | `text-amber-200` (`astro:30,48`; `tsx:121,223,236,364`) | 6 | none — new `--warning` |
| Error headline | `text-rose-200` (`astro:22`) | 1 | `text-destructive` |
| Error alert | `border-red-400/40 bg-red-500/10 text-red-100` (`tsx:188,335,346`) | 9 | `border-destructive/40 bg-destructive/10 text-destructive` |
| Counter over limit | `text-red-300` (`tsx:170,315`) | 2 | `text-destructive` |
| Accent / brand | `text-purple-200` (`tsx:28,39`); gradient `from-blue-200 to-purple-200` (`astro:37`) | 4 | `text-primary` / `--accent`; no gradient token |
| Focus | `focus:border-purple-300/60 focus:outline-none` (`tsx:164,309`) | 2 | `focus-visible:border-ring focus-visible:ring-ring/50` |
| Input field | `border-white/20 bg-white/10` (`tsx:164,309`) | 4 | `border-input bg-input/30` |
| Button chrome | `border-white/20 bg-white/10 hover:bg-white/20` (`tsx:139,179-180,324-325`) | 9 | `Button variant="outline"` |

No `style=`, arbitrary `-[..px]` values or hex/rgb/oklch appear in the two view files; the only literal colours outside Tailwind classes are `bg-cosmic`'s hex values. The scan regex counts `hover:`/`focus:`/`placeholder:`-prefixed classes and does not catch `text-transparent`/`bg-clip-text` (`astro:37`).

### 7-state matrix (as implemented today)

| State | Error-text form | Escalation control | Result views | "Twoje zgłoszenia" |
|---|---|---|---|---|
| default | palette literals (`tsx:294-330`) | palette literals (`:134-191`) | cards, literals (`:205-240`) | rows, literals (`:342-385`) |
| hover | `hover:bg-white/20` when not blocked (`:325`) | same (`:139,180`) | n/a (static) | n/a (static) |
| focus-visible | **not handled** — no ring on button; textarea `outline-none` (`:309`) | **not handled** (`:134,164,175`) | n/a | n/a (no focusable items; truncated text only via `title`, `:358`) |
| disabled | native `disabled` + `opacity-50 cursor-not-allowed` (`:320-326`); no reason shown | same (`:175-180`) | n/a | n/a |
| error | counter red + `aria-live`, linked by `aria-describedby` (`:305,312-319`), no `aria-invalid`; submit failure `role="alert"` below the form, not tied to the field (`:334-338`) | `role="alert"` inside the form (`:187-191`) | n/a | `role="alert"` (`:345-349`) |
| empty | blank/whitespace paste disables submit with no message (`:256`) | comment optional — n/a | 0 matches not handled (server does not send it) | real empty state "Nie masz jeszcze żadnych zgłoszeń." (`:350-352`) |
| loading | spinner + "Szukam rozwiązania..." (`:328-329`), not announced; old result cleared at submit (`:264`) so the area jumps twice | spinner + "Przekazuję..." | no `role="status"`/live region on the outcome sections (`:207,222,235`); escalation success has `role="status"` (`:109,120`) | single line "Wczytywanie..." (`:344`) replaced by N rows (layout shift); `reload()` keeps the old list with no indicator |

### Accessibility minimum

- Both textareas have a `<label htmlFor>` (`tsx:149,294`); every button has visible text; status labels pair colour with text (`tsx:361-367`).
- `lang`: see C5. ESLint applies jsx-a11y only to `.astro` files (`eslint.config.js:91`); the `.tsx` block (`:42-58`) has none.
- Unverified: whether lucide-react icons default to `aria-hidden` (open question).

### Tooling for the gate and the guardrail

- No Playwright, `toHaveScreenshot`, Storybook or kitchen-sink page (`package.json` devDependencies, `src/pages` tree). `scripts/smoke.mjs` is fetch-only. → The visual gate is a kitchen-sink page with desktop + one mobile screenshot.
- lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` (`package.json:59-66`). A scoped `no-restricted-syntax` rule on class-name literals (palette classes) for the cleaned files is feasible without a new dependency.
- CLAUDE.md has no UI rule beyond `cn()` (`CLAUDE.md:80`) and none encouraging one-off values; the new UI rule belongs outside the `<!-- BEGIN/END @przeprogramowani/10x-cli -->` block.

## Code References

- `src/styles/global.css:4` — `@custom-variant dark (&:is(.dark *))`
- `src/styles/global.css:6-39` / `:41-73` — `:root` light and `.dark` token values
- `src/styles/global.css:75-111` — `@theme inline` publication (no destructive-foreground, no success/warning)
- `src/styles/global.css:113-115` — `bg-cosmic` hex gradient
- `src/styles/global.css:117-124` — base layer (`outline-ring/50`, `bg-background`)
- `src/layouts/Layout.astro:14` — `<html lang="en">`, no theme class
- `src/pages/report-error.astro:16-54` — page shell and four role branches
- `src/components/error-resolution/ErrorResolutionPanel.tsx:134,175,320` — hand-built buttons
- `src/components/error-resolution/ErrorResolutionPanel.tsx:155,164,300,309` — textareas with `outline-none`
- `src/components/error-resolution/ErrorResolutionPanel.tsx:188,335,346` — alert boxes
- `src/components/ui/button.tsx:8` — token-based focus-visible ring
- `src/components/Topbar.astro:5-25` — shared chrome, English labels, palette literals
- `src/pages/dashboard.astro:73-79` — only entry link, English label
- `src/middleware.ts:5,36-39`, `src/pages/api/auth/signin.ts:19` — logged-out redirect, post-login `/`

## Architecture Insights

- Contract variant: **fresh starter with a dead token file** — shadcn tokens and one component shipped, screens built from literals. Phase 1 is making the theme real and the view read it, not picking a new palette.
- Inference: the tokens and the visible theme diverged at bootstrap — the starter's cosmic look was never expressed as tokens, and the 12 views counted above repeat the same literals instead (observed directly for the S-03 escalation form, which copies the main form's classes).
- Any new token must be added in three places to work: `:root`, `.dark` (or whichever theme is chosen) and `@theme inline`.

## Historical Context (from prior changes)

- `context/archive/2026-10-19-mark-suggestion-unhelpful/plan.md` — Phase 2 added the escalation control by copying the main form's classes (no UI contract existed); its manual criteria checked diacritics and phone width only, not focus.
- `context/archive/2026-09-25-first-gated-error-resolution/plan.md` — created the page and panel (criteria 3.9, 3.13: counter colour, diacritics, phone width); no focus or token criteria.
- No prior research.md concerns UI.

## Related Research

Not applicable — no earlier UI research in `context/changes/**` or `context/archive/**`.

## Open Questions

1. **Which theme do the tokens describe?** Apply the existing shadcn `.dark` set to `<html>` (closest to today's look, minimal value work) vs retune `:root` to the cosmic palette (keeps one theme, more value choices). Product decision for the plan.
2. **Brand gradient heading** (`report-error.astro:37`): keep as a brand token, or drop to `text-foreground` for consistency with the other branches.
3. **Scope of C5 fixes**: `<html lang="pl">` and a Polish Topbar are app-wide; keep them deferred or accept a deliberately wider change.
4. Whether lucide-react 1.x sets `aria-hidden` on icons by default (not verified).
