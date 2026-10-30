---
date: 2026-10-30T12:40:00+01:00
researcher: Claude (Opus 5.5) for pchlisty
git_commit: 411048b
branch: master
repository: Projekt_Dawid (10x-astro-starter / HelpDesk XEMI)
topic: "S-07 ui-consistency-pass — two-way UI contract audit across every page"
tags: [research, ui, design-tokens, focus-ring, layout, eslint, kitchen-sink]
status: partial
last_updated: 2026-10-30
last_updated_by: Claude (Opus 5.5)
---

# Research: S-07 ui-consistency-pass — cross-page UI contract audit

**Date**: 2026-10-30T12:40:00+01:00
**Researcher**: Claude (Opus 5.5) for pchlisty
**Git Commit**: 411048b (working tree has unrelated `.claude/skills` edits only)
**Branch**: master
**Repository**: Projekt_Dawid

## Research Question

Roadmap S-07 (`context/foundation/roadmap.md:160-171`): a guest, client and staff member moving between every page — `/`, `/report-error`, `/my-tickets`, `/auth/{signin,signup,confirm-email}`, 404, `/admin/tickets`, `/admin/users` — should see one consistent light XEMI look (width, headings, spacing, buttons, focus rings, user bar), and the leftover cosmic theme goes if unused. Confirm or reject the five `/10x-ui` pre-audit candidates, find what they missed, and record 3–5 charges with file:line and user impact.

**Status `partial`** because one requested input is missing: baseline screenshots (desktop + 375 px) were not taken — the dev server was not running during research (`curl localhost:4321` → no connection; local Supabase on `:54321` was up). Every finding below is from source; none was checked in a browser. Plan phase 0 must capture the baseline before any edit.

## Summary

All 9 pages already sit on the same token set, the same `Topbar`/`UserBar`, `bg-background` and the `max-w-5xl` frame, and the hard-coded-value scan finds **0 hits in the 17 linted view globs** (`eslint.config.js:100-118`). The inconsistencies are one level up: the page shell and its typography were **copied, not shared** — by explicit instruction of the S-05/S-06/S-04 plans — and the copies drifted. Five charges:

1. **C1 Accidental architecture — page shell copied 7×, typography drifted.** Heading size, card padding, lead paragraph and heading spacing differ between pages (4 `headingClass` variants in 9 definitions).
2. **C2 Missing shared component — control/link class strings duplicated.** `FOCUS_RING` defined 4× + 1 inline, quiet link class 6× in 2 hover styles, native `<select>` class 2× byte-identical, button-as-link in 2 patterns.
3. **C3 Focus state — the full-strength ring loses on invalid fields, and the base outline is half-alpha.** On a field with `aria-invalid="true"` the focus ring becomes `destructive/20` (compiled-CSS order verified); the base `outline-ring/50` (1.91:1) is the only focus style on the Banner link.
4. **C4 Missing tokens — Banner.astro hex palette, outside lint reach.** `<style>` block with Tailwind-palette hex; `Layout.astro`/`Banner.astro` not in `uiContractConfig`, and the rule cannot see `<style>` anyway. Dead `LibBadge.astro` carries palette classes.
5. **C5 Dead cosmic theme and stale contract docs.** `bg-cosmic`/`--cosmic-*` have 0 consumers; `.dark` has 1 (a kitchen-sink cell); CLAUDE.md:88/:90 and `design-tokens.md` still describe un-migrated cosmic views.

Pre-audit corrections: candidate 2 ("`ring-ring/50` in primitives leaves focus weak on `/report-error` and `/admin/*`") is **rejected as stated** — every inspected production control overrides it via `cn(FOCUS_RING)` and tailwind-merge drops the `/50` (verified, see C3); the real focus defects are the two in C3. Candidate 3's claim that the admin `<select>` ring falls back to `currentColor` is **rejected** — both selects merge `FOCUS_RING` (`StaffTicketQueue.astro:68-71`, `StaffUserAssignment.astro:31-34`); the duplication itself is confirmed (C2).

## Charges

### C1 — Accidental architecture: page shell copied 7×, heading/padding/lead drifted

