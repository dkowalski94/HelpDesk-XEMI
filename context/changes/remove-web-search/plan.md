# Remove web search and the Exa integration — Implementation Plan

## Overview

Remove the unused web-search feature (`/search`, `POST /api/web-search`) and the whole Exa integration from code, config, docs and agent tooling, so users no longer see the "Exa nie jest skonfigurowana" banner and `EXA_API_KEY` disappears everywhere. Roadmap slice S-01 (MS-05) of milestone M-2.

## Current State Analysis

The feature is self-contained: one page, one island, one API route, one service and one REST wrapper, plus a hand-written response union in `src/types.ts`. Nothing links to `/search` any more (the start-page change removed the last entry point), the smoke test and CI never call it, and `exa-js` is not a dependency. The only cross-cutting touch points are the route gate, the config-status banner, the `astro:env` schema, `.env.example`, three comments that point at Exa/web-search as precedent, CLAUDE.md, and the `build-with-exa` agent skill.

## Desired End State

- `/search` and `/api/web-search` return the standard 404; no page, component, service or type for web search remains.
- `Layout.astro` shows only the Supabase banner (when Supabase is missing); no Exa banner in any configuration.
- `EXA_API_KEY` is absent from `astro.config.mjs`, `.env.example`, CLAUDE.md, the hosted Worker secrets and the developer's local `.env` / `.dev.vars`.
- The `build-with-exa` skill and `skills-lock.json` are gone.
- Verify: `git grep -n -i -E "\bexa\b|EXA_API_KEY|web-search|WebSearch|search\.astro" -- . ':!context' ':!.claude/skills/10x-*'` returns nothing; lint, `astro check`, build and smoke pass.

### Key Discoveries:

- Files to delete: `src/pages/search.astro`, `src/components/search/WebSearchPanel.tsx`, `src/pages/api/web-search.ts`, `src/lib/services/web-search.ts`, `src/lib/exa.ts`.
- `src/types.ts:3-29` — `WebSearchResult`, `WebSearchSuccess`, `WebSearchFailureReason`, `WebSearchFailure`, `WebSearchResponse`; referenced in comments at `src/types.ts:42` ("the web-search shapes above") and `src/types.ts:106` ("Mirrors the `WebSearchResponse` union above").
- `src/middleware.ts:5` — `PROTECTED_ROUTES = ["/search", "/report-error", "/my-tickets"]`.
- `src/lib/config-status.ts:1,19-25` — imports `EXA_API_KEY` and declares the Exa `ConfigStatus` entry rendered by `src/layouts/Layout.astro`.
- `astro.config.mjs:41` — `EXA_API_KEY` in `env.schema`; `.env.example:3`.
- `src/lib/openai.ts:26` — comment "same as `@/lib/exa`".
- CLAUDE.md — section "### Web search (Exa)", the `.dark` note naming `search.astro`, and the Environment env-var list.
- Agent skill: `.claude/skills/build-with-exa/`, `.agents/skills/build-with-exa/`, `skills-lock.json` (its only entry), added in 4081a7d.

## What We're NOT Doing

- No redirect or stub for `/search` — the old URL gets the standard 404 (a Polish 404 comes with S-04).
- No changes to `context/archive/**` or the roadmap's historical text; archived changes stay immutable.
- No change to the Supabase banner or to `Banner.astro` / `config-status.ts` structure beyond dropping the Exa entry.
- No change to the S-01 error-resolution "search" (knowledge-base similarity search) — only web search goes.
- No CI changes — CI never set or used `EXA_API_KEY`.
- No edits to the course-managed `.claude/skills/10x-*` skills (synced by 10x-cli); they are excluded from the leftover grep.

## Implementation Approach

Pure deletion, code first, then the surrounding documentation and tooling. Phase 1 leaves the app building and type-checking with no Exa reference in `src/`, config or `.env.example`; Phase 2 makes the docs and agent tooling match and removes the key from the places only a human can reach.

## Phase 1: Remove the code and config

### Overview

Delete the web-search feature and the Exa client, and unhook them from the route gate, the config banner, the env schema and the env template.

### Changes Required:

#### 1. Feature files

**File**: `src/pages/search.astro`, `src/components/search/WebSearchPanel.tsx` (and the then-empty `src/components/search/`), `src/pages/api/web-search.ts`, `src/lib/services/web-search.ts`, `src/lib/exa.ts`

**Intent**: Remove the page, island, API route, service and REST wrapper.

**Contract**: Files deleted; no remaining imports of `@/lib/exa` or `@/lib/services/web-search`.

#### 2. Shared types

**File**: `src/types.ts`

**Intent**: Drop the web-search DTOs and keep the surrounding comments truthful.

**Contract**: Remove the five `WebSearch*` declarations (lines 3-29). Reword the comment at line 42 to name only the app's own DTOs (`SessionProfile` etc.) and the one at line 106 so it no longer says it mirrors `WebSearchResponse` (e.g. point at the other discriminated unions in the file, such as `ErrorResolutionResponse`, or drop the sentence).

#### 3. Route gate

**File**: `src/middleware.ts`

**Intent**: `/search` no longer exists, so it leaves `PROTECTED_ROUTES`.

