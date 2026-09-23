-- Migration: tickets and shared knowledge base
-- Purpose:  Add the two tables the product actually operates on -- support tickets and the
--           shared knowledge base -- with per-company isolation enforced at the row level
--           rather than in the UI, and with the knowledge base split into a staff-only base
--           table and a client-readable view so "one shared knowledge base" and "no
--           cross-client leakage" can both hold at once.
-- Affected: new extension vector (in schema extensions), new enums public.ticket_status /
--           public.kb_source, new tables public.tickets / public.knowledge_base_entries,
--           new view public.knowledge_base_public, new SECURITY DEFINER trigger function
--           public.enforce_ticket_company_kind(), three new triggers (the company-kind guard
--           plus set_updated_at() on both tables), and a closing section that revokes and
--           re-grants table, column and function privileges rather than leaving the defaults.
-- Notes:    This is the direct sequel to 20260922120000_tenant_identity_foundation.sql and
--           reuses its contract: tenancy is resolved only through current_company_id() /
--           current_company_kind() / is_service_staff(), timestamps are maintained by its
--           set_updated_at(), and every helper call inside a policy is wrapped in a scalar
--           subquery so Postgres caches it as an InitPlan instead of re-running it per row.

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------

-- pgvector is pinned to the extensions schema, which is where Supabase installs extensions
-- (seed.sql already relies on pgcrypto living there) and where the dashboard's "enable
-- extension" button would have put it on the hosted project. config.toml already lists
-- extensions in the API's extra_search_path, so PostgREST resolves the type; every reference
-- below qualifies it anyway, so nothing here depends on the applying session's search_path.
create extension if not exists vector with schema extensions;

-- `if not exists` above is a no-op when the extension is already installed -- including when it
-- is installed somewhere else. A hosted project where pgvector was enabled into `public` (older
-- dashboard behaviour) would sail past line 26 and then fail at the column definition below
-- with a bare "type extensions.vector does not exist". `supabase db reset` can never reproduce
-- that, because a fresh database always takes the branch above. Fail with the actual diagnosis.
do $$
declare
  installed_schema text;
begin
  select extnamespace::regnamespace::text into installed_schema
  from pg_extension
  where extname = 'vector';

  if installed_schema <> 'extensions' then
    raise exception
      'pgvector is installed in schema % but this migration expects "extensions". Run: alter extension vector set schema extensions;',
      installed_schema;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------

create type public.ticket_status as enum ('todo', 'resolved');

comment on type public.ticket_status is
  'todo = waiting for the service team; resolved = a staff member recorded a resolution. There is deliberately no in-between state: the PRD''s loop is file -> resolve.';

create type public.kb_source as enum ('ticket', 'erp_doc');

comment on type public.kb_source is
  'Where a knowledge base entry came from: ticket = distilled from a resolved support ticket; erp_doc = ingested from the ERP documentation.';

-- ---------------------------------------------------------------------------
-- 3. Tables and indexes
-- ---------------------------------------------------------------------------

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  -- Nullable and cleared rather than blocking, for the same reason the knowledge base clears
  -- its provenance below: profiles cascade from auth.users, so a NOT NULL / NO ACTION pair
  -- here would make every erasure request fail with a foreign-key error for any user who had
  -- ever filed a ticket -- which is every real client user. The ticket and its resolution stay
  -- useful after the person who filed it is gone. The INSERT policy still requires
  -- `created_by = auth.uid()`, so a ticket can never be *created* without an author.
  created_by uuid references public.profiles (id) on delete set null,
  error_text text not null,
  user_comment text,
  status public.ticket_status not null default 'todo',
  resolution text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Both directions, explicitly. A resolved ticket holding no resolution is an answered ticket
  -- with an empty screen; an unresolved ticket carrying a stale resolution is the same failure
  -- mirrored, and the original one-directional check allowed it. Two branches rather than a
  -- biconditional because a biconditional over the pair still lets an unresolved ticket carry
  -- exactly one of resolution / resolved_at.
  --
  -- resolved_by is required to be NULL on the unresolved branch but is NOT required on the
  -- resolved branch: ON DELETE SET NULL (see created_by / resolved_by above) fires an UPDATE
  -- on this row, which re-checks this constraint. Demanding resolved_by here would make
  -- erasing a staff account fail on the CHECK instead of the foreign key -- the same problem
  -- one layer down. A resolution stays valid after we stop knowing who wrote it.
  constraint tickets_resolution_matches_status check (
    (
      status = 'resolved'
      and resolution is not null
      and resolved_at is not null
    )
    or (
      status <> 'resolved'
      and resolution is null
      and resolved_at is null
      and resolved_by is null
    )
  )
);