- **Evidence**
  - Wrapper `min-h-screen bg-background p-4` → `mx-auto w-full max-w-5xl` → `<Topbar />` is written out in 7 places: `src/pages/index.astro:26-28`, `src/pages/404.astro:10-12`, `src/pages/auth/signin.astro:29-31`, `src/pages/auth/signup.astro:26-28`, `src/pages/auth/confirm-email.astro:13-15`, `src/pages/admin/tickets.astro:75-77`, `src/pages/admin/users.astro:30-32`, plus `src/layouts/ClientPageLayout.astro:38-40`. `index`/`404` use a `flex flex-col flex-1` variant; on 404 it has no effect (its Card has no `flex-1`, `src/components/NotFound.astro:17`).
  - Card padding: `sm:p-10` on `/` and 404 (`src/components/start/StartPage.astro:51`, `NotFound.astro:17`); `sm:p-8` on the other 7 pages (`ClientPageLayout.astro:41`, `admin/tickets.astro:78`, `admin/users.astro:33`, `signin.astro:32`, `signup.astro:29`, `ConfirmEmailNotice.astro:26`).
  - `headingClass` — 9 definitions, 4 variants: `mb-2 text-2xl` ×5 (`ClientPageLayout.astro:33`, `AccountStatusNotice.astro:17`, `StaffTicketQueue.astro:61`, `StaffUserAssignment.astro:28`; `ClientPageLayout`'s second branch reuses it), `mb-2 text-3xl sm:text-4xl` ×2 (`StartPage.astro:38`, `NotFound.astro:11`), `mb-6 text-2xl` ×2 (`signin.astro:21`, `signup.astro:18`), `mb-3 text-2xl` ×1 (`ConfirmEmailNotice.astro:20`).
  - Lead paragraph: `max-w-2xl text-muted-foreground sm:text-lg` on `/` and 404 (`StartPage.astro:39`, `NotFound.astro:12`); `text-sm` full-width with `mb-6` on client/admin pages (`ClientPageLayout.astro:34`, `StaffTicketQueue.astro:62`, `StaffUserAssignment.astro:29`); base size centred on confirm-email (`ConfirmEmailNotice.astro:29`); none on signin/signup.
  - Section headings: `text-xl font-bold` (`StartPage.astro:40`) vs `text-lg font-semibold` (`ResolutionOutcome.tsx:55,69,85,100`).
  - Topbar→content gap is consistent: 16 px from `UserBar.astro:46` (`mb-4`) on all 9 pages.
- **User impact**: moving from the start page or 404 to any working page, the title shrinks from 3xl/4xl to 2xl, card padding drops from 40 to 32 px, and the intro text changes size and line length; the 404 looks like a landing page rather than one of the app's panels.
- **Why it happened**: S-05 and S-06 were told to copy "Chrome to match `ClientPageLayout.astro`" (`context/archive/2026-10-28-staff-ticket-company-filter/plan.md:27,71`; `context/archive/2026-10-30-admin-users-ui-contract/plan.md:13,63`), S-04's 404 to use the "same frame as `index.astro`" (`context/archive/2026-10-29-polish-sign-in/plan.md:85`). `ClientPageLayout` was created only for the two client pages (`context/archive/2026-10-27-my-tickets-page/plan.md:46,58-62`). No archived document discusses a shared shell or cross-page heading sizes (searched `text-2xl|text-3xl|text-4xl|sm:text|heading size` across `context/archive/**` and `context/foundation/**`: 0 hits).
- **Intentional, keep**: narrow centred `max-w-md` auth cards (`context/archive/2026-10-29-polish-sign-in/plan.md:241`) and `max-w-5xl` as the app width (user decision, `context/archive/2026-10-28-start-page/change.md` Notes).

### C2 — Missing shared component: control and link class strings duplicated

- **Evidence**
  - `FOCUS_RING = "focus-visible:border-ring focus-visible:ring-ring"` defined in 4 files — `src/components/error-resolution/format.ts:7`, `src/components/auth/FormField.tsx:9`, `src/components/auth/SubmitButton.tsx:7`, `src/components/UserBar.astro:35` — and inlined in `src/components/NotFound.astro:14`.
  - Quiet text-link class with full-strength outline focus copied 6× in two hover styles: colour-change + transition (`UserBar.astro:40-41`, `src/pages/report-error.astro:9-10`) vs `font-medium`, no colour change (`signin.astro:23-24`, `signup.astro:20-21`, `ConfirmEmailNotice.astro:22-23`); `PasswordToggle.tsx:4-5` repeats the focus part.
  - Native `<select>` class byte-identical in `StaffTicketQueue.astro:69` and `StaffUserAssignment.astro:32` (diffed); unlike `Input` it has no `disabled:`/`aria-invalid:` styles. The native select itself is a recorded decision — no-JS GET form, "No shadcn `Select` / React island" (`context/archive/2026-10-28-staff-ticket-company-filter/plan.md:35`, `plan-brief.md:22,58`) — so the charge is the copied class, not the element.
  - Button-styled links in 2 patterns: `buttonVariants()` + `FOCUS_RING` on `<a>` (`UserBar.astro:36-37`, `NotFound.astro:14`, `StaffTicketQueue.astro:143,220`) vs `<Button asChild>` (`MyTicketsList.tsx:68,73`).
  - Success alert block duplicated (`StaffTicketQueue.astro:109-111`, `StaffUserAssignment.astro:41-43`); destructive alert classes in `ErrorAlert.tsx:6` and `ServerError.tsx:13` (the latter adds an icon).
- **User impact**: links behave differently on hover depending on the page (the report-error and top-bar links change colour, the auth links do not), and every new view picks one of the copies at random — the drift in C1 is the visible result of the same mechanism.
- **Note**: the report-error impl-review already left splitting `format.ts` (class constants vs `formatDate`) "for a later change" (`context/archive/2026-10-19-report-error-ui-contract/reviews/impl-review.md:123,125`).

### C3 — Focus state: ring loses to `aria-invalid`; base outline is half-alpha

- **Evidence**
  - `Input` and `Textarea` carry `aria-invalid:border-destructive aria-invalid:ring-destructive/20` (`src/components/ui/input.tsx:12`, `src/components/ui/textarea.tsx:9`). Compiling the variants with the repo's Tailwind (4.3.3) emits `.focus-visible\:*:focus-visible` rules **before** `.aria-invalid\:*[aria-invalid="true"]` rules at equal specificity (probe run during research, built-in colours substituted for the theme roles; order is by variant, not colour). So on a focused field that is invalid, the ring is `destructive` at 20 % alpha and `FOCUS_RING` does not win. Affected: `FormField.tsx:65` (sign-in/sign-up with an error), `ErrorTextForm.tsx:51` (text too long), `EscalationControl.tsx:103` (comment too long).
  - Base layer `* { @apply border-border outline-ring/50; }` (`src/styles/global.css:141-143`) — `--ring` at half alpha measures 1.91 / 1.84 : 1 (`context/foundation/design-tokens.md`, Notes "Focus ring at half alpha"). The only inspected control relying on it is the Banner docs link (`src/layouts/Layout.astro:30`).
  - Primitives still default to `focus-visible:ring-ring/50 focus-visible:ring-[3px]` (`button.tsx:8`, `input.tsx:11`, `textarea.tsx:9`, `badge.tsx:7`). Every production control in the inspected set overrides it (tailwind-merge 3.7.0 drops `ring-ring/50`, keeps the 3 px width — checked in node by the research worker), so this is the *cause* of C2's `FOCUS_RING` copies, not a visible defect today. Precedent conflicts: the report-error plan kept primitives "unmodified" (`context/archive/2026-10-19-report-error-ui-contract/plan.md:96`), S-04 told the implementer to change `ring-ring/50` in the new `Input` (`context/archive/2026-10-29-polish-sign-in/plan.md:220`) — not done (`input.tsx:11`).
- **User impact**: a keyboard user who tabs back into a field showing a validation error sees almost no focus indicator on exactly the field they need to fix; the "Supabase not configured" banner link has a sub-3:1 focus outline.
- **Unverified**: research worker's reading that `outline-none` + box-shadow ring leaves buttons/inputs/selects with no indicator in Windows forced-colors mode — not browser-tested.

### C4 — Missing tokens: Banner.astro hex palette, outside lint reach

- **Evidence**
  - `src/components/Banner.astro:27-41` hard-codes Tailwind-palette hex (`#dbeafe`, `#1e3a8a`, `#fef3c7`, `#fee2e2`, `#dc2626`, …) in a `<style>` block — 9 hits of the hard-coded-value scan, the only hits outside `src/components/ui/`.
  - One consumer: `src/layouts/Layout.astro:25`, always `variant="error"`, one per `missingConfigs` entry (`src/lib/config-status.ts:11-21`, Supabase only). `info` and `warning` variants have 0 callers.
  - Neither `Layout.astro` nor `Banner.astro` is in `uiContractConfig.files` (`eslint.config.js:100-118`); the rule matches string literals in `class`/`className`/`class:list`/`cn()`/named constants (`eslint.config.js:92-97,123-124`) and cannot see CSS in `<style>`.
  - Covering tokens exist: `--destructive` (`global.css:23`) with the established `border-destructive/40 bg-destructive/10 text-destructive` pattern (`ErrorAlert.tsx:6`) or `<Alert variant="destructive">`; `--warning` (`global.css:27`). No `--info` role exists.
  - `src/components/ui/LibBadge.astro:10-12` uses `bg-blue-900/50`, `text-blue-200`, `bg-purple-500/30`; 0 consumers in `src/` (grep).
  - No archived decision about Banner styling; S-01 left its structure untouched (`context/archive/2026-10-28-remove-web-search/plan.md:14,34,75-79`).
- **User impact**: the first thing a guest sees on a misconfigured deployment is a banner in the old Tailwind red, not the XEMI `destructive` colour, sitting above an otherwise on-contract page.

### C5 — Dead cosmic theme and stale contract docs

- **Evidence**
  - `bg-cosmic` (`global.css:137-139`) and `--cosmic-*` (`global.css:46-48`): 0 consumers in `src/` (grep).
  - `.dark` (`global.css:51-89`): 1 consumer — the kitchen-sink dark UserBar cell (`src/dev/ui-kitchen-sink.astro:180`, text `:169-171`); mentioned in the `UserBar.astro:8` comment.
  - `dark:` variants: only in primitives (`button.tsx:8,14,16,18`, `badge.tsx:7,14`, `input.tsx:10,12`, `textarea.tsx:9`); 0 in views.
  - Stale docs: `CLAUDE.md:88` ("Other views still use literals on `bg-cosmic`…" — no such view remains), `CLAUDE.md:90` (cosmic/`.dark` rules, "a new role goes in `:root`, `.dark` and `@theme inline`"), `context/foundation/design-tokens.md` (cosmic rows, "the 12 views… on bg-cosmic", dark-variant section).
  - Removal caveat: keep `@custom-variant dark (&:is(.dark *))` (`global.css:4`) unless the primitives' `dark:` classes go too — without it Tailwind 4's `dark:` falls back to `prefers-color-scheme: dark`, and users with an OS dark theme would get `dark:bg-input/30` etc. on the light pages.
  - Deferred here by S-04, S-05 and S-06 (`context/archive/2026-10-29-polish-sign-in/plan.md:41`, `context/archive/2026-10-28-staff-ticket-company-filter/plan.md:38`, `context/archive/2026-10-30-admin-users-ui-contract/plan.md:32,35`); keep-vs-drop is the user's call in `/10x-plan` (`roadmap.md:168-169`).
- **User impact**: none on screen today; the impact is on the next agent, which reads CLAUDE.md, believes some views are still cosmic, and keeps adding every new role to `.dark` — so the contract the user relies on stays described wrongly.

### Not charged / deferred (with reason)

| Finding | Anchor | Disposition |
| --- | --- | --- |
| Tab titles: only `/` names the brand; title ≠ h1 on report-error ("Zgłoś błąd ERP" vs "Zgłoś błąd z systemu ERP") and signin ("Logowanie" vs "Zaloguj się"); staff/waiting branches keep the client title | `Layout.astro:12,21`, `report-error.astro:14`, `signin.astro:28`, `ClientPageLayout.astro:37` | Candidate for C1's shell (title suffix is a one-line shell concern) — plan decides |
| confirm-email's next step is a text link; 404's equivalent is a default button | `ConfirmEmailNotice.astro:30`, `NotFound.astro:21` | Fold into C1/C2 if plan aligns primary actions; otherwise deferred (cosmetic, low impact) |
| my-tickets list items use `px-3 py-2 rounded-lg` instead of `INNER_CARD` `p-4` | `MyTicketsList.tsx:41`, `format.ts:13` | Deferred unless plan unifies inner cards — dense list may be intentional |
| Admin forms have no pending state / double-submit guard; auth uses `disabled`, error-resolution uses `aria-disabled`; "..." vs "…"; missing `aria-hidden` on two `Loader2` | `StaffTicketQueue.astro:102,127,209`, `StaffUserAssignment.astro:79`, `SubmitButton.tsx:19-21`, `ErrorTextForm.tsx:74-79`, `EscalationControl.tsx:120-125` | Deferred: adding pending state to no-JS admin forms is new behaviour, not a consistency fix (roadmap scope guard, `roadmap.md:170`); the `aria-hidden` gap is a 2-line fix the plan may take |
| `formatDate` duplicated in `StaffTicketQueue.astro:57-59` **without** `timeZone: "Europe/Warsaw"` (the shared one in `format.ts:2-4` has it) | as cited | **Functional bug, not visual**: staff ticket dates render in the Worker's UTC. Out of S-07's scope by definition, but trivially fixed by importing the shared helper — flag to user |
| `resolveAudience()` logic duplicated in `Topbar`, `index`, `ClientPageLayout` | `context/archive/2026-10-28-start-page/reviews/impl-review.md:53` | Deferred (logic, not visual); touches the same shell files as C1, so the plan may choose to do it alongside |
| Forced-colors / High Contrast focus | primitives' `outline-none` | Deferred: unverified; would need a browser check |

## 7-state matrix — where the pages stand today

| State | Current coverage (source) | Gap for the plan |
| --- | --- | --- |
| default | Tokens + `ui/` components on all 9 pages; Banner is the exception (C4) | C4 |
| hover | Token-driven; two link hover styles (C2) | C2 |
| focus-visible | Full `ring-ring` on all inspected controls except invalid fields and the Banner link (C3) | C3 |
| disabled | `disabled:` (auth) vs `aria-disabled:` + `BLOCKED_CLASS` (error-resolution, `format.ts:20`); admin selects have no `disabled:` style | Show both in kitchen sink; decide whether to unify |
| error | `Alert variant="destructive"` / `text-destructive` everywhere inspected (`ErrorAlert.tsx:6`, `ServerError.tsx:13`, `FormField.tsx:72`, `FieldCounter.tsx:21`); admin fields have no `aria-invalid` path | Error + focus combination (C3) |
| empty | Existing kitchen-sink cells for queue/lists (not re-checked) | Re-check per page during phase 0 screenshots |
| loading | Spinners in auth and error-resolution; none in admin (deferred above) | Kitchen-sink cell per pattern |

## Code References

- `src/styles/global.css:4` — `@custom-variant dark`; `:46-48` cosmic vars; `:51-89` `.dark`; `:137-139` `bg-cosmic`; `:141-143` base `outline-ring/50`
- `src/layouts/Layout.astro:12-36` — default title, Banner loop
- `src/layouts/ClientPageLayout.astro:33-59` — client shell, heading/lead constants, role branches
- `src/components/Banner.astro:11-41` — hex `<style>`
- `src/components/error-resolution/format.ts:2-20` — `formatDate`, `FOCUS_RING`, `INNER_CARD`, `BLOCKED_CLASS`
- `src/components/ui/{button,input,textarea,badge}.tsx` — `ring-ring/50`, `aria-invalid:*`, `dark:*`
- `src/components/admin/StaffTicketQueue.astro:57-71` — local `formatDate`, `selectClass`
- `src/components/admin/StaffUserAssignment.astro:28-34` — `headingClass`, `selectClass`
- `src/dev/ui-kitchen-sink.astro:169-183` — dark UserBar cell
- `eslint.config.js:92-124` — `uiContractConfig` selectors and files
- `CLAUDE.md:88-90` — UI contract scope and token rules

## Architecture Insights

- The contract works at the **token** level (0 literals in linted views) but has no **layout/typography** level: there is no shared page shell and no shared heading/lead/link constants, so each change re-derives them from whichever page it copied. The lint rule enforces "no literals", not "same composition".
- Shared class constants already exist ad hoc in `src/components/error-resolution/format.ts` (`FOCUS_RING`, `INNER_CARD`, `BLOCKED_CLASS`) and are imported by admin and auth code — a de facto shared UI module living in a feature folder.
- The `/50` focus ring is fixed in views, not at its source (primitives + base layer), which is what makes `FOCUS_RING` necessary everywhere.

## Historical Context (from prior changes)

- `context/archive/2026-10-19-report-error-ui-contract/plan.md:22-24,96` — light `:root` active, cosmic kept as `.dark`, primitives land unmodified (supported: still true of `button.tsx`).
- `context/archive/2026-10-19-report-error-ui-contract/tokens.md:34,55` / `design-tokens.md` — `/50` ring measured below 3:1; fix placed in views (supported).
- `context/archive/2026-10-27-my-tickets-page/plan.md:46,58-62` — `ClientPageLayout` scoped to client pages only (supported).
- `context/archive/2026-10-28-staff-ticket-company-filter/plan.md:27,35,38,71,91` — copy the client chrome; native select by decision; cosmic removal deferred to S-07; `.dark` lives only in the kitchen-sink cell (all supported by current code).
- `context/archive/2026-10-29-polish-sign-in/plan.md:41,85,220,241` — deferral to S-07; 404 frame copied from index; `Input` ring to be raised to full (contradicted: `input.tsx:11` still `/50`); narrow auth card (supported).
- `context/archive/2026-10-30-admin-users-ui-contract/plan.md:13,26,32,35,63` — chrome and select class copied; cosmic + "Użytkownicy" UserBar label deferred to S-07 (the label item was not re-examined here).
- `CLAUDE.md:88` "Other views still use literals on `bg-cosmic`" — contradicted (no such view in `src/pages`).

## Related Research

- `context/archive/2026-10-19-report-error-ui-contract/research.md` — the only prior UI research; first token/contract audit (one view).

## Open Questions (for `/10x-plan`, owner: user unless noted)

1. **`.dark` + `--cosmic-*`**: drop entirely (and strip primitives' `dark:` or keep `@custom-variant`), or keep `.dark` for a future dark mode? (`roadmap.md:168-169`)
2. **Shared shell**: one `PageShell`/layout component for all 9 pages (with `narrow` for auth, `flex-1` for start), or shared class constants only? And should the 404 keep the start page's hero size or use the panel size?
3. **Primitives**: raise `ring-ring/50` → `ring-ring` (and fix `aria-invalid` vs focus) in `src/components/ui/*` so `FOCUS_RING` copies can go — breaking the "primitives unmodified" precedent — or keep fixing in views?
4. **Tab title pattern** — "<page> — HelpDesk XEMI" or as today?
5. **Out-of-scope bug**: fix the UTC `formatDate` in `StaffTicketQueue.astro:57-59` inside this change or as a separate fix?
6. **"Użytkownicy" UserBar label** (deferred by S-06, `context/archive/2026-10-30-admin-users-ui-contract/plan.md:32`): the entry at `src/components/UserBar.astro:30` reads „Użytkownicy” while the page it opens is titled „Konta do przypisania” (`src/pages/admin/users.astro:29`, h1 in `StaffUserAssignment.astro:37`). Rename the entry, the page, or leave it?
7. **Gap (owner: implementer)**: baseline screenshots of all 9 pages, desktop + 375 px, before phase 1; forced-colors check optional.
