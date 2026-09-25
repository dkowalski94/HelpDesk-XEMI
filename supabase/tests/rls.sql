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
--
-- Rejections that are neither a privilege nor a guard -- a CHECK constraint (23514), a
-- pgvector dimension mismatch (22000) -- are asserted with expect_sqlstate() naming the
-- exact SQLSTATE, so expect_denied() never has to be widened to swallow them.

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

-- Asserts a statement fails with exactly this SQLSTATE; any other error, or success,
-- fails the run.
create function pg_temp.expect_sqlstate(label text, stmt text, expected_state text) returns void
  language plpgsql
as $$
begin
  begin
    execute stmt;
  exception
    when others then
      if sqlstate = expected_state then
        raise notice 'ok    % (rejected %: %)', label, sqlstate, sqlerrm;
        return;
      end if;
      raise exception 'FAIL  % -- expected SQLSTATE %, statement raised %: %', label, expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % -- statement succeeded but must fail with SQLSTATE %: %', label, expected_state, stmt;
end;
$$;

create function pg_temp.expect_check_violation(label text, stmt text) returns void
  language sql
as $$
  select pg_temp.expect_sqlstate(label, stmt, '23514');
$$;

-- Runs a query returning one value and compares its text form. Unlike expect_rows(), the
-- statement's effects are kept: the ERP function-path controls build on each other and
-- are undone by their own savepoint instead.
create function pg_temp.expect_equal(label text, query text, expected text) returns void
  language plpgsql
as $$
declare
  actual text;
begin
  begin
    execute query into actual;
  exception
    when others then
      raise exception 'FAIL  % -- expected %, statement raised %: %', label, expected, sqlstate, sqlerrm;
  end;
  if actual is distinct from expected then
    raise exception 'FAIL  % -- expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok    % (%)', label, actual;
end;
$$;

-- One ERP document fragment in the shape stage_erp_document_chunks() accepts. p_dims
-- other than 1536 builds the wrong-dimension case.
create function pg_temp.erp_chunk(p_seq integer, p_steps text, p_dims integer default 1536) returns jsonb
  language sql
as $$
  select jsonb_build_object(
    'seq', p_seq,
    'error_text', 'rls-test.pdf — s. ' || (p_seq + 1),
    'steps', p_steps,
    'embedding', (select jsonb_agg(0.001) from generate_series(1, p_dims)));
$$;

-- A 1536-dim vector whose leading coordinates are p_head and the rest zero, so the
-- match_knowledge_base() checks work with exact similarities: kb_vector('{1}') is e1,
-- kb_vector('{0,1}') is e2, kb_vector('{0.8,0.6}') is 0.8·e1 + 0.6·e2.
create function pg_temp.kb_vector(p_head double precision[]) returns extensions.vector
  language sql
