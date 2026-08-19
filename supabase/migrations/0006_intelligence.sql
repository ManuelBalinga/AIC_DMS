-- Phase 4 groundwork: document summaries, suggested tags, related documents.
--
-- All three reuse what ingestion already produces. Nothing here adds a second
-- copy of document text or a second embedding pass — the chunks and their
-- vectors are already in `document_chunks`, and that is what these read.

-- ---------------------------------------------------------------------------
-- Summary and suggested tags on the document
--
-- Stored rather than generated on view: a summary costs a model call, the
-- document rarely changes, and a dashboard listing twenty documents would
-- otherwise make twenty calls to render one page.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists summary text;

alter table public.documents
  add column if not exists summary_generated_at timestamptz;

-- Kept separate from `tags`, which is what a person chose. A suggestion is a
-- proposal until someone accepts it; merging the two would mean the model
-- silently editing a colleague's filing.
alter table public.documents
  add column if not exists suggested_tags text[] not null default '{}';

comment on column public.documents.suggested_tags is
  'Model-proposed tags awaiting a human decision. Never merged into `tags` automatically.';

-- ---------------------------------------------------------------------------
-- Document-level embedding, as the mean of its chunk embeddings
--
-- "Related documents" is a document-to-document question, and chunk-to-chunk
-- similarity answers a different one: two documents can share one boilerplate
-- paragraph and be about nothing alike. Averaging the chunks gives a vector
-- that represents the document as a whole.
--
-- A view rather than a stored column so it cannot go stale against a re-index.
-- If this becomes slow at AIC's scale it should become a materialized view
-- refreshed by `ingest.ts` — but measuring that needs a real corpus first.
-- ---------------------------------------------------------------------------
create or replace view public.document_embeddings as
  select
    c.document_id,
    avg(c.embedding)::vector(1536) as embedding,
    count(*)                       as chunk_count
  from public.document_chunks c
  where c.embedding is not null
  group by c.document_id;

-- The view runs as its caller, so `document_chunks`' RLS policy still decides
-- which chunks it can see. A document the caller cannot read contributes
-- nothing to it — including its existence.
alter view public.document_embeddings set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Related documents
--
-- SECURITY INVOKER for the same reason as `match_document_chunks`: permissions
-- are applied by the database before this function's caller sees a row, so the
-- feature cannot leak a restricted document by forgetting a filter.
-- ---------------------------------------------------------------------------
create or replace function public.related_documents(
  source_document_id uuid,
  match_count integer default 5,
  min_similarity double precision default 0.5
)
returns table (
  document_id    uuid,
  title          text,
  tags           text[],
  similarity     double precision
)
language sql
stable
set search_path = public
as $fn$
  with source as (
    select e.embedding
    from public.document_embeddings e
    where e.document_id = source_document_id
  )
  select
    d.id,
    d.title,
    d.tags,
    1 - (e.embedding <=> s.embedding) as similarity
  from public.document_embeddings e
  join public.documents d on d.id = e.document_id
  cross join source s
  where e.document_id <> source_document_id
    and 1 - (e.embedding <=> s.embedding) >= min_similarity
  order by e.embedding <=> s.embedding
  limit least(greatest(match_count, 1), 20);
$fn$;
