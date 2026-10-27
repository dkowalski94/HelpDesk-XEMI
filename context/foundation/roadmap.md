---
project: "HelpDesk XEMI"
version: 2
status: draft
created: 2026-09-22
updated: 2026-10-27
prd_version: —
main_goal: low-complexity
top_blocker: none
milestone_id: polished-entry-and-cleanup
milestone_seq: 2
milestone_status: open
---

# Roadmap: HelpDesk XEMI

> Derived from the user's milestone description (2026-10-26/27, anchors below) + the codebase baseline confirmed on 2026-10-27.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-2: Polished entry and cleanup** — Status: open

- **Intent:** Replace the starter leftovers around the working support loop with a Polish, XEMI-styled way in — a start page that explains the product and sends each role to its job, a separate "Moje zgłoszenia" page and a Polish user bar — and remove what the product does not use (`/dashboard`, web search/Exa); give staff a company filter on their queue.
- **Source materials:** user description (anchors below), collected 2026-10-26 during `report-error-ui-contract` and refined 2026-10-27.
- **Done when:** every S-NN below is `done`.
- **Scope anchors:**
  - MS-01: Strona startowa zamiast startera, nie dashboard. Bez logowania ładnie wystylowana, przedstawia czym jest MVP, aby klient wiedział, na jakiej stronie się znajduje; po zalogowaniu klient ma dobrze widoczne „Zgłoś błąd” oraz „Moje zgłoszenia”; serwisant ma swoją funkcjonalność rozwiązywania problemów.
  - MS-02: „Moje zgłoszenia” jako osobna strona.
  - MS-03: Usunąć `/dashboard`.
  - MS-04: Pasek z użytkownikiem inny niż w starterze (polski, wygląd XEMI), razem z powrotem na żądaną stronę po zalogowaniu.
  - MS-05: Usunąć wyszukiwanie w sieci i całą integrację Exa.
  - MS-06: Filtr w zgłoszeniach dla serwisu, aby można było filtrować po firmie.

## Vision recap

An ERP (XEMI) end user hits an error message mid-task and has no way to resolve it except filing a request and waiting; the service team re-solves the same problems because past resolutions are never written down. HelpDesk XEMI lets a user paste the error text and either get an instant matched cause/fix or have it escalated to a ticket, while service staff resolve tickets and feed the resolution back into a shared knowledge base. M-1 delivered that loop; M-2 makes it the obvious thing a visitor sees and uses.

## North star

**S-03: Start page for guest, client and staff** — the north star here means the smallest end-to-end slice whose delivery proves this milestone works: a visitor understands what the site is, and after signing in each role is one click from its job. It is placed as early as its prerequisite (S-02, the page it links to) allows, because the rest of M-2 only tidies around it.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                                                      | Prerequisites | PRD refs       | Status   |
| ---- | --------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- | -------------- | -------- |
| S-01 | remove-web-search           | use the app without the unused web-search page, its link and the "Exa not configured" banner             | —             | MS-05          | ready    |
| S-02 | my-tickets-page             | (client) open "Moje zgłoszenia" as its own page and see their tickets with status, cause and steps        | —             | MS-02          | ready    |
| S-03 | start-page                  | (guest) learn what the site is; (client) reach "Zgłoś błąd" / "Moje zgłoszenia"; (staff) reach the queue | S-02          | MS-01, MS-03   | proposed |
| S-04 | polish-user-bar             | see a Polish, XEMI-styled user bar and return to the page they asked for after signing in                | S-01, S-03    | MS-04          | proposed |
| S-05 | staff-ticket-company-filter | (staff) filter the to-do ticket queue by client company                                                   | —             | MS-06          | ready    |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme          | Chain                     | Note                                                                                           |
| ------ | -------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| A      | Way in         | `S-02` → `S-03` → `S-04`  | The north star path; small steps, each deployable on its own (`low-complexity`).               |
| B      | Cleanup        | `S-01`                    | Standalone; joins Stream A at `S-04`, which needs the "Web search" link already gone.          |
| C      | Staff queue    | `S-05`                    | Standalone; touches only `/admin/tickets`, can run alongside anything.                         |

## Baseline

What's already in place in the codebase as of `2026-10-27` (confirmed by the user).
No foundations are needed in this milestone — every layer is present.