as $$
  select (p_head || array_fill(0::double precision, array[1536 - cardinality(p_head)]))::extensions.vector(1536);
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
--   kb         f101 source=ticket (Alfa provenance)   f102 source=erp_doc (document d101)
--   erp docs   d101 Dokumentacja-demo.pdf
--   kb match   match_knowledge_base(): the seed has no embeddings, so its section sets
--              f101 = e1 and f102 = e2 and plants f201 (no embedding) plus 12 ticket
--              entries at e1, all under a savepoint that is rolled back

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
     or (select count(*) from public.knowledge_base_entries
         where id = '00000000-0000-0000-0000-00000000f102'
           and erp_document_id = '00000000-0000-0000-0000-00000000d101') <> 1
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
from public.companies c
union all
select 'erp_documents', md5(coalesce(string_agg(d::text, '|' order by d.id), ''))
from public.erp_documents d
union all
select 'erp_document_upload_chunks', md5(coalesce(string_agg(s::text, '|' order by s.upload_id, s.seq), ''))
from public.erp_document_upload_chunks s;

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
  ('erp_documents',          'authenticated', 'SELECT'),
  ('knowledge_base_entries', 'authenticated', 'SELECT'),
  ('knowledge_base_entries.cause',             'authenticated', 'INSERT'),
  ('knowledge_base_entries.created_at',        'authenticated', 'INSERT'),
  ('knowledge_base_entries.embedding',         'authenticated', 'INSERT'),
  ('knowledge_base_entries.error_text',        'authenticated', 'INSERT'),
  ('knowledge_base_entries.id',                'authenticated', 'INSERT'),
  ('knowledge_base_entries.source',            'authenticated', 'INSERT'),
  ('knowledge_base_entries.source_company_id', 'authenticated', 'INSERT'),
  ('knowledge_base_entries.source_ticket_id',  'authenticated', 'INSERT'),
  ('knowledge_base_entries.steps',             'authenticated', 'INSERT'),
  ('knowledge_base_entries.updated_at',        'authenticated', 'INSERT'),
  ('knowledge_base_entries.cause',             'authenticated', 'UPDATE'),
  ('knowledge_base_entries.created_at',        'authenticated', 'UPDATE'),
  ('knowledge_base_entries.embedding',         'authenticated', 'UPDATE'),
  ('knowledge_base_entries.error_text',        'authenticated', 'UPDATE'),
  ('knowledge_base_entries.id',                'authenticated', 'UPDATE'),
  ('knowledge_base_entries.source_company_id', 'authenticated', 'UPDATE'),
  ('knowledge_base_entries.source_ticket_id',  'authenticated', 'UPDATE'),
  ('knowledge_base_entries.steps',             'authenticated', 'UPDATE'),
  ('knowledge_base_entries.updated_at',        'authenticated', 'UPDATE'),
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
  ('is_service_staff()',     'authenticated', 'EXECUTE'),
  ('stage_erp_document_chunks()', 'authenticated', 'EXECUTE'),
  ('publish_erp_document()',      'authenticated', 'EXECUTE'),
  ('remove_erp_document()',       'authenticated', 'EXECUTE'),
  ('match_knowledge_base()',      'authenticated', 'EXECUTE');

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

-- ERP document registry: staff-only reads, and no write grant for anyone.
select pg_temp.expect_count('alfa: selecting erp_documents returns nothing',
  $q$select 1 from public.erp_documents$q$, 0);
select pg_temp.expect_denied('alfa: inserting into erp_documents',
  $q$insert into public.erp_documents (file_name, content_hash, page_count, chunk_count)
     values ('rls.pdf', repeat('a', 64), 1, 1)$q$);
select pg_temp.expect_denied('alfa: updating erp_documents',
  $q$update public.erp_documents set file_name = 'rls.pdf'$q$);
select pg_temp.expect_denied('alfa: deleting from erp_documents',
  $q$delete from public.erp_documents$q$);
select pg_temp.expect_denied('alfa: truncating erp_documents', $q$truncate public.erp_documents$q$);

-- Upload staging: no grant and no policy for any client role.
select pg_temp.expect_denied('alfa: selecting erp_document_upload_chunks',
  $q$select 1 from public.erp_document_upload_chunks$q$);
select pg_temp.expect_denied('alfa: inserting into erp_document_upload_chunks',
  $q$insert into public.erp_document_upload_chunks
       (upload_id, seq, file_name, content_hash, error_text, steps, embedding, uploaded_by)
     values (gen_random_uuid(), 0, 'rls.pdf', repeat('a', 64), 'rls test', 'rls test',
             (pg_temp.erp_chunk(0, 'rls test') ->> 'embedding')::extensions.vector(1536),
             '00000000-0000-0000-0000-0000000000a2')$q$);
select pg_temp.expect_denied('alfa: deleting from erp_document_upload_chunks',
  $q$delete from public.erp_document_upload_chunks$q$);

-- The write path: every function refuses a client with 42501 before touching anything.
select pg_temp.expect_sqlstate('alfa: calling stage_erp_document_chunks()',
  $q$select public.stage_erp_document_chunks(gen_random_uuid(), 'rls.pdf', repeat('a', 64),
       jsonb_build_array(pg_temp.erp_chunk(0, 'rls test')))$q$, '42501');
select pg_temp.expect_sqlstate('alfa: calling publish_erp_document()',
  $q$select * from public.publish_erp_document(gen_random_uuid(), 1)$q$, '42501');
