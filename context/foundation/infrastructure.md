---
project: HelpDesk XEMI
researched_at: 2026-09-21
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript / JavaScript
  framework: Astro 7 (SSR) + React 19 islands
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare is the only researched platform passing all five agent-friendly criteria (CLI-first ops via Wrangler, fully managed workerd runtime, agent-readable docs via `llms.txt`/`llms-full.txt`, a deterministic scriptable deploy/rollback API, and a GA MCP server), and it requires zero migration: the project already uses the `@astrojs/cloudflare` adapter and a Workers-shaped `wrangler.jsonc` (assets binding + `main` entrypoint — not a legacy Pages project). At the project's expected scale (100-500 users, well under 10k-100k requests/month) it costs **$0/month** on the free tier. The interview confirmed cost-minimization as the top priority and existing team familiarity with Cloudflare Workers/Pages, both of which reinforce this pick; single-region traffic and no persistent-connection requirement mean none of Cloudflare's edge/WebSocket-specific advantages were needed to win the comparison — it won on the baseline criteria alone.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Result |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | 5/5 Pass |
| Vercel | Pass | Pass | Partial | Pass | Pass | 4 Pass / 1 Partial |
| Netlify | Partial | Pass | Pass | Partial | Pass | 3 Pass / 2 Partial |
| Railway | Partial | Pass | Pass | Partial | Pass | 3 Pass / 2 Partial |
| Render | Partial | Pass | Partial | Pass | Pass | 3 Pass / 2 Partial |
| Fly.io | Pass | Partial | Pass | Pass | Partial | 3 Pass / 2 Partial |