**Contract**: `PROTECTED_ROUTES = ["/report-error", "/my-tickets"]`.

#### 4. Config banner

**File**: `src/lib/config-status.ts`

**Intent**: Remove the Exa banner.

**Contract**: Drop the Exa entry from `configStatuses` and `EXA_API_KEY` from the `astro:env/server` import; the Supabase entry and `missingConfigs` stay.

#### 5. Env schema and template

**File**: `astro.config.mjs`, `.env.example`

**Intent**: The key is no longer read anywhere.

**Contract**: Remove `EXA_API_KEY` from `env.schema` and its line from `.env.example`.

#### 6. Stale precedent comment

**File**: `src/lib/openai.ts`

**Intent**: The comment cites `@/lib/exa` as precedent for plain `fetch`; that module is gone.

**Contract**: Reword to state the reason without the reference (plain `fetch` so nothing Node-specific reaches workerd).

### Success Criteria:

#### Automated Verification:

- `npx astro sync` and `npx astro check` pass
- `npm run lint` passes
- `npm run build` passes
- `git grep -n -i -E "\bexa\b|EXA_API_KEY|web-search|WebSearch" -- src astro.config.mjs .env.example` returns nothing
- `npm run smoke` passes against `npm run preview` with a freshly reset local Supabase (`npx supabase db reset`)

#### Manual Verification:

- With `EXA_API_KEY` still present or absent in `.env`, `/` shows no Exa banner (the Supabase banner still appears when Supabase is unset)
- `/search` (signed in and signed out) returns the standard 404 page, not a sign-in redirect
- `POST /api/web-search` returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Docs, agent skill and secrets

### Overview

Make CLAUDE.md describe the app as it now is, remove the Exa agent skill, and remove the key from hosted and local secrets.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Stop documenting a feature that no longer exists.

**Contract**: Delete the whole "### Web search (Exa)" section; in the UI contract bullet, the `.dark` wrapper is applied by `admin/tickets.astro` only (drop `search.astro`); in "### Environment", drop `EXA_API_KEY` from the env-var list. No other CLAUDE.md wording changes.

#### 2. Agent skill

**File**: `.claude/skills/build-with-exa/`, `.agents/skills/build-with-exa/`, `skills-lock.json`

**Intent**: Remove the Exa skill so agents stop being offered Exa for future changes.

**Contract**: Both skill directories deleted; `skills-lock.json` deleted (its only entry is `build-with-exa`).

#### 3. Hosted and local secrets (manual)

**Intent**: The key is unused; remove it where it still lives outside the repo.

**Contract**: `npx wrangler secret delete EXA_API_KEY` on the production Worker (if it was ever set — `npx wrangler secret list` first); delete the `EXA_API_KEY` line from local `.env` and `.dev.vars`.

### Success Criteria:

#### Automated Verification:

- `git grep -n -i -E "\bexa\b|EXA_API_KEY|web-search|WebSearch|search\.astro" -- . ':!context' ':!.claude/skills/10x-*'` returns nothing
- `npm run lint` passes

#### Manual Verification:

- `npx wrangler secret list` no longer shows `EXA_API_KEY`
- Local `.env` and `.dev.vars` no longer contain `EXA_API_KEY`
- After the deploy from `master`, the production start page shows no Exa banner and `/search` returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- None — there are no unit tests in the project and nothing new to test; the change only removes code.

### Integration Tests:

- `npm run smoke` covers auth flow and tenant isolation and proves the removal broke nothing it touches (it never called web search).

### Manual Testing Steps:

1. Start `npm run dev` with and without `EXA_API_KEY` in `.dev.vars`; confirm no Exa banner on `/`.
2. Visit `/search` signed out and signed in; both show 404.
3. Sign in as a client and use `/report-error` and `/my-tickets` to confirm the protected routes still gate correctly.

## Performance Considerations

None; the Worker bundle shrinks slightly.

## Migration Notes

No database change. Rollback is a plain `wrangler rollback`; the older Worker treats a missing `EXA_API_KEY` as "not configured" (optional env field), so deleting the secret is safe in either direction.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-01 (MS-05)
- Prior removal of a page: `context/archive/start-page/` (removed `/dashboard`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Remove the code and config

#### Automated

- [x] 1.1 `npx astro sync` and `npx astro check` pass
- [x] 1.2 `npm run lint` passes
- [x] 1.3 `npm run build` passes
- [x] 1.4 No Exa/web-search references in `src`, `astro.config.mjs`, `.env.example`
- [x] 1.5 `npm run smoke` passes against the production preview with a reset local Supabase

#### Manual

- [x] 1.6 No Exa banner on `/` with or without `EXA_API_KEY`
- [x] 1.7 `/search` returns 404 signed in and signed out
- [x] 1.8 `POST /api/web-search` returns 404

### Phase 2: Docs, agent skill and secrets

#### Automated

- [ ] 2.1 No Exa/web-search references in the repo outside `context/`
- [ ] 2.2 `npm run lint` passes

#### Manual

- [ ] 2.3 `EXA_API_KEY` removed from the production Worker secrets
- [ ] 2.4 `EXA_API_KEY` removed from local `.env` and `.dev.vars`
- [ ] 2.5 Production start page shows no Exa banner and `/search` returns 404 after deploy
