-- Migration: ticket resolution
-- Purpose:  Make "service staff resolves a ticket" and "the resolution enters the shared knowledge
--           base" one atomic, staff-only database operation that records the real resolver, and
--           remove every direct write path that could do either half on its own (S-02).
-- Affected: new column public.tickets.resolution_cause and the recreated check constraint
--           tickets_resolution_matches_status, new SECURITY DEFINER function
--           public.resolve_ticket(), new partial index tickets_todo_created_at_idx, dropped
--           policies "tickets are updatable by staff" / "knowledge base entries are insertable by
--           staff", the knowledge base UPDATE policy narrowed to source = 'ticket', and a closing
--           section that revokes authenticated's UPDATE on public.tickets and INSERT on
--           public.knowledge_base_entries.
-- Notes:    Reuses the contract of migrations 1-5: staff is resolved only through
--           is_service_staff(), wrapped in a scalar subquery, and the function has a pinned empty
--           search_path, so every reference inside is schema-qualified. Denials raise SQLSTATE
--           42501 (insufficient_privilege); validation failures raise 22023
--           (invalid_parameter_value).
--           Closes two findings deferred to S-02 by earlier reviews:
--             * F2 (tenant-data-and-auth-foundation, security-review-migrations-1-2): staff could
--               set tickets.resolved_by to any profile. resolved_by is now written only by
--               resolve_ticket(), as auth.uid().
--             * F9 (erp-doc-ingestion-pipeline, impl-review): the staff knowledge base UPDATE
--               policy also covered erp_doc fragments. It now covers source = 'ticket' only.
--           After this migration authenticated has no UPDATE path on public.tickets at all. S-03
--           (the client's "this did not help" comment) adds its own client-scoped column grant
--           and policy rather than reusing a staff one.
--           resolution_cause is written by resolve_ticket() only and is not maintained by a
--           trigger, so there is nothing to backfill: every existing row is either todo (cause
--           must be null) or resolved without a recorded cause (null is valid).
--           Expected Supabase linter finding, deliberate:
--             * authenticated_security_definer_function_executable on resolve_ticket() -- definer
--               rights are the whole mechanism (authenticated holds no UPDATE on tickets and no
--               INSERT on knowledge_base_entries), and the function checks is_service_staff()
--               itself before touching anything.
--           supabase/tests/rls.sql pins the resulting grants and asserts the denied writes.

-- ---------------------------------------------------------------------------
-- 1. Recording the cause next to the steps
-- ---------------------------------------------------------------------------

-- tickets.resolution holds the steps; the cause is optional, so it gets its own nullable column
-- rather than being folded into the same text.
alter table public.tickets add column resolution_cause text;

comment on column public.tickets.resolution_cause is
  'Optional cause recorded with the resolution (tickets.resolution holds the steps). Written only by resolve_ticket(); null on every unresolved ticket.';

-- Same two branches as migration 2, plus the new column. On the unresolved branch it must be
-- null like the rest of the resolution; on the resolved branch it stays optional, because a
-- staff member may know the fix without knowing the cause.
alter table public.tickets drop constraint tickets_resolution_matches_status;

alter table public.tickets
  add constraint tickets_resolution_matches_status check (
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
      and resolution_cause is null
    )
  );

-- ---------------------------------------------------------------------------
-- 2. The staff queue
-- ---------------------------------------------------------------------------

-- The staff queue lists every client company's todo tickets, oldest first, with id as the
-- tiebreak for stable pagination. tickets_company_id_status_idx (migration 2) cannot serve it --
-- status is its trailing column -- and resolved tickets accumulate forever while the queue stays
-- short, so the index is partial.
create index tickets_todo_created_at_idx
  on public.tickets (created_at, id)
  where status = 'todo';

-- ---------------------------------------------------------------------------
-- 3. The write path
-- ---------------------------------------------------------------------------

-- Resolves one ticket and creates its knowledge base entry in the same transaction. The caller
-- (the server) supplies what it computed -- the sanitized error text and its embedding; the
-- function owns identity (auth.uid()), the company (read from the ticket row) and atomicity.
--
-- The two optional parameters come last and default to null so that `supabase gen types` types
-- them as optional: the caller omits them instead of passing null into a non-null argument.
create function public.resolve_ticket(
  p_ticket_id uuid,
  p_steps text,
  p_kb_error_text text,
  p_cause text default null,
  p_embedding extensions.vector(1536) default null
)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_steps text;
  v_kb_error_text text;
  v_cause text;
  v_company_id uuid;
