-- Migration: revoke unused write grants
-- Purpose:  Make the grant layer match the policies. After migrations 1 and 2, authenticated
--           still held INSERT/UPDATE/DELETE on public.companies, INSERT/DELETE on
--           public.profiles and DELETE on public.tickets and public.knowledge_base_entries --
--           Supabase defaults that no policy uses. RLS denies every one of them today, but the
--           grant is what a future permissive policy would silently widen: a staff INSERT
--           policy on companies, say, would also inherit UPDATE and DELETE for free.
-- Affected: table privileges of role authenticated on public.companies, public.profiles,
--           public.tickets and public.knowledge_base_entries. No schema or data change.
-- Notes:    Observably inert: each revoked statement was already rejected (INSERT) or
--           filtered to 0 rows (UPDATE/DELETE) by RLS; it now fails at the grant layer with
--           42501 instead. The application writes profiles.company_id only, through the
--           column grant from migration 1, which stays. Cascades from auth.users and the
--           triggers run as the table owner and are unaffected. supabase/tests/rls.sql pins
--           the resulting grant set exactly. A future feature that needs one of these writes
--           re-grants it narrowly (column-scoped where it can be) next to its policy.
--           Found in reviews/impl-review-full.md F2 (tenant-data-and-auth-foundation).

-- Companies are created and edited out of band (seed, migration or Studio); there is no
-- write policy for any role.
revoke insert, update, delete on public.companies from authenticated;

-- Profiles are created only by handle_new_user() and removed only by the cascade from
-- auth.users; the one client-facing write is the column-scoped company_id update.
revoke insert, delete on public.profiles from authenticated;

-- Nothing deletes tickets or knowledge-base entries from the application; INSERT and UPDATE
-- on knowledge_base_entries stay, because the staff policies use them.
revoke delete on public.tickets, public.knowledge_base_entries from authenticated;
