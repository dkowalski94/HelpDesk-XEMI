-- Migration: ERP document ingestion
-- Purpose:  Give every knowledge base entry ingested from the ERP documentation a document to
--           belong to, so that re-ingesting an edited PDF replaces that document's entries
--           instead of duplicating them, and make that replacement a single atomic database
--           operation reachable by service staff only. The offline ingestion script (F-02) signs
--           in as the staff member and writes exclusively through the three functions below.
-- Affected: new tables public.erp_documents (registry) / public.erp_document_upload_chunks
--           (staging), new column + check constraint + index on public.knowledge_base_entries,
--           new SECURITY DEFINER functions public.stage_erp_document_chunks(),
--           public.publish_erp_document(), public.remove_erp_document(), one set_updated_at()
--           trigger, and a closing section that revokes and re-grants privileges on everything
--           created here, narrowing authenticated's INSERT/UPDATE on
--           public.knowledge_base_entries to column-scoped grants without erp_document_id.
-- Notes:    Reuses the contract of migrations 1-3: staff is resolved only through
--           is_service_staff(), timestamps through set_updated_at(), every helper call in a
--           policy is wrapped in a scalar subquery, and every function is SECURITY DEFINER with a
--           pinned empty search_path, so every reference inside is schema-qualified.
--           Denials raise SQLSTATE 42501 (insufficient_privilege); validation failures raise
--           plain P0001 with a message the script can show. supabase/tests/rls.sql pins the
--           resulting grants and asserts the denied writes.
--           Expected Supabase linter findings, all deliberate:
--             * rls_enabled_no_policy (INFO) on erp_document_upload_chunks -- the staging table
--               is reachable only through the functions below; no role gets a policy or a grant.
--             * authenticated_security_definer_function_executable on the three functions --
--               definer rights are the whole mechanism (they are the only write path to tables
--               authenticated holds no write grant on), and each function checks
--               is_service_staff() itself before touching anything.

-- ---------------------------------------------------------------------------
-- 1. Pre-check: no erp_doc entry may exist without a document
-- ---------------------------------------------------------------------------

-- Section 4 adds a check that every erp_doc entry points at a document. `supabase db reset` can
-- never reproduce a violation (the migrations run before the seed), but a hosted database might
-- hold erp_doc rows inserted by hand before document tracking existed. Adding the constraint
-- would then fail with a bare check violation naming no row; fail with the diagnosis instead.
do $$
declare
  orphan_count bigint;
begin
  select count(*) into orphan_count
  from public.knowledge_base_entries
  where source = 'erp_doc';

  if orphan_count > 0 then
    raise exception
      'public.knowledge_base_entries holds % row(s) with source = ''erp_doc''. They predate document tracking and cannot be attached to a document. Delete them (delete from public.knowledge_base_entries where source = ''erp_doc'';) -- the ERP documentation is re-ingested by the ingestion script afterwards -- then re-run this migration.',
      orphan_count;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Document registry
-- ---------------------------------------------------------------------------

