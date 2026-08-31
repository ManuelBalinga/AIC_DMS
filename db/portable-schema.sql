-- Provider-neutral schema for the AIC document platform.
--
-- Runs on Neon, on plain Postgres, and on Supabase. It is the same schema as
-- `supabase/migrations/`, with every Supabase-specific dependency replaced by
-- something any Postgres provider has:
--
--   auth.users        -> app_users, a table this schema owns
--   auth.uid()        -> app.current_user_id(), one adapter function
--   storage.objects   -> documents.storage_path, an opaque string
--   `authenticated`   -> the `app_user` role, created below
--
-- Requires only `pgcrypto` and `vector`, both of which Neon and Supabase have.
--
-- Bring records across with `scripts/db-export.mjs` and `scripts/db-import.mjs`.
-- Table and column names are identical to the Supabase schema on purpose: that
-- is what lets the transfer be a copy rather than a translation.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- The one thing providers disagree about
--
-- Every RLS policy below asks the same question — "who is calling?" — and this
-- function is the only place the answer is provider-specific. Everything else
-- in the schema is portable because it goes through here.
--
-- On Supabase, `auth.uid()` reads the request's JWT.
-- Everywhere else, the application sets a connection-local variable after it
-- has authenticated the request itself:
--
--   select set_config('app.current_user_id', $1, true);
--
-- The `true` matters: it scopes the setting to the transaction, so a pooled
-- connection cannot carry one request's identity into the next one's queries.
-- ---------------------------------------------------------------------------
create schema if not exists app;

create or replace function app.current_user_id()
returns uuid
language plpgsql
stable
as $fn$
declare
  resolved uuid;
begin
  -- Supabase path. Wrapped because `auth` does not exist elsewhere, and a
  -- missing schema is a hard error rather than a null.
  begin
    execute 'select auth.uid()' into resolved;
    if resolved is not null then
      return resolved;
    end if;
  exception when others then
    null;
  end;

  return nullif(current_setting('app.current_user_id', true), '')::uuid;
end;
$fn$;

