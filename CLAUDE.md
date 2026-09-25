# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)
- `npm run smoke` — dependency-free auth-flow and tenant-isolation smoke test (`scripts/smoke.mjs`) against a running server, `BASE_URL` env (default `http://localhost:4321`). Needs the demo personas from `supabase/seed.sql` (`npx supabase db reset`). Run after dependency upgrades; CI runs it against the production preview with a local Supabase.
- `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql` — policy-level negative checks (denied writes and escalations as each seeded persona), run in one rolled-back transaction; non-zero exit means a check failed. Without a local `psql`: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls.sql`.
- `npx astro check` — type-checks `.astro` files (run in CI after `npx astro sync`, not wired to an npm script).
- `npm run ingest -- [--dry-run | --lista | --usun <plik.pdf> | --wymus | --pomoc] <plik.pdf | folder> ...` — offline ERP documentation ingestion (`scripts/ingest-erp-docs.mjs`), run by service staff from a repo clone; see *ERP documentation ingestion*. `--dry-run` needs no config or network; everything else reads `.env.ingest` and prompts for a staff password (locally: `serwis@xemi.local` from the seed).

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

**Astro 7 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages and API routes are server-rendered by default; no `prerender` exports are currently used anywhere in `src/`.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`. Also resolves the tenancy profile (`context.locals.profile`, `context.locals.profileLookupFailed`) and gates `STAFF_ROUTES` by role: pages get a redirect, paths under `/api/` get 401/403 because a `fetch` caller follows a 302 and reads the resulting HTML as success. When adding a gated path, add its `/api` twin too — prefix matching does not relate `/admin` to `/api/admin`.
- **Two invariants the route gate depends on, neither visible from `src/middleware.ts`.** (1) Astro normalizes `context.url.pathname` — percent-decoding, duplicate-slash collapsing, dot-segment resolution — *before* middleware runs, which is why `/admin%2Fusers` and `/admin../dashboard` are gated; re-check after an Astro upgrade. (2) `wrangler.jsonc` serves `./dist` as static assets with no `run_worker_first`, so a matching asset is served **before** the Worker runs: a single `export const prerender = true` on a page under a gated prefix, or one file in `public/<gated-prefix>/`, silently removes the gate from that path with no error anywhere.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`; `src/pages/api/admin/assign-company.ts` (staff-only); `src/pages/api/tickets.ts` (`GET`, returns 401 itself for anonymous callers — it is not in `PROTECTED_ROUTES`; the select has no company filter, so it returns exactly what RLS permits)
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`
- `SUPABASE_URL`/`SUPABASE_KEY` are declared `optional: true` in the `astro:env` schema. `createClient()` (`src/lib/supabase.ts`) returns `null` when either is missing, and the middleware treats that as a logged-out user rather than throwing — the app boots and renders without Supabase configured. `src/lib/config-status.ts` drives the "Supabase not configured" banner shown in that state.

### Web search (Exa)

- `src/lib/exa.ts` — thin `fetch` wrapper over the Exa REST API, keyed by `EXA_API_KEY` from `astro:env/server`. Deliberately **not** the `exa-js` SDK: it depends on `cross-fetch`, which `require`s `node-fetch` and fails in the workerd runtime. `isExaConfigured()` lets callers degrade instead of throwing, same as `createClient()` for Supabase.
- `src/lib/services/web-search.ts` — sends Exa's recommended `/search` request: `query` + `type: "auto"` + `contents: { highlights: true }`, and nothing else. Do not add `numResults`, `category`, domain filters or date/freshness filters without a stated requirement — over-specifying the request is the documented integration mistake.
- `src/pages/api/web-search.ts` — `POST`, signed-in users only (each call spends Exa credits). Returns the `WebSearchResponse` discriminated union from `src/types.ts`; the route maps `WebSearchFailureReason` to a status code.
- UI: `src/pages/search.astro` (in `PROTECTED_ROUTES`) mounting the `src/components/search/WebSearchPanel.tsx` island.

### ERP documentation ingestion