select pg_temp.expect_sqlstate('alfa: calling remove_erp_document()',
  $q$select public.remove_erp_document('Dokumentacja-demo.pdf')$q$, '42501');

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

select pg_temp.expect_count('unassigned: selecting erp_documents returns nothing',
  $q$select 1 from public.erp_documents$q$, 0);
select pg_temp.expect_denied('unassigned: inserting into erp_documents',
  $q$insert into public.erp_documents (file_name, content_hash, page_count, chunk_count)
     values ('rls.pdf', repeat('a', 64), 1, 1)$q$);
select pg_temp.expect_denied('unassigned: updating erp_documents',
  $q$update public.erp_documents set file_name = 'rls.pdf'$q$);
select pg_temp.expect_denied('unassigned: deleting from erp_documents',
  $q$delete from public.erp_documents$q$);
select pg_temp.expect_denied('unassigned: truncating erp_documents', $q$truncate public.erp_documents$q$);

select pg_temp.expect_denied('unassigned: selecting erp_document_upload_chunks',
  $q$select 1 from public.erp_document_upload_chunks$q$);
select pg_temp.expect_denied('unassigned: inserting into erp_document_upload_chunks',
  $q$insert into public.erp_document_upload_chunks
       (upload_id, seq, file_name, content_hash, error_text, steps, embedding, uploaded_by)
     values (gen_random_uuid(), 0, 'rls.pdf', repeat('a', 64), 'rls test', 'rls test',
             (pg_temp.erp_chunk(0, 'rls test') ->> 'embedding')::extensions.vector(1536),
             '00000000-0000-0000-0000-0000000000a4')$q$);
select pg_temp.expect_denied('unassigned: deleting from erp_document_upload_chunks',
  $q$delete from public.erp_document_upload_chunks$q$);

select pg_temp.expect_sqlstate('unassigned: calling stage_erp_document_chunks()',
  $q$select public.stage_erp_document_chunks(gen_random_uuid(), 'rls.pdf', repeat('a', 64),
       jsonb_build_array(pg_temp.erp_chunk(0, 'rls test')))$q$, '42501');
select pg_temp.expect_sqlstate('unassigned: calling publish_erp_document()',
  $q$select * from public.publish_erp_document(gen_random_uuid(), 1)$q$, '42501');
select pg_temp.expect_sqlstate('unassigned: calling remove_erp_document()',
  $q$select public.remove_erp_document('Dokumentacja-demo.pdf')$q$, '42501');

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

-- ERP documents: staff reads the registry, but even staff writes it only through the
-- functions -- there is no table-level write grant to fall back on.
select pg_temp.expect_count('staff: sees the seeded erp document (control)',
  $q$select 1 from public.erp_documents where id = '00000000-0000-0000-0000-00000000d101'$q$, 1);
select pg_temp.expect_denied('staff: inserting into erp_documents directly',
  $q$insert into public.erp_documents (file_name, content_hash, page_count, chunk_count)
     values ('rls.pdf', repeat('a', 64), 1, 1)$q$);
select pg_temp.expect_denied('staff: updating erp_documents directly',
  $q$update public.erp_documents set file_name = 'rls.pdf'$q$);
select pg_temp.expect_denied('staff: deleting from erp_documents directly',
  $q$delete from public.erp_documents$q$);
select pg_temp.expect_denied('staff: truncating erp_documents', $q$truncate public.erp_documents$q$);
select pg_temp.expect_denied('staff: selecting erp_document_upload_chunks directly',
  $q$select 1 from public.erp_document_upload_chunks$q$);
select pg_temp.expect_denied('staff: inserting into erp_document_upload_chunks directly',
  $q$insert into public.erp_document_upload_chunks
       (upload_id, seq, file_name, content_hash, error_text, steps, embedding, uploaded_by)
     values (gen_random_uuid(), 0, 'rls.pdf', repeat('a', 64), 'rls test', 'rls test',
             (pg_temp.erp_chunk(0, 'rls test') ->> 'embedding')::extensions.vector(1536),
             '00000000-0000-0000-0000-0000000000a1')$q$);

