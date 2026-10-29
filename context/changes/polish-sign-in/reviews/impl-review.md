<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Polish sign-in pages, 404 and return to the requested page

- **Plan**: context/changes/polish-sign-in/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Open-redirect guard (`safeNextPath`) was exercised against `//evil`, `/\evil`, `\\evil`, `/a/..//evil`, `/%2e%2e//evil`, control characters, CR/LF, 3000-char input, unicode slashes and `/auth`/`/api` variants: every cross-origin case returns `/`; percent-encoded separators stay same-origin paths. Automated criteria re-run on HEAD: lint 0 errors, astro check 0 errors, `lang=` and `bg-cosmic` greps clean; build + smoke last passed on 2680407 and no `src/`/`scripts/` file changed since. All manual rows confirmed by the user per phase.

## Findings

### F1 — Submit button never shows the pending state on the real pages

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/SubmitButton.tsx:19
- **Detail**: `useFormStatus()` reports `pending` only for React function actions; `SignInForm`/`SignUpForm` post natively to `/api/auth/*`, so `status.pending` stays false — no "Logowanie…" text, no disabled button, double submit possible. Pre-existing in the starter, but this change now shows the loading state as a kitchen-sink cell the real pages never reach.
- **Fix**: Keep a local `submitting` state in each form, set in `handleSubmit` after validation passes, and pass it as `pending` to `SubmitButton` (drop `useFormStatus`).
- **Decision**: FIXED — local `submitting` via new `src/hooks/useNativeSubmitting.ts` (resets on bfcache `pageshow`), passed as `pending`; `useFormStatus` removed; second press while posting is dropped

### F2 — Kitchen-sink auth forms submit for real

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/auth/AuthKitchenSink.tsx:52
- **Detail**: Cells keep the real `action` and prefilled credentials; Enter in a valid cell signs in or creates an account on dev Supabase and leaves the gallery. `error-resolution/KitchenSink.tsx:15` blocks this with `preventSubmit`.
- **Fix**: Add an optional `onSubmitOverride`/`preventSubmit` path to the auth forms used only by `AuthKitchenSink`, mirroring `preventSubmit`.
- **Decision**: FIXED — `preventSubmit` prop on SignInForm/SignUpForm, set on every AuthKitchenSink cell (validation still runs)

### F3 — Forbidden-prefix check runs on the still-encoded path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-redirect.ts:17
- **Detail**: `/%61pi/tickets` or `/%61uth/signin` pass `FORBIDDEN_PREFIX` and Astro decodes them on the next request, so a crafted `next` can land the user on a JSON endpoint. Same-origin only, no loop (signed-in `/auth/signin` goes to `/`).
- **Fix**: Also test the `decodeURIComponent(url.pathname)` (in try/catch) against `FORBIDDEN_PREFIX`.
- **Decision**: FIXED — prefix also checked on the decoded path with slashes collapsed (`/%61pi/…`, `/%2fapi`, `/%5capi` → `/`)

### F4 — Signed-in redirect still renders the whole auth page

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/signin.astro:13
- **Detail**: The `Astro.response` 302 workaround (ESLint-safe, as in `my-tickets.astro`) still renders Topbar and the hydrated form into a body the browser ignores. No leak (same user), only wasted work; same in `signup.astro:11`.
- **Fix**: Wrap the page markup in `{!Astro.locals.user && (…)}` on both pages.
- **Decision**: FIXED — markup wrapped in `{!signedIn && (…)}` on signin.astro and signup.astro

### F5 — PasswordToggle has no aria-pressed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/PasswordToggle.tsx:18
- **Detail**: The toggle swaps its `aria-label` ("Pokaż hasło"/"Ukryj hasło") but exposes no toggle state; acceptable as is, `aria-pressed` would make it an explicit toggle button.
- **Fix**: Add `aria-pressed={visible}` and keep a fixed label "Pokaż hasło".
- **Decision**: FIXED — `aria-pressed={visible}` with fixed label „Pokaż hasło”; kitchen-sink notes updated

### F6 — 404 hint is two sentences, plan said one

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/NotFound.astro:20
- **Detail**: "Ta strona nie istnieje albo została przeniesiona. Sprawdź adres lub zacznij od strony startowej." — cosmetic, user accepted the page in manual check 1.6.
- **Fix**: Leave as is (or trim to the first sentence).
- **Decision**: FIXED — hint trimmed to „Ta strona nie istnieje albo została przeniesiona.”

## Triage

All 6 findings fixed (2026-10-29). Gates after fixes: lint 0 errors, astro check 0 errors, build OK, smoke passed after `db reset`.
