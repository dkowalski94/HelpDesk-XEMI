-- Policy-level negative checks for the tenant schema.
--
-- Covers the write and escalation attempts that have no HTTP surface yet (ticket writes
-- belong to S-01), plus the denied write on every RLS-protected surface and an exact
-- inventory of what anon/authenticated are granted, per context/foundation/lessons.md.
-- scripts/smoke.mjs covers what is reachable over HTTP.
--
-- Run against a database loaded with supabase/seed.sql:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
--
-- Every assertion raises on an unexpected outcome, so a non-zero exit is the failure
-- signal. Everything runs in one transaction that is rolled back at the end, so the
-- script leaves the seed exactly as it found it and can be run any number of times.
--
-- Personas switch the way PostgREST does per request: `set local role authenticated`
-- plus a `request.jwt.claims` setting whose `sub` is what auth.uid() returns.
--
-- "Denied" means one of two things, depending on the layer that stops the statement:
--   * an error raised by a column/table grant, an RLS WITH CHECK or a guard trigger
--     (SQLSTATE 42501 or P0001) -- expect_denied();
--   * RLS filtering the target rows away, which Postgres reports as a successful
--     statement touching 0 rows -- expect_rows(..., 0), followed by an owner-side
--     re-read at the end proving nothing changed.
-- expect_denied() deliberately does not match on error messages: which layer rejects
-- a statement first is an implementation detail (e.g. `update profiles set role` is
-- stopped by the column grant before enforce_profile_role_immutable() is reached).
-- It does reject any *other* error, so a typo in a statement fails the run instead of
-- passing as a "denial".

\set ON_ERROR_STOP on
-- The helpers return void; only their NOTICE lines are worth reading.
\set QUIET on
\pset tuples_only on
\pset format unaligned

begin;

-- ---------------------------------------------------------------------------
-- Assertion helpers (temporary: they disappear with the session)
-- ---------------------------------------------------------------------------

create function pg_temp.expect_denied(label text, stmt text) returns void
  language plpgsql
as $$
begin
  begin
    execute stmt;
  exception
    when insufficient_privilege or raise_exception then
      raise notice 'ok    % (denied: %)', label, sqlerrm;
      return;
  end;
  raise exception 'FAIL  % -- statement succeeded but must be denied: %', label, stmt;
end;
$$;

-- Runs a write and asserts how many rows it touched. The subtransaction is always
-- rolled back, so a positive control never leaves a row behind.
create function pg_temp.expect_rows(label text, stmt text, expected integer) returns void
  language plpgsql
as $$
declare
  affected integer;
begin
  begin
    execute stmt;
    get diagnostics affected = row_count;
    raise exception using errcode = 'ZZ000', message = affected::text;
  exception
    when sqlstate 'ZZ000' then
      affected := sqlerrm::integer;
    when others then
      raise exception 'FAIL  % -- expected % row(s), statement raised %: %', label, expected, sqlstate, sqlerrm;
  end;
  if affected <> expected then
    raise exception 'FAIL  % -- expected % row(s), got %', label, expected, affected;
  end if;
  raise notice 'ok    % (% row(s))', label, affected;
end;
$$;

create function pg_temp.expect_count(label text, query text, expected integer) returns void
  language plpgsql
as $$
declare
  actual integer;
begin
  execute format('select count(*) from (%s) as q', query) into actual;
  if actual <> expected then
    raise exception 'FAIL  % -- expected % row(s), got %', label, expected, actual;
  end if;
  raise notice 'ok    % (% row(s))', label, actual;
end;
$$;

create function pg_temp.act_as(user_id uuid) returns void
  language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- The helpers are called after `set local role authenticated` (or `anon`), so those
-- roles need EXECUTE on them; a temporary function is invisible outside this session anyway.
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures: the seeded personas and rows, by the fixed ids in supabase/seed.sql
-- ---------------------------------------------------------------------------
--   companies  c001 XEMI Service (internal)   c002 Nieprzypisani (unassigned)
--              c101 Klient Alfa (client)      c102 Klient Beta (client)
--   profiles   a1 staff   a2 Alfa client   a3 Beta client   a4 unassigned
--   tickets    e101 Alfa's   e102 Beta's
--   kb         f101 source=ticket (Alfa provenance)   f102 source=erp_doc