-- The role policies are granted to. Supabase calls its equivalent
-- `authenticated`; naming it here means the policies below do not have to care.
do $$ begin
  create role app_user nologin;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Enums — identical to the Supabase schema
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('administrator', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_index_status as enum ('pending', 'processing', 'indexed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

-- Declaration order is load-bearing: Postgres compares enums by it, so
-- `role >= 'commenter'` answers a permission question with one comparison.
do $$ begin
  create type public.document_role as enum ('viewer', 'commenter', 'editor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.citation_kind as enum ('document', 'message');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- app_users: identity, owned by this schema rather than by the provider
--
-- `id` deliberately carries the same UUID the source provider used, so every
-- foreign key in an exported dataset still resolves after the move. It is a
-- plain primary key with no default of its own — identities are created by
-- whatever handles sign-in, and recorded here.
--
-- `auth_provider` / `auth_subject` record where the identity came from, so a
-- move from Supabase Auth to Clerk (or anything else) is a matter of writing a
-- new subject against an existing row rather than re-creating the user and
-- orphaning their documents.
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  id            uuid primary key,
  email         text not null unique,
  full_name     text,
  role          public.user_role not null default 'member',
  auth_provider text not null default 'supabase',
  auth_subject  text,
  -- Set when the person can no longer sign in. Their documents, grants and
  -- comments are untouched, and it is reversible.
  deactivated_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (auth_provider, auth_subject)
);

-- The application and the exported data both say `profiles`. An updatable view
-- keeps that name working here without a second copy of the rows, so the same
-- queries run against either provider unchanged.
create or replace view public.profiles as
  select id, email, full_name, role, deactivated_at, created_at, updated_at
  from public.app_users;

-- ---------------------------------------------------------------------------
-- Everything below is copied from the Supabase migrations unchanged except for
-- the two substitutions: `profiles` -> `app_users`, `auth.uid()` ->
-- `app.current_user_id()`.
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        public.user_role not null default 'member',
  status      public.invitation_status not null default 'pending',
  invited_by  uuid references public.app_users (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists invitations_pending_email_idx
  on public.invitations (lower(email))
  where status = 'pending';

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.app_users (id) on delete cascade,
  title         text not null,
  description   text,
  file_name     text not null,
  -- An opaque string, not a handle into any provider's object store. Moving
  -- providers means moving the bytes and keeping these paths, or rewriting
  -- this one column — never touching the rest of the schema.
  storage_path  text not null unique,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  tags          text[] not null default '{}',
  index_status  public.document_index_status not null default 'pending',
  indexed_at    timestamptz,
  index_error   text,
  chunk_count   integer not null default 0,
  -- Phase 4 enrichment. `suggested_tags` is kept apart from `tags` so a model
  -- proposal never counts as a person's filing decision.
  summary       text,
  summary_generated_at timestamptz,
  suggested_tags text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_owner_id_idx on public.documents (owner_id);
create index if not exists documents_created_at_idx on public.documents (created_at desc);
create index if not exists documents_tags_idx on public.documents using gin (tags);

-- `array_to_string` is declared over `anyarray`, so Postgres marks it STABLE
-- rather than IMMUTABLE: for an arbitrary element type it would depend on that
-- type's output function. A generated column requires provable immutability, so
-- using it directly fails with "generation expression is not immutable".
--
-- Narrowing the signature to `text[]` removes the generality that forced the
-- STABLE marking — text's output function is itself immutable, so this wrapper
-- is telling the planner the truth rather than papering over a hazard.
--
-- Mirrors `supabase/migrations/0003_organization.sql`, where this failure was
-- found for real. Portable in the plainest sense: nothing here is Supabase's,
-- so the same wrapper is needed on Neon or any other Postgres.
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

create table if not exists public.document_access (
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id     uuid not null references public.app_users (id) on delete cascade,
  role        public.document_role not null default 'viewer',
  granted_by  uuid references public.app_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index if not exists document_access_user_id_idx on public.document_access (user_id);

create table if not exists public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  token_count integer,
  page_number integer,
  -- Situating text prepended to content at embedding time only. Never shown to
  -- a reader and never part of a citation.
  context_header text,
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists document_chunks_document_id_idx
  on public.document_chunks (document_id);

create index if not exists document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists document_chunks_content_fts_idx
  on public.document_chunks using gin (to_tsvector('english', content));

-- ---------------------------------------------------------------------------
-- Team messaging
--
-- `chat_*` rather than `conversation_*`: the latter is a person's Ask thread
-- with the model, which is a different thing with different privacy rules.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid references public.app_users (id) on delete set null,
  topic           text,
  is_group        boolean not null default false,
  message_count   integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.chat_participants (
  thread_id    uuid not null references public.chat_threads (id) on delete cascade,
  user_id      uuid not null references public.app_users (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);

create index if not exists chat_participants_user_idx
  on public.chat_participants (user_id);

create index if not exists chat_threads_recent_idx
  on public.chat_threads (last_message_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads (id) on delete cascade,
  sender_id  uuid references public.app_users (id) on delete set null,
  body       text not null check (length(btrim(body)) > 0),
  embedding  vector(1536),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists chat_messages_thread_idx
  on public.chat_messages (thread_id, created_at);

create index if not exists chat_messages_embedding_idx
  on public.chat_messages using hnsw (embedding vector_cosine_ops);

create index if not exists chat_messages_body_fts_idx
  on public.chat_messages using gin (to_tsvector('english', body));

create table if not exists public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.app_users (id) on delete cascade,
  title               text not null default 'New conversation',
  summary             text,
  summary_through_seq integer,
  message_count       integer not null default 0,
  last_message_at     timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists conversations_user_recent_idx
  on public.conversations (user_id, last_message_at desc);

create table if not exists public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  seq             integer not null,
  role            public.message_role not null,
  content         text not null,
  retrieval_mode  text,
  passage_count   integer,
  resolved_query  text,
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq)
);

create index if not exists conversation_messages_thread_idx
  on public.conversation_messages (conversation_id, seq);

create table if not exists public.message_citations (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.conversation_messages (id) on delete cascade,
  position       integer not null,
  kind           public.citation_kind not null default 'document',
  document_id    uuid references public.documents (id) on delete set null,
  thread_id      uuid references public.chat_threads (id) on delete set null,
  document_title text not null,
  page_number    integer,
  excerpt        text not null,
  unique (message_id, position)
);

create index if not exists message_citations_message_idx
  on public.message_citations (message_id);

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_administrator(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.app_users u
    where u.id = check_user_id and u.role = 'administrator'
  );
$fn$;

-- No administrator clause: an administrator manages access, and reads a
-- document only if an owner granted it to them like anybody else.
create or replace function public.can_read_document(check_document_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.documents d
    where d.id = check_document_id
      and (
        d.owner_id = check_user_id
        or exists (
          select 1 from public.document_access a
          where a.document_id = d.id and a.user_id = check_user_id
        )
      )
  );
$fn$;

create or replace function public.can_comment_on_document(check_document_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.documents d
    where d.id = check_document_id
      and (
        d.owner_id = check_user_id
        or exists (
          select 1 from public.document_access a
          where a.document_id = d.id
            and a.user_id = check_user_id
            and a.role >= 'commenter'
        )
      )
  );
$fn$;

create or replace function public.can_edit_document(check_document_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.documents d
    where d.id = check_document_id
      and (
        d.owner_id = check_user_id
        or exists (
          select 1 from public.document_access a
          where a.document_id = d.id
            and a.user_id = check_user_id
            and a.role >= 'editor'
        )
      )
  );
$fn$;

create or replace function public.can_manage_document(check_document_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.documents d
    where d.id = check_document_id
      and (d.owner_id = check_user_id or public.is_administrator(check_user_id))
  );
$fn$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists app_users_touch_updated_at on public.app_users;
create trigger app_users_touch_updated_at
  before update on public.app_users
  for each row execute function public.touch_updated_at();

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

drop trigger if exists conversations_touch_updated_at on public.conversations;
create trigger conversations_touch_updated_at
  before update on public.conversations
  for each row execute function public.touch_updated_at();

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

-- Security definer for the same reason as on Supabase: chat_participants's own
-- select policy calls this, and reading the table as the caller would re-enter
-- that policy and recurse.
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

create or replace function public.match_chat_messages(
  query_embedding vector(1536),
  match_count integer default 6,
  min_similarity double precision default 0.15
)
returns table (
  message_id   uuid,
  thread_id    uuid,
  thread_topic text,
  sender_name  text,
  body         text,
  created_at   timestamptz,
  similarity   double precision
)
language sql
stable
set search_path = public
as $fn$
  select
    m.id,
    m.thread_id,
    t.topic,
    coalesce(u.full_name, u.email, 'A former colleague'),
    m.body,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  left join public.app_users u on u.id = m.sender_id
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
  message_id   uuid,
  thread_id    uuid,
  thread_topic text,
  sender_name  text,
  body         text,
  created_at   timestamptz,
  rank         double precision
)
language sql
stable
set search_path = public
as $fn$
  select
    m.id,
    m.thread_id,
    t.topic,
    coalesce(u.full_name, u.email, 'A former colleague'),
    m.body,
    m.created_at,
    ts_rank(to_tsvector('english', m.body), websearch_to_tsquery('english', query_text))::double precision
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  left join public.app_users u on u.id = m.sender_id
  where to_tsvector('english', m.body) @@ websearch_to_tsquery('english', query_text)
    and t.is_group = true
  order by 7 desc
  limit least(greatest(match_count, 1), 50);
$fn$;

create or replace function public.find_or_create_direct_thread(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me uuid := app.current_user_id();
  found uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if other_user_id = me then
    raise exception 'Cannot start a conversation with yourself';
  end if;

  if not exists (select 1 from public.app_users where id = other_user_id) then
    raise exception 'No such person';
  end if;

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

create table if not exists public.document_comments (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  -- `set null`, not cascade: a departing colleague's comments are part of the
  -- document's history, and removing them rewrites a review thread.
  author_id   uuid references public.app_users (id) on delete set null,
  parent_id   uuid references public.document_comments (id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  page_number integer,
  -- The passage itself, not an offset: offsets break silently when an editor
  -- replaces the file, pointing at the wrong text rather than at nothing.
  quoted_text text,
  resolved_at timestamptz,
  resolved_by uuid references public.app_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists document_comments_document_idx
  on public.document_comments (document_id, created_at);

create index if not exists document_comments_parent_idx
  on public.document_comments (parent_id);

create index if not exists document_comments_unresolved_idx
  on public.document_comments (document_id)
  where resolved_at is null and parent_id is null;

drop trigger if exists document_comments_touch_updated_at on public.document_comments;
create trigger document_comments_touch_updated_at
  before update on public.document_comments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Phase 4: document-level embeddings and related documents
--
-- A document's vector is the mean of its chunks'. Chunk-to-chunk similarity
-- answers a different question: two documents can share one boilerplate
-- paragraph and be about nothing alike.
-- ---------------------------------------------------------------------------
create or replace view public.document_embeddings as
  select
    c.document_id,
    avg(c.embedding)::vector(1536) as embedding,
    count(*)                       as chunk_count
  from public.document_chunks c
  where c.embedding is not null
  group by c.document_id;

alter view public.document_embeddings set (security_invoker = true);

create or replace function public.related_documents(
  source_document_id uuid,
  match_count integer default 5,
  min_similarity double precision default 0.5
)
returns table (
  document_id uuid,
  title       text,
  tags        text[],
  similarity  double precision
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

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Identical rules to the Supabase schema, expressed through the adapter. This
-- is the part that would normally not survive a provider move, and the reason
-- the adapter exists at all.
-- ---------------------------------------------------------------------------
alter table public.app_users             enable row level security;
alter table public.invitations           enable row level security;
alter table public.documents             enable row level security;
alter table public.document_access       enable row level security;
alter table public.document_chunks       enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.message_citations     enable row level security;
alter table public.document_comments     enable row level security;
alter table public.chat_threads          enable row level security;
alter table public.chat_participants     enable row level security;
alter table public.chat_messages         enable row level security;

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to app_user using (true);

drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self on public.app_users
  for update to app_user
  using (id = app.current_user_id() or public.is_administrator(app.current_user_id()))
  with check (id = app.current_user_id() or public.is_administrator(app.current_user_id()));

drop policy if exists invitations_admin_all on public.invitations;
create policy invitations_admin_all on public.invitations
  for all to app_user
  using (public.is_administrator(app.current_user_id()))
  with check (public.is_administrator(app.current_user_id()));

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to app_user
  using (
    owner_id = app.current_user_id()
    or exists (
      select 1 from public.document_access a
      where a.document_id = documents.id and a.user_id = app.current_user_id()
    )
    or public.is_administrator(app.current_user_id())
  );

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert to app_user
  with check (owner_id = app.current_user_id());

drop policy if exists documents_update_own on public.documents;
create policy documents_update_own on public.documents
  for update to app_user
  using (public.can_edit_document(id, app.current_user_id()))
  with check (public.can_edit_document(id, app.current_user_id()));

drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete to app_user
  using (public.can_manage_document(id, app.current_user_id()));

drop policy if exists document_comments_select on public.document_comments;
create policy document_comments_select on public.document_comments
  for select to app_user
  using (public.can_read_document(document_id, app.current_user_id()));

drop policy if exists document_comments_insert on public.document_comments;
create policy document_comments_insert on public.document_comments
  for insert to app_user
  with check (
    author_id = app.current_user_id()
    and public.can_comment_on_document(document_id, app.current_user_id())
  );

drop policy if exists document_comments_update on public.document_comments;
create policy document_comments_update on public.document_comments
  for update to app_user
  using (
    author_id = app.current_user_id()
    or public.can_manage_document(document_id, app.current_user_id())
  )
  with check (
    author_id = app.current_user_id()
    or public.can_manage_document(document_id, app.current_user_id())
  );

drop policy if exists document_comments_delete on public.document_comments;
create policy document_comments_delete on public.document_comments
  for delete to app_user
  using (author_id = app.current_user_id());

drop policy if exists document_access_select on public.document_access;
create policy document_access_select on public.document_access
  for select to app_user
  using (
    user_id = app.current_user_id()
    or public.can_manage_document(document_id, app.current_user_id())
  );

drop policy if exists document_access_insert on public.document_access;
create policy document_access_insert on public.document_access
  for insert to app_user
  with check (public.can_manage_document(document_id, app.current_user_id()));

drop policy if exists document_access_delete on public.document_access;
create policy document_access_delete on public.document_access
  for delete to app_user
  using (public.can_manage_document(document_id, app.current_user_id()));

drop policy if exists document_chunks_select on public.document_chunks;
create policy document_chunks_select on public.document_chunks
  for select to app_user
  using (public.can_read_document(document_id, app.current_user_id()));

drop policy if exists conversations_owner_all on public.conversations;
create policy conversations_owner_all on public.conversations
  for all to app_user
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

drop policy if exists conversation_messages_owner_all on public.conversation_messages;
create policy conversation_messages_owner_all on public.conversation_messages
  for all to app_user
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id
        and c.user_id = app.current_user_id()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id
        and c.user_id = app.current_user_id()
    )
  );

drop policy if exists message_citations_owner_all on public.message_citations;
create policy message_citations_owner_all on public.message_citations
  for all to app_user
  using (
    exists (
      select 1
      from public.conversation_messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_citations.message_id
        and c.user_id = app.current_user_id()
    )
  )
  with check (
    exists (
      select 1
      from public.conversation_messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_citations.message_id
        and c.user_id = app.current_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Last-administrator protection
--
-- The application refuses to let you demote yourself, but two administrators
-- could demote each other to zero and then nobody could invite anybody again.
-- A trigger holds regardless of which code path made the change.
-- ---------------------------------------------------------------------------
create or replace function public.protect_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.role = 'administrator'
     and old.deactivated_at is null
     and (new.role <> 'administrator' or new.deactivated_at is not null)
  then
    if not exists (
      select 1 from public.app_users u
      where u.role = 'administrator'
        and u.deactivated_at is null
        and u.id <> old.id
    ) then
      raise exception
        'This is the last active administrator. Promote somebody else first, '
        'or nobody will be able to invite anyone again.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists app_users_protect_last_administrator on public.app_users;
create trigger app_users_protect_last_administrator
  before update on public.app_users
  for each row execute function public.protect_last_administrator();

-- Team messaging. No administrator clause anywhere: an administrator cannot
-- read documents since migration 0007, and private messages are further still.
drop policy if exists chat_threads_select on public.chat_threads;
create policy chat_threads_select on public.chat_threads
  for select to app_user using (public.is_chat_participant(id, app.current_user_id()));

drop policy if exists chat_threads_insert on public.chat_threads;
create policy chat_threads_insert on public.chat_threads
  for insert to app_user with check (created_by = app.current_user_id());

drop policy if exists chat_threads_update on public.chat_threads;
create policy chat_threads_update on public.chat_threads
  for update to app_user using (public.is_chat_participant(id, app.current_user_id()));

drop policy if exists chat_participants_select on public.chat_participants;
create policy chat_participants_select on public.chat_participants
  for select to app_user
  using (public.is_chat_participant(thread_id, app.current_user_id()));

drop policy if exists chat_participants_insert on public.chat_participants;
create policy chat_participants_insert on public.chat_participants
  for insert to app_user
  with check (
    public.is_chat_participant(thread_id, app.current_user_id())
    or exists (
      select 1 from public.chat_threads t
      where t.id = thread_id and t.created_by = app.current_user_id()
    )
  );

drop policy if exists chat_participants_delete on public.chat_participants;
create policy chat_participants_delete on public.chat_participants
  for delete to app_user using (user_id = app.current_user_id());

drop policy if exists chat_participants_update_self on public.chat_participants;
create policy chat_participants_update_self on public.chat_participants
  for update to app_user using (user_id = app.current_user_id());

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to app_user
  using (public.is_chat_participant(thread_id, app.current_user_id()));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to app_user
  with check (
    sender_id = app.current_user_id()
    and public.is_chat_participant(thread_id, app.current_user_id())
  );

drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages
  for update to app_user using (sender_id = app.current_user_id());

drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own on public.chat_messages
  for delete to app_user using (sender_id = app.current_user_id());

grant usage on schema public, app to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public, app to app_user;

-- Phase 5 message collaboration (Supabase migration 0011), expressed through
-- the portable identity adapter rather than auth.uid().
alter table public.chat_messages
  add column if not exists parent_id uuid references public.chat_messages (id) on delete restrict,
  add column if not exists retracted_at timestamptz,
  add column if not exists retracted_by uuid references public.app_users (id) on delete set null;

create index if not exists chat_messages_parent_id_idx on public.chat_messages (parent_id, created_at);
create index if not exists chat_messages_retracted_by_idx on public.chat_messages (retracted_by);

create table if not exists public.chat_mentions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  mentioned_user_id uuid not null references public.app_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.app_users (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '🎉', '👀', '✅')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.chat_message_versions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete restrict,
  body text not null,
  edited_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists chat_mentions_mentioned_user_idx on public.chat_mentions (mentioned_user_id, created_at desc);
create index if not exists chat_reactions_user_idx on public.chat_reactions (user_id);
create index if not exists chat_message_versions_message_idx on public.chat_message_versions (message_id, created_at desc);
create index if not exists chat_message_versions_edited_by_idx on public.chat_message_versions (edited_by);

create or replace function public.validate_chat_message_write()
returns trigger language plpgsql security definer set search_path = public, app as $fn$
declare parent_thread uuid; parent_parent uuid;
begin
  if tg_op = 'UPDATE' then
    if new.thread_id <> old.thread_id or new.sender_id is distinct from old.sender_id
      or new.parent_id is distinct from old.parent_id or new.created_at <> old.created_at then
      raise exception 'Message identity fields cannot be changed';
    end if;
    if old.retracted_at is not null and new is distinct from old then
      raise exception 'A retracted message cannot be changed';
    end if;
    if new.body is distinct from old.body and new.retracted_at is not distinct from old.retracted_at then
      insert into public.chat_message_versions (message_id, body, edited_by)
      values (old.id, old.body, app.current_user_id());
      new.edited_at := now(); new.embedding := null;
    end if;
    if new.retracted_at is distinct from old.retracted_at then
      if old.retracted_at is not null or new.retracted_at is null
        or new.retracted_by is distinct from app.current_user_id()
        or old.sender_id is distinct from app.current_user_id() then
        raise exception 'Invalid message retraction';
      end if;
      insert into public.chat_message_versions (message_id, body, edited_by)
      values (old.id, old.body, app.current_user_id());
      new.retracted_at := now();
      new.body := '[Message retracted]'; new.embedding := null;
    elsif new.retracted_by is distinct from old.retracted_by then
      raise exception 'Retraction identity cannot be changed';
    end if;
  end if;
  if new.parent_id is not null then
    select m.thread_id, m.parent_id into parent_thread, parent_parent
    from public.chat_messages m where m.id = new.parent_id;
    if parent_thread is null or parent_thread <> new.thread_id then
      raise exception 'A reply must belong to the same conversation';
    end if;
    if parent_parent is not null then raise exception 'Replies may only be one level deep'; end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists chat_messages_validate_write on public.chat_messages;
create trigger chat_messages_validate_write before insert or update on public.chat_messages
  for each row execute function public.validate_chat_message_write();
revoke execute on function public.validate_chat_message_write() from public, app_user;

alter table public.chat_mentions enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_message_versions enable row level security;

drop policy if exists chat_mentions_select on public.chat_mentions;
create policy chat_mentions_select on public.chat_mentions for select to app_user using (
  exists (select 1 from public.chat_messages m where m.id = message_id
    and m.retracted_at is null
    and public.is_chat_participant(m.thread_id, app.current_user_id())));
drop policy if exists chat_mentions_insert on public.chat_mentions;
create policy chat_mentions_insert on public.chat_mentions for insert to app_user with check (
  exists (select 1 from public.chat_messages m where m.id = message_id
    and m.sender_id = app.current_user_id()
    and public.is_chat_participant(m.thread_id, mentioned_user_id)));
drop policy if exists chat_reactions_select on public.chat_reactions;
create policy chat_reactions_select on public.chat_reactions for select to app_user using (
  exists (select 1 from public.chat_messages m where m.id = message_id
    and m.retracted_at is null
    and public.is_chat_participant(m.thread_id, app.current_user_id())));
drop policy if exists chat_reactions_insert on public.chat_reactions;
create policy chat_reactions_insert on public.chat_reactions for insert to app_user with check (
  user_id = app.current_user_id() and exists (
    select 1 from public.chat_messages m where m.id = message_id and m.retracted_at is null
      and public.is_chat_participant(m.thread_id, app.current_user_id())));
drop policy if exists chat_reactions_delete_own on public.chat_reactions;
create policy chat_reactions_delete_own on public.chat_reactions for delete to app_user
  using (user_id = app.current_user_id());
drop policy if exists chat_message_versions_select on public.chat_message_versions;
create policy chat_message_versions_select on public.chat_message_versions for select to app_user using (
  exists (select 1 from public.chat_messages m where m.id = message_id and m.retracted_at is null
    and public.is_chat_participant(m.thread_id, app.current_user_id())));

drop policy if exists chat_messages_delete_own on public.chat_messages;

create or replace function public.send_chat_message(
  target_thread_id uuid, message_body text, reply_to_id uuid default null,
  mentioned_user_ids uuid[] default '{}'::uuid[]
) returns uuid language plpgsql security invoker set search_path = public, app as $fn$
declare me uuid := app.current_user_id(); new_message_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if length(btrim(message_body)) = 0 or length(btrim(message_body)) > 4000 then
    raise exception 'Message body is invalid';
  end if;
  insert into public.chat_messages (thread_id, sender_id, body, parent_id)
  values (target_thread_id, me, btrim(message_body), reply_to_id) returning id into new_message_id;
  insert into public.chat_mentions (message_id, mentioned_user_id)
  select new_message_id, member_id from (
    select distinct unnest(mentioned_user_ids) as member_id
  ) mentions where member_id <> me;
  return new_message_id;
end;
$fn$;

grant select, insert on public.chat_mentions to app_user;
grant select, insert, delete on public.chat_reactions to app_user;
grant select on public.chat_message_versions to app_user;
grant execute on function public.send_chat_message(uuid, text, uuid, uuid[]) to app_user;
revoke delete on public.chat_messages from app_user;

-- Portable helper schema: callable from RLS policies but not exposed as an API schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to app_user;

-- Phase 5 Teams foundation (Supabase migration 0012), expressed through the portable identity adapter and app_users alias.
--
-- `chat_threads` remains the one conversation store. A durable kind now
-- distinguishes direct conversations from Teams, while Team visibility drives
-- discovery, reading and retrieval dynamically. There is deliberately no
-- administrator exception in the message-reading helper: administrators may
-- manage a closed Team's membership without reading what its members say.

do $$ begin
  create type public.chat_thread_kind as enum ('direct', 'team');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.chat_team_visibility as enum ('open', 'closed');
exception when duplicate_object then null; end $$;

alter table public.chat_threads
  add column if not exists kind public.chat_thread_kind,
  add column if not exists visibility public.chat_team_visibility,
  add column if not exists purpose text;

-- Preserve every existing conversation. Historical group threads become
-- closed Teams, because silently making their contents company-readable would
-- expand access. A historical non-group thread is a direct conversation only
-- when it still has exactly two participants. The old UI allowed leaving a DM,
-- so an orphaned 0/1-person row is retained as a closed Team rather than making
-- this migration fail or deleting its evidence.
with classified as (
  select
    t.id,
    case
      when not t.is_group and count(p.user_id) = 2
        then 'direct'::public.chat_thread_kind
      else 'team'::public.chat_thread_kind
    end as durable_kind
  from public.chat_threads t
  left join public.chat_participants p on p.thread_id = t.id
  group by t.id, t.is_group
)
update public.chat_threads t
set kind = c.durable_kind,
    is_group = (c.durable_kind = 'team'),
    visibility = case
      when c.durable_kind = 'team' then 'closed'::public.chat_team_visibility
      else null
    end,
    topic = case
      when c.durable_kind = 'team'
        then coalesce(nullif(btrim(t.topic), ''), 'Existing conversation')
      else t.topic
    end,
    purpose = case when c.durable_kind = 'team' then t.purpose else null end
from classified c
where c.id = t.id;

alter table public.chat_threads alter column kind set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_threads_kind_shape_check'
      and conrelid = 'public.chat_threads'::regclass
  ) then
    alter table public.chat_threads
      add constraint chat_threads_kind_shape_check check (
        (kind = 'direct' and is_group = false and visibility is null and purpose is null)
        or
        (kind = 'team' and is_group = true and visibility is not null
          and topic is not null
          and length(btrim(topic)) between 1 and 120
          and (purpose is null or length(btrim(purpose)) between 1 and 500))
      );
  end if;
end $$;

create index if not exists chat_threads_kind_visibility_recent_idx
  on public.chat_threads (kind, visibility, last_message_at desc);

create index if not exists chat_participants_thread_joined_idx
  on public.chat_participants (thread_id, joined_at);

-- Kind is identity, not editable metadata. Visibility and purpose may change
-- for a Team, but a Team can never be turned into a DM (or vice versa) to gain
-- a different permission model around existing messages.
create or replace function private.protect_chat_thread_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.kind is distinct from old.kind or new.is_group is distinct from old.is_group then
    raise exception 'Conversation kind cannot be changed';
  end if;
  return new;
end;
$fn$;

revoke execute on function private.protect_chat_thread_kind()
  from public, app_user;

drop trigger if exists chat_threads_protect_kind on public.chat_threads;
create trigger chat_threads_protect_kind
  before update on public.chat_threads
  for each row execute function private.protect_chat_thread_kind();

-- A participant row's identity is immutable. Without this guard an UPDATE
-- could move one side of a DM to another thread while satisfying policies at
-- both ends, bypassing the insert/delete boundary and the two-person invariant.
create or replace function private.protect_chat_participant_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.thread_id is distinct from old.thread_id
    or new.user_id is distinct from old.user_id
    or new.joined_at is distinct from old.joined_at then
    raise exception 'Conversation membership identity cannot be changed';
  end if;
  return new;
end;
$fn$;

revoke execute on function private.protect_chat_participant_identity()
  from public, app_user;

drop trigger if exists chat_participants_protect_identity on public.chat_participants;
create trigger chat_participants_protect_identity
  before update on public.chat_participants
  for each row execute function private.protect_chat_participant_identity();

-- Request-aware helpers. Each captures app.current_user_id() internally, checks that the
-- session still belongs to an active staff profile, and is kept outside the
-- exposed schema. They break the RLS recursion that would otherwise occur when
-- chat_threads and chat_participants policies inspect each other.
create or replace function private.can_view_chat_thread(check_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_threads t
    join public.app_users me on me.id = (select app.current_user_id())
    where t.id = check_thread_id
      and me.deactivated_at is null
      and (
        (t.kind = 'direct' and exists (
          select 1 from public.chat_participants p
          where p.thread_id = t.id and p.user_id = me.id
        ))
        or
        (t.kind = 'team' and (
          t.visibility = 'open'
          or t.created_by = me.id
          or exists (
            select 1 from public.chat_participants p
            where p.thread_id = t.id and p.user_id = me.id
          )
          or public.is_administrator(me.id)
        ))
      )
  );
$fn$;

create or replace function private.can_read_chat_messages(check_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_threads t
    join public.app_users me on me.id = (select app.current_user_id())
    where t.id = check_thread_id
      and me.deactivated_at is null
      and (
        (t.kind = 'direct' and exists (
          select 1 from public.chat_participants p
          where p.thread_id = t.id and p.user_id = me.id
        ))
        or
        (t.kind = 'team' and (
          t.visibility = 'open'
          or exists (
            select 1 from public.chat_participants p
            where p.thread_id = t.id and p.user_id = me.id
          )
        ))
      )
  );
$fn$;

create or replace function private.can_post_chat_message(check_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_threads t
    join public.app_users me on me.id = (select app.current_user_id())
    join public.chat_participants p
      on p.thread_id = t.id and p.user_id = me.id
    where t.id = check_thread_id
      and me.deactivated_at is null
  );
$fn$;

create or replace function private.can_update_chat_thread(check_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_threads t
    join public.app_users me on me.id = (select app.current_user_id())
    where t.id = check_thread_id
      and me.deactivated_at is null
      and (
        (t.kind = 'direct' and exists (
          select 1 from public.chat_participants p
          where p.thread_id = t.id and p.user_id = me.id
        ))
        or
        (t.kind = 'team' and (
          t.created_by = me.id or public.is_administrator(me.id)
        ))
      )
  );
$fn$;

create or replace function private.can_add_team_member(check_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_threads t
    join public.app_users me on me.id = (select app.current_user_id())
    where t.id = check_thread_id
      and t.kind = 'team'
      and me.deactivated_at is null
      and (
        t.created_by = me.id
        or public.is_administrator(me.id)
        or exists (
          select 1 from public.chat_participants p
          where p.thread_id = t.id and p.user_id = me.id
        )
      )
  );
$fn$;

create or replace function private.can_remove_team_member(
  check_thread_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.chat_threads t
    join public.app_users me on me.id = (select app.current_user_id())
    where t.id = check_thread_id
      and t.kind = 'team'
      and me.deactivated_at is null
      and (
        target_user_id = me.id
        or t.created_by = me.id
        or public.is_administrator(me.id)
      )
  );
$fn$;

revoke execute on function private.can_view_chat_thread(uuid)
  from public, app_user;
revoke execute on function private.can_read_chat_messages(uuid)
  from public, app_user;
revoke execute on function private.can_post_chat_message(uuid)
  from public, app_user;
revoke execute on function private.can_update_chat_thread(uuid)
  from public, app_user;
revoke execute on function private.can_add_team_member(uuid)
  from public, app_user;
revoke execute on function private.can_remove_team_member(uuid, uuid)
  from public, app_user;

-- These predicates are invoked by RLS as app_user. Keep them outside the
-- application schema, but grant the policy caller the execution it requires.
grant execute on function private.can_view_chat_thread(uuid) to app_user;
grant execute on function private.can_read_chat_messages(uuid) to app_user;
grant execute on function private.can_post_chat_message(uuid) to app_user;
grant execute on function private.can_update_chat_thread(uuid) to app_user;
grant execute on function private.can_add_team_member(uuid) to app_user;
grant execute on function private.can_remove_team_member(uuid, uuid) to app_user;

-- Direct membership is fixed at two. A deferred constraint allows the direct-
-- thread RPC to insert both rows atomically, but rejects adding, removing or
-- moving either participant at commit. Deactivation, not deletion, remains the
-- supported employee-lifecycle operation.
create or replace function private.enforce_direct_participant_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  affected_thread uuid := coalesce(new.thread_id, old.thread_id);
  affected_kind public.chat_thread_kind;
  participant_count bigint;
begin
  select t.kind into affected_kind
  from public.chat_threads t
  where t.id = affected_thread;

  -- The thread may have been removed by a privileged cascade.
  if affected_kind is null then return null; end if;

  if affected_kind = 'direct' then
    select count(*) into participant_count
    from public.chat_participants p
    where p.thread_id = affected_thread;

    if participant_count <> 2 then
      raise exception 'A direct conversation must have exactly two participants';
    end if;
  end if;

  return null;
end;
$fn$;

revoke execute on function private.enforce_direct_participant_count()
  from public, app_user;

drop trigger if exists chat_participants_direct_count on public.chat_participants;
create constraint trigger chat_participants_direct_count
  after insert or update or delete on public.chat_participants
  deferrable initially deferred
  for each row execute function private.enforce_direct_participant_count();

do $$ begin
  if exists (
    select 1
    from public.chat_threads t
    left join public.chat_participants p on p.thread_id = t.id
    where t.kind = 'direct'
    group by t.id
    having count(p.user_id) <> 2
  ) then
    raise exception 'Existing direct conversations must have exactly two participants';
  end if;
end $$;

-- Direct creation remains one race-safe RPC. The advisory lock serialises the
-- same unordered user pair, so concurrent opens cannot create duplicate DMs.
create or replace function public.find_or_create_direct_thread(other_user_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  me uuid := app.current_user_id();
  found uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if other_user_id = me then raise exception 'Cannot message yourself'; end if;

  if not exists (
    select 1 from public.app_users p
    where p.id = me and p.deactivated_at is null
  ) or not exists (
    select 1 from public.app_users p
    where p.id = other_user_id and p.deactivated_at is null
  ) then
    raise exception 'That person is unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(me::text, other_user_id::text) || ':' ||
      greatest(me::text, other_user_id::text),
      0
    )
  );

  select t.id into found
  from public.chat_threads t
  join public.chat_participants mine
    on mine.thread_id = t.id and mine.user_id = me
  join public.chat_participants theirs
    on theirs.thread_id = t.id and theirs.user_id = other_user_id
  where t.kind = 'direct'
    and (select count(*) from public.chat_participants p where p.thread_id = t.id) = 2
  order by t.created_at
  limit 1;

  if found is not null then return found; end if;

  insert into public.chat_threads (created_by, topic, is_group, kind, visibility, purpose)
  values (me, null, false, 'direct', null, null)
  returning id into found;

  insert into public.chat_participants (thread_id, user_id)
  values (found, me), (found, other_user_id);

  return found;
end;
$fn$;

-- Team creation is SECURITY DEFINER because INSERT ... RETURNING must satisfy
-- the select policy before the creator's participant row exists. The function
-- captures the application user, validates active staff and writes only the
-- new Team plus its requested active members in one transaction.
create or replace function public.create_team(
  team_name text,
  team_purpose text,
  team_visibility public.chat_team_visibility default 'closed',
  initial_member_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  me uuid := app.current_user_id();
  new_team_id uuid;
begin
  if me is null or not exists (
    select 1 from public.app_users p
    where p.id = me and p.deactivated_at is null
  ) then
    raise exception 'Not an active staff member' using errcode = '42501';
  end if;

  if team_name is null or length(btrim(team_name)) not between 1 and 120 then
    raise exception 'Team name is invalid';
  end if;
  if team_purpose is not null and length(btrim(team_purpose)) > 500 then
    raise exception 'Team purpose is invalid';
  end if;
  if team_visibility is null then raise exception 'Team visibility is required'; end if;

  if exists (
    select 1
    from unnest(coalesce(initial_member_ids, '{}'::uuid[])) member_id
    where member_id <> me
      and not exists (
        select 1 from public.app_users p
        where p.id = member_id and p.deactivated_at is null
      )
  ) then
    raise exception 'Every initial Team member must be active staff';
  end if;

  insert into public.chat_threads (
    created_by, topic, is_group, kind, visibility, purpose
  ) values (
    me, btrim(team_name), true, 'team', team_visibility,
    nullif(btrim(team_purpose), '')
  ) returning id into new_team_id;

  insert into public.chat_participants (thread_id, user_id)
  select new_team_id, member_id
  from (
    select me as member_id
    union
    select unnest(coalesce(initial_member_ids, '{}'::uuid[]))
  ) members
  on conflict (thread_id, user_id) do nothing;

  return new_team_id;
end;
$fn$;

create or replace function public.join_team(target_thread_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare me uuid := app.current_user_id();
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  insert into public.chat_participants (thread_id, user_id)
  values (target_thread_id, me)
  on conflict (thread_id, user_id) do nothing;
end;
$fn$;

create or replace function public.add_team_member(
  target_thread_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.app_users p
    where p.id = target_user_id and p.deactivated_at is null
  ) then
    raise exception 'That person is unavailable';
  end if;

  insert into public.chat_participants (thread_id, user_id)
  values (target_thread_id, target_user_id)
  on conflict (thread_id, user_id) do nothing;
end;
$fn$;

create or replace function public.remove_team_member(
  target_thread_id uuid,
  target_user_id uuid
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $fn$
  delete from public.chat_participants
  where thread_id = target_thread_id and user_id = target_user_id;
$fn$;

-- Rebuild the complete collaboration boundary around kind and visibility.
drop policy if exists chat_threads_select on public.chat_threads;
create policy chat_threads_select on public.chat_threads
  for select to app_user
  using (private.can_view_chat_thread(id));

drop policy if exists chat_threads_insert on public.chat_threads;
create policy chat_threads_insert on public.chat_threads
  for insert to app_user
  with check (
    created_by = (select app.current_user_id())
    and kind = 'team'
    and is_group = true
    and exists (
      select 1 from public.app_users p
      where p.id = (select app.current_user_id()) and p.deactivated_at is null
    )
  );

drop policy if exists chat_threads_update on public.chat_threads;
create policy chat_threads_update on public.chat_threads
  for update to app_user
  using (private.can_update_chat_thread(id))
  with check (private.can_update_chat_thread(id));

drop policy if exists chat_participants_select on public.chat_participants;
create policy chat_participants_select on public.chat_participants
  for select to app_user
  using (private.can_view_chat_thread(thread_id));

drop policy if exists chat_participants_insert on public.chat_participants;
create policy chat_participants_insert on public.chat_participants
  for insert to app_user
  with check (
    exists (
      select 1
      from public.chat_threads t
      join public.app_users target on target.id = user_id
      where t.id = thread_id
        and t.kind = 'team'
        and target.deactivated_at is null
        and (
          private.can_add_team_member(t.id)
          or (
            user_id = (select app.current_user_id())
            and t.visibility = 'open'
          )
        )
    )
  );

drop policy if exists chat_participants_update_self on public.chat_participants;
create policy chat_participants_update_self on public.chat_participants
  for update to app_user
  using (
    user_id = (select app.current_user_id())
    and private.can_read_chat_messages(thread_id)
  )
  with check (
    user_id = (select app.current_user_id())
    and private.can_read_chat_messages(thread_id)
  );

drop policy if exists chat_participants_delete on public.chat_participants;
create policy chat_participants_delete on public.chat_participants
  for delete to app_user
  using (private.can_remove_team_member(thread_id, user_id));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to app_user
  using (private.can_read_chat_messages(thread_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to app_user
  with check (
    sender_id = (select app.current_user_id())
    and private.can_post_chat_message(thread_id)
  );

drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages
  for update to app_user
  using (
    sender_id = (select app.current_user_id())
    and private.can_post_chat_message(thread_id)
  )
  with check (
    sender_id = (select app.current_user_id())
    and private.can_post_chat_message(thread_id)
  );

drop policy if exists chat_messages_delete_own on public.chat_messages;

drop policy if exists chat_mentions_select on public.chat_mentions;
create policy chat_mentions_select on public.chat_mentions
  for select to app_user
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.can_read_chat_messages(m.thread_id)
    )
  );

drop policy if exists chat_mentions_insert on public.chat_mentions;
create policy chat_mentions_insert on public.chat_mentions
  for insert to app_user
  with check (
    exists (
      select 1
      from public.chat_messages m
      join public.chat_participants mentioned
        on mentioned.thread_id = m.thread_id
       and mentioned.user_id = mentioned_user_id
      where m.id = message_id
        and m.sender_id = (select app.current_user_id())
        and m.retracted_at is null
        and private.can_post_chat_message(m.thread_id)
    )
  );

drop policy if exists chat_reactions_select on public.chat_reactions;
create policy chat_reactions_select on public.chat_reactions
  for select to app_user
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.can_read_chat_messages(m.thread_id)
    )
  );

drop policy if exists chat_reactions_insert on public.chat_reactions;
create policy chat_reactions_insert on public.chat_reactions
  for insert to app_user
  with check (
    user_id = (select app.current_user_id())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.can_post_chat_message(m.thread_id)
    )
  );

drop policy if exists chat_reactions_delete_own on public.chat_reactions;
create policy chat_reactions_delete_own on public.chat_reactions
  for delete to app_user
  using (
    user_id = (select app.current_user_id())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and private.can_read_chat_messages(m.thread_id)
    )
  );

drop policy if exists chat_message_versions_select on public.chat_message_versions;
create policy chat_message_versions_select on public.chat_message_versions
  for select to app_user
  using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.can_read_chat_messages(m.thread_id)
    )
  );

-- Ask retrieves Teams only. Open Team messages are available to every active
-- staff member; closed Team messages are available to members. DMs never enter
-- retrieval, and an administrator who is not a member receives no closed-Team
-- message rows from RLS.
create or replace function public.match_chat_messages(
  query_embedding vector(1536),
  match_count integer default 6,
  min_similarity double precision default 0.15
)
returns table (
  message_id uuid,
  thread_id uuid,
  thread_topic text,
  sender_name text,
  body text,
  created_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    m.id,
    m.thread_id,
    t.topic,
    coalesce(p.full_name, p.email, 'A former colleague'),
    m.body,
    m.created_at,
    1 - (m.embedding OPERATOR(public.<=>) query_embedding) as similarity
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  left join public.app_users p on p.id = m.sender_id
  where m.embedding is not null
    and m.retracted_at is null
    and t.kind = 'team'
    and 1 - (m.embedding OPERATOR(public.<=>) query_embedding) >= min_similarity
  order by m.embedding OPERATOR(public.<=>) query_embedding
  limit least(greatest(match_count, 1), 50);
$fn$;

create or replace function public.search_chat_messages(
  query_text text,
  match_count integer default 6
)
returns table (
  message_id uuid,
  thread_id uuid,
  thread_topic text,
  sender_name text,
  body text,
  created_at timestamptz,
  rank double precision
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    m.id,
    m.thread_id,
    t.topic,
    coalesce(p.full_name, p.email, 'A former colleague'),
    m.body,
    m.created_at,
    ts_rank(
      to_tsvector('english', m.body),
      websearch_to_tsquery('english', query_text)
    )::double precision
  from public.chat_messages m
  join public.chat_threads t on t.id = m.thread_id
  left join public.app_users p on p.id = m.sender_id
  where m.retracted_at is null
    and t.kind = 'team'
    and to_tsvector('english', m.body)
      @@ websearch_to_tsquery('english', query_text)
  order by 7 desc
  limit least(greatest(match_count, 1), 50);
$fn$;

-- Least-privilege Data API and RPC surface. RLS remains the row authority.

revoke all privileges on table public.chat_threads from app_user;
revoke all privileges on table public.chat_participants from app_user;
revoke all privileges on table public.chat_messages from app_user;
revoke all privileges on table public.chat_mentions from app_user;
revoke all privileges on table public.chat_reactions from app_user;
revoke all privileges on table public.chat_message_versions from app_user;

grant select, insert, update on table public.chat_threads to app_user;
grant select, insert, update, delete on table public.chat_participants to app_user;
grant select, insert, update on table public.chat_messages to app_user;
grant select, insert on table public.chat_mentions to app_user;
grant select, insert, delete on table public.chat_reactions to app_user;
grant select on table public.chat_message_versions to app_user;

revoke execute on function public.find_or_create_direct_thread(uuid) from public;
revoke execute on function public.create_team(text, text, public.chat_team_visibility, uuid[]) from public;
revoke execute on function public.join_team(uuid) from public;
revoke execute on function public.add_team_member(uuid, uuid) from public;
revoke execute on function public.remove_team_member(uuid, uuid) from public;
revoke execute on function public.match_chat_messages(vector, integer, double precision) from public;
revoke execute on function public.search_chat_messages(text, integer) from public;

grant execute on function public.find_or_create_direct_thread(uuid) to app_user;
grant execute on function public.create_team(text, text, public.chat_team_visibility, uuid[]) to app_user;
grant execute on function public.join_team(uuid) to app_user;
grant execute on function public.add_team_member(uuid, uuid) to app_user;
grant execute on function public.remove_team_member(uuid, uuid) to app_user;
grant execute on function public.match_chat_messages(vector, integer, double precision) to app_user;
grant execute on function public.search_chat_messages(text, integer) to app_user;

-- Phase 5 Team document access (Supabase migration 0013), translated through
-- app.current_user_id(), app_user and app_users.
create table if not exists public.document_team_access (
  document_id uuid not null references public.documents (id) on delete cascade,
  team_id     uuid not null references public.chat_threads (id) on delete cascade,
  role        public.document_role not null default 'viewer',
  granted_by  uuid references public.app_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (document_id, team_id)
);

create index if not exists document_team_access_team_idx
  on public.document_team_access (team_id, document_id);
create index if not exists document_team_access_granted_by_idx
  on public.document_team_access (granted_by);

-- The FK proves the target is a conversation; this trigger proves it is a Team
-- and keeps the grant identity immutable. Thread kind is immutable since 0012.
create or replace function private.validate_document_team_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.chat_threads t
    where t.id = new.team_id and t.kind = 'team'
  ) then
    raise exception 'Document access may target a Team only'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
    new.document_id is distinct from old.document_id
    or new.team_id is distinct from old.team_id
    or new.granted_by is distinct from old.granted_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'A Team grant identity cannot be changed'
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

revoke execute on function private.validate_document_team_access()
  from public, app_user;

drop trigger if exists document_team_access_validate on public.document_team_access;
create trigger document_team_access_validate
  before insert or update on public.document_team_access
  for each row execute function private.validate_document_team_access();

-- Direct and Team grants may coexist; the ordered role enum makes the higher
-- effective permission win. Administrators are deliberately absent here.
create or replace function public.can_read_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.documents d
    where d.id = check_document_id
      and (
        d.owner_id = check_user_id
        or exists (
          select 1 from public.document_access a
          where a.document_id = d.id and a.user_id = check_user_id
        )
        or exists (
          select 1
          from public.document_team_access ta
          join public.chat_threads t
            on t.id = ta.team_id and t.kind = 'team'
          join public.chat_participants p
            on p.thread_id = t.id and p.user_id = check_user_id
          where ta.document_id = d.id
        )
      )
  );
$fn$;

create or replace function public.can_comment_on_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.documents d
    where d.id = check_document_id
      and (
        d.owner_id = check_user_id
        or exists (
          select 1 from public.document_access a
          where a.document_id = d.id
            and a.user_id = check_user_id
            and a.role >= 'commenter'
        )
        or exists (
          select 1
          from public.document_team_access ta
          join public.chat_threads t
            on t.id = ta.team_id and t.kind = 'team'
          join public.chat_participants p
            on p.thread_id = t.id and p.user_id = check_user_id
          where ta.document_id = d.id and ta.role >= 'commenter'
        )
      )
  );
$fn$;

create or replace function public.can_edit_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.documents d
    where d.id = check_document_id
      and (
        d.owner_id = check_user_id
        or exists (
          select 1 from public.document_access a
          where a.document_id = d.id
            and a.user_id = check_user_id
            and a.role >= 'editor'
        )
        or exists (
          select 1
          from public.document_team_access ta
          join public.chat_threads t
            on t.id = ta.team_id and t.kind = 'team'
          join public.chat_participants p
            on p.thread_id = t.id and p.user_id = check_user_id
          where ta.document_id = d.id and ta.role >= 'editor'
        )
      )
  );
