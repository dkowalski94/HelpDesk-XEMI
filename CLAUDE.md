# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)
- `npm run smoke` — dependency-free auth-flow and tenant-isolation smoke test (`scripts/smoke.mjs`) against a running server, `BASE_URL` env (default `http://localhost:4321`). Needs the demo personas from `supabase/seed.sql` (`npx supabase db reset`). Run after dependency upgrades; CI runs it against the production preview with a local Supabase. Each run files two Klient Alfa tickets — one through `/api/resolve-error`, resolved as staff (adding a `ticket` knowledge base entry), and one through `/api/escalate-error`, left open; nothing deletes any of them, so they accumulate in the newest-first `/api/tickets` listing, and after roughly 24 runs against the same local database the seeded ticket falls off the first page and the isolation steps fail — run `npx supabase db reset` every couple of dozen runs. With `OPENAI_API_KEY` set, reset before **every** run instead: the run's resolved ticket becomes a knowledge base entry, the next run's error text matches it, no ticket is filed and the ticket steps fail.
- `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql` — policy-level negative checks (denied writes and escalations as each seeded persona), run in one rolled-back transaction; non-zero exit means a check failed. Its row counts assume a seed-only database — locally ingested ERP docs or tickets from smoke runs make the control checks fail (e.g. "expected 2 row(s), got 58"), so run `npx supabase db reset` first. Without a local `psql`: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls.sql`.
- `npx astro check` — type-checks `.astro` files (run in CI after `npx astro sync`, not wired to an npm script).
- `npm run ingest -- [--dry-run | --lista | --usun <plik.pdf> | --wymus | --pomoc] <plik.pdf | folder> ...` — offline ERP documentation ingestion (`scripts/ingest-erp-docs.mjs`), run by service staff from a repo clone; see _ERP documentation ingestion_. `--dry-run` needs no config or network; everything else reads `.env.ingest` and prompts for a staff password (locally: `serwis@xemi.local` from the seed).

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

**Astro 7 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages and API routes are server-rendered by default; no `prerender` exports are currently used anywhere in `src/`.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`. Also resolves the tenancy profile (`context.locals.profile`, `context.locals.profileLookupFailed`) and gates `STAFF_ROUTES` by role: pages get a redirect, paths under `/api/` get 401/403 because a `fetch` caller follows a 302 and reads the resulting HTML as success. When adding a gated path, add its `/api` twin too — prefix matching does not relate `/admin` to `/api/admin`.
- **Two invariants the route gate depends on, neither visible from `src/middleware.ts`.** (1) Astro normalizes `context.url.pathname` — percent-decoding, duplicate-slash collapsing, dot-segment resolution — _before_ middleware runs, which is why `/admin%2Fusers` and `/admin../dashboard` are gated; re-check after an Astro upgrade. (2) `wrangler.jsonc` serves `./dist` as static assets with no `run_worker_first`, so a matching asset is served **before** the Worker runs: a single `export const prerender = true` on a page under a gated prefix, or one file in `public/<gated-prefix>/`, silently removes the gate from that path with no error anywhere.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`; `src/pages/api/admin/{assign-company,resolve-ticket,backfill-embeddings}.ts` (staff-only); `src/pages/api/escalate-error.ts` (`POST`, see _Suggestion escalation (S-03)_); `src/pages/api/tickets.ts` (`GET`, returns 401 itself for anonymous callers — it is not in `PROTECTED_ROUTES`; the select has no company filter, so it returns exactly what RLS permits)
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/my-tickets.astro`
- `SUPABASE_URL`/`SUPABASE_KEY` are declared `optional: true` in the `astro:env` schema. `createClient()` (`src/lib/supabase.ts`) returns `null` when either is missing, and the middleware treats that as a logged-out user rather than throwing — the app boots and renders without Supabase configured. `src/lib/config-status.ts` drives the "Supabase not configured" banner shown in that state.

### Error resolution (S-01)

