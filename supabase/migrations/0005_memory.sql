-- Conversation memory for the Ask module.
--
-- Until now Ask was stateless: a question went out, an answer streamed back,
-- and nothing survived the request. That makes follow-ups ("what about the
-- fees?") impossible, because the second question carries no trace of the
-- first.
--
-- Three tables, in the order the pipeline touches them:
--
--   conversations        one thread, owned by one person
--   conversation_messages  the turns, in order
--   message_citations    which passage backed which bracket number
--
-- Citations are stored rather than recomputed because retrieval is not
-- deterministic across time — re-running the same question after a re-index
-- returns different passages, so a reloaded thread whose [2] points somewhere
-- new is worse than no thread at all.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.message_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  title           text not null default 'New conversation',
  -- Rolling summary of the turns before `summary_through_seq`, so a long thread
  -- keeps its early context without resending every turn on every question.
  -- Null until a thread is long enough to need one.
  summary         text,
  summary_through_seq integer,
  message_count   integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The Ask sidebar's only query: this person's threads, most recent first.
create index if not exists conversations_user_recent_idx
  on public.conversations (user_id, last_message_at desc);

-- ---------------------------------------------------------------------------
-- conversation_messages
--
-- `seq` rather than ordering by `created_at`: two turns of the same exchange
-- can land in the same millisecond, and a thread that renders out of order is
-- indistinguishable from a broken one.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  seq             integer not null,
  role            public.message_role not null,
  content         text not null,
  -- Assistant turns only. What retrieval did for this answer, kept for the
  -- "keyword only" notice and for judging answer quality later.
  retrieval_mode  text,
  passage_count   integer,
  -- The question actually sent to retrieval. Differs from `content` when a
  -- follow-up had to be rewritten into a standalone query; null when it did
  -- not need rewriting. Stored because a retrieval that returns nothing is
  -- almost always a rewrite that went wrong, and this is the evidence.
  resolved_query  text,
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq)
);

create index if not exists conversation_messages_thread_idx
  on public.conversation_messages (conversation_id, seq);

-- ---------------------------------------------------------------------------
-- message_citations
--
-- `document_id` is nullable and `on delete set null`: deleting a document must
-- not erase the answer that cited it. `document_title` is a snapshot for the
-- same reason — the thread still reads correctly after the source is gone, it
-- just stops linking.
-- ---------------------------------------------------------------------------
create table if not exists public.message_citations (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.conversation_messages (id) on delete cascade,
  position       integer not null,
  document_id    uuid references public.documents (id) on delete set null,
  document_title text not null,
  page_number    integer,
  excerpt        text not null,
  unique (message_id, position)
);

create index if not exists message_citations_message_idx
  on public.message_citations (message_id);

-- ---------------------------------------------------------------------------
-- Keep conversation counters honest without the application maintaining them.
-- ---------------------------------------------------------------------------
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.conversations
  set message_count   = message_count + 1,
      last_message_at = new.created_at,
      updated_at      = now()
  where id = new.conversation_id;
  return new;
end;
$fn$;

drop trigger if exists conversation_messages_touch_conversation on public.conversation_messages;
create trigger conversation_messages_touch_conversation
  after insert on public.conversation_messages
  for each row execute function public.touch_conversation_on_message();

drop trigger if exists conversations_touch_updated_at on public.conversations;
create trigger conversations_touch_updated_at
  before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Next sequence number for a thread.
--
-- SECURITY INVOKER so the read is still subject to the policies below: a caller
-- who cannot see the thread cannot learn how long it is.
-- ---------------------------------------------------------------------------
create or replace function public.next_message_seq(target_conversation_id uuid)
returns integer
language sql
stable
set search_path = public
as $fn$
  select coalesce(max(m.seq), 0) + 1
  from public.conversation_messages m
  where m.conversation_id = target_conversation_id;
$fn$;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Owner-only, with no administrator exception — deliberately unlike documents.
-- An administrator can already read any document; being able to read what a
-- colleague privately asked about one is a different power, and nothing in the
-- platform needs it. Questions are often more revealing than the documents
-- they are about.
-- ---------------------------------------------------------------------------
alter table public.conversations         enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.message_citations     enable row level security;

drop policy if exists conversations_owner_all on public.conversations;
create policy conversations_owner_all on public.conversations
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Membership is derived from the thread rather than duplicated onto every row,
-- so a message can never outlive its conversation's permission rule.
drop policy if exists conversation_messages_owner_all on public.conversation_messages;
create policy conversation_messages_owner_all on public.conversation_messages
  for all to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

drop policy if exists message_citations_owner_all on public.message_citations;
create policy message_citations_owner_all on public.message_citations
  for all to authenticated
  using (
    exists (
      select 1
      from public.conversation_messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_citations.message_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.conversation_messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_citations.message_id
        and c.user_id = (select auth.uid())
    )
  );
