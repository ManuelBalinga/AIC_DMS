-- Phase 5: messages may point at governed documents but never carry files.
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
  for insert to authenticated
  with check (
    private.can_read_document(document_id, (select auth.uid()))
    and exists (
      select 1
      from public.chat_messages m
      where m.id = message_id
        and m.sender_id = (select auth.uid())
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
declare me uuid := auth.uid();
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
      and private.can_read_document(r.document_id, me) as allowed
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
  where private.can_read_document(d.id, (select auth.uid()))
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
  me uuid := auth.uid();
  thread_kind public.chat_thread_kind;
  thread_visibility public.chat_team_visibility;
  missing_count bigint;
begin
  if me is null or not private.can_post_chat_message(target_thread_id) then
    raise exception 'Not allowed to post in this conversation'
      using errcode = '42501';
  end if;
  if not private.can_read_document(target_document_id, me) then
    raise exception 'The referenced document is not available'
      using errcode = '42501';
  end if;

  select t.kind, t.visibility into thread_kind, thread_visibility
  from public.chat_threads t where t.id = target_thread_id;

  if thread_kind = 'team' and thread_visibility = 'open' then
    select count(*) into missing_count
    from public.profiles p
    where p.deactivated_at is null
      and not private.can_read_document(target_document_id, p.id);
  else
    select count(*) into missing_count
    from public.chat_participants cp
    join public.profiles p on p.id = cp.user_id and p.deactivated_at is null
    where cp.thread_id = target_thread_id
      and not private.can_read_document(target_document_id, cp.user_id);
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
  me uuid := auth.uid();
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
    where document_id is null or not private.can_read_document(document_id, me)
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
    where private.can_manage_document(document_id, me)
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

revoke all privileges on table public.chat_document_references from anon, authenticated;
grant insert on table public.chat_document_references to authenticated;

revoke execute on function public.list_chat_document_references(uuid) from public, anon;
revoke execute on function public.list_referenceable_documents() from public, anon;
revoke execute on function public.document_reference_gap_count(uuid, uuid) from public, anon;
revoke execute on function public.send_chat_message(uuid, text, uuid, uuid[], uuid[], text) from public, anon;
grant execute on function public.list_chat_document_references(uuid) to authenticated, service_role;
grant execute on function public.list_referenceable_documents() to authenticated, service_role;
grant execute on function public.document_reference_gap_count(uuid, uuid) to authenticated, service_role;
grant execute on function public.send_chat_message(uuid, text, uuid, uuid[], uuid[], text) to authenticated, service_role;
