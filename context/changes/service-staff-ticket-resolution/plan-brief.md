# Service Staff Ticket Resolution — Plan Brief

> Full plan: `context/changes/service-staff-ticket-resolution/plan.md`

## What & Why

Roadmap S-02 closes the product's core loop. Service staff see every client company's open tickets, record cause and steps, and each resolution becomes a shared knowledge base entry, so the next client who hits a similar error gets the answer without a ticket (FR-004, FR-005, FR-006, FR-008). Without this the knowledge base never grows beyond the ingested ERP documentation.

## Starting Point

S-01 files `todo` tickets and already renders "Z rozwiązanych zgłoszeń" matches, showing cause and steps. The schema has resolution columns, but nothing in the app writes them. The existing staff write grants are broad: `resolved_by` can be forged (F2), and staff can edit `erp_doc` fragments (F9).

## Desired End State

`/admin/tickets` lists `todo` tickets from all client companies, oldest first. Staff enter cause and steps and see a preview of the sanitized text that will become shared knowledge. Saving resolves the ticket and creates a matchable knowledge base entry in one transaction. If OpenAI is down, the entry is saved without an embedding and a "Przelicz" button fills it in later. The filing client sees the cause and steps on their own ticket.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| KB error text | Auto-sanitized by deterministic rules (e-mail, account, NIP, phone, document no., amount, 5+ digit runs, company name) | Ticket entries are shown to *other* companies, and the PRD forbids cross-client leakage of error content. |
| Who sanitizes | Server only, no manual edit; staff see a read-only preview | User decision: automatic rules; the preview keeps it transparent. |
| Resolution shape | Cause (optional) + steps (required) | Maps 1:1 onto KB `cause`/`steps` and S-01's "Przyczyna / Kroki" card. |
| Cause on the ticket | New `tickets.resolution_cause` | Needed so the filing client can see the cause, not only the steps. |
| Write path | One definer function `resolve_ticket()`; direct ticket UPDATE and KB INSERT revoked | Atomic resolve + KB entry, `resolved_by := auth.uid()` (closes F2), one way in. |
| KB UPDATE policy | Narrowed to `source = 'ticket'` | Closes F9; the embedding backfill uses it. |
| Embedding fails | Save without an embedding and warn | Staff work is never blocked by an OpenAI outage. |
| Recovering missing embeddings | Counter + "Przelicz" button on the staff page (20 per click) | Problem and fix are visible in one place, with no repo access needed. |
| Client sees the resolution | Yes, under "Moje zgłoszenia" | A bare "Rozwiązane" status tells the filer nothing. |
| Queue | `todo` only, oldest first, 50/page, Polish UI, Astro SSR + form POST | PRD: a simple list is enough; follows the `/admin/users` pattern. |

## Scope

**In scope:**
- Migration: `resolution_cause`, `resolve_ticket()`, revoked direct writes, narrowed KB UPDATE, partial queue index, `rls.sql` denials.
- Sanitizer module, staff services, `POST /api/admin/resolve-ticket`, `POST /api/admin/backfill-embeddings`, resolution fields in `GET /api/tickets`, smoke steps.
- `/admin/tickets` page, dashboard link, the client's resolution view.

**Out of scope:** editing or reopening resolutions; manual or AI sanitization; queue sorting, search or assignment; email notification (FR-009); S-03's `user_comment` path; automatic embedding retries; `MATCH_THRESHOLD` calibration.

## Architecture / Approach

The staff form posts to the endpoint. The service reads the ticket under the staff session, sanitizes its text and tries to embed it (null on failure), then calls `resolve_ticket()`. The function checks staff (42501), resolves only a `todo` ticket, and inserts the KB row in the same transaction; it returns `resolved` / `already-resolved` / `not-found`. Clients keep reading their own tickets through RLS. Other companies see only the sanitized KB entry, through `match_knowledge_base`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | `resolve_ticket()`, hardened grants and policies, index, `rls.sql` denials, types | Grant inventory checks in `rls.sql` must be updated in step with the revokes |
| 2. Server path | Sanitizer, services, two staff endpoints, resolution in ticket listing, smoke | Regex rules mask an ERP error code or miss company data |
| 3. UI | Staff queue page, dashboard link, client's resolution view | Long ticket cards are unwieldy on a phone |

**Prerequisites:** S-01 archived (done); local Supabase with seed personas (`serwis@xemi.local`, Alfa/Beta clients); a few real XEMI error messages for checking the sanitizer.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- Deterministic rules cannot recognize counterparty or product names. Leakage of those is an accepted risk under the chosen "automatic only" policy.
- The rules assume ERP error codes are at most 4 digits. If XEMI uses longer codes, rule 7 must be narrowed (checked in manual step 2.8).
- Ticket entries saved without an embedding stay unmatchable until someone clicks "Przelicz".
- S-03's roadmap note assumes a `tickets` UPDATE grant that this plan removes; S-03 adds its own.

## Success Criteria (Summary)

- Staff resolve a ticket from the queue, and a client of a *different* company pasting a similar error gets the sanitized answer.
- The filing client sees the cause and steps on their own ticket.
- `rls.sql` and smoke prove that only staff can resolve, only through the function, and that `resolved_by` is always the real resolver.
