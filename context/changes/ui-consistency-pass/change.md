---
change_id: ui-consistency-pass
title: Ui consistency pass
status: impl_reviewed
created: 2026-10-30
updated: 2026-11-27
archived_at: null
---

## Notes

Roadmap slice S-07 (M-2, PRD MS-07).

- **View (one surface):** the shared page shell used by every page — `src/layouts/Layout.astro`, `Banner.astro`, the repeated `min-h-screen → max-w-5xl → Topbar → Card` wrapper, page headings, and the shared controls in `src/components/ui/`. Pages it covers: `/`, `/report-error`, `/my-tickets`, `/auth/{signin,signup,confirm-email}`, 404, `/admin/tickets`, `/admin/users`. Not a restyle — every page is already on the UI contract; this aligns them and removes the leftover cosmic theme.
- **Token source:** `src/styles/global.css` (values: `context/foundation/design-tokens.md`), light XEMI `:root` theme.
- **Contract variant:** existing design system — extend it; no second palette, no `shadcn init`.
- **Open (decide in `/10x-plan`):** drop `.dark` + `--cosmic-*` entirely, or keep `.dark` for a future dark mode.
- Pre-audit candidates (2026-10-30, `/10x-ui`): Banner hex literals; `ring-ring/50` in `ui/` primitives; duplicated native `<select>` in `admin/*`; page shell copied 7× and `headingClass` 10× in 3 variants; dead cosmic/`.dark` theme.
- **Visual gate as run (impl-review F1, 2026-11-27):** `screenshots/before/` holds 6 guest pages at desktop width only (index, signin, signin-error, signup, confirm-email, 404); `screenshots/after/` holds the same 6 names at 1280 px from the production preview plus `kitchen-sink-1280.png`/`kitchen-sink-375.png` from the dev server. Every delta is intended: 404 heading/padding as a panel, confirm-email's primary button. Two pairs are not like-for-like: confirm-email shows the email-confirmation variant after vs the auto-confirmed one before (depends on the auth config, same component), and signin-error shows the server `?error=invalid-credentials` alert after vs client-side field errors before. `/report-error`, `/my-tickets`, `/admin/*`, the signed-in branches and 375 px were not captured — the user checked them by eye (Progress 1.6, 2.12, 4.8, 4.9 confirmed 2026-11-27).