begin
  if not (select public.is_service_staff()) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'Only service staff may resolve tickets';
  end if;

  -- Trimmed of spaces, tabs and line breaks: a textarea holding only newlines is blank too.
  v_steps := btrim(p_steps, E' \t\r\n');
  v_kb_error_text := btrim(p_kb_error_text, E' \t\r\n');
  v_cause := nullif(btrim(p_cause, E' \t\r\n'), '');

  if v_steps is null or v_steps = '' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'steps must not be blank';
  end if;

  if v_kb_error_text is null or v_kb_error_text = '' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'knowledge base error text must not be blank';
  end if;

  -- The conditional update comes first and the insert only follows a row it returned. Two staff
  -- members resolving the same ticket at once serialize on the row lock: the second one
  -- re-evaluates `status = 'todo'`, updates nothing and reports already-resolved, so a ticket
  -- never gets a second knowledge base entry and no entry exists without its resolution.
  update public.tickets t
  set status = 'resolved',
      resolution = v_steps,
      resolution_cause = v_cause,
      resolved_by = auth.uid(),
      resolved_at = now()
  where t.id = p_ticket_id
    and t.status = 'todo'
  returning t.company_id into v_company_id;

  if not found then
    if exists (select 1 from public.tickets t where t.id = p_ticket_id) then
      return 'already-resolved';
    end if;
    return 'not-found';
  end if;

  insert into public.knowledge_base_entries (
    source, error_text, cause, steps, embedding, source_ticket_id, source_company_id
  )
  values (
    'ticket', v_kb_error_text, v_cause, v_steps, p_embedding, p_ticket_id, v_company_id
  );

  return 'resolved';
end;
$$;

comment on function public.resolve_ticket(uuid, text, text, text, extensions.vector) is
  'Resolves a todo ticket (status, resolution = steps, resolution_cause, resolved_by = auth.uid(), resolved_at) and, in the same transaction, inserts its source = ''ticket'' knowledge base entry with the sanitized error text, cause, steps, embedding (may be null) and provenance. Returns resolved, already-resolved or not-found. Service staff only (42501 otherwise); blank steps or error text raise 22023. Definer rights are intentional: authenticated holds no UPDATE on tickets and no INSERT on knowledge_base_entries, so this is the only path that resolves a ticket or creates a ticket entry.';

-- ---------------------------------------------------------------------------
-- 4. Row level security: removing the direct write paths
-- ---------------------------------------------------------------------------

-- Closes F2: a direct staff UPDATE could set resolved_by to any profile and could resolve a
-- ticket without creating its knowledge base entry. resolve_ticket() is now the only way a
-- ticket changes; the grant goes in section 5.
drop policy "tickets are updatable by staff" on public.tickets;

-- Ticket entries are created only by resolve_ticket(), erp_doc entries only by the F-02
-- functions; both run as the owner, so no INSERT policy is needed for any role.
drop policy "knowledge base entries are insertable by staff" on public.knowledge_base_entries;

-- Closes F9: staff keep UPDATE on ticket-derived entries (the embedding backfill relies on it,
-- through the column-scoped grant of migration 20260924120000, which stays as is), but an
-- erp_doc fragment is the document's content and changes only through publish_erp_document().
drop policy "knowledge base entries are updatable by staff" on public.knowledge_base_entries;

create policy "knowledge base ticket entries are updatable by staff"
  on public.knowledge_base_entries
  for update
  to authenticated
  using ((select public.is_service_staff()) and source = 'ticket')
  with check ((select public.is_service_staff()) and source = 'ticket');

-- ---------------------------------------------------------------------------
-- 5. Privilege hardening (context/foundation/lessons.md)
-- ---------------------------------------------------------------------------
-- Postgres hands EXECUTE to PUBLIC on every new function. Pin the owner the definer rights run
-- as, take EXECUTE away from everyone, and give it back to authenticated only; the function
-- refuses anyone but service staff with 42501.

alter function public.resolve_ticket(uuid, text, text, text, extensions.vector) owner to postgres;

revoke execute on function public.resolve_ticket(uuid, text, text, text, extensions.vector)
  from public, anon;
grant execute on function public.resolve_ticket(uuid, text, text, text, extensions.vector)
  to authenticated;

-- With its policy gone, the column-scoped UPDATE grant of migration 2 (status, resolution,
-- resolved_by, resolved_at) would only wait for a future policy to widen it again. Revoking the
-- table privilege takes the column privileges with it, so authenticated holds no UPDATE on
-- tickets at all; resolve_ticket() writes as the owner. Nothing is granted back.
revoke update on public.tickets from authenticated;

-- Same for INSERT on knowledge_base_entries: the column-scoped grant of migration 20260924120000
-- goes with the policy. The column-scoped UPDATE grant stays, filtered by the policy above.
revoke insert on public.knowledge_base_entries from authenticated;
