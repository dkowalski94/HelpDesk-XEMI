-- Seed for local development and CI only (`supabase db reset` / `supabase start`).
-- It is never applied to the hosted project.
--
-- Ordering is load-bearing: inserting into auth.users fires public.handle_new_user(),
-- which creates the matching public.profiles row in the unassigned company. Profiles
-- are therefore UPDATEd below, never INSERTed -- a direct insert would collide with
-- the trigger's row on the primary key.

-- pgcrypto lives in the extensions schema on a Supabase database; naming both
-- schemas here keeps crypt()/gen_salt() resolvable wherever it happens to be
-- installed, without hard-coding the answer into every call below.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Systemic companies
-- ---------------------------------------------------------------------------
-- Created by 20260922120000_tenant_identity_foundation.sql, not here. The schema
-- hard-depends on both rows -- handle_new_user() resolves the unassigned company by
-- kind, and a service_staff profile is only valid inside the internal one -- and this
-- seed never reaches a database built by `supabase db push`. Their ids are fixed in
-- that migration and referenced below. Client companies and demo data follow the
-- staff account, at the end of this file.

-- ---------------------------------------------------------------------------
-- First service_staff account
-- ---------------------------------------------------------------------------
-- Without it nobody can ever reach the admin screen, since the application never
-- grants the service_staff role.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000a1',
  'authenticated',
  'authenticated',
  'serwis@xemi.local',
  crypt('Xemi-Service-Passw0rd!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Serwis XEMI"}'::jsonb,
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- GoTrue resolves a password sign-in through auth.identities, so the email identity
-- has to exist alongside the user row.
insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1',
  jsonb_build_object(
    'sub', '00000000-0000-0000-0000-0000000000a1',
    'email', 'serwis@xemi.local',
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
)
on conflict do nothing;

-- Promote the profile the trigger just created. This is the out-of-band path the
-- role-immutability trigger permits -- the seed runs as the database owner, not as
-- authenticated -- and it is the only place in the repository where a role is granted.
update public.profiles
set
  company_id = '00000000-0000-0000-0000-00000000c001',
  role = 'service_staff',
  full_name = 'Serwis XEMI',
  updated_at = now()
where id = '00000000-0000-0000-0000-0000000000a1';

-- ---------------------------------------------------------------------------
-- Demo data: two client companies, one user each, and one waiting account
-- ---------------------------------------------------------------------------
-- What the isolation checks compare against: scripts/smoke.mjs over HTTP and
-- supabase/tests/rls.sql at the policy level both address these rows by the fixed
-- ids below, so changing an id or a password here means changing it there too.
--
--   persona                      email                       password
--   Klient Alfa client user      alfa@klient-alfa.local      Klient-Alfa-Passw0rd!
--   Klient Beta client user      beta@klient-beta.local      Klient-Beta-Passw0rd!
--   unassigned (waiting) user    oczekujacy@xemi.local       Oczekujacy-Passw0rd!
--
-- The waiting account is never assigned by the smoke test (it registers its own
-- throwaway account for that), so `/admin/users` always has one row to show after
-- `supabase db reset`.

insert into public.companies (id, name, kind)
values
  ('00000000-0000-0000-0000-00000000c101', 'Klient Alfa', 'client'),
  ('00000000-0000-0000-0000-00000000c102', 'Klient Beta', 'client')
on conflict (id) do nothing;

-- Auth users first: each insert fires handle_new_user(), which creates the profile in
-- the unassigned company. The profiles are moved to their companies further down.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  demo.id,
  'authenticated',
  'authenticated',
  demo.email,
  crypt(demo.password, gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', demo.full_name),
  '',
  '',
  '',
  ''
from (
  values
    ('00000000-0000-0000-0000-0000000000a2'::uuid, 'alfa@klient-alfa.local', 'Klient-Alfa-Passw0rd!', 'Anna Alfa'),
    ('00000000-0000-0000-0000-0000000000a3'::uuid, 'beta@klient-beta.local', 'Klient-Beta-Passw0rd!', 'Bartosz Beta'),
    ('00000000-0000-0000-0000-0000000000a4'::uuid, 'oczekujacy@xemi.local', 'Oczekujacy-Passw0rd!', 'Olga Oczekujaca')
) as demo (id, email, password, full_name)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id::text,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a3',
  '00000000-0000-0000-0000-0000000000a4'
)
on conflict do nothing;

-- Company assignment only; the role stays the trigger's client_user. The waiting
-- account (…a4) is deliberately left where the trigger put it.
update public.profiles
set company_id = '00000000-0000-0000-0000-00000000c101'
where id = '00000000-0000-0000-0000-0000000000a2';

update public.profiles
set company_id = '00000000-0000-0000-0000-00000000c102'
where id = '00000000-0000-0000-0000-0000000000a3';

-- One open ticket per client company. The error texts name their company so a leak
-- is obvious to a human reading the smoke output, not only to the assertions.
insert into public.tickets (id, company_id, created_by, error_text, status)
values
  (
    '00000000-0000-0000-0000-00000000e101',
    '00000000-0000-0000-0000-00000000c101',
    '00000000-0000-0000-0000-0000000000a2',
    'Klient Alfa: ERR-1042 Nie można zaksięgować dokumentu — okres rozliczeniowy zamknięty.',
    'todo'
  ),
  (
    '00000000-0000-0000-0000-00000000e102',
    '00000000-0000-0000-0000-00000000c102',
    '00000000-0000-0000-0000-0000000000a3',
    'Klient Beta: ERR-2210 Brak uprawnień do modułu Magazyn dla bieżącego operatora.',
    'todo'
  )
on conflict (id) do nothing;

-- Two shared knowledge base entries: one distilled from a ticket, carrying the
-- provenance only staff may read, and one from the ERP documentation without any.
insert into public.knowledge_base_entries (
  id,
  source,
  error_text,
  cause,
  steps,
  source_ticket_id,
  source_company_id
)
values
  (
    '00000000-0000-0000-0000-00000000f101',
    'ticket',
    'ERR-1042 Nie można zaksięgować dokumentu — okres rozliczeniowy zamknięty.',
    'Dokument ma datę w okresie, który został już zamknięty.',
    'Otwórz okres w Księgowość → Okresy albo zmień datę dokumentu na bieżący okres.',
    '00000000-0000-0000-0000-00000000e101',
    '00000000-0000-0000-0000-00000000c101'
  ),
  (
    '00000000-0000-0000-0000-00000000f102',
    'erp_doc',
    'ERR-2210 Brak uprawnień do modułu.',
    'Operator nie ma przypisanej roli z dostępem do modułu.',
    'Administrator nadaje rolę w Konfiguracja → Operatorzy → Uprawnienia.',
    null,
    null
  )
on conflict (id) do nothing;