-- erp_doc entries: staff keeps its other knowledge-base writes, but erp_document_id (and source
-- on UPDATE) has no grant, so no direct write can attach an entry to a document -- whose publish
-- or remove would then cascade-delete it.
select pg_temp.expect_sqlstate('staff: attaching a ticket entry to an erp document',
  $q$update public.knowledge_base_entries
     set source = 'erp_doc', erp_document_id = '00000000-0000-0000-0000-00000000d101'
     where id = '00000000-0000-0000-0000-00000000f101'$q$, '42501');
select pg_temp.expect_sqlstate('staff: changing an entry''s source',
  $q$update public.knowledge_base_entries set source = 'erp_doc'
     where id = '00000000-0000-0000-0000-00000000f101'$q$, '42501');
select pg_temp.expect_sqlstate('staff: inserting an entry that names an erp document',
  $q$insert into public.knowledge_base_entries (source, error_text, steps, erp_document_id)
     values ('erp_doc', 'rls test', 'rls test', '00000000-0000-0000-0000-00000000d101')$q$, '42501');
select pg_temp.expect_check_violation('staff: inserting an erp_doc entry without a document',
  $q$insert into public.knowledge_base_entries (source, error_text, steps)
     values ('erp_doc', 'rls test', 'rls test')$q$);

reset role;

-- ---------------------------------------------------------------------------
-- ERP document write path: staff through the functions
-- ---------------------------------------------------------------------------
-- The staging calls below succeed and the positive controls publish and remove real
-- rows, so the whole section runs under a savepoint that is rolled back at its end;
-- the fingerprint at the bottom then proves nothing leaked out of it.
--   uploads    b001 gap in seq   b002 staged by alfa (owner-side)
--              b003 first version   b004 replacement in different case

savepoint erp_function_path;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

-- Input validation: each malformed call is refused before anything is staged.
select pg_temp.expect_denied('staff: staging an empty chunk array',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), '[]'::jsonb)$q$);
select pg_temp.expect_denied('staff: staging chunks that are not an array',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), pg_temp.erp_chunk(0, 'rls test'))$q$);
select pg_temp.expect_denied('staff: staging more than 200 chunks in one call',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), (select jsonb_agg(pg_temp.erp_chunk(g, 'rls test', 1)) from generate_series(0, 200) g))$q$);
select pg_temp.expect_denied('staff: staging a chunk without an embedding',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(0, 'rls test') - 'embedding'))$q$);
select pg_temp.expect_denied('staff: staging a chunk with blank steps',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(0, '   ')))$q$);
-- A bad seq is a validation error (P0001), not the raw CHECK or cast error the insert would raise.
select pg_temp.expect_sqlstate('staff: staging a chunk with a negative seq',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(-1, 'rls test')))$q$, 'P0001');
select pg_temp.expect_sqlstate('staff: staging a chunk with a non-integer seq',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), jsonb_build_array(jsonb_set(pg_temp.erp_chunk(0, 'rls test'), '{seq}', '1.5')))$q$, 'P0001');
-- File identity is the base name, so a path in either separator style is refused.
select pg_temp.expect_sqlstate('staff: staging a file name with a folder path',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'C:\Dokumentacja\rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(0, 'rls test')))$q$, 'P0001');
select pg_temp.expect_sqlstate('staff: staging a file name with a forward-slash path',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'docs/rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(0, 'rls test')))$q$, 'P0001');
-- pgvector rejects the dimension in the cast itself, with data_exception rather than a
-- privilege or guard error -- asserted by exact SQLSTATE, not through expect_denied().
select pg_temp.expect_sqlstate('staff: staging a vector of the wrong dimension',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b0ff', 'rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(0, 'rls test', 3)))$q$, '22000');

-- An upload with a gap in seq never publishes.
select pg_temp.expect_equal('staff: staging fragments 0 and 2 (setup)',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b001', 'rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(0, 'rls gap 0'), pg_temp.erp_chunk(2, 'rls gap 2')))$q$,
  '2');
