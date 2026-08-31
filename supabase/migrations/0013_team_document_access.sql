-- Phase 5: grant a document to a Team without copying one row per person.
-- Membership is evaluated at read time, so joining inherits every Team grant
-- and leaving withdraws those grants immediately. Direct messages are rejected
-- at the database boundary and can never become permission groups.

create table if not exists public.document_team_access (
  document_id uuid not null references public.documents (id) on delete cascade,
  team_id     uuid not null references public.chat_threads (id) on delete cascade,
  role        public.document_role not null default 'viewer',
  granted_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (document_id, team_id)
);

create index if not exists document_team_access_team_idx
  on public.document_team_access (team_id, document_id);
create index if not exists document_team_access_granted_by_idx
  on public.document_team_access (granted_by);

-- A foreign key proves that the target is a conversation, not that it is a
-- Team. It also cannot keep the identity columns immutable on update, so one
-- trigger owns both invariants.
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
  from public, anon, authenticated, service_role;

drop trigger if exists document_team_access_validate on public.document_team_access;
create trigger document_team_access_validate
  before insert or update on public.document_team_access
  for each row execute function private.validate_document_team_access();

-- These three helpers remain the one permission vocabulary for bytes, chunks,
-- comments, Ask and metadata writes. A direct and a Team grant may coexist;
-- the ordered role enum makes the higher effective permission win naturally.
create or replace function private.can_read_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
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

create or replace function private.can_comment_on_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
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

create or replace function private.can_edit_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
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

-- Team-granted readers must be able to discover the document row. The
-- administrator arm exposes management metadata only; bytes/chunks/comments
-- still call can_read_document and therefore remain closed unless granted.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    private.can_read_document(id, (select auth.uid()))
    or private.is_administrator((select auth.uid()))
  );

alter table public.document_team_access enable row level security;

drop policy if exists document_team_access_select on public.document_team_access;
create policy document_team_access_select on public.document_team_access
  for select to authenticated
  using (private.can_manage_document(document_id, (select auth.uid())));

drop policy if exists document_team_access_insert on public.document_team_access;
create policy document_team_access_insert on public.document_team_access
  for insert to authenticated
  with check (
    granted_by = (select auth.uid())
    and private.can_manage_document(document_id, (select auth.uid()))
  );

drop policy if exists document_team_access_update on public.document_team_access;
create policy document_team_access_update on public.document_team_access
  for update to authenticated
  using (private.can_manage_document(document_id, (select auth.uid())))
  with check (private.can_manage_document(document_id, (select auth.uid())));

drop policy if exists document_team_access_delete on public.document_team_access;
create policy document_team_access_delete on public.document_team_access
  for delete to authenticated
  using (private.can_manage_document(document_id, (select auth.uid())));

revoke all privileges on table public.document_team_access from anon, authenticated;
grant select, insert, update, delete on table public.document_team_access to authenticated;

-- Membership managers need the consequence before they add somebody, but not
-- the document titles. This narrow RPC returns only a count and performs the
-- same membership-management authorization as the insert policy.
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
  if (select auth.uid()) is null
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

revoke execute on function public.team_document_grant_count(uuid) from public, anon;
grant execute on function public.team_document_grant_count(uuid) to authenticated, service_role;