$fn$;

-- Administrators keep metadata visibility without gaining content access.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to app_user
  using (
    public.can_read_document(id, app.current_user_id())
    or public.is_administrator(app.current_user_id())
  );

alter table public.document_team_access enable row level security;

drop policy if exists document_team_access_select on public.document_team_access;
create policy document_team_access_select on public.document_team_access
  for select to app_user
  using (public.can_manage_document(document_id, app.current_user_id()));

drop policy if exists document_team_access_insert on public.document_team_access;
create policy document_team_access_insert on public.document_team_access
  for insert to app_user
  with check (
    granted_by = app.current_user_id()
    and public.can_manage_document(document_id, app.current_user_id())
  );

drop policy if exists document_team_access_update on public.document_team_access;
create policy document_team_access_update on public.document_team_access
  for update to app_user
  using (public.can_manage_document(document_id, app.current_user_id()))
  with check (public.can_manage_document(document_id, app.current_user_id()));

drop policy if exists document_team_access_delete on public.document_team_access;
create policy document_team_access_delete on public.document_team_access
  for delete to app_user
  using (public.can_manage_document(document_id, app.current_user_id()));

revoke all privileges on table public.document_team_access from app_user;
grant select, insert, update, delete on table public.document_team_access to app_user;

-- Membership managers can see the consequence of adding someone without
-- learning document titles or any content.
create or replace function public.team_document_grant_count(target_team_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  result bigint;
begin
  if (select app.current_user_id()) is null
     or not private.can_add_team_member(target_team_id) then
    raise exception 'Not allowed to manage this Team'
      using errcode = '42501';
  end if;

  select count(*) into result
  from public.document_team_access ta
  where ta.team_id = target_team_id;

  return result;
end;
$fn$;

revoke execute on function public.team_document_grant_count(uuid) from public;
grant execute on function public.team_document_grant_count(uuid) to app_user;
-- Phase 5: permission-aware document references (Supabase migration 0014), expressed through the portable identity adapter and app_users alias.
-- The reference row is visible with the conversation; document metadata is
-- resolved separately through an access-filtered RPC so even an administrator
-- cannot learn a restricted title from an open Team message.

create table if not exists public.chat_document_references (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.chat_messages (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (message_id, document_id)
);

create index if not exists chat_document_references_message_idx
  on public.chat_document_references (message_id, created_at);

create index if not exists chat_document_references_document_idx
  on public.chat_document_references (document_id, message_id);

alter table public.chat_document_references enable row level security;

drop policy if exists chat_document_references_insert on public.chat_document_references;
create policy chat_document_references_insert on public.chat_document_references
  for insert to app_user
  with check (
    public.can_read_document(document_id, (select app.current_user_id()))
    and exists (
      select 1
      from public.chat_messages m
      where m.id = message_id
        and m.sender_id = (select app.current_user_id())
        and private.can_post_chat_message(m.thread_id)
    )
  );

-- The base table is intentionally not selectable through the Data API. Every
-- identifier and title is CASE-gated here; a locked card discloses no document
-- identifier that a client could use as an oracle elsewhere.
create or replace function public.list_chat_document_references(target_thread_id uuid)
returns table (
  message_id uuid,
  locked boolean,
  document_id uuid,
  title text,
  mime_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare me uuid := app.current_user_id();
begin
  if me is null or not private.can_read_chat_messages(target_thread_id) then
    raise exception 'Conversation is unavailable' using errcode = '42501';
  end if;

  return query
  select
    r.message_id,
    not allowed as locked,
    case when allowed then d.id else null end as document_id,
    case when allowed then d.title else null end as title,
    case when allowed then d.mime_type else null end as mime_type
  from public.chat_document_references r
  join public.chat_messages m on m.id = r.message_id
  left join public.documents d on d.id = r.document_id
  cross join lateral (
    select r.document_id is not null
      and public.can_read_document(r.document_id, me) as allowed
  ) permission
  where m.thread_id = target_thread_id
  order by r.created_at, r.id;
end;
$fn$;

-- A safe picker and renderer source. Querying documents directly is not enough:
-- administrators intentionally see management metadata without content. This
-- function returns titles only for documents the current user may actually read.
create or replace function public.list_referenceable_documents()
returns table (id uuid, title text, mime_type text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select d.id, d.title, d.mime_type
  from public.documents d
  where public.can_read_document(d.id, (select app.current_user_id()))
  order by d.title, d.id;
$fn$;

-- Used before posting to turn a silent permission mismatch into an explicit
-- choice. Open Teams are readable by every active staff member; closed Teams
-- and Direct conversations use their current participant lists.
create or replace function public.document_reference_gap_count(
  target_thread_id uuid,
  target_document_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  me uuid := app.current_user_id();
  thread_kind public.chat_thread_kind;
  thread_visibility public.chat_team_visibility;
  missing_count bigint;
begin
  if me is null or not private.can_post_chat_message(target_thread_id) then
    raise exception 'Not allowed to post in this conversation'
      using errcode = '42501';
  end if;
  if not public.can_read_document(target_document_id, me) then
    raise exception 'The referenced document is not available'
      using errcode = '42501';
  end if;

  select t.kind, t.visibility into thread_kind, thread_visibility
  from public.chat_threads t where t.id = target_thread_id;

  if thread_kind = 'team' and thread_visibility = 'open' then
    select count(*) into missing_count
    from public.app_users p
    where p.deactivated_at is null
      and not public.can_read_document(target_document_id, p.id);
  else
    select count(*) into missing_count
    from public.chat_participants cp
    join public.app_users p on p.id = cp.user_id and p.deactivated_at is null
    where cp.thread_id = target_thread_id
      and not public.can_read_document(target_document_id, cp.user_id);
  end if;

  return missing_count;
end;
$fn$;

-- Replace the four-argument overload so PostgREST has one unambiguous RPC.
drop function if exists public.send_chat_message(uuid, text, uuid, uuid[]);
create function public.send_chat_message(
  target_thread_id uuid,
  message_body text,
  reply_to_id uuid default null,
  mentioned_user_ids uuid[] default '{}'::uuid[],
  referenced_document_ids uuid[] default '{}'::uuid[],
  reference_mode text default 'require_access'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  me uuid := app.current_user_id();
  new_message_id uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if length(btrim(message_body)) = 0 or length(btrim(message_body)) > 4000 then
    raise exception 'Message body is invalid';
  end if;
  if cardinality(coalesce(referenced_document_ids, '{}'::uuid[])) > 5 then
    raise exception 'A message may reference at most five documents';
  end if;
  if exists (
    select 1
    from unnest(coalesce(referenced_document_ids, '{}'::uuid[])) document_id
    where document_id is null or not public.can_read_document(document_id, me)
  ) then
    raise exception 'Every referenced document must be readable by the sender'
      using errcode = '42501';
  end if;
  if reference_mode not in ('require_access', 'locked', 'grant_team') then
    raise exception 'Document reference decision is invalid';
  end if;
  if cardinality(coalesce(referenced_document_ids, '{}'::uuid[])) > 0
     and reference_mode = 'require_access'
     and exists (
       select 1
       from unnest(referenced_document_ids) document_id
       where public.document_reference_gap_count(target_thread_id, document_id) > 0
     ) then
    raise exception 'Conversation access changed; review the document reference again'
      using errcode = '40001';
  end if;
  if cardinality(coalesce(referenced_document_ids, '{}'::uuid[])) > 0
     and reference_mode = 'grant_team' then
    if not exists (
      select 1 from public.chat_threads t
      where t.id = target_thread_id and t.kind = 'team'
    ) then
      raise exception 'Direct messages cannot grant document access'
        using errcode = '42501';
    end if;

    insert into public.document_team_access (document_id, team_id, role, granted_by)
    select document_id, target_thread_id, 'viewer', me
    from (select distinct unnest(referenced_document_ids) as document_id) docs
    where public.can_manage_document(document_id, me)
    on conflict (document_id, team_id) do nothing;

    if (select count(distinct document_id) from unnest(referenced_document_ids) document_id) > (
      select count(*) from public.document_team_access ta
      where ta.team_id = target_thread_id
        and ta.document_id = any(referenced_document_ids)
    ) then
      raise exception 'Not allowed to grant every referenced document to this Team'
        using errcode = '42501';
    end if;
  end if;

  insert into public.chat_messages (thread_id, sender_id, body, parent_id)
  values (target_thread_id, me, btrim(message_body), reply_to_id)
  returning id into new_message_id;

  insert into public.chat_mentions (message_id, mentioned_user_id)
  select new_message_id, member_id
  from (select distinct unnest(coalesce(mentioned_user_ids, '{}'::uuid[])) as member_id) mentions
  where member_id <> me;

  insert into public.chat_document_references (message_id, document_id)
  select new_message_id, document_id
  from (select distinct unnest(coalesce(referenced_document_ids, '{}'::uuid[])) as document_id) refs
  where document_id is not null;

  return new_message_id;
end;
$fn$;

revoke all privileges on table public.chat_document_references from app_user;
grant insert on table public.chat_document_references to app_user;

revoke execute on function public.list_chat_document_references(uuid) from public;
revoke execute on function public.list_referenceable_documents() from public;
revoke execute on function public.document_reference_gap_count(uuid, uuid) from public;
revoke execute on function public.send_chat_message(uuid, text, uuid, uuid[], uuid[], text) from public;
grant execute on function public.list_chat_document_references(uuid) to app_user;
grant execute on function public.list_referenceable_documents() to app_user;
grant execute on function public.document_reference_gap_count(uuid, uuid) to app_user;
grant execute on function public.send_chat_message(uuid, text, uuid, uuid[], uuid[], text) to app_user;

-- Phase 5: promote a conversation snapshot into a normal governed document
-- (Supabase migration 0015), using the portable identity adapter.
create or replace function private.protect_document_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if length(new.file_name) not between 1 and 120
       or new.file_name ~ '[/\\]'
       or new.storage_path <> format(
         '%s/%s/%s', new.owner_id, new.id, new.file_name
       ) then
      raise exception 'Document storage binding is invalid'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes then
    raise exception 'Document file binding cannot be changed'
      using errcode = '23514';
  end if;

  if new.owner_id is distinct from old.owner_id
     and not private.is_administrator((select app.current_user_id())) then
    raise exception 'Only an administrator may transfer document ownership'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

revoke execute on function private.protect_document_binding() from public, app_user;

drop trigger if exists documents_protect_binding on public.documents;
create trigger documents_protect_binding
  before insert or update on public.documents
  for each row execute function private.protect_document_binding();

create or replace function public.promote_chat_thread_to_document(
  target_thread_id uuid,
  new_document_id uuid,
  document_title text,
  document_description text,
  document_file_name text,
  document_storage_path text,
  document_size_bytes bigint,
  document_tags text[] default '{}'::text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  me uuid := (select app.current_user_id());
  thread_kind public.chat_thread_kind;
begin
  if me is null or not private.can_post_chat_message(target_thread_id) then
    raise exception 'Only a conversation participant may promote it'
      using errcode = '42501';
  end if;

  if new_document_id is null
     or length(btrim(document_title)) not between 1 and 200
     or length(btrim(document_file_name)) not between 1 and 120
     or document_file_name ~ '[/\\]'
     or document_size_bytes not between 1 and 52428800
     or document_storage_path <> format(
       '%s/%s/%s', me, new_document_id, document_file_name
     )
     or cardinality(coalesce(document_tags, '{}'::text[])) > 12
     or exists (
       select 1 from unnest(coalesce(document_tags, '{}'::text[])) tag
       where length(tag) not between 1 and 32
     ) then
    raise exception 'Promoted document metadata is invalid'
      using errcode = '22023';
  end if;

  select t.kind into strict thread_kind
  from public.chat_threads t
  where t.id = target_thread_id;

  insert into public.documents (
    id, owner_id, title, description, file_name, storage_path,
    mime_type, size_bytes, tags
  ) values (
    new_document_id, me, btrim(document_title),
    nullif(btrim(document_description), ''), document_file_name,
    document_storage_path, 'text/markdown', document_size_bytes,
    coalesce(document_tags, '{}'::text[])
  );

  if thread_kind = 'team' then
    insert into public.document_team_access (
      document_id, team_id, role, granted_by
    ) values (
      new_document_id, target_thread_id, 'viewer', me
    );
  end if;

  return new_document_id;
end;
$fn$;

revoke execute on function public.promote_chat_thread_to_document(
  uuid, uuid, text, text, text, text, bigint, text[]
) from public;
grant execute on function public.promote_chat_thread_to_document(
  uuid, uuid, text, text, text, text, bigint, text[]
) to app_user;

-- Live chat notifications. Supabase's publication is deployment-specific and
-- intentionally absent; the relational behavior remains portable.
create table if not exists public.chat_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  message_id uuid not null references public.chat_messages (id) on delete restrict,
  kind text not null check (kind in ('mention', 'reply')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, message_id)
);

create index if not exists chat_notifications_unread_recipient_idx
  on public.chat_notifications (recipient_id, created_at desc)
  where read_at is null;
alter table public.chat_notifications enable row level security;

drop policy if exists chat_notifications_select on public.chat_notifications;
create policy chat_notifications_select on public.chat_notifications
  for select to app_user
  using (
    recipient_id = app.current_user_id()
    and private.can_read_chat_messages(thread_id)
  );
drop policy if exists chat_notifications_update_own on public.chat_notifications;
create policy chat_notifications_update_own on public.chat_notifications
  for update to app_user
  using (
    recipient_id = app.current_user_id()
    and private.can_read_chat_messages(thread_id)
  )
  with check (
    recipient_id = app.current_user_id()
    and private.can_read_chat_messages(thread_id)
  );

create or replace function private.protect_chat_notification()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if new.id is distinct from old.id
     or new.recipient_id is distinct from old.recipient_id
     or new.actor_id is distinct from old.actor_id
     or new.thread_id is distinct from old.thread_id
     or new.message_id is distinct from old.message_id
     or new.kind is distinct from old.kind
     or new.created_at is distinct from old.created_at then
    raise exception 'Notification identity cannot be changed'
      using errcode = '42501';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'A read notification cannot be made unread'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function private.protect_chat_notification() from public, app_user;
drop trigger if exists chat_notifications_protect_update on public.chat_notifications;
create trigger chat_notifications_protect_update
  before update on public.chat_notifications
  for each row execute function private.protect_chat_notification();

create or replace function private.notify_chat_reply()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
declare recipient uuid;
begin
  if new.parent_id is null then return new; end if;
  select parent.sender_id into recipient
  from public.chat_messages parent
  where parent.id = new.parent_id and parent.thread_id = new.thread_id;
  if recipient is not null and recipient is distinct from new.sender_id then
    insert into public.chat_notifications
      (recipient_id, actor_id, thread_id, message_id, kind)
    values (recipient, new.sender_id, new.thread_id, new.id, 'reply')
    on conflict (recipient_id, message_id) do nothing;
  end if;
  return new;
end;
$fn$;
revoke execute on function private.notify_chat_reply() from public, app_user;
drop trigger if exists chat_messages_notify_reply on public.chat_messages;
create trigger chat_messages_notify_reply
  after insert on public.chat_messages
  for each row execute function private.notify_chat_reply();

create or replace function private.notify_chat_mention()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
declare source_message public.chat_messages%rowtype;
begin
  select m.* into strict source_message
  from public.chat_messages m where m.id = new.message_id;
  if new.mentioned_user_id is distinct from source_message.sender_id then
    insert into public.chat_notifications
      (recipient_id, actor_id, thread_id, message_id, kind)
    values (
      new.mentioned_user_id, source_message.sender_id,
      source_message.thread_id, source_message.id, 'mention'
    )
    on conflict (recipient_id, message_id) do nothing;
  end if;
  return new;
end;
$fn$;
revoke execute on function private.notify_chat_mention() from public, app_user;
drop trigger if exists chat_mentions_notify on public.chat_mentions;
create trigger chat_mentions_notify
  after insert on public.chat_mentions
  for each row execute function private.notify_chat_mention();

create or replace function public.mark_chat_thread_read(
  target_thread_id uuid, through_message_id uuid
)
returns void language plpgsql security invoker set search_path = ''
as $fn$
declare
  me uuid := app.current_user_id();
  through_at timestamptz;
begin
  if me is null or not private.can_post_chat_message(target_thread_id) then
    raise exception 'Only a participant may mark a conversation read'
      using errcode = '42501';
  end if;
  if through_message_id is null then return; end if;
  select m.created_at into strict through_at
  from public.chat_messages m
  where m.id = through_message_id and m.thread_id = target_thread_id;
  update public.chat_participants
  set last_read_at = greatest(
    coalesce(last_read_at, '-infinity'::timestamptz), through_at
  )
  where thread_id = target_thread_id and user_id = me;
end;
$fn$;
revoke execute on function public.mark_chat_thread_read(uuid, uuid) from public;
grant execute on function public.mark_chat_thread_read(uuid, uuid) to app_user;

revoke all on table public.chat_notifications from public, app_user;
grant select on table public.chat_notifications to app_user;
grant update (read_at) on table public.chat_notifications to app_user;
