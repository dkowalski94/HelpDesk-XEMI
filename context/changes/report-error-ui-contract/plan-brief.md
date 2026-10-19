# Report-error View on the Design-System Contract — Plan Brief

> Full plan: `context/changes/report-error-ui-contract/plan.md`
> Research: `context/changes/report-error-ui-contract/research.md`

## What & Why

The `/report-error` view (the client's main screen) is painted entirely with literal Tailwind palette classes and hand-built buttons, fields and cards, while the shadcn tokens in `global.css` describe a light gray theme the app never shows. This change puts the view on a design-system contract — real tokens, shared components, all seven states, a visual gate and a guardrail — so the next views inherit the contract instead of copying literals.

## Starting Point

`.dark` tokens exist but are never applied; the dark look comes from `bg-cosmic` (hex) and literal `white/blue/purple` classes (96 scan matches in the two view files, 0 token classes). Only `Button` exists in `src/components/ui`; keyboard focus is invisible on every control; status colours have no role.

## Desired End State

The app runs on `<html class="dark">` with `.dark` values that reproduce today's cosmic look plus `success`/`warning` roles. `/report-error` uses only token classes and `src/components/ui` components (scan = 0), every control covers default/hover/focus-visible/disabled/error/empty/loading, a dev-only kitchen sink shows all states with desktop + mobile screenshots, and CLAUDE.md plus an ESLint rule keep the next agent on the contract.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the theme applies | `class="dark"` on `<html>`, app-wide | One theme that matches what users see; `Button`'s `dark:` styles start working everywhere. | Plan |
| Token values | Today's cosmic palette mapped into `.dark` | Contract before pixels: minimal visual delta, easy review. | Plan |
| Status colours | New `--success` / `--warning` roles, one `--destructive` | Same meaning, same colour, one source. | Research C2 + Plan |
| Client heading gradient | Dropped → `text-foreground` | Consistency across the four branches; no token with a single user. | Plan |
| C5 scope | View-level only; `lang`, Topbar, dashboard link, `returnTo` deferred | Topbar touches 3 pages, `returnTo` touches auth. | Plan |
| Guardrail | CLAUDE.md UI block + scoped ESLint `no-restricted-syntax` | Lint-staged blocks drift without a new dependency. | Plan |
| Visual gate | Dev-only kitchen sink (404 in production) + screenshots | No screenshot tooling in the repo; works without a test runner. | Research |
| Panel structure | Split into presentational components, logic stays in `ErrorResolutionPanel` | Shared components per piece and static rendering for the kitchen sink. | Plan |

## Scope

**In scope:** `Layout.astro` theme class; shadcn `Textarea`, `Alert`, `Card`, `Badge`; `global.css` dark values, status roles, `bg-cosmic` from tokens; `tokens.md`; `report-error.astro` and the panel split; 7-state fixes; `/dev/ui-kitchen-sink`; CLAUDE.md UI block; ESLint rule.

**Out of scope:** restyling other views, `Topbar`, `<html lang="pl">`, dashboard link, post-login return, `SubmitButton` overrides, a light theme or switcher, a screenshot test runner, any API behaviour change.

## Architecture / Approach

Tokens (`:root` / `.dark` → `@theme inline` → `bg-card`, `text-muted-foreground`, `text-success`…) feed `src/components/ui` (`Button`, `Textarea`, `Alert`, `Card`, `Badge`), which feed the panel's presentational components (`ErrorTextForm`, `ResolutionOutcome`, `EscalationControl`, `MyTicketsList`, `FieldCounter`, `CauseSteps`). `ErrorResolutionPanel` keeps state and fetches; the kitchen sink renders the presentational pieces with static props.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Environment and library | `.dark` on `<html>`, four shadcn components | Global class visibly changes another view |
| 2. Token values | Cosmic palette in `.dark`, success/warning, `bg-cosmic` from tokens, `tokens.md` | Contrast of translucent surfaces on navy |
| 3. One view | View on tokens/components, panel split, scan 96 → 0 | Behaviour regression from the split (smoke + manual) |
| 4. States, gate, guardrail | 7-state matrix, kitchen sink + screenshots, CLAUDE.md rule, ESLint rule | AST selector misses classes built dynamically |

**Prerequisites:** local Supabase for smoke; network access for `npx shadcn@latest add`.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- `.dark` on `<html>` is assumed invisible on other views because they cover `body` with `bg-cosmic` and literal classes; phase 1's manual check confirms it.
- shadcn components may pull extra dependencies (e.g. Radix packages); they are accepted as the repo's documented component path and listed in the commit.
- The ESLint rule checks literal strings only; dynamically composed class names are covered by the scan and review, not by lint.

## Success Criteria (Summary)

- A keyboard user sees where they are on every control of `/report-error`, and errors, disabled reasons and results are announced.
- The view's colours come from one token source; scan matches drop from 96 to 0 and lint rejects new literals.
- Every state of the view is visible on one kitchen-sink page with recorded screenshots.
