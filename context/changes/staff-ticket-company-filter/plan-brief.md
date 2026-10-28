# Staff ticket company filter — Plan Brief

> Full plan: `context/changes/staff-ticket-company-filter/plan.md`

## What & Why

Roadmap S-05 (MS-06, MS-07): service staff need to work through one client company's open tickets at a time, and `/admin/tickets` is the last staff page still on the starter's dark look. We add a company filter to the `todo` queue and move the page onto the light XEMI UI contract.

## Starting Point

`/admin/tickets` lists every client company's `todo` tickets oldest first (50 per page) in starter literals, with no filter; the resolve and "Przelicz" endpoints redirect to a fixed `/admin/tickets?status|error=…`. Staff already read all tickets through RLS.

## Desired End State

On a light, `max-w-5xl` page with the XEMI Topbar, staff pick a company from "Wszystkie firmy / Klient Alfa (3) / Klient Beta (0)…"; the queue narrows at once, the URL carries `?company=<uuid>`, and the filter survives paging, resolving a ticket and "Przelicz". Every state is visible in the kitchen sink and the filter is proven by smoke.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Company list | All `kind = 'client'` companies, alphabetical, with open-ticket count | Stable list; staff see who waits, and a 0 company gives a clear empty state. |
| Control | Native `<select>` in a GET form, auto-submit on change + "Filtruj" button | Works without JS, shareable URL, no new dependency or hydration. |
| After actions | Keep `company` (validated UUID) through resolve/backfill redirects; drop offset | Staff stay on the company they are working; offset would skip a ticket after a resolve. |
| Invalid `company` | Non-UUID or not a client company → treated as "all" | No dead filter state and nothing unvalidated echoed into URLs. |
| Restyle | Extract static-props `StaffTicketQueue.astro`, page keeps data loading | Same pattern as `StartPage.astro`; all states screenshot-gated and lint-enforced. |
| Testing | Extend `scripts/smoke.mjs` + kitchen-sink screenshots | Proves filter and redirect against the real server and RLS in CI. |
| Data model | No migration | The filter narrows what RLS already returns to staff. |

## Scope

**In scope:**
- Light XEMI restyle of `/admin/tickets`, new `src/components/admin/StaffTicketQueue.astro`, lint contract + kitchen-sink cells
- `listTodoQueue` `companyId`, `listClientCompanies()` with counts, `staffQueueHref()` helper
- `company` carried by pagination, resolve and backfill forms; endpoint redirects
- Smoke steps, CLAUDE.md updates

**Out of scope:**
- Migrations/RLS changes, shadcn `Select`/React island, multi-select or other filters
- Keeping offset across actions; `/admin/users` (S-06); removing `.dark`/cosmic (S-07)

## Architecture / Approach

Page parses `company` (UUID + must be a listed client company), loads the company list and the filtered queue under the staff session, and renders the presentational component. Forms post a hidden `company`; endpoints rebuild the redirect with `staffQueueHref()`, which echoes `company` only when it is a UUID and keeps today's exact URLs when there is none.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. UI contract for the staff queue | Light, tokenized page + component, lint + kitchen-sink cells, no behaviour change | Losing the KB-preview script hooks or the smoke-checked HTML during extraction |
| 2. Company filter | Filter with counts, kept through paging/resolve/backfill, smoke steps, docs | PostgREST embedded filtered count; fallback is two queries counted in TS |

**Prerequisites:** S-03 done (Topbar, contract); local Supabase (`npx supabase db reset`) for smoke.
**Estimated effort:** ~2 sessions, one per phase.

## Open Risks & Assumptions

- Smoke still assumes the Alfa escalation ticket is on the first (filtered) page; reset the database every couple of dozen runs, as today.
- Native `<select>` styling differs slightly across browsers; accepted over adding a Radix island.

## Success Criteria (Summary)

- Staff narrow the queue to one company in one action and stay on it after resolving or "Przelicz".
- `/admin/tickets` looks like the start page and passes the UI-contract lint; all its states appear in the kitchen sink.
- CI smoke proves the filter includes/excludes by company and that redirects keep a validated company.