select pg_temp.expect_denied('staff: publishing an upload with a gap in seq',
  $q$select * from public.publish_erp_document('00000000-0000-0000-0000-00000000b001', 1)$q$);
select pg_temp.expect_denied('staff: staging a different file under an existing upload id',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b001', 'inny.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(1, 'rls gap 1')))$q$);

-- An upload staged by someone else is neither extendable nor publishable. The rows are
-- planted by the owner, because no client path can stage as a non-staff account.
reset role;
insert into public.erp_document_upload_chunks
  (upload_id, seq, file_name, content_hash, error_text, steps, embedding, uploaded_by)
values (
  '00000000-0000-0000-0000-00000000b002', 0, 'rls-test.pdf', repeat('a', 64), 'rls test', 'rls foreign 0',
  (pg_temp.erp_chunk(0, 'rls test') ->> 'embedding')::extensions.vector(1536),
  '00000000-0000-0000-0000-0000000000a2'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

select pg_temp.expect_denied('staff: staging into an upload held by another user',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b002', 'rls-test.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(1, 'rls foreign 1')))$q$);
select pg_temp.expect_denied('staff: publishing an upload staged by another user',
  $q$select * from public.publish_erp_document('00000000-0000-0000-0000-00000000b002', 1)$q$);

-- Positive control: a first version of a document.
select pg_temp.expect_equal('staff: staging 2 fragments of a new document',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b003', 'Magazyn-rls.pdf',
       repeat('a', 64), jsonb_build_array(pg_temp.erp_chunk(0, 'rls first version 0'),
                                          pg_temp.erp_chunk(1, 'rls first version 1')))$q$,
  '2');
select pg_temp.expect_equal('staff: publishing it adds 2 fragments',
  $q$select chunk_count from public.publish_erp_document('00000000-0000-0000-0000-00000000b003', 3)$q$,
  '2');
select pg_temp.expect_count('staff: one registry row for the document',
  $q$select 1 from public.erp_documents where lower(file_name) = 'magazyn-rls.pdf'$q$, 1);
select pg_temp.expect_equal('staff: the registry row records who loaded it, pages and fragments',
  $q$select ingested_by || ' ' || page_count || ' ' || chunk_count
     from public.erp_documents where lower(file_name) = 'magazyn-rls.pdf'$q$,
  '00000000-0000-0000-0000-0000000000a1 3 2');
select pg_temp.expect_count('staff: 2 erp_doc entries linked to it',
  $q$select 1 from public.knowledge_base_entries e
     join public.erp_documents d on d.id = e.erp_document_id
     where e.source = 'erp_doc' and lower(d.file_name) = 'magazyn-rls.pdf'$q$, 2);

reset role;
select pg_temp.expect_count('owner: publishing cleared the upload''s staging rows',
  $q$select 1 from public.erp_document_upload_chunks where upload_id = '00000000-0000-0000-0000-00000000b003'$q$, 0);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

-- Positive control: the same file name in different case replaces, never duplicates.
select pg_temp.expect_equal('staff: staging 1 fragment of the same document, name in different case',
  $q$select public.stage_erp_document_chunks('00000000-0000-0000-0000-00000000b004', 'MAGAZYN-RLS.PDF',
       repeat('b', 64), jsonb_build_array(pg_temp.erp_chunk(0, 'rls replacement fragment')))$q$,
  '1');
select pg_temp.expect_equal('staff: publishing the replacement',
  $q$select chunk_count from public.publish_erp_document('00000000-0000-0000-0000-00000000b004', 1)$q$,
  '1');
select pg_temp.expect_count('staff: still one registry row for the document',
  $q$select 1 from public.erp_documents where lower(file_name) = 'magazyn-rls.pdf'$q$, 1);
select pg_temp.expect_count('staff: exactly 1 erp_doc entry linked to it',
  $q$select 1 from public.knowledge_base_entries e
     join public.erp_documents d on d.id = e.erp_document_id
     where e.source = 'erp_doc' and lower(d.file_name) = 'magazyn-rls.pdf'$q$, 1);
