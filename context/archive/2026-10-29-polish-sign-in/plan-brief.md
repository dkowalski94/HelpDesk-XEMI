# Polish sign-in pages, 404 and return to the requested page — Plan Brief

> Full plan: `context/changes/polish-sign-in/plan.md`

## What & Why

Roadmap S-04 (MS-04, MS-07). The sign-in, sign-up and confirm-email pages are still the starter's dark English screens that show raw Supabase error text, unknown URLs get Astro's default 404, and after signing in everyone lands on `/` instead of the page they wanted. This change makes the way in Polish, XEMI-styled and able to return the user to where they were going, without opening a redirect hole.

## Starting Point

`src/pages/auth/*` and `src/components/auth/*` use `bg-cosmic` and palette classes with English strings; `/api/auth/signin` and `/signup` put `error.message` into `?error=`; the middleware redirects anonymous visitors to bare `/auth/signin`; `Layout.astro` is `lang="en"` titled "10x Astro Starter". The smoke test pins those exact redirects.

## Desired End State

All auth pages and a new 404 page render on the light XEMI contract with the user bar, in Polish, and are guarded by the ESLint contract block. Errors appear as fixed Polish messages chosen by a short code in the URL. A guest sent to sign in from `/my-tickets?offset=20` comes back there after signing in, even after a wrong-password retry; an unsafe `next` falls back to `/`. A signed-in user never sees the sign-in form.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Supabase error messages | Map `AuthError.code` → URL code → fixed Polish text; unknown → generic message | Same pattern as the staff pages; the URL never carries text that gets rendered |
| Return-to transport | `?next=` query param, hidden field, validated by one `safeNextPath()` | Stateless and testable in smoke; no stale cookie redirecting a later sign-in |
| `next` rules | Same-origin path only: single leading `/`, no `//` or `/\`, no control chars, not `/api/` or `/auth/`; else `/` | Closes open redirect and loops back to the form |
| Signed-in user on `/auth/*` | Redirect to validated `next` or `/` | Avoids "Zaloguj się" form next to "Zalogowany jako" |
| Field controls | Add shadcn `Input` + `Label` (`@radix-ui/react-label`) | UI contract says use shared components, not hand-built controls |
| `<html lang>` | `pl` in `Layout.astro`, per-element `lang="pl"` removed | Every page is Polish now |

## Scope

**In scope:**
- `Layout.astro` lang/title, new `src/pages/404.astro`
- `src/lib/auth-redirect.ts`, `src/lib/auth-messages.ts`; signin/signup endpoints; middleware `next`
- Auth pages + components on the contract; shadcn `Input`/`Label`; kitchen-sink cells; ESLint contract list
- Smoke test updates and new steps; CLAUDE.md notes

**Out of scope:**
- `next` through sign-up/confirm-email; password reset; OAuth
- `/admin/users` (S-06); cross-page pass and cosmic-theme removal (S-07)
- Sign-out target, API 401/403 behaviour, zod

## Architecture / Approach

Two dependency-free modules hold the rules: `auth-redirect.ts` (`safeNextPath`, `signinHref` — `error` first, then `next`) used by middleware, endpoint and pages; `auth-messages.ts` (Supabase code → URL code → Polish message) used by endpoints and pages. Pages resolve the message on the server and pass a plain string to the React island.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Polish shell and 404 | `lang="pl"`, default title, Polish 404 with user bar | Missing a `lang` wrapper / 404 status lost |
| 2. Error codes and return-to | Codes in `?error=`, validated `?next=`, signed-in redirect, smoke steps | Open redirect via `//` or `/\`; smoke prefix match broken by param order |
| 3. Auth pages on the contract | Restyled Polish forms, `Input`/`Label`, kitchen sink, lint guard | shadcn CLI import rewrites; focus ring at `/50` from the registry |

**Prerequisites:** S-03 done (it is); local Supabase with seed for smoke.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Supabase returns `code` on the errors we map (true for supabase-js ^2.99); unmapped ones show the generic message and are logged.
- Smoke expectations change in the same commit as the redirect change, so CI stays green per commit.

## Success Criteria (Summary)

- A client opening a protected page signs in in Polish and lands on that page.
- No auth page, form or 404 shows English text or the starter's dark look; lint guards it.
- `npm run smoke` passes with the open-redirect and return-to steps.
