---
project: "HelpDesk XEMI"
version: 1
status: draft
created: 2026-09-21
context_type: greenfield
product_type: web-app
target_scale:
  users: large
  qps: "# TODO — see Open Questions"
  data_volume: "# TODO — see Open Questions"
timeline_budget:
  mvp_weeks: 3
  hard_deadline: "2026-11-04"
  after_hours_only: false
---

## Vision & Problem Statement

An end user of the ERP system (XEMI) — a purchasing agent, salesperson, accountant, or warehouse worker at any client company using the system — hits an error message during their work (e.g. trying to approve a document or issue an invoice) and doesn't know what it means or how to fix it. Today the only path is filing a request with the service team and waiting, which stops the user's work; the problem has three faces: workflow friction (work stops until service answers), knowledge trapped somewhere unsearchable (past resolutions exist but aren't accessible at the moment of the error), and coordination overhead (the same error reaches the service team repeatedly, across different clients).

The service team re-solves the same problems repeatedly because resolutions are never written down anywhere searchable — the knowledge disappears when a ticket closes instead of feeding future, similar cases. At much larger scale (10-50k users), this matching rule itself wouldn't need to change, but the knowledge base would need better categorization/segmentation (e.g. by ERP module or version) to keep match quality from degrading.

## User & Persona

**ERP end user** — any role at any client company using the ERP (purchasing, sales, accounting, warehouse). Reaches for this product the moment they hit an error message during everyday ERP work that they don't understand and can't resolve on their own.

### Secondary persona

Service-team staff member — handles tickets that AI/documentation couldn't resolve, and records the resolution back into the knowledge base for future reuse.

## Success Criteria

### Primary
- The first flow works end to end: user pastes an error message, gets a suggested cause/steps when a match is found in the knowledge base, or the message is escalated as a service ticket when no match is found.

### Secondary
# TODO: secondary success outcome — see Open Questions

### Guardrails
- Client company data (tickets, error context) must remain private — no cross-client leakage.
- Response time to the user should improve versus today, and/or the volume of simple repeat tickets reaching the service team should decrease.

## User Stories

### US-01: Client user resolves or escalates an ERP error

- **Given** a logged-in client user who has hit an error message in the ERP
- **When** they paste the error text into the tool
- **Then** they see a suggested cause and steps if a match exists in the knowledge base, or the message is turned into a service ticket visible to service staff if no match is found

#### Acceptance Criteria
- A match found in the knowledge base is shown to the user without creating a ticket
- No match found creates a ticket in a "to do" state, visible only to service staff and the submitting client's own company
- The user is told clearly which of the two outcomes happened

## Functional Requirements

### Error resolution (client user)
- FR-001: Client user can paste the text of an error message. Priority: must-have
  > Socratic: Counter-argument considered: "users may paste overly long or irrelevant fragments (whole logs), confusing the match." Resolution: kept as written; mitigated with explicit user-facing instructions on exactly where in the ERP to copy the specific error message from, so irrelevant fragments aren't pasted in the first place.
- FR-002: Client user can receive a suggested cause and steps when the system finds a match in the knowledge base. Priority: must-have
  > Socratic: Counter-argument considered: "a wrong match can mislead the user more than it helps (false confidence)." Resolution: kept; if following the suggested steps doesn't resolve it, the user can mark the suggestion as not helpful (see FR-011), which escalates to a service ticket carrying the user's comment.

### Service escalation
- FR-003: System can automatically create a service ticket when no match is found. Priority: must-have
  > Socratic: Counter-argument considered: "this could flood the service team with tickets for errors the user could resolve with a light hint instead." Resolution: no counter-argument strong enough to change it; stands as written.
- FR-004: Service staff can see tickets on their dashboard in a "to do" state. Priority: must-have
  > Socratic: Counter-argument considered: "without prioritization/queuing, the dashboard gets overwhelmed once there are many clients." Resolution: no counter-argument strong enough to change it for MVP; a simple unsorted list is enough for now.
- FR-005: Service staff can record the resolution once a ticket is handled. Priority: must-have
  > Socratic: Counter-argument considered: "an internal tool where service staff enter resolutions carelessly means similar future problems keep reaching a human instead of being resolved automatically." Resolution: risk accepted — this is an internal-team quality/organizational matter, not something the product should enforce at MVP stage.
- FR-006: Recorded resolutions feed the knowledge base used by FR-002 for future similar errors. Priority: must-have
  > Socratic: No counter-argument strong enough to change it; stands as written.
- FR-011: Client user can mark a suggested resolution (FR-002) as not helpful, which creates a service ticket carrying the user's comment. Priority: must-have

### Knowledge base sources
- FR-012: The knowledge base searched by FR-002 includes existing ERP (XEMI) system documentation (currently maintained as PDF/Word/Excel files describing known errors and fixes), ingested alongside resolved-ticket history (FR-006), as a second match source. Priority: must-have
  > Socratic: Counter-argument considered: "starting the MVP with only ticket-history matching (FR-006) is simpler — the documentation source adds one-time ingestion scope (extracting text from PDF/Word/Excel, chunking, embedding) that isn't yet sized." Resolution: kept as written — the documentation is a known, already-existing source of the same kind of information FR-002 needs, and excluding it would leave the knowledge base empty of matches until enough tickets accumulate. Ingestion mechanics are a tech/implementation concern, not scoped further here; open sizing questions are tracked below.

### Access
- FR-007: Client user can log in and see only their own company's tickets. Priority: must-have
  > Socratic: No counter-argument strong enough to change it; stands as written.
- FR-008: Service staff can log in and see tickets from all client companies. Priority: must-have
  > Socratic: No counter-argument strong enough to change it; stands as written.

### ERP integration
- FR-009: Service staff can receive an email notification at a dedicated mailbox integrated with the ERP when a new ticket arrives. Priority: nice-to-have
  > Socratic: No counter-argument strong enough to change it; stands as written.
- FR-010: Service staff can view tickets directly from within the ERP interface. Priority: nice-to-have
  > Socratic: Counter-argument considered: "ERP-UI integration could be far more costly than a separate web dashboard, since it needs deeper access than what was used in prior projects." Resolution: clarified — the ERP already ingests and displays emails sent to that dedicated mailbox natively, so this capability is fully satisfied by FR-009 (sending the email); no separate ERP-UI integration work is needed.

## Non-Functional Requirements

- The user sees a suggested cause or an escalation outcome within a few seconds of submitting the error text — no long wait without feedback.
- Error content and tickets from one client company are never visible to another client company.
- The product is usable from the standard browser already used by client employees at work — no dedicated app required.

## Business Logic

**The application matches an error message to the most similar previously-resolved case.**

The rule takes the raw text of the error message the user pastes as its input. Its output is not always a single, clean answer — depending on what the matched case(s) show, it can be a single cause or a chain of different related causes/dependencies. The user encounters this the moment an error is thrown in the ERP system — that trigger is what sends them to the tool with the error text in hand.

The match sources are two knowledge inputs, not one: previously-resolved ticket history (FR-006) and existing ERP (XEMI) system documentation describing known errors and fixes (FR-012). Both are searched together; a match can come from either source.

## Access Control

Login-based authentication (email+password / OAuth / passwordless — mechanism TBD downstream). Two roles:

- **Client user** — belongs to one client company; can submit an error message, see the AI's suggested cause/steps, and escalate to a service ticket when unresolved. Sees only their own company's tickets.
- **Service staff** — internal role; sees tickets from all client companies on their dashboard in a "to do" state, and records the resolution once handled.

Data isolation: tickets and any client-specific data are fully isolated between client companies — a client from Company A cannot see Company B's tickets. The knowledge base (resolved-ticket history plus ingested ERP documentation, per FR-012) is shared across all clients so the AI can reuse a match found for one client when a similar error appears for another.

## Non-Goals

- **Modifying the ERP system itself** — the tool reads error messages and sends emails around the ERP, but never changes the ERP's own code or configuration.
- **Supporting multiple different ERP systems** — MVP scope is this one specific ERP (XEMI), not a generic multi-ERP tool.
- **Fully automating ticket closure without service staff** — service staff always manually resolves and records the resolution; the AI never closes a ticket on its own.
- **Analytics dashboards / error trend reporting** — no error-statistics reporting in MVP; a possible future extension.

## Open Questions

1. **What is the secondary (nice-to-have) success outcome for this MVP?** — Owner: user. Not yet identified during shaping; no blocking impact, Primary and Guardrails are sufficient to evaluate MVP success without it.
2. **What are the expected QPS and data-volume ballparks?** — Owner: user. Only the user-count scale (large, ~100-500 total users) was captured during shaping; throughput and data-volume ballparks were not discussed. By: before tech-stack selection, since these inform infrastructure sizing.
3. **How much ERP documentation exists, and how consistent is its format?** (FR-012) — Owner: user. Volume (page/file count) and format consistency of the existing PDF/Word/Excel documentation directly affect ingestion effort and knowledge base quality. By: before designing the ingestion approach.
4. **Does the ERP documentation change over time, and who owns re-ingesting updates?** (FR-012) — Owner: user. Not yet decided whether this is a one-time bulk import at MVP launch or an ongoing process as documentation is revised. By: before designing the ingestion approach.
