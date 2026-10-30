# UI consistency pass (S-07) — Plan Brief

> Full plan: `context/changes/ui-consistency-pass/plan.md`
> Research: `context/changes/ui-consistency-pass/research.md`

## What & Why

All 9 pages are already on the XEMI tokens, but moving between them the title size, card padding, intro text, link hover and tab titles change, because each change copied the page frame and its class strings from a different page. This last M-2 slice gives them one shell and one set of shared classes, fixes focus rings where they are defined, removes the dead cosmic theme, and leaves a rule and lint so the next page inherits the contract instead of copying.

## Starting Point

0 hard-coded colours in the linted views; the frame (`max-w-5xl` → Topbar → Card) is written out 7 times, `headingClass` 9 times in 4 variants, `FOCUS_RING` 4 times + 1 inline. Primitives still draw `ring-ring/50`, an invalid field's focus ring loses to `destructive/20`, the banner uses hex in `<style>`, and `.dark`/`--cosmic-*` survive only for one kitchen-sink cell.

## Desired End State

Every page renders through `PageShell` (panel / narrow for auth / hero for the start page) with a tab title `<h1> — HelpDesk XEMI`; shared classes come from `src/lib/ui-classes.ts`; every focused control shows a full-strength ring (red on an invalid field); one light theme, no cosmic leftovers; CLAUDE.md and lint cover every view.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Cosmic / `.dark` | Remove `.dark`, `--cosmic-*`, `bg-cosmic`, dark cell; keep `@custom-variant dark` | One theme in the contract, and OS dark mode cannot switch on the primitives' `dark:` classes | Plan |
| Shared shell | `PageShell.astro` + `src/lib/ui-classes.ts` | The next page inherits the frame and classes instead of copying them | Plan |
| Focus fix location | In the primitives + base layer | Fixes the cause; `FOCUS_RING` copies disappear; re-apply note after `shadcn add` | Plan |
| 404 heading | Panel size like other app pages; only the start page is a hero | Two clear variants: hero for the landing, panel everywhere else | Plan |
| Tab titles | `<h1> — HelpDesk XEMI`, `/` stays `HelpDesk XEMI` | Tabs name both the app and the page; title and h1 can no longer drift | Plan |
| Extras in scope | UTC `formatDate` fix, UserBar „Konta do przypisania”, `aria-hidden` spinners, confirm-email button | Small, found in research, the user chose all four | Plan |
| Admin select | Stays native; only its class is shared | S-05 decision (no-JS GET form, no island) | Research |
| Visual gate | Before/after screenshots + kitchen-sink section, no new test runner | Repo has no screenshot tooling; `/10x-ui` gate | Research |

## Scope

**In scope:**
- Primitives (`button`, `input`, `textarea`, `badge`) full ring + invalid-focus ring; base `outline-ring`
- `PageShell`, `ui-classes.ts`, all 9 pages + `ClientPageLayout` migrated; 404 as panel
- Banner on tokens; delete `LibBadge` and the cosmic theme
- One link style, confirm-email button, UserBar label, spinner `aria-hidden`, UTC date fix
- Kitchen-sink section for the shared pieces; lint scope; CLAUDE.md + design-tokens.md

**Out of scope:**
- Dark mode, new colour roles, shadcn `Select`
- Pending state on admin forms; unifying `disabled` vs `aria-disabled`
- `resolveAudience()` extraction, my-tickets item padding, forced-colors work

## Architecture / Approach

Source first, then composition, then alignment, then the rule. `PageShell` = `Layout` + `bg-background p-4` wrapper + `max-w-5xl` frame + `Topbar` + `Card` (variant class from `ui-classes.ts`); pages and `ClientPageLayout` pass only the h1 title and variant. Components that rendered their own `Card` (`StartPage`, `NotFound`, `ConfirmEmailNotice`) drop it; the kitchen sink wraps them with the same card constants.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Primitives, base layer and theme cleanup | Baseline screenshots; full focus rings incl. invalid fields; banner on tokens; cosmic + LibBadge gone | Invalid-focus rule must win in compiled CSS order — verify in `dist/` |
| 2. Shared class module and PageShell | One shell and one class module for all 9 pages; titles; 404 panel; UTC fix | Large diff across every page; smoke must stay green |
| 3. Control alignment and states | One link style, confirm-email button, UserBar label, spinners, kitchen-sink state section | Longer UserBar label wrapping at 375 px |
| 4. Lock it in | Lint over all view files; CLAUDE.md and design-tokens.md rewritten; after-screenshots | Docs drift if written before code settles — done last |

**Prerequisites:** Local Supabase (`npx supabase start`, `db reset`), seeded personas, `npm run dev` for screenshots.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Baseline screenshots do not exist yet — phase 1 must take them before the first edit, or the visual gate has nothing to compare against.
- Editing shadcn primitives breaks the "primitives unmodified" precedent; a future `shadcn add` re-introduces `ring-ring/50` unless the CLAUDE.md note is followed.
- Focus cannot be rendered statically, so the kitchen sink documents it with a caption and the manual keyboard pass checks it.

## Success Criteria (Summary)

- Moving guest → sign-in → client pages → staff pages → 404 shows one look: same width, heading, spacing, buttons, focus and user bar.
- A keyboard user sees a full-strength focus ring on every control, including a field with a validation error.
- A new page built from CLAUDE.md uses `PageShell` and `ui-classes.ts`, and lint fails if it adds a palette class.
