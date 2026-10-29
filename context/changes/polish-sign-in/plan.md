# Polish sign-in pages, 404 and return to the requested page — Implementation Plan

## Overview

Roadmap item **S-04** (`polish-sign-in`, PRD MS-04, MS-07). Move `/auth/signin`, `/auth/signup` and `/auth/confirm-email` onto the light XEMI UI contract in Polish with the user bar, add a Polish XEMI 404 page, make the shared `Layout.astro` Polish (`lang="pl"`, title "HelpDesk XEMI"), show Supabase auth errors as fixed Polish messages chosen by error code, and after signing in send the user back to the page they originally asked for — validated as a same-origin path.

## Current State Analysis

- **Auth pages are the starter's dark look in English.** `src/pages/auth/signin.astro`, `signup.astro`, `confirm-email.astro` use `bg-cosmic`, `bg-white/10`, `text-blue-100/60`, gradient headings; `src/components/auth/{FormField,PasswordToggle,ServerError,SubmitButton,SignInForm,SignUpForm}.tsx` use palette classes (`bg-purple-600`, `text-red-300`, `border-white/20`) and English strings (validation, "Show password", "Signing in...", "Create account").
- **No shared `Input`/`Label`.** `src/components/ui/` has `button`, `textarea`, `alert`, `card`, `badge`; `FormField.tsx` hand-styles a raw `<input>`.
- **Raw Supabase messages reach the page.** `src/pages/api/auth/signin.ts:15` and `signup.ts:15` redirect with `?error=${encodeURIComponent(error.message)}`; the page passes that string to the island, which renders it verbatim — arbitrary English text reflected from the URL. Both also redirect with the English "Supabase is not configured".
- **No return-to-page.** `src/middleware.ts:41` redirects anonymous page requests on `PROTECTED_ROUTES`/`STAFF_ROUTES` to bare `/auth/signin`; `signin.ts:18` always redirects to `/`. A signed-in user opening `/auth/signin` sees the form next to "Zalogowany jako" in the user bar.
- **Shell is English.** `src/layouts/Layout.astro:12,16` — default title "10x Astro Starter", `<html lang="en">`; contract views compensate with per-element `lang="pl"` (`UserBar.astro:45`, `StartPage.astro:51`, `ClientPageLayout.astro:41`, `admin/tickets.astro:78`, `ui-kitchen-sink.astro:107,158`).
- **No custom 404.** Unknown paths (e.g. the removed `/dashboard`) render Astro's default; smoke step "dashboard is gone" asserts only status 404.
- **Smoke test pins the current redirects** (`scripts/smoke.mjs`): `/admin/users`, `/report-error`, `/my-tickets` anonymous → exactly `/auth/signin` (lines 215, 222, 227); successful sign-in → exactly `/` (253, 264, 278, 284, 325); wrong password → prefix `/auth/signin?error=` (248). `locationMatches()` (712) is exact for a bare path, prefix when the expectation contains `?`.

## Desired End State

- `/auth/signin`, `/auth/signup`, `/auth/confirm-email` and the 404 page render on the light XEMI look — `Topbar` + `Card`, token classes only, Polish text — and their files are in the ESLint `uiContractConfig` block, so lint fails on a palette class there.
- Every page's `<html>` is `lang="pl"`; the default title is "HelpDesk XEMI"; the per-element `lang="pl"` attributes are gone.
- An unknown URL (`/dashboard`) returns 404 with a Polish page: user bar, a short explanation, a link to `/`.
- Sign-in/sign-up errors show a fixed Polish message per error code; the URL carries only a short code (`?error=invalid-credentials`), never Supabase's text; an unknown code shows a generic Polish message.
- An anonymous visit to `/my-tickets?offset=20` redirects to `/auth/signin?next=%2Fmy-tickets%3Foffset%3D20`; signing in lands on `/my-tickets?offset=20`; a wrong password keeps `next` through the error round-trip. A `next` that is not a same-origin path (`//evil.example`, `/\evil.example`, `https://…`, `/api/…`, `/auth/…`) is replaced by `/`.
- A signed-in user opening `/auth/signin` or `/auth/signup` is redirected to the validated `next` or `/`.
- The kitchen sink shows every auth form state; `npm run smoke` passes with the updated and new steps.

Verify: `npm run lint`, `npx astro check`, `npm run build`, `npm run smoke` against the preview, kitchen sink screenshot gate.

### Key Discoveries:

