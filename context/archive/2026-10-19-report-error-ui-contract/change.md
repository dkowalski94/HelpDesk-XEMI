---
change_id: report-error-ui-contract
title: Report-error view on the design-system contract
status: archived
created: 2026-10-19
updated: 2026-10-27
archived_at: 2026-10-27T07:23:12Z
---

## Notes

- **View:** `/report-error` — `src/pages/report-error.astro` + island `src/components/error-resolution/ErrorResolutionPanel.tsx`. `Topbar.astro` is shared with other pages (out of scope unless research says otherwise).
- **Token source:** `src/styles/global.css` (`:root` / `.dark` values, published via `@theme inline`); components in `src/components/ui/` (only `Button` today).
- **Contract variant:** fresh starter with a dead token file — tokens exist but the view reads none (0 token-class uses; pre-audit scan 96 hard-coded hits in the two view files). Phase 1 makes the view read the existing tokens before choosing new values.
