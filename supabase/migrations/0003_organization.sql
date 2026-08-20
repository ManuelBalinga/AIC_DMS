-- Document organization (plan §4.2) and keyword search (plan §10 week 3).
--
-- Tags rather than folders: a document that is both an "i363" item and a
-- "product doc" needs to appear in both places, which a tree cannot do without
-- duplicating the file. Tags also give the Week 3 discovery work a filter
-- dimension for free.

alter table public.documents
  add column if not exists tags text[] not null default '{}';

create index if not exists documents_tags_idx
  on public.documents using gin (tags);

-- ---------------------------------------------------------------------------
-- `array_to_string` is declared over `anyarray`, so Postgres marks it STABLE
-- rather than IMMUTABLE: for an arbitrary element type it would depend on that
-- type's output function. A generated column requires provable immutability, so
-- using it directly fails with "generation expression is not immutable".
--
-- Narrowing the signature to `text[]` removes the generality that forced the
-- STABLE marking — text's output function is itself immutable, so this wrapper
-- is telling the planner the truth rather than papering over a hazard.
-- ---------------------------------------------------------------------------
create or replace function public.text_array_to_string(arr text[], sep text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $fn$
  select array_to_string(arr, sep);
$fn$;

-- ---------------------------------------------------------------------------
-- Keyword search over document metadata.
--
-- Generated (not trigger-maintained) so the column can never drift from the
-- columns it summarises. Title is weighted above description, which is weighted
-- above the file name and tags.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(file_name, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(public.text_array_to_string(tags, ' '), '')), 'C')
  ) stored;

create index if not exists documents_search_vector_idx
  on public.documents using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Distinct tags visible to the signed-in user, for the dashboard filter.
--
-- SECURITY INVOKER (the default) on purpose: the select below runs as the
-- caller, so the `documents_select` policy decides which rows contribute tags.
-- A security-definer version would leak the tag vocabulary of documents the
-- user cannot see.
-- ---------------------------------------------------------------------------
create or replace function public.visible_document_tags()
returns table (tag text, document_count bigint)
language sql
stable
set search_path = public
as $fn$
  select t.tag, count(*) as document_count
  from public.documents d
  cross join lateral unnest(d.tags) as t(tag)
  group by t.tag
  order by document_count desc, t.tag asc;
$fn$;
