# ERP Documentation Ingestion Pipeline — Plan Brief

> Full plan: `context/changes/erp-doc-ingestion-pipeline/plan.md`

## What & Why

Roadmap F-02 (FR-012): load the existing ERP (XEMI) PDF documentation into the shared knowledge
base so S-01 has a second match source. The documentation changes over time and service staff
own it, so loading must be a repeatable script a non-developer runs on their own machine, and it
must replace a document's old entries instead of duplicating them.

## Starting Point

F-01 created `knowledge_base_entries` with a `vector(1536)` embedding column and HNSW index, but
nothing records which document an entry came from, and `authenticated` has no DELETE on it. There
is no PDF parser or embedding client in the project yet.

## Desired End State

A service-staff member runs `npm run ingest -- <pliki lub folder>`, types their HelpDesk
password, and sees Polish progress. Each PDF becomes one `erp_documents` row plus N `erp_doc`
entries with embeddings, visible to clients through `knowledge_base_public`. Unchanged files are
skipped; edited files are replaced atomically; `--lista`, `--usun` and `--dry-run` cover the rest.

## Key Decisions Made

| Decision            | Choice                                                         | Why (1 sentence)                                                                                             | Source  |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| Corpus & format     | PDF only, ~20 × ~200 MB, text only, no OCR                     | Screenshots add nothing the text lacks; Word/Excel are not in the current corpus.                              | Roadmap |
| Where it runs       | Offline script, run by service staff; no in-app upload         | Keeps large files and CPU-heavy work away from the Worker.                                                    | Roadmap |
| Embeddings          | OpenAI `text-embedding-3-small`, 1536 dims, plain `fetch`      | Matches the existing column and its comment; no schema change; S-01 must use the same model.                  | Plan    |
| Chunking            | Fixed ~800-token fragments with overlap; label in `error_text`, text in `steps` | Works on any PDF layout without knowing its structure; `error_text` is NOT NULL.                   | Plan    |
| Credentials         | Staff member's own HelpDesk login; writes only via `SECURITY DEFINER` RPCs checking `is_service_staff()` | No full-access key on laptops; RLS stays in force; `ingested_by` is recorded.            | Plan    |
| Document identity   | New `erp_documents` registry (file name, SHA-256); entries FK `ON DELETE CASCADE` | Hash skips unchanged files; replace/remove are one clean operation.                              | Plan    |
| Upload shape        | Batches staged into a private table, then one atomic publish   | Avoids multi-MB single requests; clients never see a half-loaded document.                                    | Plan    |
| Distribution        | Script in the repo (`npm run ingest`), Polish runbook          | One source of truth, updates via `git pull`, covered by lint/CI.                                              | Plan    |
| Verification        | `rls.sql` denied-write checks + `--dry-run` + manual runs      | Covers the security risk automatically without an OpenAI key in CI; e2e CI test deferred to Module 3.         | Plan    |

## Scope

**In scope:**
- Migration: `erp_documents`, staging table, `knowledge_base_entries.erp_document_id` + check, three staff-only functions, privilege revokes
- Seed update and `rls.sql` coverage for every new surface
- `scripts/ingest-erp-docs.mjs` + modules (extract, chunk, embed, upload), `unpdf` as devDependency
- Polish runbook, `.env.ingest.example`, CLAUDE.md, hosted `db push`, first real ingestion

**Out of scope:**
- Word/Excel, OCR, screenshots; in-app upload or any Worker route
- S-01's matching query and Worker-side embedding call
- Structure-aware chunking, header/footer stripping, packaged executable
- CI end-to-end ingestion test; any use of `service_role`

## Architecture / Approach

```
PDF ──hash──► skip if unchanged (erp_documents)
  └─unpdf─► pages ─chunk─► fragments ─OpenAI─► vectors
                     └─ stage_erp_document_chunks() ×N batches ─► staging table (private)
                     └─ publish_erp_document() ── one tx: delete old doc (cascade) → insert doc + entries → clear staging
```
Everything expensive happens before the first write, so an OpenAI or network failure leaves the
knowledge base untouched.

## Phases at a Glance

| Phase                                   | What it delivers                                              | Key risk                                                            |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Schema and the staff-only write path | Registry, staging, FK/check, 3 RPCs, revokes, `rls.sql` tests | A write hole on a new surface — mitigated by denied-write tests now  |
| 2. PDF extraction and chunking (dry run)| `npm run ingest -- --dry-run` on real PDFs, no network        | `unpdf` memory/quality on 200 MB files                               |
| 3. Embeddings, sign-in and publish      | Real ingestion, skip-by-hash, replace, `--lista`/`--usun`     | Error messages unusable for a non-developer                          |
| 4. Staff runbook and production rollout | Polish runbook, env template, CLAUDE.md, hosted migration, first load | Staff setup friction (Node/Git on their machine)             |

**Prerequisites:** F-01 done (it is); an OpenAI API key; a service-staff account on the hosted
project; one real ERP PDF available locally for Phases 2–3.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Fixed-size fragments may match worse than per-error sections if documents are strongly structured — revisit after S-01 sees real queries.
- Assumes no `erp_doc` rows exist on the hosted database; the migration aborts with instructions if they do.
- A staff member needs Node 22 and Git installed once; the runbook must carry them through it.
- The OpenAI key lives in `.env.ingest` on the staff machine — accepted; it is scoped to embeddings spend only.

## Success Criteria (Summary)

- A service-staff member loads all current ERP PDFs using only the runbook, and a client account sees the resulting `erp_doc` entries.
- Re-running on unchanged files is a no-op; on changed files it replaces, never duplicates.
- `rls.sql` proves no role other than service staff (through the functions) can write the new surfaces.