create table public.erp_documents (
  id uuid primary key default gen_random_uuid(),
  -- The base name as the staff member's file system gave it (never a full path). Identity is
  -- case-insensitive -- see the unique index below.
  file_name text not null,
  -- SHA-256 of the PDF bytes: how the script recognises an unchanged file and skips it.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  page_count integer not null,
  chunk_count integer not null,
  -- Cleared rather than cascaded, like every other provenance column in this schema: the
  -- document stays loaded after the person who loaded it is gone.
  ingested_by uuid references public.profiles (id) on delete set null,
  ingested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.erp_documents is
  'One row per ingested ERP documentation PDF. Owns its knowledge base entries through knowledge_base_entries.erp_document_id (ON DELETE CASCADE). Written only by publish_erp_document() / remove_erp_document(); staff-only SELECT.';

-- Staff run the script on Windows, where Magazyn.pdf and magazyn.PDF are the same file. A plain
-- unique constraint would let both exist and the replace would miss the old entries.
create unique index erp_documents_file_name_key
  on public.erp_documents (lower(file_name));

-- ingested_by is ON DELETE SET NULL, so erasing a staff account rewrites every document it
-- loaded; an unindexed foreign key would scan the table.
create index erp_documents_ingested_by_idx on public.erp_documents (ingested_by);

create trigger set_erp_documents_updated_at
  before update on public.erp_documents
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Upload staging
-- ---------------------------------------------------------------------------

-- A large PDF yields a few hundred fragments of 1536 floats each -- several MB of JSON, too much
-- for one RPC. The script stages them in batches under a client-generated upload_id and then
-- publishes the whole upload at once, so knowledge_base_entries and the client view never see a
-- partial document. Rows here are transient: publish_erp_document() deletes them.
create table public.erp_document_upload_chunks (
  upload_id uuid not null,
  seq integer not null check (seq >= 0),
  file_name text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  error_text text not null,
  steps text not null,
  embedding extensions.vector(1536) not null,
  -- Cascaded, unlike the provenance columns: an unpublished upload is worthless without the
  -- person who was uploading it.
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (upload_id, seq)
);

comment on table public.erp_document_upload_chunks is
  'Private staging for ERP document uploads. RLS on with no policies and no grants: reachable only through stage_erp_document_chunks() / publish_erp_document().';

create index erp_document_upload_chunks_uploaded_by_idx
  on public.erp_document_upload_chunks (uploaded_by);

-- ---------------------------------------------------------------------------
-- 4. Linking knowledge base entries to their document
-- ---------------------------------------------------------------------------

-- This foreign key cascades while source_ticket_id / source_company_id (migration 2) set null,
-- and the difference is deliberate. Those columns record where an entry came *from*; the entry
-- stays true after its ticket or company is gone. An erp_doc entry is not derived from its
-- document -- it *is* the document's content, one fragment of it. Deleting or replacing the
-- document must take its fragments with it, or a replaced PDF would leave stale text matchable
-- forever.
alter table public.knowledge_base_entries
  add column erp_document_id uuid references public.erp_documents (id) on delete cascade;

comment on column public.knowledge_base_entries.erp_document_id is
  'The ERP document this fragment belongs to. Set exactly when source = ''erp_doc'' (knowledge_base_entries_erp_doc_has_document). Cascades: the entries are the document''s content.';

-- Both directions: an erp_doc entry without a document cannot be replaced or removed by the
-- pipeline, and a ticket entry carrying a document id would be deleted with a document it has
-- nothing to do with.
alter table public.knowledge_base_entries
  add constraint knowledge_base_entries_erp_doc_has_document
  check ((source = 'erp_doc') = (erp_document_id is not null));

-- Every replace and remove deletes by this column through the cascade.
create index knowledge_base_entries_erp_document_id_idx
  on public.knowledge_base_entries (erp_document_id);

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------

alter table public.erp_documents enable row level security;
alter table public.erp_document_upload_chunks enable row level security;

-- The registry is what the script's "is this file unchanged?" check and its listing read.
-- Clients never see it: file names and who loaded what are internal.
create policy "erp documents are selectable by staff"
  on public.erp_documents
  for select
  to authenticated
  using ((select public.is_service_staff()));

-- erp_document_upload_chunks deliberately has no policy for any role: with RLS on and no grant
-- (section 7), only the table owner -- and therefore only the SECURITY DEFINER functions below --
-- can read or write it.

-- ---------------------------------------------------------------------------
-- 6. The write path
-- ---------------------------------------------------------------------------

-- Stages one batch of fragments for an upload. Can be called repeatedly with the same upload_id
-- until every fragment is staged; publish_erp_document() then checks the batch is complete.
create function public.stage_erp_document_chunks(
  p_upload_id uuid,
  p_file_name text,
  p_content_hash text,
  p_chunks jsonb
)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  inserted integer;
begin
  if not public.is_service_staff() then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only service staff may stage ERP document fragments';
  end if;

  if p_upload_id is null then
    raise exception 'upload_id is required';
  end if;

  if p_file_name is null or btrim(p_file_name) = '' then
    raise exception 'file_name is required';
  end if;

  -- Identity is the base name (lower(file_name)); a path would make the same file a second
  -- document. The script sends path.basename().
  if p_file_name ~ '[/\\]' then
    raise exception 'file_name must be a file name without a folder path';
  end if;

  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'content_hash must be 64 lowercase hex characters (SHA-256)';
  end if;

  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'chunks must be a non-empty JSON array';
  end if;

  -- Keeps one RPC body bounded; the script sends ~50 per call.
  if jsonb_array_length(p_chunks) > 200 then
    raise exception 'at most 200 chunks per call (got %)', jsonb_array_length(p_chunks);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_chunks) as c
    where jsonb_typeof(c) <> 'object'
       or c ->> 'seq' is null
       or c ->> 'error_text' is null
       or c ->> 'steps' is null
       or c ->> 'embedding' is null
  ) then
    raise exception 'every chunk must be an object with seq, error_text, steps and embedding';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_chunks) as c
    where btrim(c ->> 'steps') = ''
  ) then
    raise exception 'chunk steps must not be blank';
  end if;

  -- seq must be a non-negative integer that fits the column; otherwise the insert below would
  -- fail with a raw cast (22P02/22003) or CHECK (23514) error instead of a readable one.
  if exists (
    select 1
    from jsonb_array_elements(p_chunks) as c
    where case
            when jsonb_typeof(c -> 'seq') = 'number'
              then (c ->> 'seq')::numeric < 0
                or (c ->> 'seq')::numeric <> trunc((c ->> 'seq')::numeric)
                or (c ->> 'seq')::numeric > 2147483647
            else true
          end
  ) then
    raise exception 'chunk seq must be a non-negative integer';
  end if;

  -- An upload_id belongs to one person uploading one version of one file. Mixing would let
  -- publish assemble a document from someone else's fragments, or from two different files.
  if exists (
    select 1
    from public.erp_document_upload_chunks s
    where s.upload_id = p_upload_id
      and (
        s.uploaded_by is distinct from auth.uid()
        or s.file_name is distinct from p_file_name
        or s.content_hash is distinct from p_content_hash
      )
  ) then
    raise exception 'upload % already holds fragments of a different upload', p_upload_id;
  end if;

  -- pgvector's text input format is a JSON array, so the embedding casts directly. A vector of
  -- the wrong dimension fails the cast (SQLSTATE 22000) and the whole batch with it; a repeated
  -- seq fails the primary key. Both are left to the database rather than re-checked here.
  insert into public.erp_document_upload_chunks (
    upload_id, seq, file_name, content_hash, error_text, steps, embedding, uploaded_by
  )
  select
    p_upload_id,
    (c ->> 'seq')::integer,
    p_file_name,
    p_content_hash,
    c ->> 'error_text',
    c ->> 'steps',
    (c ->> 'embedding')::extensions.vector(1536),
    auth.uid()
  from jsonb_array_elements(p_chunks) as c;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.stage_erp_document_chunks(uuid, text, text, jsonb) is
  'Stages up to 200 fragments of an ERP document upload for the calling service-staff member. Nothing is visible in the knowledge base until publish_erp_document().';

