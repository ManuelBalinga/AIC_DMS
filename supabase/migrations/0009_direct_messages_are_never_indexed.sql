-- ---------------------------------------------------------------------------
-- 0009 · Direct messages are never indexed for Ask
--
-- Manuel's decision, 20 August, recorded in Documentation/TEAM_COMMUNICATION.md:
-- a direct message is never a retrieval source. Migration 0008 was written on
-- 21 August against a different reading and shipped without the distinction, so
-- every message the asker participates in — including one-to-one conversations
-- — was reachable from Ask. This restores the agreed behaviour.
--
-- The filter belongs here rather than in `retrieve.ts` for the same reason the
-- permission filter does: code that has to remember a `where` clause eventually
-- forgets one. `is_group = true` is checked inside the functions, so a future
-- caller cannot opt out of it, and neither can a caller that never knew the
-- rule existed.
--
-- Note that the keyword arm matters as much as the vector arm. Declining to
-- store an embedding for a direct message would hide it from `match_` while
-- leaving it fully reachable through `search_`, because full-text search reads
-- `body` and needs no vector at all. Both functions are redefined.
--
-- `is_group` is the right discriminator because `find_or_create_direct_thread`
-- is the only path that creates a thread with `is_group = false`, and it always
-- creates exactly the two-person case. A group conversation is a deliberate,
-- named, multi-person space — closer to a team channel than to a private word
-- between two colleagues, which is the distinction the decision turns on.
-- ---------------------------------------------------------------------------

create or replace function public.match_chat_messages(
  query_embedding vector(1536),
  match_count integer default 6,
  min_similarity double precision default 0.15
)
returns table (
  message_id  uuid,
  thread_id   uuid,
  thread_topic text,
  sender_name text,
  body        text,
  created_at  timestamptz,
  similarity  double precision
)
language sql
stable
set search_path = public
as $fn$
  select
    m.id,
    m.thread_id,
    t.topic,
    coalesce(p.full_name, p.email, 'A former colleague'),
    m.body,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  left join public.profiles p on p.id = m.sender_id
  where m.embedding is not null
    and t.is_group = true
    and 1 - (m.embedding <=> query_embedding) >= min_similarity
  order by m.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$fn$;

create or replace function public.search_chat_messages(
  query_text text,
  match_count integer default 6
)
returns table (
  message_id  uuid,
  thread_id   uuid,
  thread_topic text,
  sender_name text,
  body        text,
  created_at  timestamptz,
  rank        double precision
)
language sql
stable
set search_path = public
as $fn$
  select
    m.id,
    m.thread_id,
    t.topic,
    coalesce(p.full_name, p.email, 'A former colleague'),
    m.body,
    m.created_at,
    ts_rank(to_tsvector('english', m.body), websearch_to_tsquery('english', query_text))::double precision
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  left join public.profiles p on p.id = m.sender_id
  where to_tsvector('english', m.body) @@ websearch_to_tsquery('english', query_text)
    and t.is_group = true
  order by 7 desc
  limit least(greatest(match_count, 1), 50);
$fn$;

-- ---------------------------------------------------------------------------
-- Forget what should never have been learned
--
-- A no-op on any project where 0008 and 0009 are applied together, which is
-- every project today — no message has ever been sent through this schema. It
-- is here for the case that stops being true: a deployment that ran 0008,
-- carried real one-to-one conversations, and only then took this migration.
-- There, the vectors already exist, and leaving them would keep the private
-- conversation semantically searchable the moment someone relaxes the filter
-- above. Dropping the column value is the only way to make the retraction real
-- rather than a promise the schema makes and the data contradicts.
--
-- The messages themselves are untouched. Retention says a conversation record
-- is evidence of who was told what and when; this removes the derived vector,
-- not the record.
-- ---------------------------------------------------------------------------
update public.chat_messages m
   set embedding = null
  from public.chat_threads t
 where t.id = m.thread_id
   and t.is_group = false
   and m.embedding is not null;
