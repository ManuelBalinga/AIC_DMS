-- Team messaging, and two changes to what retrieval understands.
--
-- Three things, in the order they depend on each other:
--
--   1. document_chunks gains a `context_header` — the sentence or two that
--      situates a passage inside its document before it is embedded.
--   2. chat_threads / chat_participants / chat_messages: people talking to
--      each other on the platform instead of on WhatsApp, which is the whole
--      point of the product.
--   3. Two SECURITY INVOKER functions that make those messages retrievable by
--      Ask — for the participants, and for nobody else.
--
-- Read part 3 carefully. It is the first time Ask can ground an answer in
-- something other than a document, and the reason it is safe is structural
-- rather than careful: `match_chat_messages` reads `chat_messages`, whose RLS
-- policy calls `is_chat_participant`, so Postgres removes other people's
-- conversations before the retrieval code sees a row. Exactly the arrangement
-- `can_read_document` already gives documents.
--
-- There is no administrator exception anywhere in this file. Migration 0007
-- took document reading away from administrators on the grounds that managing
-- access and reading contents are different powers; reading a colleague's
-- private messages is further still.

-- ---------------------------------------------------------------------------
-- 1. Contextual embeddings
--
-- A chunk reading "the fee is GHS 500" is nearly unretrievable: it names
-- neither the fee nor the year, so its embedding sits nowhere near the question
-- "what does the i363 programme cost?". Prefixing the document's title and a
-- line of its summary before embedding puts it in the right neighbourhood.
--
-- Stored in its own column rather than folded into `content`, because the
-- header is an artefact of retrieval and must never appear in a citation. The
-- citation quotes what the document actually says.
-- ---------------------------------------------------------------------------
alter table public.document_chunks
  add column if not exists context_header text;

comment on column public.document_chunks.context_header is
  'Situating text prepended to content at embedding time only. Never shown to a reader, never part of a citation.';

