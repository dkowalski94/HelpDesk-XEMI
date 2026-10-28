# Remove web search and the Exa integration — Plan Brief

> Full plan: `context/changes/remove-web-search/plan.md`

## What & Why

Roadmap slice S-01 (MS-05): the product never used the starter's web-search page, yet every visitor without an Exa key sees "Exa nie jest skonfigurowana — wyszukiwanie w internecie jest wyłączone." This change removes web search and the whole Exa integration from code, config, docs and agent tooling.

## Starting Point

Web search is self-contained: `/search` page + `WebSearchPanel` island, `POST /api/web-search`, `services/web-search.ts`, `lib/exa.ts`, and the `WebSearch*` types. Nothing links to `/search` any more; smoke and CI never touch it. `EXA_API_KEY` lives in `astro.config.mjs`, `.env.example`, the config banner, CLAUDE.md, the hosted Worker and local env files; a `build-with-exa` agent skill is tracked in the repo.

## Desired End State

No web-search page, route, service or type remains; `/search` returns the standard 404. The only config banner left is Supabase's. `EXA_API_KEY` is gone from code, config, docs, hosted secrets and local files, and the Exa agent skill is removed.

## Key Decisions Made

| Decision                 | Choice                                     | Why (1 sentence)                                                                        |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `build-with-exa` skill   | Remove (both dirs + `skills-lock.json`)    | MS-05 says "the whole Exa integration"; agents should not suggest Exa in future changes. |
| Old `/search` URL        | Standard 404, no redirect                  | Nothing links to it; a redirect would be dead code (Polish 404 arrives in S-04).        |
| Hosted secret            | Deleted by hand with `wrangler secret delete` | CI never manages secrets; the field is optional so rollback stays safe.              |
| Archived docs / roadmap  | Untouched                                  | Archived changes are immutable history.                                                 |

## Scope

**In scope:**
- Delete the five web-search/Exa source files and the `WebSearch*` types
- Unhook `/search` from `PROTECTED_ROUTES`, Exa from `config-status.ts`, `EXA_API_KEY` from `astro.config.mjs` and `.env.example`
- Fix comments citing Exa/web-search (`openai.ts`, `types.ts`)
- CLAUDE.md: drop the "Web search (Exa)" section and other mentions
- Remove the `build-with-exa` skill; remove the key from hosted and local secrets

**Out of scope:**
- Redirect or stub for `/search`; Polish 404 (S-04)
- Knowledge-base similarity search (S-01 error resolution) — unrelated, stays
- `context/archive/**` and roadmap history; CI workflow

## Architecture / Approach

Pure deletion, code first: Phase 1 removes everything under `src/` plus the env schema/template and must leave lint, `astro check`, build and smoke green. Phase 2 aligns CLAUDE.md and agent tooling and covers the human-only steps (Cloudflare secret, local `.env`/`.dev.vars`).

## Phases at a Glance

| Phase                          | What it delivers                                        | Key risk                                           |
| ------------------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| 1. Remove the code and config  | App without web search or Exa banner; build green       | A leftover import/type reference — caught by `astro check` |
| 2. Docs, agent skill, secrets  | CLAUDE.md accurate, skill gone, key removed everywhere  | Forgetting the hosted secret (manual step)         |

**Prerequisites:** local Supabase (Docker) for the smoke run; `wrangler` auth for the secret deletion.
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- Assumes `EXA_API_KEY` may or may not be set on production — check with `wrangler secret list` before deleting.
- A bookmarked `/search` now lands on a 404 instead of a sign-in redirect; accepted.

## Success Criteria (Summary)

- No visitor ever sees an Exa banner, and `/search` is gone.
- `git grep` for Exa/web-search outside `context/` finds nothing; lint, `astro check`, build and smoke pass.
- `EXA_API_KEY` no longer exists in the hosted Worker or local env files.
