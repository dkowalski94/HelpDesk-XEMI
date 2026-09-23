-- Migration: tenant identity foundation
-- Purpose:  Establish companies and profiles as the single source of truth for
--           "which company and which role is this request", so every policy written
--           later resolves tenancy through one code path instead of re-deriving it.
-- Affected: new enums public.user_role / public.company_kind,
--           new tables public.companies / public.profiles,
--           new trigger on auth.users, new SECURITY DEFINER helpers in public.
-- Notes:    Every function below is SECURITY DEFINER with a pinned empty search_path,
--           so all references inside them are fully schema-qualified. Postgres (and
--           Supabase's default privileges) hand out EXECUTE far too widely, so the
--           closing section revokes and re-grants deliberately.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('client_user', 'service_staff');

create type public.company_kind as enum ('client', 'internal', 'unassigned');

comment on type public.company_kind is
  'client = a customer organisation; internal = the XEMI service team; unassigned = the sentinel company every new account lands in until staff assigns it.';

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.company_kind not null default 'client',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is
  'Tenants. Exactly one internal company and exactly one unassigned company exist; everything else is a client.';

-- The internal and unassigned companies are systemic singletons: policies and the
-- new-user trigger resolve them by kind, so a second row of either kind would make
-- "the unassigned company" ambiguous.
create unique index companies_systemic_kind_key
  on public.companies (kind)
  where kind in ('internal', 'unassigned');

-- These two rows are schema invariants, not fixtures: profiles.company_id is NOT NULL
-- and handle_new_user() resolves the unassigned company by kind, so a database built
-- by migrations alone would reject every registration without them. They live here
-- rather than in seed.sql because the seed runs only on `db reset` / `supabase start`
-- and is never applied by `supabase db push`.
insert into public.companies (id, name, kind)
values
  ('00000000-0000-0000-0000-00000000c001', 'XEMI Service', 'internal'),
  ('00000000-0000-0000-0000-00000000c002', 'Nieprzypisani', 'unassigned');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  role public.user_role not null default 'client_user',
  email text not null,
  -- full_name arrives from raw_user_meta_data, which the caller controls completely at
  -- signup. It is only ever displayed and Astro escapes by default, so the bound is
  -- about storage rather than injection: without it an unauthenticated request can put
  -- an arbitrarily large string in this table.
  full_name text check (full_name is null or char_length(full_name) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth.users row, created by the on_auth_user_created trigger. company_id is never null: unassigned accounts point at the sentinel company.';

comment on column public.profiles.email is
  'Denormalized from auth.users: the authenticated role cannot read the auth schema, and the admin screen must show who it is assigning.';

-- profiles.company_id is the join the admin screen ("who is waiting?") and every
-- tenancy lookup travels on; an unindexed foreign key would scan the table.
create index profiles_company_id_idx on public.profiles (company_id);

-- ---------------------------------------------------------------------------
-- 3. Tenancy helpers (the contract every later policy calls)
-- ---------------------------------------------------------------------------

create function public.current_company_id() returns uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

comment on function public.current_company_id() is
  'The caller''s company, resolved through profiles. SECURITY DEFINER so it also works from inside policies on profiles itself.';

create function public.current_company_kind() returns public.company_kind
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select c.kind
  from public.profiles p
  join public.companies c on c.id = p.company_id
  where p.id = auth.uid()
$$;

create function public.is_service_staff() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'service_staff'
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Profile lifecycle: every account gets exactly one profile
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  unassigned_company_id uuid;
begin
  select id into unassigned_company_id
  from public.companies
  where kind = 'unassigned';

  if unassigned_company_id is null then
    raise exception 'No company with kind = ''unassigned'' exists; cannot create a profile for %', new.id;
  end if;

  insert into public.profiles (id, company_id, role, email, full_name)
  values (
    new.id,
    unassigned_company_id,
    'client_user',
    new.email,
    -- Trimmed rather than rejected: this runs inside the auth.users INSERT, so letting
    -- the column's CHECK fire here would turn an oversized name into a failed signup --
    -- and GoTrue echoes the raw constraint error, row contents included, back to the
    -- caller. The CHECK stays as a backstop for every other write path.
    left(nullif(new.raw_user_meta_data ->> 'full_name', ''), 200)
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- profiles.email is a denormalized copy of auth.users.email, kept because the
-- authenticated role cannot read the auth schema and the admin screen has to show who
-- it is assigning. The insert above is the only thing that ever wrote it, so a user
-- changing their email through Supabase Auth would leave the admin screen showing the
-- old address -- and since authenticated holds UPDATE on company_id alone (section 8),
-- nothing in the application could correct it either. Mirror the change instead.
create function public.sync_profile_email()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;

  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- 5. Cross-table invariant: role and company kind must agree
-- ---------------------------------------------------------------------------

create function public.enforce_profile_company_kind() returns trigger
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

  -- Unreachable while company_id is NOT NULL and FK'd and companies.kind is NOT NULL,
  -- but the two checks below disagree about NULL: `is distinct from` fails closed while
  -- `not in (...)` evaluates to NULL and raises nothing. Rather than make one branch
  -- coerce a sentinel, refuse the impossible state outright so neither branch ever has
  -- to have an opinion about it.
  if target_kind is null then
    raise exception 'Company % has no kind; cannot validate profile %',
      new.company_id, new.id;
  end if;

  if new.role = 'service_staff' and target_kind is distinct from 'internal' then
    raise exception 'A service_staff profile must belong to an internal company (company % has kind %)',
      new.company_id, target_kind;
  end if;

  if new.role = 'client_user' and target_kind not in ('client', 'unassigned') then
    raise exception 'A client_user profile must belong to a client or unassigned company (company % has kind %)',
      new.company_id, target_kind;
  end if;

  return null;
end;
$$;

create constraint trigger enforce_profile_company_kind
  after insert or update on public.profiles
  deferrable initially immediate
  for each row
  execute function public.enforce_profile_company_kind();

-- Both tables declare updated_at but nothing advances it, so without this it stays frozen
-- at insert time. It is maintained here rather than by the caller because authenticated
-- holds UPDATE on company_id alone (section 8) -- a BEFORE trigger writing NEW is not
-- column-privilege checked, so the timestamp stays accurate without widening that grant.
create function public.set_updated_at()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_companies_updated_at
  before update on public.companies
  for each row
  execute function public.set_updated_at();

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- The invariant above spans two tables but the trigger only watches one of them.
-- Flipping a company's kind -- `update public.companies set kind = 'client'` -- would
-- strand every service_staff profile inside a client company without either side
-- objecting, and current_company_kind() would then report 'client' for staff, which is
-- the predicate later phases key their policies on. RLS stops the authenticated role
-- here (companies has no write policies), but Studio, service_role and migrations are
-- exactly the paths this design uses to manage companies, so the hole is on the live
-- path. A company's kind is decided at creation and has no legitimate reason to change,
-- so the cheapest closure is to forbid the change outright; a migration that genuinely
-- needs to re-kind a company drops this trigger, does it, and re-validates by hand.
create function public.enforce_company_kind_immutable()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'companies.kind is immutable (company % is %, cannot become %)',
      old.id, old.kind, new.kind;
  end if;

  return new;
end;
$$;

create trigger enforce_company_kind_immutable
  before update on public.companies
  for each row
  when (old.kind is distinct from new.kind)
  execute function public.enforce_company_kind_immutable();

-- ---------------------------------------------------------------------------
-- 6. Role immutability: granting service_staff is an out-of-band operation
-- ---------------------------------------------------------------------------

create function public.enforce_profile_role_immutable() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  -- PostgREST issues `set local role authenticated` (or anon) per request, so the
  -- role GUC still names the caller even though SECURITY DEFINER has switched
  -- current_user to the function owner. 'none' means nobody assumed a role: a
  -- migration, the seed, or a direct owner session.
  session_role text := coalesce(current_setting('role', true), 'none');
begin
  if new.role is distinct from old.role
     and session_role not in ('none', 'postgres', 'service_role', 'supabase_admin')
  then
    raise exception 'profiles.role is immutable through the application; grant roles out of band (migration, seed, or service_role)';
  end if;

  return new;
end;
$$;

-- The WHEN clause keeps the function out of the hot path: every company assignment is a
-- profiles UPDATE, and only the rare role change needs checking.
--
-- Note what this trigger does and does not cover. 'none' in the allowlist above means
-- "nobody ran SET ROLE" -- it identifies the absence of a role switch, not a privileged
-- caller -- and service_role is allowlisted deliberately. So an endpoint built on a
-- service_role client would pass this check, and service_role also bypasses RLS and the
-- column grants in section 8. The admin assign-company endpoint must therefore run on
-- the user's own authenticated session, never on a service_role client.
create trigger enforce_profile_role_immutable
  before update on public.profiles
  for each row
  when (old.role is distinct from new.role)
  execute function public.enforce_profile_role_immutable();

-- ---------------------------------------------------------------------------
-- 7. Row level security
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.profiles enable row level security;

-- Every helper call below is wrapped in a scalar subquery. STABLE alone does not get
-- these hoisted out of the per-row qualifier -- Postgres only caches the result as an
-- InitPlan when the call is written as (select ...). Bare calls would re-run a SELECT
-- against public.profiles once per candidate row. Later phases copy this call style.

-- companies: staff see every tenant; a client user sees only its own.
-- No write policies at all: companies are created by migration, seed or Studio.
create policy "companies are selectable by staff and by their own members"
  on public.companies
  for select
  to authenticated
  using ((select public.is_service_staff()) or id = (select public.current_company_id()));

-- profiles: you can always read yourself; staff read everyone.
create policy "profiles are selectable by their owner and by staff"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_service_staff()));

-- Only staff may update a profile, and even then the role column is frozen by
-- enforce_profile_role_immutable(); the writable field is the company assignment.
create policy "profiles are updatable by staff"
  on public.profiles
  for update
  to authenticated
  using ((select public.is_service_staff()))
  with check ((select public.is_service_staff()));

-- ---------------------------------------------------------------------------
-- 8. Privilege hardening for the elevated surface
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase's default
-- privileges additionally grant it to anon and authenticated. For SECURITY DEFINER
-- functions that is a privilege-escalation primitive handed to anyone who can reach
-- the database, so each one is revoked first and granted back only where needed.

revoke execute on function public.current_company_id() from public, anon;
revoke execute on function public.current_company_kind() from public, anon;
revoke execute on function public.is_service_staff() from public, anon;

grant execute on function public.current_company_id() to authenticated;
grant execute on function public.current_company_kind() to authenticated;
grant execute on function public.is_service_staff() to authenticated;

-- Trigger functions are invoked by the triggers themselves, never by a client.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_profile_company_kind() from public, anon, authenticated;
revoke execute on function public.enforce_profile_role_immutable() from public, anon, authenticated;
revoke execute on function public.enforce_company_kind_immutable() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.sync_profile_email() from public, anon, authenticated;

-- The update policy above authorizes rows, not columns: Supabase's default privileges
-- hand authenticated UPDATE on every column of public.profiles, so a staff session
-- could rewrite id, email or created_at as well as the company assignment. Column
-- privileges are checked before RLS and before triggers, so narrowing the grant to
-- company_id is what actually makes role immutability structural rather than a
-- property of enforce_profile_role_immutable() holding.
--
-- updated_at is deliberately NOT granted: it is maintained by a BEFORE UPDATE trigger
-- writing NEW.updated_at, which is not column-privilege checked.
revoke update on public.profiles from authenticated;
grant update (company_id) on public.profiles to authenticated;

-- The same defaults also hand out TRUNCATE, TRIGGER and REFERENCES, and TRUNCATE is not
-- subject to RLS at all: a statement-level path that reached it would empty the table no
-- matter what the policies above say. No client path issues these statements, so the grants
-- buy nothing and are withdrawn. anon has no policy on either table and loses everything --
-- the same treatment migration 2 gives its own tables.
revoke truncate, references, trigger on public.companies, public.profiles from authenticated;
revoke all on public.companies, public.profiles from anon;
