-- Migration: knowledge base similarity search
-- Purpose:  Give a signed-in client session the one way it can run a similarity search over the
--           shared knowledge base. knowledge_base_entries is staff-only at the table level and
--           knowledge_base_public projects the embedding away, so neither can rank entries
--           against a query vector; this function does, as the owner, and returns only what the
--           view already exposes plus the similarity.
-- Affected: new SECURITY DEFINER function public.match_knowledge_base(), and its privileges.
-- Notes:    Reuses the contract of migrations 1-4: authorization goes through
--           current_company_kind() / is_service_staff(), each wrapped in a scalar subquery, and
--           the function has a pinned empty search_path, so every reference inside -- the
--           pgvector operator included -- is schema-qualified.
--           The gate is the one knowledge_base_public carries in its body: a client company or
--           service staff sees entries, anyone else (an unassigned account) gets zero rows rather
--           than an error, exactly as the view behaves.
--           Similarity is 1 - cosine distance, matching text-embedding-3-small's unit vectors
--           (scripts/ingest/embeddings.mjs). p_match_count is clamped to 1..10 so a caller can
--           neither ask for nothing nor page through the whole knowledge base.
--           Expected Supabase linter finding, deliberate:
--             * authenticated_security_definer_function_executable -- definer rights are the
--               whole mechanism (authenticated cannot read the base table), and the body carries
--               the view's gate itself.
--           supabase/tests/rls.sql pins the grant, the result signature and the semantics.

create function public.match_knowledge_base(
  p_query_embedding extensions.vector(1536),
  p_match_threshold double precision,
  p_match_count integer
)
  returns table (
    id uuid,
    source public.kb_source,
    error_text text,
    cause text,
    steps text,
    similarity double precision
  )
  language sql
  stable
  strict
  security definer
  set search_path = ''
as $$
  select m.id, m.source, m.error_text, m.cause, m.steps, m.similarity
  from (
    select e.id, e.source, e.error_text, e.cause, e.steps,
           1 - (e.embedding operator(extensions.<=>) p_query_embedding) as similarity
    from public.knowledge_base_entries e
    where e.embedding is not null
      and ((select public.current_company_kind()) = 'client' or (select public.is_service_staff()))
    order by e.embedding operator(extensions.<=>) p_query_embedding
    limit least(greatest(p_match_count, 1), 10)
  ) m
  where m.similarity >= p_match_threshold
  order by m.similarity desc;
$$;

comment on function public.match_knowledge_base(extensions.vector, double precision, integer) is
  'Similarity search over the shared knowledge base: up to p_match_count (clamped to 1..10) entries with an embedding whose cosine similarity to p_query_embedding is at least p_match_threshold, closest first. Same gate as knowledge_base_public -- zero rows unless the caller''s company is a client or the caller is service staff. Exposes no provenance (source_ticket_id, source_company_id, erp_document_id) and no embedding. Definer rights are intentional: authenticated cannot read the base table.';

-- ---------------------------------------------------------------------------
-- Privilege hardening (context/foundation/lessons.md)
-- ---------------------------------------------------------------------------
-- Postgres hands EXECUTE to PUBLIC on every new function. Pin the owner the definer rights run
-- as, take EXECUTE away from everyone, and give it back to authenticated only.

alter function public.match_knowledge_base(extensions.vector, double precision, integer) owner to postgres;

revoke execute on function public.match_knowledge_base(extensions.vector, double precision, integer)
  from public, anon;
grant execute on function public.match_knowledge_base(extensions.vector, double precision, integer)
  to authenticated;