do $$
begin
  if (select count(*) from public.profiles p join public.companies c on c.id = p.company_id
      where (p.id, p.role, c.kind) in (
        ('00000000-0000-0000-0000-0000000000a1'::uuid, 'service_staff'::public.user_role, 'internal'::public.company_kind),
        ('00000000-0000-0000-0000-0000000000a2', 'client_user', 'client'),
        ('00000000-0000-0000-0000-0000000000a3', 'client_user', 'client'),
        ('00000000-0000-0000-0000-0000000000a4', 'client_user', 'unassigned'))) <> 4
     or (select count(*) from public.tickets
         where id in ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e102')) <> 2
     or (select count(*) from public.knowledge_base_entries
         where id in ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f102')) <> 2
  then
    raise exception 'FAIL  seed fixtures missing -- run `npx supabase db reset` first';
  end if;
end;
$$;

-- Snapshot of every row an attempt below could change, taken as the owner (who is
-- exempt from RLS) and compared again at the end.
create temp table rls_baseline as
select 'tickets' as surface, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as digest
from public.tickets t
union all
select 'knowledge_base_entries', md5(coalesce(string_agg(k::text, '|' order by k.id), ''))
from public.knowledge_base_entries k
union all
select 'profiles', md5(coalesce(string_agg(p::text, '|' order by p.id), ''))
from public.profiles p
union all
select 'companies', md5(coalesce(string_agg(c::text, '|' order by c.id), ''))
from public.companies c;

-- ---------------------------------------------------------------------------
-- Grant inventory: the exact privileges anon / authenticated / PUBLIC hold in public
-- ---------------------------------------------------------------------------
-- Supabase's default privileges hand out ALL (TRUNCATE included, which bypasses RLS) on
-- every new table and EXECUTE on every new function. Any grant not listed here fails the
-- run, so a migration that widens a grant has to update this list deliberately
-- (context/foundation/lessons.md: verify via role_table_grants, not by reading SQL).
-- Column-scoped grants are listed as `table.column`; functions as `name()`.

create temp table rls_expected_grants (object text, grantee text, privilege text);
insert into rls_expected_grants values
  ('companies',              'authenticated', 'SELECT'),
  ('knowledge_base_entries', 'authenticated', 'INSERT'),
  ('knowledge_base_entries', 'authenticated', 'SELECT'),
  ('knowledge_base_entries', 'authenticated', 'UPDATE'),
  ('knowledge_base_public',  'authenticated', 'SELECT'),
  ('profiles',               'authenticated', 'SELECT'),
  ('profiles.company_id',    'authenticated', 'UPDATE'),
  ('tickets',                'authenticated', 'SELECT'),
  ('tickets.company_id',     'authenticated', 'INSERT'),
  ('tickets.created_by',     'authenticated', 'INSERT'),
  ('tickets.error_text',     'authenticated', 'INSERT'),
  ('tickets.user_comment',   'authenticated', 'INSERT'),
  ('tickets.resolution',     'authenticated', 'UPDATE'),
  ('tickets.resolved_at',    'authenticated', 'UPDATE'),
  ('tickets.resolved_by',    'authenticated', 'UPDATE'),
  ('tickets.status',         'authenticated', 'UPDATE'),
  ('current_company_id()',   'authenticated', 'EXECUTE'),
  ('current_company_kind()', 'authenticated', 'EXECUTE'),
  ('is_service_staff()',     'authenticated', 'EXECUTE');

do $$
declare
  drift text;
begin
  with actual as (
    select g.table_name as object, g.grantee, g.privilege_type as privilege
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.grantee in ('PUBLIC', 'anon', 'authenticated')
    union
    -- Column grants only where the table-level grant is absent (a table-level grant
    -- lists every column here too).
    select cp.table_name || '.' || cp.column_name, cp.grantee, cp.privilege_type
    from information_schema.column_privileges cp
    where cp.table_schema = 'public' and cp.grantee in ('PUBLIC', 'anon', 'authenticated')
      and not exists (
        select 1 from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name = cp.table_name
          and g.grantee = cp.grantee and g.privilege_type = cp.privilege_type)
    union
    select p.proname || '()', r.rolname, 'EXECUTE'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) as r (rolname)
    where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'execute')
  )
  select string_agg(
           format('%s %s %s on %s',
                  case when e.object is null then 'unexpected' else 'missing' end,
                  coalesce(a.grantee, e.grantee), coalesce(a.privilege, e.privilege),
                  coalesce(a.object, e.object)),
           '; ' order by coalesce(a.object, e.object), coalesce(a.grantee, e.grantee))
    into drift
  from actual a
  full join rls_expected_grants e
    on e.object = a.object and e.grantee = a.grantee and e.privilege = a.privilege
  where a.object is null or e.object is null;

  if drift is not null then
    raise exception 'FAIL  grant inventory drifted: %', drift;
  end if;
  raise notice 'ok    grant inventory matches (no TRUNCATE/TRIGGER/REFERENCES, nothing for anon)';