- `scripts/ingest-erp-docs.mjs` + `scripts/ingest/*.mjs` — plain Node script that loads ERP PDFs into `knowledge_base_entries` (`source = 'erp_doc'`). **Offline only**: nothing in `src/` imports it and there is no Worker route or in-app upload. Run by a non-developer: every user-facing string is Polish and lives in `scripts/ingest/messages.mjs`; the staff runbook is `docs/wgrywanie-dokumentacji-erp.md` — update it when flags or messages change.
- Signs in as the staff member (`signInWithPassword`, password always prompted, never in env) with the **publishable/anon key only**; `loadConfig()` in `scripts/ingest/upload.mjs` rejects a `service_role`/`sb_secret_` key. Config comes from `.env.ingest` (template `.env.ingest.example`), read by the script's own loader resolved against the repo root rather than `node --env-file` (which prints an English notice when the file is absent): UTF-8 BOM stripped, UTF-16 (PowerShell 5.1 `>`) rejected with a Polish message, variables already in the environment win. `OPENAI_API_KEY` is required only for loading, not `--lista`/`--usun`; `SUPABASE_URL` must be `https:` except for localhost.
- **Writes go solely through the three `SECURITY DEFINER` functions** of `supabase/migrations/20260924120000_erp_document_ingestion.sql`: `stage_erp_document_chunks` (batches into a staging table with RLS on and no policies), `publish_erp_document` (one transaction: replace the document, clear staging), `remove_erp_document`. Each raises 42501 unless `is_service_staff()`. `authenticated` has only staff-filtered SELECT on `erp_documents` — do not add direct write grants or policies. The script's Polish mapping keys on these errors (`databaseError()` in `messages.mjs`, incl. `UPLOAD_INTERRUPTED_MESSAGES` matched against the functions' `raise` texts), so changing a function's error text means updating that list.
- **Every `erp_doc` entry must have a document**: check `knowledge_base_entries_erp_doc_has_document` ties `source = 'erp_doc'` to a non-null `erp_document_id` (FK `on delete cascade` — the entries *are* the document). Any other writer (seed, tests) creates the `erp_documents` row first. Document identity is the base file name in NFC, case-insensitive (unique index on `lower(file_name)`).
- **Embedding model and dimension are shared with S-01's query side**: `text-embedding-3-small`, 1536 (`scripts/ingest/embeddings.mjs`, column `extensions.vector(1536)`). Changing either on one side makes every stored vector unmatchable; it means a new migration plus re-ingesting everything with `--wymus`.
- `unpdf` stays a **devDependency**, imported only from `scripts/`, so it never enters the Worker bundle; staff get it through a plain `npm ci` (never `--omit=dev`). The embeddings client is plain `fetch`, no OpenAI SDK.

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports (see `src/pages/api/auth/*.ts`). Input is currently read directly from `FormData` with no schema validation layer (`zod` is not a dependency) — follow that pattern unless the user asks to introduce validation.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/hooks/` (matches the `hooks` alias in `components.json`).
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.
- **shadcn/ui component set**: currently only `Button` (`src/components/ui/button.tsx`) is installed; `LibBadge.astro` is a project-specific badge, not a shadcn component.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY`, `EXA_API_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Ingestion script env vars (`.env.ingest`, template `.env.ingest.example`, gitignored): `SUPABASE_URL`, `SUPABASE_KEY` (same publishable/anon key as the app), `OPENAI_API_KEY`, optional `HELPDESK_EMAIL`. `DEBUG=1` adds stack traces to its output.
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

### Database migrations

Nothing in CI migrates the hosted database: the `deploy` job runs `npm run build` and `npx wrangler deploy` only. Applying a migration to production is a manual gate.

- **A PR that adds or changes a file in `supabase/migrations/` must be applied to the hosted project before it is merged to `master`** — the merge deploys a Worker that expects the new schema. Run `npx supabase link --project-ref <ref>` once, then `npx supabase db push --dry-run` to see which migrations are pending, then `npx supabase db push`.
- **`supabase/seed.sql` is local/CI only and is never applied to production.** It holds demo personas with known passwords. `db reset` and `supabase start` run it; `db push` does not — never pass `--include-seed`. Rows the schema itself needs (the internal and unassigned companies) live in the migrations, not the seed.
- **Rolling back a deploy does not roll back a migration.** `wrangler rollback` reverts the Worker only. Before rolling back across a migration, check by hand that the older Worker's queries still work against the current schema; if they do not, fix forward with a new migration.
- A migration already applied to the hosted project is immutable — change it with a new migration, never by editing the file.

## CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs two jobs on every push and PR to `master`, then a third on push to `master` only:

- **ci** — `astro sync`, `npm run lint`, `astro check`, `npm run build`. Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI (which applies the migrations and `supabase/seed.sql`), runs `supabase/tests/rls.sql` against it with `psql`, builds, serves the production preview, and runs `npm run smoke` against it. No repository secrets required.
- **deploy** — after both pass: `npm run build` and `npx wrangler deploy`. It never touches the database; see *Database migrations*.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — Moduł 2, Lekcja 3

Przejrzyj kod wygenerowany przez AI przed scaleniem, korzystając z **łańcucha przeglądu implementacji**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` jest głównym tematem lekcji. Przegląd jest bramką jakości, a nie poleceniem naprawienia każdego znaleziska.

