# Start page for guest, client and staff — Plan Brief

> Full plan: `context/changes/start-page/plan.md`

## What & Why

`/` still shows the English "10x Astro Starter" hero, and the only place that sends a signed-in user to their job is the English, starter-styled `/dashboard`. This change gives HelpDesk XEMI a Polish, XEMI-styled start page that tells a visitor what the site is and puts each role one click from its work, and removes `/dashboard` (roadmap S-03, MS-01 + MS-03 — the M-2 north star).

## Starting Point

Sign-in and sign-out already land on `/`. `/dashboard` holds the role links and the "waiting for assignment" / "couldn't load your account" states; `ClientPageLayout.astro` has the Polish token-styled versions of those states for `/report-error` and `/my-tickets`.

## Desired End State

A guest sees an explanation of the product, three "how it works" steps and "Zaloguj się" / "Załóż konto". A client sees their company and two big entries, "Zgłoś błąd" and "Moje zgłoszenia". Staff see "Zgłoszenia do rozwiązania" and "Użytkownicy". An unassigned account or a failed profile lookup sees the product explanation plus the same status notice the client pages show. `/dashboard` returns 404.

## Key Decisions Made

| Decision                         | Choice                                                    | Why (1 sentence)                                                                 |
| -------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Unassigned / profile-error state | Product intro + shared status notice                      | No dead end, and one wording across `/`, `/report-error`, `/my-tickets`.         |
| Staff entries                    | Queue (primary) + users (secondary)                       | Nothing staff reach from `/dashboard` today is lost.                             |
| `/dashboard` URL                 | Plain 404, no redirect                                    | "No longer exists" literally; no leftover route for a URL nobody shares.         |
| Look and content                 | Full UI contract, guest hero + 3 steps, kitchen-sink cells | Matches the XEMI pages one click away and lint keeps it there.                   |
| Component shape                  | Presentational `StartPage.astro` with `audience` prop      | Kitchen sink can render every audience with static props; route only derives it. |
| Audience order                   | profile error → staff → client → waiting                  | Same as `ClientPageLayout`, so pages agree on who sees what.                     |

## Scope

**In scope:**

- New `/` with five audiences on tokens; `Welcome.astro` deleted
- Shared `AccountStatusNotice.astro` used by the start page and `ClientPageLayout`
- Kitchen-sink section and `uiContractConfig` entries for the new files
- Delete `/dashboard`; middleware, Topbar link, `/admin/users` back link, smoke steps and docs repointed to `/`

**Out of scope:**

- Topbar redesign and return-to-page after sign-in (S-04)
- Restyling `/admin/*`, `/auth/*`, the 404 page or `Layout.astro`
- Ticket counts or other data on the start page; any API/migration

## Architecture / Approach

`index.astro` reads `Astro.locals` (user, profile, profileLookupFailed), picks one of `guest | client | staff | waiting | profile-error`, and renders `Layout` → `Topbar` → `StartPage audience=… companyName=…`. `StartPage` is pure markup (logo, `Card`, `Button asChild` links) and embeds `AccountStatusNotice` for the two status audiences.

## Phases at a Glance

| Phase                          | What it delivers                                                    | Key risk                                                               |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Start page on the contract  | New `/` in five audiences, shared notice, kitchen sink, lint guard  | Contract lint rejects patterns copied from `Welcome.astro`             |
| 2. Remove /dashboard           | Page deleted, all links/redirects/smoke/docs point to `/`           | Missing one smoke step that still expects `/dashboard` → CI red        |

**Prerequisites:** S-02 `my-tickets-page` done (it is); local Supabase for the smoke run.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- Assumes the smoke's fresh signup is still unassigned when it first hits `/` (true today: assignment happens later in the script).
- The waiting notice's last sentence becomes page-neutral, a small visible text change on `/report-error` and `/my-tickets`.

## Success Criteria (Summary)

- Each persona lands on `/` after sign-in and sees exactly its entries; a guest understands what the site is.
- `/dashboard` is gone with no broken link or redirect pointing at it.
- Lint, `astro check`, build and smoke pass; kitchen sink shows all five audiences.
