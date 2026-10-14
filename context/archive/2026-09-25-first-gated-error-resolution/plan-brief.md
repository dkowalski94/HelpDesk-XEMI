# First Gated Error Resolution — Plan Brief

> Full plan: `context/changes/first-gated-error-resolution/plan.md`

## What & Why

Roadmap slice S-01, the milestone's north star: a client user pastes an ERP error message and immediately gets either a matching cause/steps from the shared knowledge base or an automatically filed service ticket — and is told which one happened. It proves the PRD's primary success criterion ("the first flow works end to end") on top of the tenant schema (F-01) and the ingested ERP documentation (F-02).

## Starting Point

The database already lets a client file a `todo` ticket for their own company, and the knowledge base holds embedded ERP-doc fragments (`text-embedding-3-small`, 1536 dims, HNSW cosine index). There is no similarity-search function, clients cannot read embeddings, the Worker has no OpenAI key, and there is no screen for the flow.

## Desired End State

On `/report-error` a client user reads a Polish instruction, pastes up to 2000 characters and sees one of: up to 3 matching entries (no ticket), a newly created ticket, or "you already reported this". If the search is unavailable, a ticket is filed anyway and the user is told why. Below the form they see only the tickets they filed themselves.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| What counts as a match | Cosine similarity ≥ 0.5, show up to 3, best first | Covers the PRD's "chain of causes" and leaves one constant (`MATCH_THRESHOLD`) to calibrate on real queries |
| Search failure (no key, OpenAI down, RPC error) | File a ticket and say the search was unavailable | A report is never lost; CI without a key exercises the full ticket path |
| Language | Polish on the new page, island and endpoint messages only | End users, ERP errors and docs are Polish; other screens stay English |
| Testing the matched path | SQL tests with fixed vectors + HTTP smoke for the ticket path + manual run with a real key | No test-only code in production and no OpenAI secret in CI |
| Duplicate pastes | Same user + open `todo` ticket + identical trimmed text → "already reported" | Fewer repeat tickets; always points at a ticket the user can see |
| Ticket list | Only the user's own tickets, via `GET /api/tickets?mine=1` | The user asked for "only mine"; the unfiltered route stays the smoke test's RLS probe |
| "Only mine" enforcement | View filter in the API, not RLS | Keeps PRD FR-007 and F-01's tested policies intact |
| Long pastes | Hard limit 2000 characters (400), counter + instruction | Implements the PRD's mitigation and bounds embedding cost |
| Search access for clients | New `SECURITY DEFINER` function `match_knowledge_base` | Clients cannot read `embedding`; the function exposes only the view's columns plus similarity |

## Scope

**In scope:**
- Migration with `match_knowledge_base` and its privilege hardening, plus `rls.sql` tests
- `OPENAI_API_KEY` config, `src/lib/openai.ts`, resolution service, `POST /api/resolve-error`, `?mine=1` on `GET /api/tickets`
- `/report-error` page, React island and hook, dashboard link, smoke coverage, CLAUDE.md

**Out of scope:**
- "Not helpful" marking (S-03); staff resolution and feeding the knowledge base (S-02)
- An RLS change to per-user visibility; a database-enforced unique open ticket
- Translating existing screens; an OpenAI stub or secret in CI; retries or caching of embeddings
- Documentation screenshots, email notification, analytics, HNSW or chunking tuning

## Architecture / Approach

Island → `POST /api/resolve-error` (FormData) → service: validate → `embedText` (OpenAI, 8 s timeout) → `rpc("match_knowledge_base")` on the user's session → matched? return entries : dedupe against the user's own `todo` tickets → insert ticket through the existing RLS policy. Every search failure is treated as "no match" plus a `searchUnavailable` flag. The island reloads `GET /api/tickets?mine=1` after a ticket outcome.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Match function in the database | `match_knowledge_base` + SQL tests on fixed vectors + regenerated types | Operator qualification under `search_path = ''`; the index is used only by the ordered inner query |
| 2. Server path | OpenAI client, service, endpoint, `?mine=1`, smoke for denials and the ticket path | Keeping `astro:env/server` out of the island bundle; smoke idempotency |
| 3. Client page | Polish `/report-error` page, outcome views, own-ticket list, dashboard link | Threshold 0.5 may need calibration on real documents |

**Prerequisites:** local Supabase (Docker); an OpenAI key and one real ERP PDF for the manual checks; before merge, `supabase db push` and `wrangler secret put OPENAI_API_KEY` on production.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- The 0.5 threshold is a starting point; real match quality on fixed-size documentation fragments is unknown until the manual calibration step.
- Deduplication is an application check: two truly concurrent submissions can still file two tickets.
- Locally, each smoke run adds one ticket to Klient Alfa; after ~50 runs without a `db reset`, the existing staff check expecting a single page of tickets will fail.
- The instruction on "where to copy the error from" is generic until someone names the exact spot in the XEMI UI.
- Without the production OpenAI secret, the feature silently degrades to "every paste is a ticket".

## Success Criteria (Summary)

- A client user pasting a documented error sees the relevant fragment or resolution, and no ticket is filed.
- An unknown error (or a search outage) always ends as exactly one visible `todo` ticket for that user.
- No other company, staff account or unassigned account can use the flow or see the new tickets beyond what RLS already allows.
