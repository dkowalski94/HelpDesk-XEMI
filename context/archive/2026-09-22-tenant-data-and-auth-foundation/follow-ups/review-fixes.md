# Review fixes queue

## From `reviews/impl-review-phase-4.md`

- **F2 → Phase 5, `supabase/tests/rls.sql`**: the `update profiles set role` negative check must
  assert that the statement raises *any* error and that the role is unchanged afterwards. Do not
  match on `enforce_profile_role_immutable()`'s message: the column-scoped
  `grant update (company_id)` rejects the statement first with `permission denied for table
  profiles`, so the trigger is never reached on the `authenticated` path.

## From `reviews/impl-review-full.md`

- **DONE 2026-09-24** — pushed by the user; `supabase migration list --linked` shows local and remote identical (`20260922120000`, `20260922120100`, `20260924090000`).
  **F2 → hosted database, before merge**: `supabase/migrations/20260924090000_revoke_unused_write_grants.sql`
  is applied locally only. Per the `CLAUDE.md` runbook, run `npx supabase db push --dry-run`
  (expect exactly this one pending migration), then `npx supabase db push`, before the commit
  carrying it reaches `master`. Nothing in the app uses the revoked grants, so the currently
  deployed Worker keeps working before and after the push.
