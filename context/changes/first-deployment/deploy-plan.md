---
change: first-deployment
status: done
completed_at: 2026-09-21
platform: Cloudflare Workers
based_on: context/foundation/infrastructure.md
---

# First Deployment — HelpDesk XEMI on Cloudflare Workers

Runbook for the first production deployment, executed against the recommendation in
[`infrastructure.md`](../../foundation/infrastructure.md). This is a record of what was
actually done, not a forward-looking plan — see that file for the platform research and
rationale (why Cloudflare Workers over Netlify/Vercel/Railway/Render/Fly.io).

## What changed in the repo

1. **`astro.config.mjs`** — set `adapter: cloudflare({ imageService: "passthrough" })`.
   The `@astrojs/cloudflare` adapter defaults to `cloudflare-binding`, which
   auto-provisions a Cloudflare Images binding on deploy — an unplanned resource/cost
   the infrastructure research flagged as a risk. Confirmed via the adapter's source
   (`utils/image-config.js`) and verified the build still succeeds.
2. **`context/foundation/tech-stack.md`** — corrected the stale
   `deployment_target: cloudflare-pages` hint (left over from bootstrapping) to
   `cloudflare-workers`. The repo's `wrangler.jsonc` already targeted Workers
   correctly (`main` entrypoint + `assets` binding, not a Pages project); only the
   label was wrong.
3. **`.github/workflows/ci.yml`** — added a `deploy` job that runs after `ci` and
   `smoke` pass, gated to `push` on `master` only:
   ```yaml
   deploy:
     needs: [ci, smoke]
     if: github.event_name == 'push' && github.ref == 'refs/heads/master'
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-node@v4
         with: { node-version: 22, cache: npm }
       - run: npm ci
       - run: npm run build
         env:
           SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
           SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
       - run: npx wrangler deploy
         env:
           CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
           CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
   ```
   This is the "human trigger" `infrastructure.md`'s Approval section calls for —
   `wrangler deploy` only ever runs after a reviewed PR is merged to `master`, never
   ad hoc from an agent shell.

Commits: `fc932cb` (config + CI wiring), `f7d30ae` (10xDevs Lesson 5 skill/manifest sync).

## Manual steps (done outside the repo, by the project owner)

These were deliberately left to a human per `infrastructure.md`'s Approval guidance
(production deploys and secret rotation require a human trigger):

1. Created a Cloudflare API token scoped to the `10x-astro-starter` Worker.
2. Added GitHub repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (Settings → Secrets and variables → Actions).
3. Authenticated Wrangler locally (`wrangler login`) and set the Worker's production
   runtime secrets, reusing the values already in the local `.env`:
   ```
   wrangler secret put SUPABASE_URL
   wrangler secret put SUPABASE_KEY
   ```

## What went wrong once, and the fix

The first push (`f7d30ae`) triggered the new `deploy` job before the Cloudflare
secrets existed — it failed as expected at the `npx wrangler deploy` step (`ci` and
`smoke` both passed). No code fix was needed: once the manual steps above were done,
re-running the failed job from the Actions UI succeeded on attempt 2.

## Verification

- GitHub Actions run [`35605253107`](https://github.com/dkowalski94/HelpDesk-XEMI/actions/runs/35605253107):
  `ci`, `smoke`, and `deploy` all green on re-run.
- `wrangler deployments list` shows the CI-triggered deployment
  (version `149f97c2-3e03-474a-b962-19f4e7bdad5f`, 2026-09-21T13:43) as the most
  recent, confirming the pipeline (not a manual `wrangler deploy`) shipped it.
- Live URL: `https://10x-astro-starter.dkowalski.workers.dev` — `GET /` and
  `GET /auth/signin` both return 200.
- Confirmed the "Supabase not configured" banner (`src/lib/config-status.ts`, shown
  when `SUPABASE_URL`/`SUPABASE_KEY` are falsy at runtime) does **not** appear on the
  live homepage — the Worker secrets are correctly wired, not just present.

## Still open (from `infrastructure.md`'s Risk Register — not addressed by this change)

- No alerting wired to `wrangler tail --status=error` yet; the free tier's 10ms
  CPU-time ceiling and any `nodejs_compat` gaps in the future AI-matching dependency
  chain would currently surface only as silent 5xxs.
- No documented manual check that a `wrangler rollback` target is schema-compatible
  before rolling back, in case a future deploy pairs a Supabase migration with a code
  change.