select pg_temp.expect_count('staff: the first version''s fragments are gone',
  $q$select 1 from public.knowledge_base_entries where steps like 'rls first version%'$q$, 0);

-- Published fragments reach clients through the shared view.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_count('alfa: sees the published fragment through knowledge_base_public',
  $q$select 1 from public.knowledge_base_public where source = 'erp_doc' and steps = 'rls replacement fragment'$q$, 1);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

-- Positive control: removal takes the entries with it.
select pg_temp.expect_equal('staff: removing the document',
  $q$select public.remove_erp_document('magazyn-rls.pdf')$q$, 'true');
select pg_temp.expect_count('staff: its registry row is gone',
  $q$select 1 from public.erp_documents where lower(file_name) = 'magazyn-rls.pdf'$q$, 0);
select pg_temp.expect_count('staff: its entries went with it',
  $q$select 1 from public.knowledge_base_entries where steps = 'rls replacement fragment'$q$, 0);
select pg_temp.expect_equal('staff: removing it again reports it missing',
  $q$select public.remove_erp_document('magazyn-rls.pdf')$q$, 'false');

rollback to savepoint erp_function_path;
release savepoint erp_function_path;

-- ---------------------------------------------------------------------------
-- Similarity search: match_knowledge_base()
-- ---------------------------------------------------------------------------
-- The seed carries no embeddings, so the owner plants them with fixed vectors and every
-- similarity below is exact. The whole section runs under a savepoint that is rolled
-- back at its end; the fingerprint at the bottom then proves nothing leaked out of it.
-- Similarities are compared rounded, because pgvector computes in single precision.

savepoint kb_match_path;

update public.knowledge_base_entries set embedding = pg_temp.kb_vector('{1}')
where id = '00000000-0000-0000-0000-00000000f101';
update public.knowledge_base_entries set embedding = pg_temp.kb_vector('{0,1}')
where id = '00000000-0000-0000-0000-00000000f102';

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');

select pg_temp.expect_equal('alfa: query 0.8·e1 + 0.6·e2 at threshold 0.5 returns f101 then f102',
  $q$select string_agg(id || ' ' || round(similarity::numeric, 6), ', ' order by ord)
     from public.match_knowledge_base(pg_temp.kb_vector('{0.8,0.6}'), 0.5, 3) with ordinality as m (id, source, error_text, cause, steps, similarity, ord)$q$,
  '00000000-0000-0000-0000-00000000f101 0.800000, 00000000-0000-0000-0000-00000000f102 0.600000');
select pg_temp.expect_equal('alfa: threshold 0.7 keeps f101 only',
  $q$select string_agg(id::text, ', ')
     from public.match_knowledge_base(pg_temp.kb_vector('{0.8,0.6}'), 0.7, 3)$q$,
  '00000000-0000-0000-0000-00000000f101');
select pg_temp.expect_count('alfa: a query orthogonal to every entry returns nothing',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{0,0,1}'), 0.5, 3)$q$, 0);

-- An entry without an embedding is never a match, not even at the lowest threshold.
reset role;
insert into public.knowledge_base_entries (id, source, error_text)
values ('00000000-0000-0000-0000-00000000f201', 'ticket', 'rls match: no embedding');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');

select pg_temp.expect_count('alfa: at threshold -1 only the two embedded entries match',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), -1, 10)$q$, 2);
select pg_temp.expect_count('alfa: the entry without an embedding is never returned',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), -1, 10)
     where id = '00000000-0000-0000-0000-00000000f201'$q$, 0);

-- 12 more entries at e1 make 13 exact matches, enough to see the count clamp. They are
-- ticket entries: an erp_doc one would need a document (knowledge_base_entries_erp_doc_has_document).
reset role;
insert into public.knowledge_base_entries (source, error_text, embedding)
select 'ticket', 'rls match ' || g, pg_temp.kb_vector('{1}')
from generate_series(1, 12) g;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');

select pg_temp.expect_count('alfa: count 3 returns 3 rows',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), 0.5, 3)$q$, 3);
select pg_temp.expect_equal('alfa: the closest match comes first, at similarity 1',
  $q$select round(similarity::numeric, 6)
     from public.match_knowledge_base(pg_temp.kb_vector('{1}'), 0.5, 3) limit 1$q$,
  '1.000000');