- `@supabase/supabase-js` ^2.99 exposes `AuthError.code` (`node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts`) incl. `invalid_credentials`, `email_not_confirmed`, `user_already_exists`, `email_exists`, `weak_password`, `email_address_invalid`, `signup_disabled`, `over_request_rate_limit`, `over_email_send_rate_limit` — map by code, not text.
- Code-in-URL → fixed message is the established pattern: `staffQueueHref()` in `src/lib/services/ticket-resolution.ts:28` and the message map in `src/pages/admin/tickets.astro`.
- `UserBar.astro` already renders the guest entries ("Zaloguj się", "Załóż konto"); `Topbar.astro` reads `Astro.locals`, which the middleware sets for the 404 page too (SSR).
- `KitchenSink.tsx` builds state cells with `Cell`/`Group` (`src/components/error-resolution/KitchenSink.tsx:93,103`) and forces a pending state via a prop (`FormCell pending`).
- `@radix-ui/react-slot` is the only Radix dependency (`package.json:23`); the shadcn `label` needs the label primitive.

## What We're NOT Doing

- Carrying `next` through sign-up / confirm-email (the e-mail confirmation link lands where Supabase's site URL says); the signin↔signup links carry no `next`.
- Password reset, magic links, OAuth, changing Supabase email templates.
- Translating `/admin/users` (S-06) or the final cross-page consistency pass and cosmic-theme removal (S-07).
- Changing the post-sign-out target (stays `/`) or the API 401/403 behaviour of the middleware.
- A server-side validation layer (zod); inputs stay read from `FormData` per CLAUDE.md.

## Implementation Approach

Shell first (smallest, unblocks a correct `lang` for every later page), then the server contract (error codes, `next`, middleware, smoke) so the pages in phase 3 consume finished helpers, then the visual move of the auth pages. Two new dependency-free modules in `src/lib/` hold the rules so pages, endpoints and middleware share one definition.

## Critical Implementation Details

**`next` validation is the security boundary.** Accept only a string that starts with exactly one `/` followed by a non-`/`, non-`\` character (or is `/` itself), contains no ASCII control characters, is at most 2048 characters, resolves via `new URL(next, "http://n")` to origin `http://n`, and does not start with `/auth/` or `/api/` (no loop back to the form, no landing on an endpoint). Anything else → `/`. Browsers treat `/\host` as `//host`, so the backslash check is load-bearing.

**Smoke error redirect stays a prefix match.** Build the error redirect with `error` as the first query parameter (`/auth/signin?error=<code>&next=<…>`) so step "signin rejects wrong password" still matches its `/auth/signin?error=` prefix.

## Phase 1: Polish shell and 404 page

### Overview

Make the shared shell Polish and add the 404 page on the contract.

### Changes Required:

#### 1. Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Declare the document Polish and use the product name as the default title.

**Contract**: `<html lang="pl">`; `title` prop default `"HelpDesk XEMI"`.

#### 2. Remove redundant `lang="pl"`

**Files**: `src/components/UserBar.astro`, `src/components/start/StartPage.astro`, `src/layouts/ClientPageLayout.astro`, `src/pages/admin/tickets.astro`, `src/dev/ui-kitchen-sink.astro`, `src/pages/my-tickets.astro` (comment at line 9)

**Intent**: The document is now Polish, so the per-element wrappers are noise; update comments that point to them.

**Contract**: No `lang=` attribute left in `src/` except `Layout.astro`.

#### 3. 404 page

**File**: `src/pages/404.astro` (new)

**Intent**: Polish, XEMI-styled "page not found" with the user bar and a way back, instead of Astro's default.

**Contract**: Same frame as `index.astro` (`Layout` title "Nie znaleziono strony", `bg-background`, `max-w-5xl`, `Topbar`, `Card`); `h1` "Nie znaleziono strony", one hint sentence, a link "Wróć na stronę startową" to `/` styled with `buttonVariants`; response status stays 404. Token classes only.

#### 4. Contract lint and kitchen sink

**Files**: `eslint.config.js`, `src/dev/ui-kitchen-sink.astro`

**Intent**: Put the 404 page under the UI contract guard and give it a screenshot cell.

**Contract**: `"src/pages/404.astro"` in `uiContractConfig.files`; a kitchen-sink section rendering the 404 card content (extract it into `src/components/NotFound.astro` if needed so both use the same markup).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- `grep -rn 'lang="' src` matches only `src/layouts/Layout.astro`
- `npm run smoke` passes (step "dashboard is gone" still 404)

#### Manual Verification:

- `/dashboard` shows the Polish 404 page with the user bar (as guest and as a signed-in client) and the link returns to `/`
- Page source of `/` shows `<html lang="pl">`; tab title of a page without its own title is "HelpDesk XEMI"

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Error codes and return to the requested page

### Overview

Replace raw Supabase messages with codes and Polish texts, and carry a validated `next` through sign-in.

### Changes Required:

#### 1. Return-to helpers

**File**: `src/lib/auth-redirect.ts` (new, dependency-free)

**Intent**: One definition of "safe return path" and of the sign-in URL, shared by middleware, endpoint and pages.

**Contract**: `safeNextPath(value: unknown): string` — returns the value when it passes the rules in _Critical Implementation Details_, else `"/"`. `signinHref({ next?: string; error?: string }): string` — `/auth/signin`, then `error` (first) and `next` as query params, `next` omitted when it is `"/"` or unsafe.

#### 2. Error codes and messages

**File**: `src/lib/auth-messages.ts` (new, dependency-free)

**Intent**: Map Supabase `AuthError.code` to a short URL code, and URL codes to fixed Polish messages.

**Contract**:
- `signinErrorCode(error)`: `invalid_credentials` → `invalid-credentials`; `email_not_confirmed` → `email-not-confirmed`; `over_request_rate_limit`/`over_email_send_rate_limit` → `rate-limited`; else `unknown`.
- `signupErrorCode(error)`: `user_already_exists`/`email_exists` → `already-registered`; `weak_password` → `weak-password`; `email_address_invalid`/`validation_failed` → `invalid-email`; `signup_disabled` → `signup-disabled`; rate limits → `rate-limited`; else `unknown`.
- Shared extra codes: `not-configured` (no Supabase client), `missing-fields` (empty email/password in the form).
- `authErrorMessage(code: string | null): string | null` — `null` for no code, a fixed Polish sentence per known code, a generic "Nie udało się. Spróbuj ponownie za chwilę." for any other value. The page never renders the raw parameter.
- Log the original Supabase `code`/`status` with `console.error` in the endpoint for `unknown`, so a missing mapping is visible.

#### 3. Endpoints

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Redirect with codes; sign-in honours `next`.

**Contract**: signin reads form fields `email`, `password`, `next`; empty fields → `missing-fields`; error → `signinHref({ error: code, next })`; success → `safeNextPath(next)` (so without `next` it is exactly `/`, as smoke expects). signup → `/auth/signup?error=<code>` on error, `/auth/confirm-email` on success (unchanged).

#### 4. Middleware

**File**: `src/middleware.ts`

**Intent**: Remember the requested page when sending an anonymous visitor to sign in.

**Contract**: the anonymous page redirect becomes `signinHref({ next: pathname + search })`; API paths keep 401; the staff-role redirect to `/` is unchanged.

#### 5. Signed-in visitors on auth pages

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: A signed-in user gets no sign-in form.

**Contract**: when `Astro.locals.user` is set, `return Astro.redirect(safeNextPath(searchParams.get("next")))`. The signin page passes `authErrorMessage(error)` (not the raw param) and the validated `next` to the island; `SignInForm` posts `next` in a hidden input when it is not `/`. (Visual work on these pages is phase 3.)

#### 6. Smoke test

**File**: `scripts/smoke.mjs`

**Intent**: Pin the new redirects and the open-redirect guard.

**Contract**:
- Update the three anonymous page steps to `/auth/signin?next=%2Fadmin%2Fusers`, `…%2Freport-error`, `…%2Fmy-tickets`.
- New steps: sign-in with `next=/my-tickets` → `302 /my-tickets`; wrong password with `next` → location starts with `/auth/signin?error=invalid-credentials&next=`; sign-in with `next=//evil.example` → `302 /`; a signed-in `GET /auth/signin` → `302 /`.
- Keep the existing sign-in steps expecting exactly `/`.

#### 7. Docs

**File**: `CLAUDE.md`

**Intent**: Record the auth contract next to the existing _Auth flow_ notes.

**Contract**: one bullet: `?next=` via `safeNextPath()`/`signinHref()` in `src/lib/auth-redirect.ts` (the only validation), `?error=` carries codes from `src/lib/auth-messages.ts`, `error` first for the smoke prefix match.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- `npm run smoke` passes, including the updated anonymous-redirect steps and the four new steps

#### Manual Verification:

- As a guest open `/my-tickets?offset=20`, sign in as Klient Alfa, land on `/my-tickets?offset=20`
- Wrong password shows a Polish message and a second, correct attempt still lands on the requested page
- `/auth/signin?error=<script>` shows the generic Polish message, not the parameter text
- `/auth/signin?next=//example.com` followed by a successful sign-in lands on `/`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Auth pages on the XEMI contract

### Overview

Restyle and translate the three auth pages and their components using shared `Input`/`Label`.

### Changes Required:

#### 1. shadcn `Input` and `Label`

**Files**: `src/components/ui/input.tsx`, `src/components/ui/label.tsx` (new, via `npx shadcn@latest add input label`), `package.json`

**Intent**: Shared field controls per the UI contract instead of a hand-styled input.

**Contract**: follow the CLAUDE.md post-install fix: imports rewritten to `@/lib/utils` and, for the label, `@radix-ui/react-label` (add it as a dependency); drop `cn`/`radix-ui` the CLI adds. Focus ring at full `ring-ring` (not `/50`) on the contract pages — adjust in the component if the registry emits `ring-ring/50`. Add both to the component-set line in CLAUDE.md.

#### 2. Auth components

**Files**: `src/components/auth/{FormField,PasswordToggle,ServerError,SubmitButton,SignInForm,SignUpForm}.tsx`

**Intent**: Token classes and Polish text; accessible error wiring.

**Contract**:
- `FormField` composes `Label` + `Input` with the leading icon and optional end content; on error sets `aria-invalid` and `aria-describedby` pointing at the error text (`text-destructive`).
- `PasswordToggle` aria-labels "Pokaż hasło" / "Ukryj hasło", `text-muted-foreground`, visible focus ring.
- `ServerError` uses the shared `Alert` (destructive variant) the way `error-resolution/ErrorAlert.tsx` does.
- `SubmitButton` uses `Button` default variant without palette overrides; optional `pending?: boolean` prop overrides `useFormStatus` (kitchen sink).
- Polish strings: "E-mail", "Hasło", "Powtórz hasło", "Zaloguj się" / "Logowanie…", "Załóż konto" / "Zakładanie konta…", "Podaj adres e-mail", "Podaj poprawny adres e-mail", "Podaj hasło", "Hasło musi mieć co najmniej 6 znaków", "Powtórz hasło", "Hasła się różnią", password-length hint with correct Polish plural ("Jeszcze 1 znak" / "2 znaki" / "5 znaków").

#### 3. Auth pages

**Files**: `src/pages/auth/signin.astro`, `signup.astro`, `confirm-email.astro`

**Intent**: Light XEMI frame with the user bar and Polish copy.

**Contract**: `Layout` (titles "Logowanie", "Załóż konto", and the confirm heading), `bg-background`, `Topbar`, a narrow centred `Card` (`max-w-md`); headings "Zaloguj się" / "Załóż konto"; links "Nie masz konta? Załóż konto" / "Masz już konto? Zaloguj się" in `text-primary` with full focus ring. confirm-email: "Konto założone" + "Możesz się teraz zalogować." (dev auto-confirm) / "Sprawdź skrzynkę e-mail" + "Wysłaliśmy link aktywacyjny…" ; emoji replaced by a lucide icon in `text-primary`; link "Przejdź do logowania".

#### 4. Contract lint and kitchen sink

**Files**: `eslint.config.js`, `src/components/error-resolution/KitchenSink.tsx` (or a new `src/components/auth/AuthKitchenSink.tsx` rendered by `src/dev/ui-kitchen-sink.astro`), CLAUDE.md _UI contract_ list

**Intent**: Guard the moved files and show every state for the screenshot gate.

**Contract**: add `"src/pages/auth/**"` and `"src/components/auth/**"` to `uiContractConfig.files` (`src/components/ui/` stays outside the guard, as today). Kitchen-sink cells: sign-in default, field errors (empty submit), server error (`invalid-credentials` message), pending; sign-up default, password hint, mismatch error, server error (`already-registered`), pending; password visible/hidden; confirm-email both variants. Update the UI-contract file list in CLAUDE.md.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (auth pages and components are inside `uiContractConfig`)
- `npx astro check` passes
- `npm run build` passes
- `npm run smoke` passes
- `grep -rn "bg-cosmic" src/pages/auth src/components/auth` returns nothing

#### Manual Verification:

- Kitchen sink `/dev/ui-kitchen-sink` shows every auth state on the light look; screenshot gate accepted
- Sign-in, sign-up (new e-mail and an existing one) and confirm-email work end to end in Polish with the user bar
- Keyboard: Tab order e-mail → hasło → przełącznik → przycisk, visible focus ring everywhere; screen reader announces field errors
- 360 px width: no horizontal scroll on the three pages and the 404

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No unit test runner in the repo; `safeNextPath` cases are covered by smoke steps and the manual list: `/`, `/my-tickets?offset=20`, `//evil.example`, `/\evil.example`, `https://evil.example`, `/api/tickets`, `/auth/signin`, value with `\n`, empty, non-string.

### Integration Tests:

- `npm run smoke`: anonymous redirects with `next`, sign-in round trip to `next`, error round trip keeping `next`, open-redirect rejection, signed-in visit to `/auth/signin`, existing 404 step.

### Manual Testing Steps:

1. As a guest open `/report-error`, sign in as Klient Alfa, land on `/report-error`.
2. Wrong password → Polish message, `next` kept, correct password → requested page.
3. Sign up with an e-mail from the seed → "already registered" message in Polish.
4. Signed in, open `/auth/signup` → redirected to `/`.
5. Open `/dashboard` as guest and as staff → Polish 404 with the user bar.

## Performance Considerations

None — two pure string helpers and static markup.

## Migration Notes

No database change. The smoke test expectations change in the same commit as the middleware/endpoint change (phase 2).

## References

- Roadmap item: `context/foundation/roadmap.md` → S-04
- Code-to-message pattern: `src/lib/services/ticket-resolution.ts:28`, `src/pages/admin/tickets.astro`
- Contract reference implementation: `src/layouts/ClientPageLayout.astro`, `src/components/error-resolution/ErrorAlert.tsx`
- Design tokens: `context/foundation/design-tokens.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Polish shell and 404 page

#### Automated

- [x] 1.1 `npm run lint` passes — 0036274
- [x] 1.2 `npx astro check` passes — 0036274
- [x] 1.3 `npm run build` passes — 0036274
- [x] 1.4 `grep -rn 'lang="' src` matches only `src/layouts/Layout.astro` — 0036274
- [x] 1.5 `npm run smoke` passes (step "dashboard is gone" still 404) — 0036274

#### Manual

- [x] 1.6 `/dashboard` shows the Polish 404 page with the user bar (as guest and as a signed-in client) and the link returns to `/` — 0036274
- [x] 1.7 Page source of `/` shows `<html lang="pl">`; tab title of a page without its own title is "HelpDesk XEMI" — 0036274

### Phase 2: Error codes and return to the requested page

#### Automated

- [x] 2.1 `npm run lint` passes — 9c4193e
- [x] 2.2 `npx astro check` passes — 9c4193e
- [x] 2.3 `npm run build` passes — 9c4193e
- [x] 2.4 `npm run smoke` passes, including the updated anonymous-redirect steps and the four new steps — 9c4193e

#### Manual

- [x] 2.5 As a guest open `/my-tickets?offset=20`, sign in as Klient Alfa, land on `/my-tickets?offset=20` — 9c4193e
- [x] 2.6 Wrong password shows a Polish message and a second, correct attempt still lands on the requested page — 9c4193e
- [x] 2.7 `/auth/signin?error=<script>` shows the generic Polish message, not the parameter text — 9c4193e
- [x] 2.8 `/auth/signin?next=//example.com` followed by a successful sign-in lands on `/` — 9c4193e

### Phase 3: Auth pages on the XEMI contract

#### Automated

- [x] 3.1 `npm run lint` passes (auth pages and components are inside `uiContractConfig`)
- [x] 3.2 `npx astro check` passes
- [x] 3.3 `npm run build` passes
- [x] 3.4 `npm run smoke` passes
- [x] 3.5 `grep -rn "bg-cosmic" src/pages/auth src/components/auth` returns nothing

#### Manual

- [x] 3.6 Kitchen sink `/dev/ui-kitchen-sink` shows every auth state on the light look; screenshot gate accepted
- [x] 3.7 Sign-in, sign-up (new e-mail and an existing one) and confirm-email work end to end in Polish with the user bar
- [x] 3.8 Keyboard: Tab order e-mail → hasło → przełącznik → przycisk, visible focus ring everywhere; screen reader announces field errors
- [x] 3.9 360 px width: no horizontal scroll on the three pages and the 404
