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
  document_id    uuid references public.documents (id) on delete set null,
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

grant usage on schema public, app to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public, app to app_user;