select pg_temp.expect_count('alfa: count 1000 is clamped to 10 rows',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), 0.5, 1000)$q$, 10);
select pg_temp.expect_count('alfa: count 0 is clamped to 1 row',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), 0.5, 0)$q$, 1);
select pg_temp.expect_count('alfa: the entry without an embedding is still never returned',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), -1, 10)
     where id = '00000000-0000-0000-0000-00000000f201'$q$, 0);

-- Same gate as knowledge_base_public: an unassigned account gets nothing, not an error.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_count('unassigned: match_knowledge_base() returns nothing',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), 0.5, 3)$q$, 0);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_count('staff: match_knowledge_base() returns matches (control)',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), 0.5, 3)$q$, 3);

reset role;

-- The result exposes what knowledge_base_public exposes plus the similarity: no embedding,
-- no provenance, no document link.
select pg_temp.expect_equal('owner: match_knowledge_base() result signature',
  $q$select pg_get_function_result('public.match_knowledge_base(extensions.vector, double precision, integer)'::regprocedure)$q$,
  'TABLE(id uuid, source kb_source, error_text text, cause text, steps text, similarity double precision)');
select pg_temp.expect_equal('owner: match_knowledge_base() is stable, security definer, owned by postgres',
  $q$select p.provolatile::text || ' ' || p.prosecdef || ' ' || p.proowner::regrole
     from pg_proc p
     where p.oid = 'public.match_knowledge_base(extensions.vector, double precision, integer)'::regprocedure$q$,
  's true postgres');

rollback to savepoint kb_match_path;
release savepoint kb_match_path;

-- ---------------------------------------------------------------------------
-- Owner-side: the erp_doc / document invariant holds below RLS too
-- ---------------------------------------------------------------------------
-- The owner bypasses RLS and every grant, so only the CHECK constraint stands here.

select pg_temp.expect_check_violation('owner: an erp_doc entry without a document',
  $q$insert into public.knowledge_base_entries (source, error_text) values ('erp_doc', 'rls test')$q$);
select pg_temp.expect_check_violation('owner: a ticket entry pointing at a document',
  $q$insert into public.knowledge_base_entries (source, error_text, erp_document_id)
     values ('ticket', 'rls test', '00000000-0000-0000-0000-00000000d101')$q$);

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
select pg_temp.expect_denied('anon: selecting erp_documents', $q$select 1 from public.erp_documents$q$);
select pg_temp.expect_denied('anon: selecting erp_document_upload_chunks',
  $q$select 1 from public.erp_document_upload_chunks$q$);
select pg_temp.expect_denied('anon: calling stage_erp_document_chunks()',
  $q$select public.stage_erp_document_chunks(gen_random_uuid(), 'rls.pdf', repeat('a', 64),
       jsonb_build_array(pg_temp.erp_chunk(0, 'rls test')))$q$);
select pg_temp.expect_denied('anon: calling publish_erp_document()',
  $q$select * from public.publish_erp_document(gen_random_uuid(), 1)$q$);
select pg_temp.expect_denied('anon: calling remove_erp_document()',
  $q$select public.remove_erp_document('Dokumentacja-demo.pdf')$q$);
select pg_temp.expect_denied('anon: calling match_knowledge_base()',
  $q$select 1 from public.match_knowledge_base(pg_temp.kb_vector('{1}'), 0.5, 3)$q$);

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
    union all
    select 'erp_documents', md5(coalesce(string_agg(d::text, '|' order by d.id), ''))
    from public.erp_documents d
    union all
    select 'erp_document_upload_chunks', md5(coalesce(string_agg(s::text, '|' order by s.upload_id, s.seq), ''))
    from public.erp_document_upload_chunks s
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

  raise notice 'ok    no row changed on tickets, knowledge_base_entries, profiles, companies, erp_documents or erp_document_upload_chunks';
end;
$$;

rollback;

\echo 'All RLS negative checks passed'