- `src/pages/api/resolve-error.ts` — `POST`, FormData field `errorText`. Client users of a client company only: anonymous → 401, profile lookup failure → 500, anyone else (staff, unassigned) → 403 `not-a-client` before any OpenAI call. Not in `PROTECTED_ROUTES` — like `/api/tickets`, it answers 401 itself. Returns the `ErrorResolutionResponse` union from `src/types.ts`.
- `src/lib/services/error-resolution.ts` — `resolveError()` never throws to the route: trims and validates (limit `ERROR_TEXT_MAX_LENGTH` in the dependency-free `src/lib/error-text.ts`, which the island may import — never import `src/lib/openai.ts` or the service from client code, they read `astro:env/server`), embeds the text, calls `match_knowledge_base` (migration `20260925120000`, `SECURITY DEFINER`, same gate as `knowledge_base_public`) with the vector as `JSON.stringify(vector)`, and filters by `MATCH_THRESHOLD` in TypeScript — the single calibration knob, applied outside SQL so the best similarity of every search is logged and changing it needs no migration.
- **Fallback-to-ticket rule**: a match returns the entries and files **no** ticket. No match, or search unavailable (no key, OpenAI error/timeout, RPC error), returns the caller's own open (`todo`) ticket with the same trimmed text (`already-reported`) or files a new one (`ticket-created`); `searchUnavailable` flags the second case. A failed duplicate lookup files anyway — a duplicate beats a lost report.
- `src/lib/openai.ts` — plain-`fetch` embeddings client, keyed by `OPENAI_API_KEY`; `embedText()` returns `null` without a key, no retries, 8 s timeout. **`EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` must equal `scripts/ingest/embeddings.mjs`** (`text-embedding-3-small`, 1536) — change both or neither, see _ERP documentation ingestion_.
- `GET /api/tickets?mine=1` narrows the list to `created_by = caller`. It is a view filter inside what RLS returns, not a security boundary (no page uses it; the smoke test does); the default listing stays unfiltered because it is the smoke test's RLS probe.
- `src/pages/report-error.astro` shows the paste form and the immediate outcome only (`ErrorResolutionPanel.tsx`), plus a "Zobacz w moich zgłoszeniach" link to `/my-tickets`.
- `src/pages/my-tickets.astro` (in `PROTECTED_ROUTES`) is the client's own ticket list, server-rendered with no hydration: `listVisibleTickets()` from `src/lib/services/tickets.ts` with `createdBy = caller` under the caller's session (RLS bounds it), `?offset=` page links, `MyTicketsList.tsx` with `heading={null}`. Both pages share `src/layouts/ClientPageLayout.astro` (Topbar with the XEMI logo, `Card`, and the profile-error / staff / waiting branches; the default slot renders only for a client user of a client company).

### Ticket resolution (S-02)