-- Replaces (or first adds) the document an upload holds, atomically: the old registry row and --
-- through the cascade -- its entries go, the new registry row and entries arrive, and the
-- staging rows are cleared, all inside the caller's single statement.
create function public.publish_erp_document(p_upload_id uuid, p_page_count integer)
  returns table (document_id uuid, chunk_count integer)
  language plpgsql
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_file_name text;
  v_content_hash text;
  v_total integer;
  v_owned integer;
  v_min_seq integer;
  v_max_seq integer;
  v_file_names integer;
  v_hashes integer;
  v_document_id uuid;
  v_inserted integer;
begin
  if not public.is_service_staff() then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only service staff may publish ERP documents';
  end if;

  if p_page_count is null or p_page_count < 1 then
    raise exception 'page_count must be a positive integer';
  end if;

  -- Lock the upload first, so two concurrent publishes of the same upload serialize: the second
  -- one wakes up to find the rows gone and fails as incomplete instead of publishing twice.
  perform 1
  from public.erp_document_upload_chunks s
  where s.upload_id = p_upload_id
  for update;

  select
    count(*),
    count(*) filter (where s.uploaded_by = auth.uid()),
    min(s.seq),
    max(s.seq),
    min(s.file_name),
    min(s.content_hash),
    count(distinct s.file_name),
    count(distinct s.content_hash)
  into v_total, v_owned, v_min_seq, v_max_seq, v_file_name, v_content_hash, v_file_names, v_hashes
  from public.erp_document_upload_chunks s
  where s.upload_id = p_upload_id;

  -- (upload_id, seq) is the primary key, so n distinct seq values spanning 0..n-1 is exactly
  -- "no gap". Someone else's upload counts as not the caller's to publish.
  if v_total = 0
     or v_owned <> v_total
     or v_min_seq <> 0
     or v_max_seq <> v_total - 1
  then
    raise exception 'incomplete upload %: expected fragments 0..n-1 staged by the caller', p_upload_id;
  end if;

  -- stage_erp_document_chunks() refuses mixing, but two of its calls racing on a fresh upload_id
  -- could both pass that check; never publish one file's name with another's fragments or hash.
  if v_file_names <> 1 or v_hashes <> 1 then
    raise exception 'upload % mixes fragments of different files', p_upload_id;
  end if;

  -- Two uploads of the same file published at once would otherwise both pass the DELETE and
  -- collide on erp_documents_file_name_key (raw 23505). Serialize them per file name: the
  -- second one then replaces what the first just published.
  perform pg_advisory_xact_lock(hashtext(lower(v_file_name)));

  delete from public.erp_documents d
  where lower(d.file_name) = lower(v_file_name);

  insert into public.erp_documents (file_name, content_hash, page_count, chunk_count, ingested_by)
  values (v_file_name, v_content_hash, p_page_count, v_total, auth.uid())
  returning id into v_document_id;

  insert into public.knowledge_base_entries (source, error_text, cause, steps, embedding, erp_document_id)
  select 'erp_doc', s.error_text, null, s.steps, s.embedding, v_document_id
  from public.erp_document_upload_chunks s
  where s.upload_id = p_upload_id
  order by s.seq;

  get diagnostics v_inserted = row_count;

  -- A stage call committing mid-publish would add rows the count above never saw.
  if v_inserted <> v_total then
    raise exception 'upload % changed while publishing; run it again', p_upload_id;
  end if;

  -- This upload, plus anything anyone abandoned (a crashed or killed run) more than a day ago.
  -- An upload takes minutes, so the day-old cut-off never touches one still in flight.
  delete from public.erp_document_upload_chunks s
  where s.upload_id = p_upload_id
     or s.created_at < now() - interval '24 hours';

  return query select v_document_id, v_inserted;
