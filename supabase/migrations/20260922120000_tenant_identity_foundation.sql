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

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  role public.user_role not null default 'client_user',
  email text not null,
  full_name text,
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
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

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

create trigger enforce_profile_role_immutable
  before update on public.profiles
  for each row
  execute function public.enforce_profile_role_immutable();

-- ---------------------------------------------------------------------------
-- 7. Row level security
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.profiles enable row level security;

-- companies: staff see every tenant; a client user sees only its own.
-- No write policies at all: companies are created by migration, seed or Studio.
create policy "companies are selectable by staff and by their own members"
  on public.companies
  for select
  to authenticated
  using (public.is_service_staff() or id = public.current_company_id());

-- profiles: you can always read yourself; staff read everyone.
create policy "profiles are selectable by their owner and by staff"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_service_staff());

-- Only staff may update a profile, and even then the role column is frozen by
-- enforce_profile_role_immutable(); the writable field is the company assignment.
create policy "profiles are updatable by staff"
  on public.profiles
  for update
  to authenticated
  using (public.is_service_staff())
  with check (public.is_service_staff());

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
