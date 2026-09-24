---
project: "HelpDesk XEMI"
version: 1
status: draft
created: 2026-09-22
updated: 2026-09-24
prd_version: 1
main_goal: speed
top_blocker: decisions
milestone_id: first-end-to-end-support-loop
milestone_seq: 1
milestone_status: open
---

# Roadmap: HelpDesk XEMI

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: First end-to-end support loop** — Status: open

- **Intent:** Prove the core hypothesis end to end — a client user can paste an ERP error and get either a matched suggestion or an escalated ticket, and a service-staff member can resolve that ticket and feed the resolution back into the shared knowledge base — across both knowledge-base sources (ticket history and ingested ERP documentation).
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** US-01; must-have FR-001–FR-008, FR-011, FR-012; nice-to-have FR-009–FR-010 (parked, see `## Parked`).

## Vision recap

An ERP (XEMI) end user — purchasing, sales, accounting, or warehouse staff at any client company — hits an error message mid-task and has no way to resolve it except filing a request and waiting, which stops their work. The service team re-solves the same problems repeatedly because past resolutions are never written down anywhere searchable. HelpDesk XEMI lets a user paste the error text and either get an instant matched cause/fix or have it auto-escalated to a ticket, while service staff resolve unmatched tickets and feed the resolution back into a shared knowledge base so the same problem isn't re-solved from scratch next time.

## North star

**S-01: Client user pastes an error and gets a matched suggestion or an auto-escalated ticket** — this is the PRD's own Primary Success Criterion, stated verbatim: "the first flow works end to end."

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as its Prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID                       | Outcome (user can …)                                                              | Prerequisites | PRD refs                          | Status   |
| ---- | -------------------------------- | ---------------------------------------------------------------------------------- | -------------- | ---------------------------------- | -------- |
| F-01 | tenant-data-and-auth-foundation  | (foundation) multi-tenant schema + role model landed, enforcing per-company isolation | —              | Access Control, FR-007, FR-008    | done |
| F-02 | erp-doc-ingestion-pipeline       | (foundation) ERP documentation (PDF/Word/Excel) ingested into the shared knowledge base | F-01           | FR-012, Business Logic            | blocked  |
| S-01 | first-gated-error-resolution     | paste an error and see a matched cause/steps, or have it auto-escalated to a ticket | F-01, F-02     | US-01, FR-001, FR-002, FR-003, FR-007, FR-012 | proposed |
| S-02 | service-staff-ticket-resolution  | (service staff) see to-do tickets from all client companies and record a resolution that feeds the knowledge base | F-01, S-01     | FR-004, FR-005, FR-006, FR-008    | proposed |
| S-03 | mark-suggestion-unhelpful        | mark a suggested resolution as not helpful, escalating it to a ticket with a comment | S-01           | FR-011                            | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                            | Note                                                                                   |
| ------ | ------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| A      | Core support loop   | `F-01` → `F-02` → `S-01` → `S-02` | The must-have path to the full client+staff resolution loop — sequenced first per the `speed` goal. |
| B      | Escalation refinement | `S-03`                          | Joins Stream A at `S-01`; a smaller client-side refinement that can run alongside Stream A's `S-02` once `S-01` lands. |

## Baseline

What's already in place in the codebase as of `2026-09-22` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro+React scaffold present (`src/pages/index.astro`, `src/layouts/Layout.astro`), no product screens (error-paste form, ticket views) yet.
- **Backend / API:** partial — Astro SSR + auth API routes present (`src/pages/api/auth/*.ts`), no domain routes (ticket creation, KB search) yet.
- **Data:** absent — no Supabase migrations exist yet (`supabase/migrations` has no `.sql` files); no schema for companies, tickets, or knowledge base.
- **Auth:** partial — Supabase SSR auth wired (`src/lib/supabase.ts`, `src/middleware.ts`, signin/signup/signout), but single generic user model only — no client-company tenant field, no client-user/service-staff role split.
- **Deploy / infra:** present — `wrangler.jsonc` correctly targets Cloudflare Workers; `.github/workflows/ci.yml` wires ci → smoke → deploy (`wrangler deploy`) on merge to master.
- **Observability:** partial — Cloudflare dashboard-side `observability.enabled: true` in `wrangler.jsonc`; no in-app error tracking/alerting wired yet (flagged as an open risk in `infrastructure.md`, deferred — see `## Parked`).

## Foundations

### F-01: Tenant data & auth foundation

- **Outcome:** (foundation) a multi-tenant Postgres schema (client companies, tickets, shared knowledge base) with RLS lands, and the existing generic auth model is extended with a company reference and a client-user/service-staff role — enforcing the PRD's per-company data isolation guardrail from the ground up.
- **Change ID:** tenant-data-and-auth-foundation
- **PRD refs:** Access Control section, FR-007, FR-008
- **Unlocks:** S-01, S-02 — neither can enforce "see only your own company's tickets" / "see tickets from all companies" without this schema and role model in place.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Expected QPS / data-volume ballpark, to size indexes and connection limits. Owner: user. Block: no.
- **Risk:** Sequenced first because every other item depends on tenant isolation being correct from the start; retrofitting RLS after tickets/knowledge-base rows exist is riskier than building it in from day one.
- **Status:** done

### F-02: ERP documentation ingestion pipeline