### Router zadań — od czego zacząć

| Umiejętność | Użyj jej, gdy |
| --- | --- |
| **Przegląd kodu (główny temat lekcji)** | |
| `/10x-impl-review <change-id>` | Zaimplementowano kod i chcesz przeprowadzić ustrukturyzowany przegląd przed scaleniem. Umiejętność sprawdza zgodność z planem, dyscyplinę zakresu, bezpieczeństwo i jakość, architekturę, spójność wzorców oraz kryteria sukcesu, a następnie przedstawia ustalenia do selekcji. |
| **Wynik powtarzającej się lekcji** | |
| `/10x-lesson` | Ustalenie ujawnia powtarzającą się regułę projektu lub wzorzec błędów agenta. Zapisz je w `context/foundation/lessons.md` zamiast traktować je jako jednorazową notatkę. |

### Dyscyplina selekcji

- Dotkliwość określa, jak poważne jest ustalenie. Wpływ określa, jak duże znaczenie ma teraz decyzja.
- Prawidłowe wyniki: napraw teraz, napraw inaczej, pomiń, zaakceptuj jako ryzyko, zapisz jako powtarzającą się regułę (`/10x-lesson`), nie zgódź się.
- Naprawiaj krytyczne ustalenia. Nie poświęcaj godzin na obserwacje o niskim wpływie tylko dlatego, że agent je znalazł.
- Świadome pomijanie ustaleń o niskim wpływie jest prawidłowym wynikiem przeglądu, a nie zaniedbaniem.
- Jeśli nie zgadzasz się z ustaleniem, zapisz dlaczego. Błędne rozumowanie agenta również jest sygnałem.

### Granice przeglądu

- Ta lekcja dotyczy przeglądu zaimplementowanego kodu. Nie tworzy planu, nie wykonuje nowych faz ani nie uczy przeglądu CI.
- Strategia testowania i bramki jakości zostaną wprowadzone w Module 3.
- Nie używaj `/10x-contract` jako wyniku selekcji w tej lekcji.

### Ścieżki używane przez tę lekcję

- `context/changes/<change-id>/plan.md` — oczekiwany kontrakt implementacji
- `context/changes/<change-id>/reviews/` — wynik przeglądu
- `context/foundation/lessons.md` — powtarzające się lekcje

Umiejętności nie mogą zapisywać do `context/archive/`. Zarchiwizowane zmiany są niezmienne; jeśli rozwiązana ścieżka docelowa zaczyna się od `context/archive/`, przerwij z komunikatem: "Ta zmiana jest zarchiwizowana. Zamiast tego otwórz nową zmianę za pomocą `/10x-new`."

<!-- END @przeprogramowani/10x-cli -->
