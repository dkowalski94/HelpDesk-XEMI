-- Migration: sanitized knowledge base resolution
-- Purpose:  Close the two cross-tenant gaps found in the S-02 implementation review
--           (context/changes/service-staff-ticket-resolution/reviews/impl-review.md):
--             * F1: the cause and steps a staff member writes went verbatim into the shared
--               knowledge base, which match_knowledge_base shows to every client company. The
--               function now takes a separately sanitized copy of both for the entry, while the
--               ticket keeps the unmasked text its own company reads.
--             * F2: authenticated kept a column-scoped UPDATE on knowledge_base_entries covering
--               error_text, cause, steps and provenance, so staff could overwrite a sanitized
--               entry directly. The embedding backfill is the only direct writer; UPDATE is now
--               granted on embedding alone.
-- Affected: public.resolve_ticket() dropped and recreated with p_kb_steps and p_kb_cause; the
--           UPDATE grant on public.knowledge_base_entries for authenticated.
-- Notes:    Same contract as migration 20261014120000: is_service_staff() in a scalar subquery,
--           pinned empty search_path, 42501 for denials, 22023 for validation failures, and the
--           optional parameters last with default null so `supabase gen types` types them as
--           optional. p_kb_steps is required, so the generated type makes the caller pass it.
--           The signature changes, so the function is dropped rather than replaced; no deployed
--           Worker calls the old signature (S-02 ships together with this migration).
--           updated_at is still advanced by the set_updated_at() trigger: a trigger's own write
--           is not checked against the column grant.
--           Expected Supabase linter finding, deliberate, unchanged from 20261014120000:
--             * authenticated_security_definer_function_executable on resolve_ticket().
--           supabase/tests/rls.sql pins the resulting grants and asserts the denied writes.

-- ---------------------------------------------------------------------------
-- 1. The write path, with a sanitized copy for the knowledge base
-- ---------------------------------------------------------------------------

drop function public.resolve_ticket(uuid, text, text, text, extensions.vector);

-- Resolves one ticket and creates its knowledge base entry in the same transaction. The ticket
-- gets the steps and cause as written (only its own company reads them); the entry gets the
-- server-sanitized error text, steps and cause, because other companies read it on a match.
create function public.resolve_ticket(
  p_ticket_id uuid,
  p_steps text,
  p_kb_error_text text,
  p_kb_steps text,
  p_cause text default null,
  p_kb_cause text default null,
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
  v_kb_steps text;
  v_cause text;
  v_kb_cause text;
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
  v_kb_steps := btrim(p_kb_steps, E' \t\r\n');
  v_cause := nullif(btrim(p_cause, E' \t\r\n'), '');
  v_kb_cause := nullif(btrim(p_kb_cause, E' \t\r\n'), '');

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

  if v_kb_steps is null or v_kb_steps = '' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'knowledge base steps must not be blank';
  end if;

  -- The entry's cause exists exactly when the ticket's does: a cause without its sanitized copy
  -- would leave the entry without one, and a sanitized copy without a cause has no source.
  if (v_cause is null) <> (v_kb_cause is null) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'cause and knowledge base cause must both be given or both be blank';
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
    'ticket', v_kb_error_text, v_kb_cause, v_kb_steps, p_embedding, p_ticket_id, v_company_id
  );

  return 'resolved';
end;
$$;

comment on function public.resolve_ticket(uuid, text, text, text, text, text, extensions.vector) is
  'Resolves a todo ticket (status, resolution = steps, resolution_cause, resolved_by = auth.uid(), resolved_at) and, in the same transaction, inserts its source = ''ticket'' knowledge base entry with the sanitized error text, sanitized steps, sanitized cause, embedding (may be null) and provenance. Returns resolved, already-resolved or not-found. Service staff only (42501 otherwise); blank steps, error text or knowledge base steps, or a cause without its sanitized copy (or the reverse), raise 22023. Definer rights are intentional: authenticated holds no UPDATE on tickets and no INSERT on knowledge_base_entries, so this is the only path that resolves a ticket or creates a ticket entry.';

-- Postgres hands EXECUTE to PUBLIC on every new function (context/foundation/lessons.md).
alter function public.resolve_ticket(uuid, text, text, text, text, text, extensions.vector)
  owner to postgres;

revoke execute on function public.resolve_ticket(uuid, text, text, text, text, text, extensions.vector)
  from public, anon;
grant execute on function public.resolve_ticket(uuid, text, text, text, text, text, extensions.vector)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Knowledge base UPDATE: the embedding backfill only
-- ---------------------------------------------------------------------------

-- Revoking the table privilege takes every column privilege of migration 20260924120000 with
-- it; the backfill (src/lib/services/ticket-resolution.ts) writes nothing but the embedding.
-- The policy "knowledge base ticket entries are updatable by staff" still limits the rows to
-- staff and source = 'ticket'.
revoke update on public.knowledge_base_entries from authenticated;
grant update (embedding) on public.knowledge_base_entries to authenticated;
