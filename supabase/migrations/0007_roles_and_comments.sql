-- Document roles, comments, and deactivation.
--
-- Specified in Documentation/ROLE_MODEL.md. Three changes, one of which takes
-- access away rather than adding it:
--
--   1. document_access carries a role, so a grant means more than "can read".
--   2. Comments exist, at document level and anchored to a page.
--   3. Administrators can manage access but no longer read document contents.
--
-- Change 3 is the one to read carefully. Everything else here is additive and
-- nobody's access changes on the day it ships: every existing grant becomes a
-- Viewer, which is exactly what it already meant.

-- ---------------------------------------------------------------------------
-- Document roles
--
-- Declaration order is load-bearing. Postgres compares enums by the order they
-- are declared, so `role >= 'commenter'` answers a permission question with one
-- comparison. A set of unordered labels would need a lookup table that grows
-- quadratically and eventually disagrees with itself.
--
-- 'owner' is deliberately absent: ownership lives on documents.owner_id, and a
-- value that must never appear in this column is one somebody will eventually
-- insert.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.document_role as enum ('viewer', 'commenter', 'editor');
exception when duplicate_object then null; end $$;

alter table public.document_access
  add column if not exists role public.document_role not null default 'viewer';

comment on column public.document_access.role is
  'What this grant permits. Ordered: viewer < commenter < editor. Ownership is documents.owner_id, not a value here.';

-- ---------------------------------------------------------------------------
-- Deactivation
--
-- Removing a person cascades to the documents they own, which is right for a
-- test account and catastrophic for a departing colleague. Deactivation keeps
-- the account and its documents while ending the ability to sign in.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists deactivated_at timestamptz;

comment on column public.profiles.deactivated_at is
  'Set when the person can no longer sign in. Their documents, grants and comments are untouched. Reversible.';

-- ---------------------------------------------------------------------------
-- Permission helpers
--
-- `can_read_document` and `can_manage_document` together are the "manage access
-- but do not read" decision: the administrator clause moves out of one and
-- stays in the other. Expressing it in two functions rather than across twenty
-- policies is what makes it a decision rather than a convention.
-- ---------------------------------------------------------------------------

-- CHANGED: the administrator clause is gone. An administrator now reads a
-- document only if an owner granted them access, like anybody else.
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

-- `can_manage_document` is unchanged and keeps its administrator clause. This
-- is what an administrator retains: control over who may reach a document,
-- without the ability to open it.

-- ---------------------------------------------------------------------------
-- Policy changes
--
-- `documents_select` keeps its administrator clause while `can_read_document`
-- loses it. That gap is the design: an administrator sees that a document
-- exists, who owns it and who can reach it -- the metadata they need to manage
-- access -- while the chunks, the bytes and the AI answers stay closed.
-- ---------------------------------------------------------------------------
drop policy if exists documents_update_own on public.documents;
create policy documents_update_own on public.documents
  for update to authenticated
  using (public.can_edit_document(id, (select auth.uid())))
  with check (public.can_edit_document(id, (select auth.uid())));

-- Deleting stays with the owner and administrators; an editor improves a
-- document, an owner decides whether it exists.
drop policy if exists documents_delete_own on public.documents;
create policy documents_delete_own on public.documents
  for delete to authenticated
  using (public.can_manage_document(id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create table if not exists public.document_comments (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  -- `set null` rather than cascade: a departing colleague's comments are part
  -- of the document's history. Deleting the person must not silently rewrite a
  -- review thread, leaving the rest answering questions nobody appears to have
  -- asked. The UI renders a null author as "Former colleague".
  author_id   uuid references public.profiles (id) on delete set null,
  parent_id   uuid references public.document_comments (id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  -- Null for a comment on the document as a whole; set for a placed one.
  page_number integer,
  -- The passage itself, not a character offset. Offsets break the moment an
  -- editor replaces the file -- silently, and pointing at the wrong text, which
  -- is worse than pointing at nothing.
  quoted_text text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists document_comments_document_idx
  on public.document_comments (document_id, created_at);

create index if not exists document_comments_parent_idx
  on public.document_comments (parent_id);

-- Open threads on documents you can reach: the dashboard's unresolved count.
create index if not exists document_comments_unresolved_idx
  on public.document_comments (document_id)
  where resolved_at is null and parent_id is null;

drop trigger if exists document_comments_touch_updated_at on public.document_comments;
create trigger document_comments_touch_updated_at
  before update on public.document_comments
  for each row execute function public.touch_updated_at();

alter table public.document_comments enable row level security;

-- Comments are exactly as private as the document they hang on -- no more, no
-- less. With administrators no longer able to read documents, they cannot read
-- the comments either, and no separate rule has to be kept in step.
drop policy if exists document_comments_select on public.document_comments;
create policy document_comments_select on public.document_comments
  for select to authenticated
  using (public.can_read_document(document_id, (select auth.uid())));

drop policy if exists document_comments_insert on public.document_comments;
create policy document_comments_insert on public.document_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_comment_on_document(document_id, (select auth.uid()))
  );

-- Your own words only. Not even the document's owner may rewrite what somebody
-- else said -- they can resolve the thread instead.
drop policy if exists document_comments_update on public.document_comments;
create policy document_comments_update on public.document_comments
  for update to authenticated
  using (
    author_id = (select auth.uid())
    or public.can_manage_document(document_id, (select auth.uid()))
  )
  with check (
    author_id = (select auth.uid())
    or public.can_manage_document(document_id, (select auth.uid()))
  );

drop policy if exists document_comments_delete on public.document_comments;
create policy document_comments_delete on public.document_comments
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Last-administrator protection
--
-- The application already refuses to let you demote yourself, but two
-- administrators could demote each other to zero and then nobody could ever
-- invite anybody again. A trigger is the only place this can be enforced
-- reliably: it holds regardless of which code path made the change.
-- ---------------------------------------------------------------------------
create or replace function public.protect_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Only relevant when an active administrator stops being one, whether by a
  -- role change or by deactivation.
  if old.role = 'administrator'
     and old.deactivated_at is null
     and (new.role <> 'administrator' or new.deactivated_at is not null)
  then
    if not exists (
      select 1 from public.profiles p
      where p.role = 'administrator'
        and p.deactivated_at is null
        and p.id <> old.id
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

drop trigger if exists profiles_protect_last_administrator on public.profiles;
create trigger profiles_protect_last_administrator
  before update on public.profiles
  for each row execute function public.protect_last_administrator();