- **Outcome:** (foundation) existing ERP (XEMI) documentation (PDF/Word/Excel describing known errors and fixes) is parsed, chunked, and embedded into the shared knowledge base established by F-01, running as an offline process outside the deployed Worker's request path (per `infrastructure.md`'s CPU-time-ceiling finding).
- **Change ID:** erp-doc-ingestion-pipeline
- **PRD refs:** FR-012, Business Logic section
- **Unlocks:** S-01 — the north star's "match against ERP documentation" source has nothing to search until this pipeline has run at least once.
- **Prerequisites:** F-01 (needs the knowledge-base table schema to write into)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How much ERP documentation exists, and how consistent is its format (PDF/Word/Excel)? Owner: user. Block: yes.
  - Does the ERP documentation change over time, and who owns re-ingesting updates? Owner: user. Block: yes.
- **Risk:** Sequenced right after F-01 and before the north star, since the user explicitly chose the "full" north star (both knowledge-base sources) over the narrower ticket-history-only alternative — but the two Open Questions above must resolve before the ingestion approach itself can be designed.
- **Status:** blocked

## Slices

### S-01: Client user resolves or escalates an ERP error

- **Outcome:** a client user can paste the text of an ERP error message and see a suggested cause/steps when a match exists in the knowledge base, or have it turned into a service ticket when no match is found.
- **Change ID:** first-gated-error-resolution
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-007, FR-012
- **Prerequisites:** F-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the north star — placed as early as its Foundations allow rather than deferred for symmetry, since it's the single slice that proves the PRD's core hypothesis end to end.
- **Status:** proposed

### S-02: Service staff resolves a ticket and feeds the knowledge base

- **Outcome:** a service-staff member can see to-do tickets from all client companies on their dashboard and record a resolution once handled, which feeds the shared knowledge base for future matches.
- **Change ID:** service-staff-ticket-resolution
- **PRD refs:** FR-004, FR-005, FR-006, FR-008
- **Prerequisites:** F-01, S-01 (tickets must exist — created via S-01's escalation path — before staff can resolve them)
- **Parallel with:** S-03 (both depend only on S-01, neither depends on the other)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Closes the full core loop described in the PRD's Business Logic (resolutions feeding future matches) — sequenced right after the north star since without it the knowledge base never grows beyond its initial ingested state.
- **Status:** proposed

### S-03: Client user marks a suggestion as not helpful

- **Outcome:** a client user can mark a suggested resolution as not helpful, which creates a service ticket carrying their comment.
- **Change ID:** mark-suggestion-unhelpful
- **PRD refs:** FR-011
- **Prerequisites:** S-01 (needs a displayed suggestion to react to)
- **Parallel with:** S-02 (both depend only on S-01, neither depends on the other)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small, self-contained refinement of the north star's suggestion display; safe to build alongside S-02 since neither touches the other's surface. Carries one inherited constraint from F-01: after that change's Phase 2 review, `tickets` grants `authenticated` UPDATE on `(status, resolution, resolved_by, resolved_at)` only, and there is no client-scoped UPDATE policy at all — so the write path FR-011 needs does not exist yet. S-03 must add `user_comment` to that column grant and a policy scoped to the client's own ticket. See `context/changes/tenant-data-and-auth-foundation/reviews/impl-review-phase-2.md`, finding F9.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                       | Suggested issue title                                             | Ready for `/10x-plan` | Notes                                              |
| ---------- | -------------------------------- | -------------------------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| F-01       | tenant-data-and-auth-foundation  | Build multi-tenant schema + role model with RLS                     | yes                    | Run `/10x-plan tenant-data-and-auth-foundation`     |
| F-02       | erp-doc-ingestion-pipeline       | Build offline ERP-doc ingestion pipeline (FR-012)                   | no                     | Blocked on doc volume/format + re-ingestion ownership |
| S-01       | first-gated-error-resolution     | Client error paste → matched suggestion or auto-escalated ticket    | no                     | Blocked on F-01, F-02 landing first                 |
| S-02       | service-staff-ticket-resolution  | Service-staff ticket dashboard + resolution recording               | no                     | Blocked on F-01, S-01 landing first                 |
| S-03       | mark-suggestion-unhelpful        | "Not helpful" marking escalates suggestion with comment              | no                     | Blocked on S-01 landing first                       |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog.

## Open Roadmap Questions

1. **What is the secondary (nice-to-have) success outcome for this MVP?** — Owner: user. Block: roadmap-wide (informational only — Primary and Guardrails are sufficient to evaluate MVP success without it).

## Parked

- **Modifying the ERP system itself** — Why parked: PRD §Non-Goals; the tool reads errors and sends emails around the ERP but never changes its code or configuration.
- **Supporting multiple different ERP systems** — Why parked: PRD §Non-Goals; MVP scope is this one specific ERP (XEMI), not a generic multi-ERP tool.
- **Fully automating ticket closure without service staff** — Why parked: PRD §Non-Goals; the AI never closes a ticket on its own.
- **Analytics dashboards / error trend reporting** — Why parked: PRD §Non-Goals; a possible future extension.
- **Email notification to the service mailbox on new ticket, and its native ERP-UI display (FR-009, FR-010)** — Why parked: both nice-to-have priority; not on the must-have critical path under the `speed` sequencing goal.
- **In-app error tracking/alerting for the Workers CPU-time-ceiling risk** — Why parked: `infrastructure.md` flags this as pre-go-live hardening, not required for this milestone's core loop; the already-present dashboard-side observability is sufficient for now.

## Milestone History

(Empty — this is the first milestone.)

## Done

- **F-01: (foundation) a multi-tenant Postgres schema (client companies, tickets, shared knowledge base) with RLS lands, and the existing generic auth model is extended with a company reference and a client-user/service-staff role — enforcing the PRD's per-company data isolation guardrail from the ground up.** — Archived 2026-09-24 → `context/archive/2026-09-22-tenant-data-and-auth-foundation/`. Lesson: —.
