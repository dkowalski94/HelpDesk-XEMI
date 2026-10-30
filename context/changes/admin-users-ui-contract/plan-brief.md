# `/admin/users` on the UI contract — Plan Brief

> Full plan: `context/changes/admin-users-ui-contract/plan.md`

## What & Why

Roadmap S-06 (MS-07): `/admin/users`, where service staff move new accounts into their client company, is the last staff page still on the starter's dark look with English copy. We move it onto the light XEMI UI contract so it matches `/admin/tickets` and the start page, ahead of the S-07 consistency pass.

## Starting Point

The page lists accounts waiting in the `unassigned` company with a company `<select>` and "Assign" each, in starter literals (`bg-cosmic`, `bg-white/10`), `max-w-2xl`, no Topbar. Data loading (`listPendingAssignments()`) and the endpoint (`/api/admin/assign-company`, fixed redirect codes) already work and are smoke-tested.

## Desired End State

Staff open „Użytkownicy” from the Topbar and see a light, `max-w-5xl` card „Konta do przypisania”: each waiting account with e-mail, full name and „Założone: 28 paź 2026, 14:05”, a „Wybierz firmę” select and „Przypisz”. All messages are Polish; every state is in the kitchen sink; smoke passes unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Account details | E-mail, full name, creation date | Staff see how long an account has waited; the date is already loaded. |
| Heading | „Konta do przypisania” (UserBar label stays „Użytkownicy”) | Names the task like „Zgłoszenia do rozwiązania” without a longer bar label. |
| Structure | Static-props `StaffUserAssignment.astro`, page keeps data + message mapping | Same pattern as S-05; every state renders in the kitchen sink. |
| Control | Native `<select>` + shadcn `Button` | Matches `/admin/tickets`, no island or dependency. |
| Behaviour | Endpoint, redirect codes and form markup unchanged | Smoke matches them exactly; this is a visual change only. |
| Back link | Dropped; Topbar logo links home | Same as `/admin/tickets`. |

## Scope

**In scope:**
- New `src/components/admin/StaffUserAssignment.astro`; `src/pages/admin/users.astro` on Topbar + Card, Polish copy
- Page added to `uiContractConfig`; kitchen-sink section + „Użytkownicy”-active UserBar
- CLAUDE.md UI-contract view list

**Out of scope:**
- Endpoint/service/type/RLS changes, new smoke steps, pagination or search
- Renaming the UserBar entry; removing `.dark`/cosmic tokens (S-07)

## Architecture / Approach

The page loads `PendingAssignmentsResult`, maps `?status`/`?error` codes to fixed Polish strings, and passes both to the presentational component inside the shared chrome (`bg-background`, `max-w-5xl`, `Topbar`, `Card`). The component renders one state; the kitchen sink renders all of them with fixtures.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. `/admin/users` on the UI contract | Restyled Polish page + component, lint, kitchen-sink cells, docs | Breaking the smoke parser: e-mail must stay `>email<` and the hidden `name="userId" value` must precede it |

**Prerequisites:** S-03 done (Topbar, contract); local Supabase reset for smoke.
**Estimated effort:** ~1 session.

## Open Risks & Assumptions

- Prettier/Astro formatting must not add whitespace inside the e-mail element; verified by the unchanged smoke run.
- Native `<select>` looks slightly different across browsers; accepted as on `/admin/tickets`.

## Success Criteria (Summary)

- `/admin/users` looks like `/admin/tickets` and passes the UI-contract lint; all states appear in the kitchen sink.
- Staff see when each account was created and assign it in Polish.
- CI smoke passes with no change to `scripts/smoke.mjs`.