comment on table public.tickets is
  'Support tickets. Always owned by a company of kind = client: the internal and unassigned companies are rejected by enforce_ticket_company_kind().';

comment on column public.tickets.user_comment is
  'The client''s own note on top of the pasted error, and later the "this did not help" escalation text (FR-011). No screen writes it yet.';

-- The client dashboard filters by company, optionally narrowed by status, and the composite
-- covers the company_id-only lookup on its leading column too. It deliberately does NOT serve
-- the staff queue ("every todo ticket across all companies"): status is the trailing column,
-- so a status-only predicate cannot use this index. That screen is S-02's, and it will want
-- its own partial index such as `on public.tickets (status) where status = 'todo'`.
create index tickets_company_id_status_idx on public.tickets (company_id, status);

-- "my tickets" for a single client user, and an unindexed foreign key would scan the table.
create index tickets_created_by_idx on public.tickets (created_by);

-- Same rule: resolved_by is ON DELETE SET NULL, so erasing a staff account rewrites every
-- ticket that account resolved, and without this that is a sequential scan plus row locks.
create index tickets_resolved_by_idx on public.tickets (resolved_by);

create table public.knowledge_base_entries (
  id uuid primary key default gen_random_uuid(),
  source public.kb_source not null,
  error_text text not null,
  cause text,
  steps text,
  embedding extensions.vector(1536),
  -- Provenance is cleared rather than cascaded: an entry distilled from one company's ticket
  -- stays useful to everyone else after that ticket or that company goes away.
  source_ticket_id uuid references public.tickets (id) on delete set null,
  source_company_id uuid references public.companies (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.knowledge_base_entries is
  'The shared knowledge base, staff-only at the table level. Client users never read this table; they read public.knowledge_base_public, which projects away the provenance and the embedding.';

comment on column public.knowledge_base_entries.embedding is
  '1536 dimensions: matches OpenAI text-embedding-3-small and stays under pgvector''s 2000-dimension ceiling for HNSW/IVFFlat indexes. Left empty by this migration -- populating it is F-02/S-01.';

comment on column public.knowledge_base_entries.source_company_id is
  'Which client the source ticket belonged to. Readable by service_staff only: exposing it through the shared view would tell every client who else is hitting which error.';

-- Cosine distance, because the embeddings this column will hold are normalized and the
-- matching step compares direction, not magnitude. HNSW rather than IVFFlat so the index is
-- usable while the table is still nearly empty -- IVFFlat needs representative rows at build
-- time, and this table starts with none.
create index knowledge_base_entries_embedding_idx
  on public.knowledge_base_entries
  using hnsw (embedding extensions.vector_cosine_ops);

-- Both provenance columns are ON DELETE SET NULL, so deleting one ticket or one company
-- rewrites every knowledge base row pointing at it. This is the table the product expects to
-- grow largest, which makes an unindexed foreign key here the most expensive one in the schema.
create index knowledge_base_entries_source_ticket_id_idx
  on public.knowledge_base_entries (source_ticket_id);

create index knowledge_base_entries_source_company_id_idx
  on public.knowledge_base_entries (source_company_id);

-- ---------------------------------------------------------------------------
-- 4. Invariants and timestamp maintenance
-- ---------------------------------------------------------------------------

-- The INSERT policy below already holds a client user to its own client company, but a policy
-- only constrains the authenticated role. The seed, a migration, Studio, service_role and any
-- future endpoint built on a service_role client all bypass RLS, and a ticket attached to the
-- internal or the sentinel company would be real data visible to nobody -- or, if a later
-- policy ever dropped the company-kind test, visible to every unassigned account at once.
-- This makes "tickets belong to clients" a property of the table rather than of the policies.
create function public.enforce_ticket_company_kind() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  target_kind public.company_kind;
begin
  select kind into target_kind
  from public.companies
  where id = new.company_id;

  -- Unreachable while company_id is NOT NULL and FK'd and companies.kind is NOT NULL, but
  -- the check below would then reject the row for the wrong reason and with a message naming
  -- the wrong problem. Refuse the impossible state on its own terms instead.
  if target_kind is null then
    raise exception 'Company % has no kind; cannot validate ticket', new.company_id;
  end if;

  if target_kind is distinct from 'client' then
    raise exception 'A ticket must belong to a client company (company % has kind %)',
      new.company_id, target_kind;
  end if;

  return new;
end;
$$;

-- No WHEN clause here, unlike the immutability triggers in migration 1: this invariant has to
-- hold on every write, and ticket UPDATEs are rare (a staff member recording a resolution),
-- so there is no hot path to keep the function out of.
create trigger enforce_ticket_company_kind
  before insert or update on public.tickets
  for each row
  execute function public.enforce_ticket_company_kind();

-- Both tables declare updated_at and nothing advances it on its own. set_updated_at() from
-- migration 1 is the project's one BEFORE UPDATE timestamp trigger; it is reused rather than
-- duplicated so the behaviour cannot drift between tables.
create trigger set_tickets_updated_at
  before update on public.tickets
  for each row
  execute function public.set_updated_at();

create trigger set_knowledge_base_entries_updated_at
  before update on public.knowledge_base_entries
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------
-- Supabase's default privileges already hand the authenticated role table access here, so RLS
-- is the only thing standing between one client and another's rows -- the policies exist
-- before any data does. Every helper call is wrapped in a scalar subquery for the reason
-- spelled out in migration 1, section 7.

alter table public.tickets enable row level security;
alter table public.knowledge_base_entries enable row level security;

-- FR-008 (staff see every company's tickets) and FR-007 (a client sees only its own). The
-- company-kind test is named explicitly rather than left implicit: relying on the sentinel
-- company simply holding no rows would turn any stray row carrying its id into a shared inbox
-- for every not-yet-assigned account.
create policy "tickets are selectable by staff and by their own company"
  on public.tickets
  for select
  to authenticated
  using (
    (select public.is_service_staff())
    or (
      (select public.current_company_kind()) = 'client'
      and company_id = (select public.current_company_id())
    )
  );

-- A client user files tickets for its own company and under its own name: created_by is
-- pinned to the caller so nobody can file on a colleague's behalf. Staff get no INSERT path
-- at all -- a ticket always originates with the client.
create policy "tickets are insertable by client users for their own company"
  on public.tickets
  for insert
  to authenticated
  with check (
    company_id = (select public.current_company_id())
    and (select public.current_company_kind()) = 'client'
    and created_by = (select auth.uid())
  );

-- Recording a resolution is a staff action (FR-005/FR-006). There is deliberately no DELETE
-- policy on either table: a ticket is the record that the exchange happened.
create policy "tickets are updatable by staff"
  on public.tickets
  for update
  to authenticated
  using ((select public.is_service_staff()))
  with check ((select public.is_service_staff()));

-- The base table is staff-only in all three directions. Clients reach the safe projection
-- through public.knowledge_base_public (section 6), never through this table.
create policy "knowledge base entries are selectable by staff"
  on public.knowledge_base_entries
  for select
  to authenticated
  using ((select public.is_service_staff()));

create policy "knowledge base entries are insertable by staff"
  on public.knowledge_base_entries
  for insert
  to authenticated
  with check ((select public.is_service_staff()));

create policy "knowledge base entries are updatable by staff"
  on public.knowledge_base_entries
  for update
  to authenticated
  using ((select public.is_service_staff()))
  with check ((select public.is_service_staff()));

-- ---------------------------------------------------------------------------
-- 6. The client-facing knowledge base
-- ---------------------------------------------------------------------------
-- RLS filters rows, and Supabase gives every logged-in user the same `authenticated` role, so
-- no GRANT can tell a client from a staff member column by column. The split is therefore by
-- surface: the table above is staff-only, and this view projects the matchable text and the
-- fix while dropping user-facing provenance, the embedding and the source columns.
--
-- The view is deliberately NOT security_invoker. Definer rights are the entire mechanism:
-- running as the owner is what lets it read past the staff-only policies on the base table.
-- Adding `with (security_invoker = true)` would not raise an error -- it would quietly return
-- zero rows to every client and make the shared knowledge base look empty.
--
-- Because it bypasses RLS it cannot borrow the base table's authorization, so it carries its
-- own in the body. An account still sitting in the sentinel company matches neither branch and
-- reads an empty knowledge base rather than all of it.
create view public.knowledge_base_public as
select
  id,
  source,
  error_text,
  cause,
  steps
from public.knowledge_base_entries
where (select public.current_company_kind()) = 'client'
   or (select public.is_service_staff());

comment on view public.knowledge_base_public is
  'Client-readable projection of public.knowledge_base_entries: no provenance, no embedding, no user comment. Definer rights are intentional -- see the migration for why security_invoker must stay off. Supabase''s database linter flags this as security_definer_view; that warning is expected and accepted here, and the write verbs are revoked in section 7 so the definer rights buy reads only.';

-- Pinned rather than inherited: a definer view runs with its owner's rights, so leaving the
-- owner to be whoever happened to apply the migration would make the bypass depend on that
-- role. postgres owns the base table, and a table's owner is exempt from its own RLS.
alter view public.knowledge_base_public owner to postgres;

-- ---------------------------------------------------------------------------
-- 7. Privilege hardening
-- ---------------------------------------------------------------------------
-- Same reasoning as migration 1, section 8: Postgres grants EXECUTE to PUBLIC on every new
-- function and Supabase's default privileges grant table access to anon and authenticated, so
-- both surfaces are narrowed here instead of being left at their defaults.

-- Invoked by the trigger, never by a client.
revoke execute on function public.enforce_ticket_company_kind() from public, anon, authenticated;

-- The INSERT policy pins company_id, created_by and the company kind, but a policy authorizes
-- rows, not columns -- migration 1, section 8 makes the same point about profiles. Supabase's
-- default privileges hand authenticated INSERT on all eleven columns, so without the grant
-- below a client could file a ticket that is already `resolved`, carrying a resolution it
-- wrote itself, with resolved_by pointing at a real service_staff profile and a backdated
-- created_at. created_by is pinned by the policy; resolved_by was pinned by nothing.
--
-- Column privileges are checked before RLS and before triggers, so this makes "a client files
-- an error, staff answers it" a property of the table rather than of every future endpoint
-- remembering to omit the columns.
revoke insert on public.tickets from authenticated;
grant insert (company_id, created_by, error_text, user_comment) on public.tickets to authenticated;

-- Same reasoning on the write side. The UPDATE policy authorizes staff as a row-level fact,
-- which left a staff session able to rewrite error_text -- the client's original evidence --
-- and to move a ticket's company_id to a different client company. The kind trigger waves that
-- through, because the target is still of kind `client`, so the tenant boundary the rest of
-- this file defends was crossable by the one role that can reach every tenant's rows.
--
-- Recording a resolution touches exactly these four columns. updated_at is deliberately NOT
-- granted: it is maintained by the BEFORE UPDATE trigger writing NEW, which is not
-- column-privilege checked -- the same carve-out migration 1 documents for profiles.
revoke update on public.tickets from authenticated;
grant update (status, resolution, resolved_by, resolved_at) on public.tickets to authenticated;

-- anon has no policies on either table and so already reads nothing, but the grant is what a
-- future policy would silently widen. Neither table is part of the anonymous surface.
revoke all on public.knowledge_base_entries from anon;
revoke all on public.tickets from anon;

-- TRUNCATE bypasses RLS, so while authenticated holds it any statement-level path would empty
-- the shared knowledge base or every tenant's tickets regardless of the policies above -- the
-- same reasoning as migration 1, section 8. TRIGGER and REFERENCES go with it: nothing on the
-- client side needs either.
revoke truncate, references, trigger on public.tickets, public.knowledge_base_entries from authenticated;

-- The view runs with its owner's rights, so a grant here is not filtered by RLS afterwards --
-- it is the whole table minus the columns left out of the projection. Access starts at nothing
-- and is handed back to logged-in users only; the view's own WHERE clause then decides which
-- of them see rows.
--
-- `authenticated` has to be named in the revoke, not just public and anon. This view is a
-- single-table projection of plain column references, which makes it auto-updatable, and
-- definer rights mean a write through it executes as the owner -- past the base table's
-- staff-only RLS. Supabase's default privileges hand `authenticated` ALL, so without the
-- revoke below any logged-in account, including one still sitting in the sentinel company,
-- could INSERT, UPDATE and DELETE the shared knowledge base over PostgREST. The WHERE clause
-- above does not help: it has no WITH CHECK OPTION, so it only ever runs on SELECT.
revoke all on public.knowledge_base_public from public, anon, authenticated;
grant select on public.knowledge_base_public to authenticated;
