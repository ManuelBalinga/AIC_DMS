-- RAG retrieval layer (plan §4.4, §6.4, §9).
--
-- Migration 0001 created `document_chunks` with a vector(1536) column and an
-- RLS policy calling `can_read_document`. This migration adds what retrieval
-- needs on top: citation metadata, an ingestion audit trail, a vector index,
-- and the permission-aware similarity search function.

-- ---------------------------------------------------------------------------
-- Citation metadata on chunks
-- ---------------------------------------------------------------------------
alter table public.document_chunks
  add column if not exists page_number integer;

-- Populated for formats where a "page" is meaningful (PDF). Null elsewhere,
-- which the citation renderer treats as "no page reference available".
comment on column public.document_chunks.page_number is
  '1-indexed source page, when the format has pages. Null otherwise.';

-- ---------------------------------------------------------------------------
-- Ingestion audit trail on documents
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists indexed_at timestamptz;

alter table public.documents
  add column if not exists index_error text;

alter table public.documents
  add column if not exists chunk_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- Vector index
--
-- HNSW rather than IVFFlat: it needs no training pass, so it behaves correctly
-- on an empty table and stays accurate as the corpus grows from zero to a few
-- thousand chunks. Cosine distance to match the normalised embeddings the
-- ingestion pipeline stores.
-- ---------------------------------------------------------------------------
create index if not exists document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Permission-aware similarity search
--
-- SECURITY INVOKER (the default) is the whole point: the function body reads
-- `document_chunks`, whose RLS policy calls `can_read_document`, so the
-- database filters out chunks from documents the caller cannot open. The
-- retrieval code cannot forget to apply permissions because it never applies
-- them in the first place.
--
-- `1 - (embedding <=> query)` converts pgvector cosine distance to similarity,
-- so callers reason in "higher is better" terms.
-- ---------------------------------------------------------------------------
create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_count integer default 8,
  min_similarity double precision default 0.15
)
returns table (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  chunk_index    integer,
  page_number    integer,
  content        text,
  similarity     double precision
)
language sql
stable
set search_path = public
as $fn$
  select
    c.id,
    c.document_id,
    d.title,
    c.chunk_index,
    c.page_number,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$fn$;

-- ---------------------------------------------------------------------------
-- Keyword fallback over chunk content
--
-- Vector search misses exact identifiers ("i363", an invoice number) whose
-- embedding neighbourhood is uninformative. Same SECURITY INVOKER reasoning as
-- above, so this path inherits the same permission filter.
-- ---------------------------------------------------------------------------
create index if not exists document_chunks_content_fts_idx
  on public.document_chunks
  using gin (to_tsvector('english', content));

create or replace function public.search_document_chunks(
  query_text text,
  match_count integer default 8
)
returns table (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  chunk_index    integer,
  page_number    integer,
  content        text,
  rank           double precision
)
language sql
stable
set search_path = public
as $fn$
  select
    c.id,
    c.document_id,
    d.title,
    c.chunk_index,
    c.page_number,
    c.content,
    ts_rank(to_tsvector('english', c.content), websearch_to_tsquery('english', query_text))::double precision
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where to_tsvector('english', c.content) @@ websearch_to_tsquery('english', query_text)
  order by 7 desc
  limit least(greatest(match_count, 1), 50);
$fn$;