end;
$$;

comment on function public.publish_erp_document(uuid, integer) is
  'Atomically replaces the ERP document (matched by lower(file_name)) with the staged upload: old registry row and entries removed, new ones inserted, staging cleared. Service staff only.';

create function public.remove_erp_document(p_file_name text)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if not public.is_service_staff() then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only service staff may remove ERP documents';
  end if;

  -- The cascade on knowledge_base_entries.erp_document_id takes the entries with it.
  delete from public.erp_documents d
  where lower(d.file_name) = lower(p_file_name);

  return found;
end;
$$;

comment on function public.remove_erp_document(text) is
  'Removes an ERP document (matched by lower(file_name)) and, through the cascade, its knowledge base entries. Returns whether it existed. Service staff only.';

-- ---------------------------------------------------------------------------
-- 7. Privilege hardening (context/foundation/lessons.md)
-- ---------------------------------------------------------------------------
-- Supabase's default privileges hand anon and authenticated ALL on every new table -- TRUNCATE,
-- which bypasses RLS, included -- and Postgres hands EXECUTE to PUBLIC on every new function.
-- Everything created here starts at nothing and gets back only what a policy or the script uses.

-- The registry: staff read it through the SELECT policy; nobody writes it except the functions,
-- which run as the owner.
revoke all on public.erp_documents from public, anon, authenticated;
grant select on public.erp_documents to authenticated;

-- Staging: no grant at all, for any client role.
revoke all on public.erp_document_upload_chunks from public, anon, authenticated;

-- Staging access rests on the functions owning the tables they write (RLS on, no policy,
-- no FORCE); pin it the way migration 2 pins its definer view.
alter function public.stage_erp_document_chunks(uuid, text, text, jsonb) owner to postgres;
alter function public.publish_erp_document(uuid, integer) owner to postgres;
alter function public.remove_erp_document(text) owner to postgres;

-- The functions are the write path. anon never reaches them; authenticated may call them and
-- each one refuses anyone but service staff with 42501.
revoke execute on function public.stage_erp_document_chunks(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.publish_erp_document(uuid, integer) from public, anon;
revoke execute on function public.remove_erp_document(text) from public, anon;

grant execute on function public.stage_erp_document_chunks(uuid, text, text, jsonb) to authenticated;
grant execute on function public.publish_erp_document(uuid, integer) to authenticated;
grant execute on function public.remove_erp_document(text) to authenticated;

-- knowledge_base_entries: authenticated's table-level INSERT/UPDATE (migrations 2-3) would also
-- cover erp_document_id, letting a direct staff write attach any entry -- a ticket-derived one
-- included -- to a document, whose next publish or remove then deletes it through the cascade.
-- Re-grant both column by column without erp_document_id (and without source on UPDATE), so an
-- erp_doc entry has exactly one write path: the functions above.
revoke insert, update on public.knowledge_base_entries from authenticated;
grant insert (id, source, error_text, cause, steps, embedding, source_ticket_id,
              source_company_id, created_at, updated_at)
  on public.knowledge_base_entries to authenticated;
grant update (id, error_text, cause, steps, embedding, source_ticket_id,
              source_company_id, created_at, updated_at)
  on public.knowledge_base_entries to authenticated;