end;
$$;

-- ---------------------------------------------------------------------------
-- Persona: Klient Alfa client user (a2)
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');

-- Reads
select pg_temp.expect_count('alfa: sees exactly its own ticket',
  $q$select 1 from public.tickets where id = '00000000-0000-0000-0000-00000000e101'$q$, 1);
select pg_temp.expect_count('alfa: sees no ticket of another company',
  $q$select 1 from public.tickets where company_id <> '00000000-0000-0000-0000-00000000c101'$q$, 0);
select pg_temp.expect_count('alfa: selecting knowledge_base_entries returns nothing',
  $q$select 1 from public.knowledge_base_entries$q$, 0);
select pg_temp.expect_count('alfa: knowledge_base_public returns the shared entries (control)',
  $q$select 1 from public.knowledge_base_public$q$, 2);

-- Ticket inserts. The positive control proves the statement shape is valid, so the
-- denials below are about the target company and nothing else.
select pg_temp.expect_rows('alfa: filing a ticket for its own company is allowed (control)',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000a2', 'rls test')$q$, 1);
select pg_temp.expect_denied('alfa: filing a ticket for another company',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c102', '00000000-0000-0000-0000-0000000000a2', 'rls test')$q$);
select pg_temp.expect_denied('alfa: filing a ticket against the internal company',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a2', 'rls test')$q$);
select pg_temp.expect_denied('alfa: filing a ticket already resolved',
  $q$insert into public.tickets (company_id, created_by, error_text, status, resolution, resolved_at)
     values ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000a2', 'rls test',
             'resolved', 'self-answered', now())$q$);
select pg_temp.expect_denied('alfa: filing a ticket attributed to someone else',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000a1', 'rls test')$q$);
select pg_temp.expect_denied('alfa: filing a ticket with no author',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c101', null, 'rls test')$q$);

-- TRUNCATE bypasses RLS entirely, so the grant layer is the only thing that stops it.
select pg_temp.expect_denied('alfa: truncating tickets', $q$truncate public.tickets$q$);
select pg_temp.expect_denied('alfa: truncating knowledge_base_entries', $q$truncate public.knowledge_base_entries$q$);
select pg_temp.expect_denied('alfa: truncating profiles', $q$truncate public.profiles$q$);
select pg_temp.expect_denied('alfa: truncating companies', $q$truncate public.companies$q$);

-- Ticket updates and deletes: resolving is staff-only, deleting is nobody's.
select pg_temp.expect_rows('alfa: resolving its own ticket touches no row',
  $q$update public.tickets set status = 'resolved', resolution = 'self-answered', resolved_at = now()
     where id = '00000000-0000-0000-0000-00000000e101'$q$, 0);
select pg_temp.expect_denied('alfa: rewriting a ticket''s company',
  $q$update public.tickets set company_id = '00000000-0000-0000-0000-00000000c102'
     where id = '00000000-0000-0000-0000-00000000e101'$q$);
select pg_temp.expect_denied('alfa: deleting its own ticket',
  $q$delete from public.tickets where id = '00000000-0000-0000-0000-00000000e101'$q$);

-- Knowledge base base table: staff-only in every direction.
select pg_temp.expect_denied('alfa: inserting into knowledge_base_entries',
  $q$insert into public.knowledge_base_entries (source, error_text) values ('erp_doc', 'rls test')$q$);
select pg_temp.expect_rows('alfa: updating knowledge_base_entries touches no row',
  $q$update public.knowledge_base_entries set steps = 'rls test'$q$, 0);
select pg_temp.expect_denied('alfa: deleting from knowledge_base_entries',
  $q$delete from public.knowledge_base_entries$q$);

-- Knowledge base view: definer rights must buy reads only.
select pg_temp.expect_denied('alfa: inserting through knowledge_base_public',
  $q$insert into public.knowledge_base_public (source, error_text) values ('erp_doc', 'rls test')$q$);
select pg_temp.expect_denied('alfa: updating through knowledge_base_public',
  $q$update public.knowledge_base_public set steps = 'rls test'$q$);
select pg_temp.expect_denied('alfa: deleting through knowledge_base_public',
  $q$delete from public.knowledge_base_public$q$);

-- Profiles: no role change, and no moving itself to another company.
select pg_temp.expect_denied('alfa: updating its own profiles.role',
  $q$update public.profiles set role = 'service_staff' where id = '00000000-0000-0000-0000-0000000000a2'$q$);
select pg_temp.expect_rows('alfa: moving itself to another company touches no row',
  $q$update public.profiles set company_id = '00000000-0000-0000-0000-00000000c102'
     where id = '00000000-0000-0000-0000-0000000000a2'$q$, 0);
select pg_temp.expect_denied('alfa: creating a profile',
  $q$insert into public.profiles (id, company_id, email)
     values (gen_random_uuid(), '00000000-0000-0000-0000-00000000c101', 'rls-test@example.com')$q$);
select pg_temp.expect_denied('alfa: deleting its own profile',
  $q$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$q$);

-- Companies: no write path for anyone but the owner.
select pg_temp.expect_denied('alfa: creating a company',
  $q$insert into public.companies (name, kind) values ('rls test', 'client')$q$);
select pg_temp.expect_denied('alfa: renaming its own company',
  $q$update public.companies set name = 'rls test' where id = '00000000-0000-0000-0000-00000000c101'$q$);
select pg_temp.expect_denied('alfa: deleting its own company',
  $q$delete from public.companies where id = '00000000-0000-0000-0000-00000000c101'$q$);

reset role;

-- ---------------------------------------------------------------------------
-- Persona: unassigned account (a4)
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');

select pg_temp.expect_count('unassigned: sees no tickets',
  $q$select 1 from public.tickets$q$, 0);
select pg_temp.expect_count('unassigned: selecting knowledge_base_public returns nothing',
  $q$select 1 from public.knowledge_base_public$q$, 0);
select pg_temp.expect_count('unassigned: selecting knowledge_base_entries returns nothing',
  $q$select 1 from public.knowledge_base_entries$q$, 0);

select pg_temp.expect_denied('unassigned: filing a ticket for its own (sentinel) company',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000a4', 'rls test')$q$);
select pg_temp.expect_denied('unassigned: filing a ticket for a client company',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000a4', 'rls test')$q$);

select pg_temp.expect_denied('unassigned: inserting through knowledge_base_public',
  $q$insert into public.knowledge_base_public (source, error_text) values ('erp_doc', 'rls test')$q$);
select pg_temp.expect_denied('unassigned: updating through knowledge_base_public',
  $q$update public.knowledge_base_public set steps = 'rls test'$q$);
select pg_temp.expect_denied('unassigned: deleting through knowledge_base_public',
  $q$delete from public.knowledge_base_public$q$);
select pg_temp.expect_denied('unassigned: inserting into knowledge_base_entries',
  $q$insert into public.knowledge_base_entries (source, error_text) values ('erp_doc', 'rls test')$q$);

select pg_temp.expect_denied('unassigned: updating its own profiles.role',
  $q$update public.profiles set role = 'service_staff' where id = '00000000-0000-0000-0000-0000000000a4'$q$);
select pg_temp.expect_rows('unassigned: assigning itself to a client company touches no row',
  $q$update public.profiles set company_id = '00000000-0000-0000-0000-00000000c101'
     where id = '00000000-0000-0000-0000-0000000000a4'$q$, 0);

reset role;

-- ---------------------------------------------------------------------------
-- Persona: service staff (a1)
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

select pg_temp.expect_count('staff: sees both client tickets (control)',
  $q$select 1 from public.tickets
     where id in ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e102')$q$, 2);

select pg_temp.expect_denied('staff: filing a ticket against the internal company',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a1', 'rls test')$q$);
-- A client company passes enforce_ticket_company_kind(), so this one is stopped by the
-- INSERT policy itself: staff has no path to file tickets.
select pg_temp.expect_denied('staff: filing a ticket for Klient Alfa',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000a1', 'rls test')$q$);
select pg_temp.expect_denied('staff: moving a ticket to another client company',
  $q$update public.tickets set company_id = '00000000-0000-0000-0000-00000000c102'
     where id = '00000000-0000-0000-0000-00000000e101'$q$);
select pg_temp.expect_denied('staff: deleting a ticket',
  $q$delete from public.tickets where id = '00000000-0000-0000-0000-00000000e101'$q$);

-- Role changes are out of band even for staff, on others and on itself.
select pg_temp.expect_denied('staff: promoting a client user via profiles.role',
  $q$update public.profiles set role = 'service_staff' where id = '00000000-0000-0000-0000-0000000000a2'$q$);
select pg_temp.expect_denied('staff: demoting itself via profiles.role',
  $q$update public.profiles set role = 'client_user' where id = '00000000-0000-0000-0000-0000000000a1'$q$);

select pg_temp.expect_denied('staff: deleting through knowledge_base_public',
  $q$delete from public.knowledge_base_public$q$);

-- Companies are created out of band (seed or Studio), even by staff.
select pg_temp.expect_denied('staff: creating a company',
  $q$insert into public.companies (name, kind) values ('rls test', 'client')$q$);
select pg_temp.expect_denied('staff: deleting a company',
  $q$delete from public.companies where id = '00000000-0000-0000-0000-00000000c102'$q$);

reset role;

-- ---------------------------------------------------------------------------
-- Persona: anonymous caller (anon, no JWT subject)
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '', true);

select pg_temp.expect_denied('anon: selecting tickets', $q$select 1 from public.tickets$q$);
select pg_temp.expect_denied('anon: selecting profiles', $q$select 1 from public.profiles$q$);
select pg_temp.expect_denied('anon: selecting companies', $q$select 1 from public.companies$q$);
select pg_temp.expect_denied('anon: selecting knowledge_base_entries', $q$select 1 from public.knowledge_base_entries$q$);
select pg_temp.expect_denied('anon: selecting knowledge_base_public', $q$select 1 from public.knowledge_base_public$q$);
select pg_temp.expect_denied('anon: filing a ticket',
  $q$insert into public.tickets (company_id, created_by, error_text)
     values ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000a2', 'rls test')$q$);
select pg_temp.expect_denied('anon: calling current_company_id()', $q$select public.current_company_id()$q$);

reset role;

-- ---------------------------------------------------------------------------
-- Nothing changed: re-read every surface as the owner
-- ---------------------------------------------------------------------------

do $$
declare
  changed text;
begin
  select string_agg(b.surface, ', ') into changed
  from rls_baseline b
  join (
    select 'tickets' as surface, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as digest
    from public.tickets t
    union all
    select 'knowledge_base_entries', md5(coalesce(string_agg(k::text, '|' order by k.id), ''))
    from public.knowledge_base_entries k
    union all
    select 'profiles', md5(coalesce(string_agg(p::text, '|' order by p.id), ''))
    from public.profiles p
    union all
    select 'companies', md5(coalesce(string_agg(c::text, '|' order by c.id), ''))
    from public.companies c
  ) now_ on now_.surface = b.surface
  where now_.digest <> b.digest;

  if changed is not null then
    raise exception 'FAIL  rows changed during denied attempts: %', changed;
  end if;

  -- Stated separately from the digest because it is the one change that matters most.
  if exists (
    select 1 from public.profiles
    where role = 'service_staff' and id <> '00000000-0000-0000-0000-0000000000a1'
  ) then
    raise exception 'FAIL  a profile other than the seeded staff account holds service_staff';
  end if;

  raise notice 'ok    no row changed on tickets, knowledge_base_entries, profiles or companies';
end;
$$;

rollback;

\echo 'All RLS negative checks passed'
