# Report-error View on the Design-System Contract — Plan Brief

> Full plan: `context/changes/report-error-ui-contract/plan.md`
> Research: `context/changes/report-error-ui-contract/research.md`

## What & Why

The `/report-error` view (the client's main screen) is painted entirely with literal Tailwind palette classes and hand-built buttons, fields and cards, while the shadcn tokens in `global.css` describe a light gray theme the app never shows. This change puts the view on a design-system contract — real tokens, shared components, all seven states, a visual gate and a guardrail — so the next views inherit the contract instead of copying literals.

## Starting Point

`.dark` tokens exist but are never applied; the dark look comes from `bg-cosmic` (hex) and literal `white/blue/purple` classes (96 scan matches in the two view files, 0 token classes). Only `Button` exists in `src/components/ui`; keyboard focus is invisible on every control; status colours have no role.

## Desired End State

`/report-error` follows xemi.pl: the light XEMI theme in `:root` is active (white, `#F4F4F4` surfaces, `#141414` text, brand blue, Lato), the XEMI logo sits in the page header, and the view uses only token classes and `src/components/ui` components (scan = 0). Every control covers default/hover/focus-visible/disabled/error/empty/loading, a dev-only kitchen sink shows all states with desktop + mobile screenshots, and CLAUDE.md plus an ESLint rule keep the next agent on the contract. Other views stay dark (`bg-cosmic` made theme-independent); the shared Topbar is on tokens and renders dark on them via `class="dark"` wrappers.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Theme | Light XEMI theme in `:root` active; cosmic values kept in `.dark` | Matches the company site (xemi.pl), analysed with the user; phase 1's `.dark` on `<html>` is reverted in phase 2. | Amendment |
| Token values | xemi.pl palette: white, `#F4F4F4`, `#141414`, `#BFE5F5`; `--brand` `#009FE3` for logo/large accents, darker brand blue for `--primary`/`--ring` | `#009FE3` is ≈3.0:1 on white — too weak for text and button labels. | Amendment |
| Other dark views | `bg-cosmic` on theme-independent variables | Prevents white-on-white on the 12 views still using literal white text. | Amendment |
| Topbar | On tokens; `class="dark"` on `search` and `admin/tickets` wrappers | Readable on the light view, unchanged on dark pages; labels/`lang` still deferred. | Amendment |
| Logo and font | `public/logo-xemi.svg` in the view header; Lato via `@fontsource/lato` | Brand identity without an external font request. | Amendment |
| Status colours | New `--success` / `--warning` roles, one `--destructive` | Same meaning, same colour, one source. | Research C2 + Plan |
| Client heading gradient | Dropped → `text-foreground` | Consistency across the four branches; no token with a single user. | Plan |
| C5 scope | View-level only; Topbar labels, `lang`, dashboard link, `returnTo` deferred (Topbar colours in scope, see Amendment) | Labels touch 3 pages, `returnTo` touches auth. | Plan |
| Guardrail | CLAUDE.md UI block + scoped ESLint `no-restricted-syntax` | Lint-staged blocks drift without a new dependency. | Plan |
| Visual gate | Dev-only kitchen sink (404 in production) + screenshots | No screenshot tooling in the repo; works without a test runner. | Research |
| Panel structure | Split into presentational components, logic stays in `ErrorResolutionPanel` | Shared components per piece and static rendering for the kitchen sink. | Plan |

## Scope

**In scope:** `Layout.astro` theme class; shadcn `Textarea`, `Alert`, `Card`, `Badge`; `global.css` dark values, status roles, `bg-cosmic` from tokens; `tokens.md`; `report-error.astro` and the panel split; 7-state fixes; `/dev/ui-kitchen-sink`; CLAUDE.md UI block; ESLint rule.

**Out of scope:** restyling other views, Topbar labels, `<html lang="pl">`, dashboard link, post-login return, `SubmitButton` overrides, a light theme or switcher, a screenshot test runner, any API behaviour change.

## Architecture / Approach

Tokens (`:root` / `.dark` → `@theme inline` → `bg-card`, `text-muted-foreground`, `text-success`…) feed `src/components/ui` (`Button`, `Textarea`, `Alert`, `Card`, `Badge`), which feed the panel's presentational components (`ErrorTextForm`, `ResolutionOutcome`, `EscalationControl`, `MyTicketsList`, `FieldCounter`, `CauseSteps`). `ErrorResolutionPanel` keeps state and fetches; the kitchen sink renders the presentational pieces with static props.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Environment and library | `.dark` on `<html>`, four shadcn components | Global class visibly changes another view |
| 2. XEMI brand tokens | Light XEMI theme in `:root`, `.dark` reverted on `<html>`, brand/success/warning roles, `bg-cosmic` independent, Lato, `tokens.md` | Brand blue contrast on white |
| 3. One view | View on tokens/components, panel split, logo, Topbar on tokens, scan 96 → 0 | Behaviour regression from the split; Topbar on dark pages |
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
