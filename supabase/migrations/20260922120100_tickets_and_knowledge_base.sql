-- Migration: tickets and shared knowledge base
-- Purpose:  Add the two tables the product actually operates on -- support tickets and the
--           shared knowledge base -- with per-company isolation enforced at the row level
--           rather than in the UI, and with the knowledge base split into a staff-only base
--           table and a client-readable view so "one shared knowledge base" and "no
--           cross-client leakage" can both hold at once.
-- Affected: new extension vector (in schema extensions), new enums public.ticket_status /
--           public.kb_source, new tables public.tickets / public.knowledge_base_entries,
--           new view public.knowledge_base_public, new SECURITY DEFINER trigger function
--           public.enforce_ticket_company_kind().
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

-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------

create type public.ticket_status as enum ('todo', 'resolved');

create type public.kb_source as enum ('ticket', 'erp_doc');

comment on type public.kb_source is
  'Where a knowledge base entry came from: ticket = distilled from a resolved support ticket; erp_doc = ingested from the ERP documentation.';

-- ---------------------------------------------------------------------------
-- 3. Tables and indexes
-- ---------------------------------------------------------------------------

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  created_by uuid not null references public.profiles (id),
  error_text text not null,
  user_comment text,
  status public.ticket_status not null default 'todo',
  resolution text,
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A resolved ticket with no resolution is what the client would see as an answered ticket
  -- holding nothing: the status flips and the screen stays empty. Keeping the three facts
  -- consistent in the table means no endpoint has to remember to.
  constraint tickets_resolved_requires_resolution check (
    status <> 'resolved'
    or (resolution is not null and resolved_by is not null)
  )
);

comment on table public.tickets is
  'Support tickets. Always owned by a company of kind = client: the internal and unassigned companies are rejected by enforce_ticket_company_kind().';

comment on column public.tickets.user_comment is
  'The client''s own note on top of the pasted error, and later the "this did not help" escalation text (FR-011). No screen writes it yet.';

-- The client dashboard filters by company, the staff dashboard by status, and both travel on
-- company_id; the composite covers the leading-column lookup too.
create index tickets_company_id_status_idx on public.tickets (company_id, status);

-- "my tickets" for a single client user, and an unindexed foreign key would scan the table.
create index tickets_created_by_idx on public.tickets (created_by);

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
  'Client-readable projection of public.knowledge_base_entries: no provenance, no embedding, no user comment. Definer rights are intentional -- see the migration for why security_invoker must stay off.';

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

-- anon has no policies on the knowledge base and so already reads nothing, but the grant is
-- what a future policy would silently widen. This table is not part of the anonymous surface.
revoke all on public.knowledge_base_entries from anon;

-- The view runs with its owner's rights, so a grant here is not filtered by RLS afterwards --
-- it is the whole table minus the columns left out of the projection. Access starts at nothing
-- and is handed back to logged-in users only; the view's own WHERE clause then decides which
-- of them see rows.
revoke all on public.knowledge_base_public from public, anon;
grant select on public.knowledge_base_public to authenticated;