- UI: `src/pages/admin/tickets.astro` (staff-only via `STAFF_ROUTES`, server-rendered, Polish) lists every client company's `todo` tickets oldest first; each form posts to `src/pages/api/admin/resolve-ticket.ts`, which redirects back with a `status`/`error` code the page maps to fixed messages. Logic lives in `src/lib/services/ticket-resolution.ts`. The filing client sees the cause and steps on `/my-tickets` (`MyTicketsList.tsx`).
- **`resolve_ticket()` (migration `20261014120000`, `SECURITY DEFINER`, 42501 unless `is_service_staff()`) is the only path that resolves a ticket and the only path that creates a `source = 'ticket'` knowledge base entry**, in one transaction, with `resolved_by = auth.uid()`. Direct `tickets` UPDATE and `knowledge_base_entries` INSERT are revoked from `authenticated` — do not re-grant them. KB UPDATE is granted on `embedding` only (migration `20261019120000`, for the backfill) and its policy is limited to staff and `source = 'ticket'`, so no direct write can change an entry's sanitized text or provenance, and `erp_doc` entries stay writable only through the F-02 functions.
- **KB text is sanitized server-side** by `src/lib/sanitize-error-text.ts` (a ticket entry is shown to other companies' users on a match): the error text from the ticket row as stored, never from form input, with the embedding computed from it (`sanitizeErrorText`); the staff-written cause and steps as separate `p_kb_cause`/`p_kb_steps` copies (`sanitizeResolutionText`, keeps line breaks), while the ticket keeps them as written for its own company. The module is dependency-free, so the staff page imports it for both previews (the cause/steps one in a page `<script>`). It is a deterministic, incomplete filter by design.
- **A missing embedding** (no `OPENAI_API_KEY`, or OpenAI failed) does not block the resolution: it is saved as `resolved-no-embedding` and matches nothing until staff click "Przelicz" on `/admin/tickets` (`src/pages/api/admin/backfill-embeddings.ts`, up to `BACKFILL_BATCH` entries per click).

### Suggestion escalation (S-03)

- `src/pages/api/escalate-error.ts` — `POST`, FormData fields `errorText` and optional `comment`, for a client who found the matched suggestions unhelpful. Gated exactly like `/api/resolve-error` (401/500/403 `not-a-client`/503) and, like it, not in `PROTECTED_ROUTES`. Returns the `EscalationResponse` union from `src/types.ts`; `comment-too-long` → 400 (`COMMENT_MAX_LENGTH` in `src/lib/error-text.ts`, counted on the trimmed comment).
- `escalateUnhelpful()` in `src/lib/services/error-resolution.ts` runs no search: it shares the S-01 duplicate rule through the private `fileTicket()` helper (the caller's open ticket with the same trimmed text is returned, the comment ignored; otherwise a new ticket is filed with `user_comment`).
- It writes through the existing column-scoped `tickets` INSERT grant only. There is no UPDATE path for `user_comment` — a comment is set at insert time and never edited; `rls.sql` pins the denied update.

### ERP documentation ingestion

- `scripts/ingest-erp-docs.mjs` + `scripts/ingest/*.mjs` — plain Node script that loads ERP PDFs into `knowledge_base_entries` (`source = 'erp_doc'`). **Offline only**: nothing in `src/` imports it and there is no Worker route or in-app upload. Run by a non-developer: every user-facing string is Polish and lives in `scripts/ingest/messages.mjs`; the staff runbook is `docs/wgrywanie-dokumentacji-erp.md` — update it when flags or messages change.
- Signs in as the staff member (`signInWithPassword`, password always prompted, never in env) with the **publishable/anon key only**; `loadConfig()` in `scripts/ingest/upload.mjs` rejects a `service_role`/`sb_secret_` key. Config comes from `.env.ingest` (template `.env.ingest.example`), read by the script's own loader resolved against the repo root rather than `node --env-file` (which prints an English notice when the file is absent): UTF-8 BOM stripped, UTF-16 (PowerShell 5.1 `>`) rejected with a Polish message, variables already in the environment win. `OPENAI_API_KEY` is required only for loading, not `--lista`/`--usun`; `SUPABASE_URL` must be `https:` except for localhost.
- **Writes go solely through the three `SECURITY DEFINER` functions** of `supabase/migrations/20260924120000_erp_document_ingestion.sql`: `stage_erp_document_chunks` (batches into a staging table with RLS on and no policies), `publish_erp_document` (one transaction: replace the document, clear staging), `remove_erp_document`. Each raises 42501 unless `is_service_staff()`. `authenticated` has only staff-filtered SELECT on `erp_documents` — do not add direct write grants or policies. The script's Polish mapping keys on these errors (`databaseError()` in `messages.mjs`, incl. `UPLOAD_INTERRUPTED_MESSAGES` matched against the functions' `raise` texts), so changing a function's error text means updating that list.
- **`knowledge_base_entries` INSERT/UPDATE for `authenticated` are column-scoped** (migration `20260924120000`, §7): both omit `erp_document_id`, UPDATE also omits `source`, so no direct write can attach an entry to a document (whose next publish/remove would cascade-delete it). A new column on that table means adding it to both column lists in a new migration — never a table-level `grant insert/update`. `rls.sql` pins the column inventory.
- **Every `erp_doc` entry must have a document**: check `knowledge_base_entries_erp_doc_has_document` ties `source = 'erp_doc'` to a non-null `erp_document_id` (FK `on delete cascade` — the entries _are_ the document). Any other writer (seed, tests) creates the `erp_documents` row first. Document identity is the base file name in NFC, case-insensitive (unique index on `lower(file_name)`).
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
- **shadcn/ui component set**: `Button`, `Textarea`, `Alert`, `Card`, `Badge` (`src/components/ui/`). The current new-york-v4 registry emits `import { cn } from "cn"` and `import { Slot } from "radix-ui"`: after `npx shadcn@latest add`, rewrite those imports to `@/lib/utils` and `@radix-ui/react-slot` and drop the `cn`/`radix-ui` dependencies it adds (`git checkout -- package.json package-lock.json && npm ci`). `LibBadge.astro` is a project-specific badge, not a shadcn component.

### UI contract

Applies to views already on the contract: `src/pages/index.astro`, `src/components/start/`, `src/components/AccountStatusNotice.astro`, `src/pages/report-error.astro`, `src/pages/my-tickets.astro`, `src/layouts/ClientPageLayout.astro`, `src/components/error-resolution/`, `src/components/Topbar.astro`, `src/components/UserBar.astro`. Other views still use literals on `bg-cosmic` until their own change moves them.

- **Tokens** live in `src/styles/global.css`; values, xemi.pl sources and contrast in `context/foundation/design-tokens.md`. The light XEMI `:root` theme is active (`<html>` has no theme class). `.dark` is the cosmic dark variant, applied by a `class="dark"` wrapper (`admin/tickets.astro`). `bg-cosmic` is theme-independent (`--cosmic-*`) and used only by views not yet migrated. A new role goes in `:root`, `.dark` and `@theme inline` (`--color-<role>`) — never a raw colour in `@theme inline`.
- **Components**: check `src/components/ui` before building a control; add a missing one with `npx shadcn@latest add <name>` (see the component-set line above), not by hand.
- **No palette classes (`text-blue-200`, `bg-white/10`), arbitrary values (`-[12px]`) or colour functions/hex (`oklch(`, `#fff`) in views** — use roles (`bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `text-success`, `text-warning`, `border-border`). `--brand` is for the logo and large accents only (≈3:1 on white). Use full `ring-ring` on focus, not `ring-ring/50` (below 3:1 on white).
- **Kitchen sink** `/dev/ui-kitchen-sink` (dev only: `src/dev/ui-kitchen-sink.astro`, routed by the `devOnlyRoutes` integration in `astro.config.mjs` under `astro dev`, absent from production builds) renders every state of the view's components with static props via `src/components/error-resolution/KitchenSink.tsx`; add a cell when adding a state or component, and use it as the screenshot gate.
- **ESLint enforces it**: `uiContractConfig` in `eslint.config.js` (`no-restricted-syntax` on `class`/`className`/`class:list`, `cn()` arguments and string constants) fails lint and lint-staged in the files above. Moving a view onto the contract means adding its files to that block's `files`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY` (all optional; without `OPENAI_API_KEY` every pasted error falls back to a ticket) (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Ingestion script env vars (`.env.ingest`, template `.env.ingest.example`, gitignored): `SUPABASE_URL`, `SUPABASE_KEY` (same publishable/anon key as the app), `OPENAI_API_KEY`, optional `HELPDESK_EMAIL`. `DEBUG=1` adds stack traces to its output.
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth). Production secrets are set once per key with `npx wrangler secret put <NAME>` — including `OPENAI_API_KEY`.

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
- **deploy** — after both pass: `npm run build` and `npx wrangler deploy`. It never touches the database; see _Database migrations_.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — Moduł 2, Lekcja 5 (interfejs 10xDevs 4.0)

**W przypadku pracy nad interfejsem widoku, który już się renderuje, zacznij od `/10x-ui <view>`.** To
punkt wejścia: krótki audyt wstępny, sugerowany identyfikator zmiany oraz polecenie `/10x-new` do
uruchomienia, a następnie opis audytu dla `/10x-research`. Zmiana wizualna przechodzi przez ten sam łańcuch
co każda inna zmiana (`/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement` →
`/10x-impl-review`); `/10x-ui <change-id>` wznawia pracę od pierwszego kroku, który nie został jeszcze wykonany. Przenosi
zasady:
kiedy rozpocząć i który widok wybrać, audyt do opłat, kontrakt systemu projektowego w formie,
w jakiej realizuje go to repozytorium, stany komponentów, bramkę zrzutu ekranu oraz zasadę, która
utrzymuje następnego agenta przy kontrakcie. Jego `references/` zawiera listę kontrolną jakości.

Tworzenie widoku po raz pierwszy nie jest zadaniem dla `/10x-ui` — utwórz go za pomocą
zwykłego łańcucha, a następnie wróć do niego z `/10x-ui`.

<!-- END @przeprogramowani/10x-cli -->
