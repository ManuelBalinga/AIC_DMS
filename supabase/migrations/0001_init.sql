-- AIC Internal Document Platform - Phase 1 (Week 1) schema
-- Modules covered: auth, users/team, documents, access control.
-- Week 2 (RAG) tables are created here but left unused until the RAG module lands.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('administrator', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Tracks the RAG ingestion pipeline (plan 6.2 step 6). Unused until Week 2.
  create type public.document_index_status as enum ('pending', 'processing', 'indexed', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles: one row per internal user, mirrors auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        public.user_role not null default 'member',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- invitations: the only way a user enters the platform (no public sign-up)
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        public.user_role not null default 'member',
  status      public.invitation_status not null default 'pending',
  invited_by  uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists invitations_pending_email_idx
  on public.invitations (lower(email))
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- documents: metadata + ownership. Bytes live in Storage, not here.
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  title         text not null,
  description   text,
  file_name     text not null,
  storage_path  text not null unique,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  index_status  public.document_index_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_owner_id_idx on public.documents (owner_id);
create index if not exists documents_created_at_idx on public.documents (created_at desc);

-- ---------------------------------------------------------------------------
-- document_access: explicit per-document grants (plan 4.3)
-- ---------------------------------------------------------------------------
create table if not exists public.document_access (
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  granted_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index if not exists document_access_user_id_idx on public.document_access (user_id);

-- ---------------------------------------------------------------------------
-- document_chunks: Week 2 RAG storage. Created now so that permissions are
-- designed in from the start rather than retrofitted onto the retrieval layer.
-- ---------------------------------------------------------------------------
create table if not exists public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index integer not null,
  content     text not null,
  token_count integer,
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists document_chunks_document_id_idx on public.document_chunks (document_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so RLS policies can call them without
-- recursing into the policies of the tables they read).
-- ---------------------------------------------------------------------------
create or replace function public.is_administrator(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.role = 'administrator'
  );
$fn$;

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
        or public.is_administrator(check_user_id)
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

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Provision a profile whenever an auth user is created, taking the role from
-- the matching invitation and marking that invitation accepted.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  invited_role public.user_role;
begin
  select i.role into invited_role
  from public.invitations i
  where lower(i.email) = lower(new.email) and i.status = 'pending'
  limit 1;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(invited_role, (new.raw_user_meta_data ->> 'role')::public.user_role, 'member')
  )
  on conflict (id) do nothing;

  update public.invitations
  set status = 'accepted', accepted_at = now()
  where lower(email) = lower(new.email) and status = 'pending';

  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.invitations     enable row level security;
alter table public.documents       enable row level security;
alter table public.document_access enable row level security;
alter table public.document_chunks enable row level security;

-- profiles: every internal user can see the team roster (needed to pick people
-- to share a document with). Only the user or an admin can change a profile.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_administrator((select auth.uid())))
  with check (id = (select auth.uid()) or public.is_administrator((select auth.uid())));

-- invitations: administrators only.
drop policy if exists invitations_admin_all on public.invitations;
create policy invitations_admin_all on public.invitations
  for all to authenticated
  using (public.is_administrator((select auth.uid())))
  with check (public.is_administrator((select auth.uid())));

-- documents: readable by owner, granted users, and administrators.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.document_access a
      where a.document_id = documents.id and a.user_id = (select auth.uid())
    )
    or public.is_administrator((select auth.uid()))
  );

drop policy if exists documents_insert_own on public.documents;
create policy documents_insert_own on public.documents
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists documents_update_own on public.documents;
create policy documents_update_own on public.documents
  for update to authenticated
  using (owner_id = (select auth.uid()) or public.is_administrator((select auth.uid())))
  with check (owner_id = (select auth.uid()) or public.is_administrator((select auth.uid())));

drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete to authenticated
  using (owner_id = (select auth.uid()) or public.is_administrator((select auth.uid())));

-- document_access: a user sees their own grants; owners and admins see and
-- manage all grants on documents they control.
drop policy if exists document_access_select on public.document_access;
create policy document_access_select on public.document_access
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_manage_document(document_id, (select auth.uid()))
  );

drop policy if exists document_access_insert on public.document_access;
create policy document_access_insert on public.document_access
  for insert to authenticated
  with check (public.can_manage_document(document_id, (select auth.uid())));

drop policy if exists document_access_delete on public.document_access;
create policy document_access_delete on public.document_access
  for delete to authenticated
  using (public.can_manage_document(document_id, (select auth.uid())));

-- document_chunks: retrieval inherits document permissions. This is what makes
-- the Week 2 permission-aware RAG safe by construction (plan 6.4 steps 2-3).
drop policy if exists document_chunks_select on public.document_chunks;
create policy document_chunks_select on public.document_chunks
  for select to authenticated
  using (public.can_read_document(document_id, (select auth.uid())));
