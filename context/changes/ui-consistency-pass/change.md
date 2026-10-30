---
change_id: ui-consistency-pass
title: Ui consistency pass
status: implementing
created: 2026-10-30
updated: 2026-10-30
archived_at: null
---

## Notes

Roadmap slice S-07 (M-2, PRD MS-07).

- **View (one surface):** the shared page shell used by every page — `src/layouts/Layout.astro`, `Banner.astro`, the repeated `min-h-screen → max-w-5xl → Topbar → Card` wrapper, page headings, and the shared controls in `src/components/ui/`. Pages it covers: `/`, `/report-error`, `/my-tickets`, `/auth/{signin,signup,confirm-email}`, 404, `/admin/tickets`, `/admin/users`. Not a restyle — every page is already on the UI contract; this aligns them and removes the leftover cosmic theme.
- **Token source:** `src/styles/global.css` (values: `context/foundation/design-tokens.md`), light XEMI `:root` theme.
- **Contract variant:** existing design system — extend it; no second palette, no `shadcn init`.
- **Open (decide in `/10x-plan`):** drop `.dark` + `--cosmic-*` entirely, or keep `.dark` for a future dark mode.
- Pre-audit candidates (2026-10-30, `/10x-ui`): Banner hex literals; `ring-ring/50` in `ui/` primitives; duplicated native `<select>` in `admin/*`; page shell copied 7× and `headingClass` 10× in 3 variants; dead cosmic/`.dark` theme.