- **Frontend:** present — Astro SSR + React islands, Tailwind, shadcn components; XEMI design tokens (`context/foundation/design-tokens.md`) and the UI contract in CLAUDE.md (token classes and shared components only, every state in the dev kitchen sink, lint guardrail); `/report-error` follows it, the other views still use the starter's dark look.
- **Backend / API:** present — auth, resolve/escalate error, tickets, admin and web-search routes.
- **Data:** present — Supabase migrations with RLS for companies, tickets and the knowledge base; seeded personas for local/CI.
- **Auth:** present — Supabase SSR sessions, middleware with protected and staff-only routes, client/staff roles.
- **Deploy / infra:** present — Cloudflare Workers, CI ci → smoke → deploy on `master`.
- **Observability:** partial — Cloudflare-side observability only (in-app alerting stays parked).

## Foundations

None in M-2 — every layer the slices touch is present in the Baseline, and the one partial layer (observability) is parked.

## Slices

### S-01: Web search and Exa removed

- **Outcome:** user can use the app without the unused web-search page, its user-bar link and the "Exa not configured" banner; the Exa integration and its key are gone from code, config and docs.
- **Change ID:** remove-web-search
- **PRD refs:** MS-05
- **Prerequisites:** —
- **Parallel with:** S-02, S-03, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pure removal, so it goes first among the quick wins; the hosted secret is removed by hand (no CI step) and the smoke test and CLAUDE.md must stop mentioning the route.
- **Status:** ready

### S-02: "Moje zgłoszenia" as its own page

- **Outcome:** a client user can open "Moje zgłoszenia" as a separate page and see their own tickets with status and, for resolved ones, the cause and steps; `/report-error` keeps the paste flow and points to that page.
- **Change ID:** my-tickets-page
- **PRD refs:** MS-02
- **Prerequisites:** —
- **Parallel with:** S-01, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Comes before the start page because it is the start page's link target; the list moves out of the `/report-error` panel, so that view's states and the kitchen sink change with it.
- **Status:** ready

### S-03: Start page for guest, client and staff

- **Outcome:** a guest sees a styled Polish start page that explains what HelpDesk XEMI is; after signing in a client sees prominent "Zgłoś błąd" and "Moje zgłoszenia" entries and a staff member reaches ticket resolution; sign-in lands here and `/dashboard` no longer exists.
- **Change ID:** start-page
- **PRD refs:** MS-01, MS-03
- **Prerequisites:** S-02
- **Parallel with:** S-01, S-05
- **Blockers:** —
- **Unknowns:**
  - What an account not yet assigned to a company (and a failed profile lookup) sees on the start page — today only `/dashboard` shows these states. Owner: user. Block: no (decide in `/10x-plan`).
- **Risk:** The north star; `/dashboard` is today's post-sign-in target and holds the unassigned/profile-error messages, so removing it and adding the start page belong in one slice to avoid a gap.
- **Status:** proposed

### S-04: Polish user bar

- **Outcome:** user can see a Polish, XEMI-styled user bar on every page that renders it, with links that match their role and no starter leftovers, and after signing in returns to the page they originally asked for.
- **Change ID:** polish-user-bar
- **PRD refs:** MS-04
- **Prerequisites:** S-01, S-03
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - Exact contents of the bar (e.g. logo, company name, email, role links, "Wyloguj"). Owner: user. Block: no (decide in `/10x-plan`).
- **Risk:** Last in the way-in path because its links depend on what S-01 and S-03 remove and add; the return-to-page step touches the sign-in flow, which the smoke test covers.
- **Status:** proposed

### S-05: Company filter for the staff queue

- **Outcome:** a service-staff member can filter the to-do ticket queue by client company.
- **Change ID:** staff-ticket-company-filter
- **PRD refs:** MS-06
- **Prerequisites:** —
- **Parallel with:** S-01, S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Independent of the way-in path; staff already read every company's tickets through RLS, so the filter narrows a view and opens no new data path.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                      |
| ---------- | --------------------------- | ------------------------------------------------------------- | --------------------- | ------------------------------------------ |
| S-01       | remove-web-search           | Remove web search and the Exa integration                     | yes                   | Run `/10x-plan remove-web-search`          |
| S-02       | my-tickets-page             | "Moje zgłoszenia" as a separate client page                   | yes                   | Run `/10x-plan my-tickets-page`            |
| S-03       | start-page                  | Start page for guest/client/staff; remove /dashboard          | no                    | After S-02 lands                           |
| S-04       | polish-user-bar             | Polish XEMI user bar + return to requested page after sign-in | no                    | After S-01 and S-03 land                   |
| S-05       | staff-ticket-company-filter | Company filter on the staff ticket queue                      | yes                   | Run `/10x-plan staff-ticket-company-filter` |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog.

