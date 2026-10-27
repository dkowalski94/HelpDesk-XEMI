# "Moje zgłoszenia" as a Separate Page — Plan Brief

> Full plan: `context/changes/my-tickets-page/plan.md`

## What & Why

The client's ticket list moves out of the `/report-error` panel to its own page, `/my-tickets`, so `/report-error` is about pasting an error and the list has room for history and paging. It is roadmap slice S-02 of M-2; the start page (S-03) will link here.

## Starting Point

Today the list ("Twoje zgłoszenia") is rendered inside the `/report-error` React island, loaded in the browser from `GET /api/tickets?mine=1` (first 50 only) and refreshed after each paste. The service behind it, `listVisibleTickets`, already supports paging and a "mine" filter.

## Desired End State

A signed-in client opens `/my-tickets` and sees their tickets, newest first, 50 per page with "Starsze/Nowsze zgłoszenia" links, Polish dates, cause and steps for resolved ones — rendered on the server, no loading skeleton. `/report-error` shows the form and the immediate outcome, plus one link "Zobacz w moich zgłoszeniach". Staff, unassigned and profile-error visitors see the same messages on both pages.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Rendering | Server-side (Astro page renders `MyTicketsList` without hydration) | List is in the HTML at once — no skeleton, no layout jump, smoke can check it. |
| What stays on `/report-error` | Immediate outcome + one persistent link "Zobacz w moich zgłoszeniach" | User: a found solution shows at once; everything earlier is behind the link. |
| Paging | 50 per page + "Starsze zgłoszenia" via `?offset=` | No ticket gets lost; the service already returns `nextOffset`. |
| Address | `/my-tickets` | Consistent with the other English paths (`/report-error`, `/admin/*`). |
| Page branches | One shared `ClientPageLayout.astro` for both client pages | Staff/waiting/profile-error texts cannot drift apart. |
| Dates | `formatDate` with `timeZone: "Europe/Warsaw"` | The Worker runs in UTC; server and browser must agree. |
| Hook | `useMyTickets` deleted after the panel stops using it | No remaining users. |

## Scope

**In scope:** `/my-tickets` page, shared client-page layout, pagination, middleware protection, Polish time zone in dates, smoke steps, slimmer panel, kitchen sink, lint guardrail scope, CLAUDE.md.

**Out of scope:** API changes, links from the start page / user bar (S-03/S-04), filtering or ticket detail, a short recent list on `/report-error`, removing `/dashboard`.

## Architecture / Approach

`/my-tickets` (Astro, server) → `ClientPageLayout` decides the branch → in the client branch calls `listVisibleTickets(createdBy = user, limit 50, offset)` under the user's session (RLS) → renders the presentational `MyTicketsList` to static HTML with page links. Phase 1 ships the page beside the old in-panel list; phase 2 removes the old list.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The /my-tickets page | Server-rendered page, shared layout, paging, smoke steps | Shared layout changes `/report-error` text that smoke matches |
| 2. Slim /report-error and close the contract | List and hook removed, link added, kitchen sink/ESLint/CLAUDE.md | Panel regression after removing `reload()` wiring |

**Prerequisites:** local Supabase with the seed for smoke; nothing else.
**Estimated effort:** ~2 short sessions, one per phase.

## Open Risks & Assumptions

- Smoke checks `/my-tickets` with this run's own ticket text, so accumulated smoke tickets do not push the checked row off the first page.

## Success Criteria (Summary)

- A client finds every earlier ticket — resolved or waiting — on `/my-tickets`, with paging beyond 50.
- `/report-error` is just the paste flow plus the link, with no behaviour change in resolving or escalating.
- Lint, type-check, build and smoke pass; the new page is on the UI contract.