-- ---------------------------------------------------------------------------
-- 2. Threads
--
-- `chat_*` rather than `conversation_*`: migration 0005 already took the latter
-- for a person's Ask threads with the model. Two different things called the
-- same name in one schema is a bug waiting for a tired afternoon.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  -- Kept for "who started this", and null-safe: a departing colleague's
  -- threads survive them, the same way their documents and comments do.
  created_by      uuid references public.profiles (id) on delete set null,
  -- Null for a direct message between two people, where the participants are
  -- the subject. Named threads are for the group case.
  topic           text,
  is_group        boolean not null default false,
  message_count   integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.chat_participants (
  thread_id    uuid not null references public.chat_threads (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  -- Drives the unread badge. Null means "never opened", which is different from
  -- "opened before the first message" and reads correctly as unread.
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);

-- The inbox query: my threads, most recently active first.
create index if not exists chat_participants_user_idx
  on public.chat_participants (user_id);

create index if not exists chat_threads_recent_idx
  on public.chat_threads (last_message_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads (id) on delete cascade,
  -- `set null` for the same reason document comments use it: a thread with one
  -- side's turns deleted reads as though the rest were answering nobody.
  sender_id  uuid references public.profiles (id) on delete set null,
  body       text not null check (length(btrim(body)) > 0),
  -- Null until embedded, and null forever if no embedding provider is
  -- configured. Retrieval treats null as "not searchable by meaning" rather
  -- than as an error, so messaging works with no AI keys at all.
  embedding  vector(1536),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists chat_messages_thread_idx
  on public.chat_messages (thread_id, created_at);

-- Same HNSW / cosine choice as document_chunks, for the same reason: no
-- training pass, so it is correct on an empty table.
create index if not exists chat_messages_embedding_idx
  on public.chat_messages
  using hnsw (embedding vector_cosine_ops);

create index if not exists chat_messages_body_fts_idx
  on public.chat_messages
  using gin (to_tsvector('english', body));

-- ---------------------------------------------------------------------------
-- Participation helper
--
-- SECURITY DEFINER is load-bearing, not incidental. `chat_participants`'s own
-- select policy calls this function, and if the function read the table as the
-- caller it would re-enter that policy and recurse until Postgres gives up.
-- Reading the table with the definer's rights breaks the cycle. Same shape as
-- `can_read_document`.
-- ---------------------------------------------------------------------------
create or replace function public.is_chat_participant(
  check_thread_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.chat_participants p
    where p.thread_id = check_thread_id
      and p.user_id = check_user_id
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.chat_threads      enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages     enable row level security;

drop policy if exists chat_threads_select on public.chat_threads;
create policy chat_threads_select on public.chat_threads
  for select using (public.is_chat_participant(id, (select auth.uid())));

drop policy if exists chat_threads_insert on public.chat_threads;
create policy chat_threads_insert on public.chat_threads
  for insert with check (created_by = (select auth.uid()));

-- Renaming a group thread. Deletion is deliberately absent: there is no policy
-- for it, so nobody can delete a thread out from under the other participants.
drop policy if exists chat_threads_update on public.chat_threads;
create policy chat_threads_update on public.chat_threads
  for update using (public.is_chat_participant(id, (select auth.uid())));

drop policy if exists chat_participants_select on public.chat_participants;
create policy chat_participants_select on public.chat_participants
  for select using (public.is_chat_participant(thread_id, (select auth.uid())));

-- You may add someone to a thread you are already in, or seed the thread you
-- just created. The second clause is what lets a new conversation exist at all:
-- at that instant there are no participants yet, so the first arm is false for
-- everyone including the creator.
drop policy if exists chat_participants_insert on public.chat_participants;
create policy chat_participants_insert on public.chat_participants
  for insert with check (
    public.is_chat_participant(thread_id, (select auth.uid()))
    or exists (
      select 1 from public.chat_threads t
      where t.id = thread_id and t.created_by = (select auth.uid())
    )
  );

-- Leaving a thread is removing your own row. You cannot remove anybody else:
-- being in a conversation is not a power over who else is in it.
drop policy if exists chat_participants_delete on public.chat_participants;
create policy chat_participants_delete on public.chat_participants
  for delete using (user_id = (select auth.uid()));

-- Marking as read.
drop policy if exists chat_participants_update_self on public.chat_participants;
create policy chat_participants_update_self on public.chat_participants
  for update using (user_id = (select auth.uid()));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (public.is_chat_participant(thread_id, (select auth.uid())));

-- Both halves matter: the first stops you posting into a stranger's thread,
-- the second stops you posting as somebody else inside your own.
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert with check (
    sender_id = (select auth.uid())
    and public.is_chat_participant(thread_id, (select auth.uid()))
  );

drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages
  for update using (sender_id = (select auth.uid()));

drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own on public.chat_messages
  for delete using (sender_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Thread bookkeeping
--
-- A trigger rather than application code: `last_message_at` orders the inbox,
-- and an inbox that sorts wrongly because one write path forgot to update a
-- column is a bug nobody reproduces on demand.
-- ---------------------------------------------------------------------------
create or replace function public.touch_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.chat_threads
  set last_message_at = new.created_at,
      message_count   = message_count + 1,
      updated_at      = now()
  where id = new.thread_id;
  return new;
end;
$fn$;

drop trigger if exists chat_messages_touch_thread on public.chat_messages;
create trigger chat_messages_touch_thread
  after insert on public.chat_messages
  for each row execute function public.touch_chat_thread();

-- ---------------------------------------------------------------------------
-- 3. Retrieval over messages
--
-- SECURITY INVOKER (the default), exactly as `match_document_chunks` is. The
-- body reads `chat_messages`; that table's policy calls `is_chat_participant`;
-- so a caller can only ever match their own conversations. No filter in this
-- function, and none needed in the TypeScript that calls it.
--
-- `sender_name` is resolved here rather than in the application because a
-- retrieved message is useless without knowing who said it, and the profiles
-- read is already permitted to every signed-in user.
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
  order by 7 desc
  limit least(greatest(match_count, 1), 50);
$fn$;

-- ---------------------------------------------------------------------------
-- Citations can now point at a message
--
-- `message_citations.document_id` was already nullable, for a document deleted
-- after it was cited. Reusing that null to mean "this was a message" would make
-- a reloaded thread render a colleague's remark as a deleted document, so the
-- kind is recorded explicitly and the thread id kept alongside it.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.citation_kind as enum ('document', 'message');
exception when duplicate_object then null; end $$;

alter table public.message_citations
  add column if not exists kind public.citation_kind not null default 'document';

alter table public.message_citations
  add column if not exists thread_id uuid references public.chat_threads (id) on delete set null;

comment on column public.message_citations.thread_id is
  'Set when kind = message. On delete set null so a citation survives the conversation it came from, the way it survives a deleted document.';

-- ---------------------------------------------------------------------------
-- Finding or starting a direct conversation
--
-- Without this, "message this person" races: two people opening each other's
-- profile at the same moment create two threads, and each sends into a
-- different one. SECURITY DEFINER so it can look across participant rows to
-- find an existing pair, and it only ever returns a thread the caller is in.
-- ---------------------------------------------------------------------------
create or replace function public.find_or_create_direct_thread(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me uuid := auth.uid();
  found uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if other_user_id = me then
    raise exception 'Cannot start a conversation with yourself';
  end if;

  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'No such person';
  end if;

  -- An existing two-person thread containing exactly the two of us. The count
  -- check is what stops a three-person group from being reused as a DM.
  select t.id into found
  from public.chat_threads t
  join public.chat_participants a on a.thread_id = t.id and a.user_id = me
  join public.chat_participants b on b.thread_id = t.id and b.user_id = other_user_id
  where t.is_group = false
    and (select count(*) from public.chat_participants p where p.thread_id = t.id) = 2
  order by t.created_at
  limit 1;

  if found is not null then
    return found;
  end if;

  insert into public.chat_threads (created_by, is_group)
  values (me, false)
  returning id into found;

  insert into public.chat_participants (thread_id, user_id)
  values (found, me), (found, other_user_id);

  return found;
end;
$fn$;