## Open Roadmap Questions

1. **What is the secondary (nice-to-have) success outcome for this MVP?** — Owner: user. Block: roadmap-wide (informational only — Primary and Guardrails are sufficient to evaluate MVP success without it).

## Parked

- **Modifying the ERP system itself** — Why parked: PRD §Non-Goals; the tool reads errors and sends emails around the ERP but never changes its code or configuration.
- **Supporting multiple different ERP systems** — Why parked: PRD §Non-Goals; MVP scope is this one specific ERP (XEMI), not a generic multi-ERP tool.
- **Fully automating ticket closure without service staff** — Why parked: PRD §Non-Goals; the AI never closes a ticket on its own.
- **Analytics dashboards / error trend reporting** — Why parked: PRD §Non-Goals; a possible future extension.
- **Email notification to the service mailbox on new ticket, and its native ERP-UI display (FR-009, FR-010)** — Why parked: both nice-to-have priority; not part of the user's M-2 description.
- **Showing ERP-documentation screenshots alongside a matched suggestion** — Why parked: nice-to-have (user, 2026-09-24). The screenshots illustrate the solution but carry no information missing from the text, so ingestion stores text only; showing them later would need image extraction, storage and a display surface.
- **In-app error tracking/alerting for the Workers CPU-time-ceiling risk** — Why parked: `infrastructure.md` flags this as pre-go-live hardening; the already-present Cloudflare-side observability is sufficient for now.
- **Restyling the remaining starter views (auth pages, `/admin/users`, `/admin/tickets` look)** — Why parked: not in the M-2 description; each can follow the UI contract via `/10x-ui` when touched (S-05 changes `/admin/tickets` behaviour, not its look).

## Milestone History

- **M-1: First end-to-end support loop** (`first-end-to-end-support-loop`) — closed 2026-10-19. A client user pastes an ERP error and gets a matched suggestion (ERP docs or resolved tickets) or an escalated ticket, can escalate an unhelpful suggestion with a comment, and staff resolve tickets back into the shared knowledge base; F-01, F-02, S-01–S-03 done.

## Done

M-1 items (their IDs belong to M-1):

- **F-01: (foundation) a multi-tenant Postgres schema (client companies, tickets, shared knowledge base) with RLS lands, and the existing generic auth model is extended with a company reference and a client-user/service-staff role — enforcing the PRD's per-company data isolation guardrail from the ground up.** — Archived 2026-09-24 → `context/archive/2026-09-22-tenant-data-and-auth-foundation/`. Lesson: —.
- **F-02: (foundation) existing ERP (XEMI) documentation (PDF/Word/Excel describing known errors and fixes) is parsed, chunked, and embedded into the shared knowledge base established by F-01, running as an offline process outside the deployed Worker's request path (per `infrastructure.md`'s CPU-time-ceiling finding).** — Archived 2026-09-25 → `context/archive/2026-09-24-erp-doc-ingestion-pipeline/`. Lesson: —.
- **S-01: a client user can paste the text of an ERP error message and see a suggested cause/steps when a match exists in the knowledge base, or have it turned into a service ticket when no match is found.** — Archived 2026-10-14 → `context/archive/2026-09-25-first-gated-error-resolution/`. Lesson: —.
- **S-02: a service-staff member can see to-do tickets from all client companies on their dashboard and record a resolution once handled, which feeds the shared knowledge base for future matches.** — Archived 2026-10-19 → `context/archive/2026-10-14-service-staff-ticket-resolution/`. Lesson: —.
- **S-03: a client user can mark a suggested resolution as not helpful, which creates a service ticket carrying their comment.** — Archived 2026-10-19 → `context/archive/2026-10-19-mark-suggestion-unhelpful/`. Lesson: —.

Outside any milestone item: `report-error-ui-contract` — archived 2026-10-27 → `context/archive/2026-10-19-report-error-ui-contract/`.
