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
-- The schema depends on both of these existing: handle_new_user() resolves the
-- unassigned company by kind, and a service_staff profile is only valid inside the
-- internal one. Client companies and demo data arrive in a later phase.

insert into public.companies (id, name, kind)
values
  ('00000000-0000-0000-0000-00000000c001', 'XEMI Service', 'internal'),
  ('00000000-0000-0000-0000-00000000c002', 'Nieprzypisani', 'unassigned')
on conflict (id) do nothing;

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