- **Cloudflare Workers**: `wrangler deploy`/`rollback`/`tail`/`versions` are all GA and fully scriptable. Workers are fully managed (workerd), with the free tier covering ~3M requests/month — an order of magnitude above this project's expected load. Docs are published as markdown and `llms.txt`/`llms-full.txt`, and pages are servable as raw markdown via an `Accept: text/markdown` header. Official Cloudflare MCP servers are GA. Only caveat: the adapter dropped Cloudflare **Pages** support (see Risk Register) — this project already targets Workers correctly, so no action is needed beyond correcting the stale `deployment_target: cloudflare-pages` label in `tech-stack.md`.
- **Vercel**: Technically the strongest alternative — GA CLI, GA MCP (`mcp.vercel.com`, explicitly supports Claude Code), deterministic deploy/rollback. Loses on cost: the Hobby free tier's terms restrict it to **non-commercial use**, and this is a paid ERP support product, so realistic cost is Pro at $20/month — the most expensive option evaluated. Docs are MDX-based but no public open-source docs repo was confirmed, scoring Partial on agent-readability.
- **Netlify**: Mature, GA tooling across the board with a genuine official MCP server and full `llms.txt` docs. Requires swapping `@astrojs/cloudflare` → `@astrojs/netlify` and — critically — reconfiguring the `SUPABASE_URL`/`SUPABASE_KEY` runtime secrets, since Netlify scopes build-time and function-runtime env vars separately (a real gotcha coming from Cloudflare's `.dev.vars`/`wrangler secret` model). Rollback is dashboard-driven, not CLI-scriptable.
- **Railway**: Zero-config Node builds (Railpack, no Dockerfile), a genuine hosted MCP server, and no execution-time ceiling on requests. No CLI rollback to an arbitrary deployment (dashboard-only). No meaningful free tier for an always-on service — Hobby ($5/mo base) is the realistic floor, landing around $5-10/month.
- **Render**: Native Node runtime with no Dockerfile required and a GA MCP server with decent (if intentionally limited) scope. Weakest on agent-readable docs — no public markdown/GitHub docs repo was found. The free tier spins down after 15 minutes of inactivity, which would visibly hurt the auth flow's UX, pushing this toward the $7/month Starter instance.
- **Fly.io**: Best persistent-process/WebSocket support of the group (not needed for this MVP) and cheapest paid option (~$2-6/month, or near-zero with scale-to-zero at the cost of cold starts). Requires the largest one-time migration: authoring a Dockerfile from scratch (none exists in this repo today) plus swapping to `@astrojs/node`. MCP support exists but is flagged as early-stage/experimental.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Already the configured adapter and wrangler setup — zero migration cost. Passes all five criteria, costs $0/month at this project's scale, and matches the team's existing hands-on familiarity (confirmed in the interview). No competing platform came close once the free-tier commercial restriction disqualified Vercel from being a genuine $0 option.

#### 2. Netlify

Strong runner-up on tooling maturity and MCP support. The gap versus Cloudflare is migration cost (adapter swap + env var re-scoping) for no clear functional gain, since none of Netlify's differentiators (Netlify DB/Blobs, edge functions) are needed — Supabase already covers the data layer.

#### 3. Railway

Third by virtue of the lowest-friction migration among the remaining options (no Dockerfile, Railpack auto-detection) and a real MCP server, but it has no CLI rollback and no meaningful free tier, making it strictly more expensive and less agent-scriptable than Cloudflare for this project's needs.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`nodejs_compat` is a compatibility layer, not full Node parity.** Any current or future npm dependency used for the PRD's AI-driven knowledge-base matching feature that relies on an unsupported Node API can fail silently at runtime rather than at build time — this is a real risk given FR-002/FR-006 depend on an AI matching step whose dependency tree hasn't been chosen yet.
2. **The free tier's CPU-time ceiling (10ms per invocation) is a hard, easy-to-hit limit** for synchronous work — Supabase JWT verification on every authenticated request plus any inline AI-matching logic could push individual requests over the limit, causing either forced upgrade to the $5/month paid plan or silent 5xx errors under load.
3. **Version rollback via `wrangler rollback` does not roll back bound-resource state.** If a deploy introduces a Supabase schema migration alongside a code change, rolling back the Worker code leaves the database migration applied — a code/schema mismatch that the rollback command gives no warning about.
4. **The Astro Cloudflare adapter (v13+) auto-provisions a Cloudflare Images binding by default** unless explicitly overridden to `passthrough` or `compile` — an easy way to end up with an unplanned binding (and potential cost) that nobody consciously opted into.
5. **Cloudflare's own platform is changing quickly** (Pages deprecation in April 2025, adapter v13→v14 changes, Astro 6 moving `dev`/`preview` onto real workerd) — tutorials, Stack Overflow answers, and even Cloudflare's own Pages-specific Astro deploy guide are now stale, so the team must re-verify against current official docs rather than cached knowledge each time deploy config changes.

### Pre-Mortem — How This Could Fail

The team deployed HelpDesk XEMI's Astro SSR app on Cloudflare Workers, trusting an older "Workers + Pages" tutorial, only to discover mid-sprint that the adapter had dropped Pages support entirely — losing a day reconfiguring `wrangler.jsonc` under deadline pressure right before the MVP deadline. Once live, the AI-powered error-matching flow — calling an external LLM/embedding API synchronously per request — began intermittently exceeding the Workers CPU-time ceiling under real client load, causing silent 500s the team didn't notice for days because they hadn't wired `wrangler tail` or alerting into their on-call routine. Meanwhile, a request for a live ticket-status view for service staff turned into a multi-week detour once the team discovered Durable Objects can't hibernate Worker-initiated outgoing WebSocket connections, forcing a rearchitecture. Underestimated throughout: how much `nodejs_compat` actually left unfinished for a couple of their npm dependencies, which only broke in production — not in local `wrangler dev` — because the compatibility flag masked the gap until real traffic hit an edge case none of their tests covered.

### Unknown Unknowns

- `compatibility_date` pinning means upgrading Wrangler or the Astro adapter later can silently change runtime behavior if the date isn't bumped deliberately — an easy-to-miss versioning trap that doesn't show up in local testing.
- The 10ms CPU-time-per-invocation free-tier limit is easy to exceed with ordinary synchronous work (JWT verification, JSON-heavy responses) — not just AI calls — and teams typically only discover this after seeing unexplained 5xxs under mild production load.
- Workers has no traditional persistent filesystem or long-lived build cache; auto-provisioned bindings (like the Images binding above) can add cost or behavior nobody explicitly opted into until someone checks the dashboard.
- A Worker version rollback is instant for code, but never touches state in bound resources (KV, D1) or in external services like Supabase — assuming a rollback undoes "the deploy" as a whole is a dangerous mental model.
- Given how fast Cloudflare's Workers/Pages/Astro-adapter surface has moved in the last 12-18 months, the team should expect to re-verify official docs each time they touch deploy config rather than trust cached knowledge, including from this very document a year from now.

## Operational Story

- **Preview deploys**: Wrangler supports version-based gradual deploys (`wrangler versions deploy`, ≥3.40.0) with percentage-based traffic splits; for PR previews, wire GitHub Actions to run `wrangler versions upload` per branch/PR and post the preview URL as a PR comment — no built-in fork-PR restriction was found, but secrets should still be scoped to trusted branches only.
- **Secrets**: Non-secret vars live in `wrangler.jsonc` under `vars`; real secrets (`SUPABASE_URL`, `SUPABASE_KEY`) are set via `wrangler secret put <NAME>` and never committed. Local dev uses `.dev.vars` (already gitignored per this repo's CLAUDE.md). Only whoever has Cloudflare account/API-token access can read or rotate secrets — API tokens should be scoped to the specific Worker, not account-wide.
- **Rollback**: `wrangler rollback [<VERSION_ID>]` instantly repoints all routes to a prior version — seconds, not minutes. Caveat: it does not revert Supabase schema migrations or any bound-resource state, so a rollback that follows a migration-bearing deploy needs a manual check that the prior code version is still compatible with the current database schema.
- **Approval**: Production deploys (`wrangler deploy` to the live Worker) and any `wrangler secret put` should require a human trigger (e.g., merge-to-main via GitHub Actions with a human-reviewed PR) — an agent may run `wrangler deploy --dry-run`, `wrangler tail`, and `wrangler versions list` unattended, but should not run an unreviewed production deploy or secret rotation.
- **Logs**: `wrangler tail [WORKER] --status=error --format=pretty` streams live logs; `wrangler tail --search <term>` filters by content. Cloudflare's `observability.enabled: true` (already set in this repo's `wrangler.jsonc`) enables the dashboard-side Logs/Analytics views for read-only historical inspection.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `nodejs_compat` gap silently breaks an AI-matching dependency in production, not at build time | Devil's advocate | M | H | Smoke-test the AI-matching dependency chain against real `wrangler dev` (workerd) before relying on it; pin `compatibility_date` deliberately and re-test on every bump |
| Free-tier 10ms CPU-time ceiling causes silent 5xx errors under real load (JWT verification + AI calls) | Devil's advocate / Unknown unknowns | M | H | Wire `wrangler tail --status=error` into an alert (even a simple scheduled check) before go-live; budget for the $5/month paid plan if CPU-time becomes tight |
| Worker version rollback leaves Supabase schema/migrations out of sync with rolled-back code | Devil's advocate / Unknown unknowns | L | H | Document a manual pre-rollback check: confirm the target code version is compatible with the current Supabase schema before rolling back |
| Adapter auto-provisions an unwanted Cloudflare Images binding on deploy | Devil's advocate | M | L | Explicitly set the adapter's image service to `passthrough` (or the desired option) in `astro.config.mjs` at bootstrap time rather than relying on the default |
| Stale "Workers + Pages" tutorials/docs lead to wasted migration effort or wrong config | Devil's advocate / Pre-mortem | M | M | Confirmed already avoided in this repo (`wrangler.jsonc` already targets Workers correctly) — still, correct the stale `deployment_target: cloudflare-pages` hint in `tech-stack.md` so future readers aren't misled |
| Durable Objects can't hibernate Worker-initiated outgoing WebSocket connections | Research finding | L | M | Not needed for MVP (no realtime requirement per PRD); revisit only if a future feature needs the Worker to hold an outgoing persistent connection |
| Compatibility-date pinning causes a silent behavior change on a future Wrangler/adapter upgrade | Unknown unknowns | L | M | Treat `compatibility_date` bumps as a deliberate, tested change — never bump it opportunistically alongside an unrelated dependency update |

## Getting Started

1. Confirm the current setup already matches Workers (not Pages): `wrangler.jsonc` in this repo already has a `main` entrypoint and `assets` binding — no adapter or config change needed.
2. Explicitly set the Astro Cloudflare adapter's image service to avoid the default auto-provisioned Images binding, e.g. in `astro.config.mjs`: `adapter: cloudflare({ imageService: "passthrough" })` (confirm the exact option name against the installed `@astrojs/cloudflare` version before applying).
3. Set production secrets before first deploy: `wrangler secret put SUPABASE_URL` and `wrangler secret put SUPABASE_KEY`.
4. Deploy: `npm run build && wrangler deploy` (or wire this into the existing GitHub Actions CI as the auto-deploy-on-merge step already noted in `tech-stack.md`).
5. Verify logs and rollback readiness before go-live: `wrangler tail --status=error` in one terminal while smoke-testing, and confirm `wrangler versions list` shows a rollback target once the first production version is live.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
