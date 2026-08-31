-- Phase 5: live message delivery and quiet, durable in-app notifications.
-- Realtime is only a signal; RLS remains the reading authority.

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
  for select to authenticated
  using (
    recipient_id = (select auth.uid())
    and private.can_read_chat_messages(thread_id)
  );

drop policy if exists chat_notifications_update_own on public.chat_notifications;
create policy chat_notifications_update_own on public.chat_notifications
  for update to authenticated
  using (
    recipient_id = (select auth.uid())
    and private.can_read_chat_messages(thread_id)
  )
  with check (
    recipient_id = (select auth.uid())
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

revoke execute on function private.protect_chat_notification()
  from public, anon, authenticated, service_role;
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

revoke execute on function private.notify_chat_reply()
  from public, anon, authenticated, service_role;
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

revoke execute on function private.notify_chat_mention()
  from public, anon, authenticated, service_role;
drop trigger if exists chat_mentions_notify on public.chat_mentions;
create trigger chat_mentions_notify
  after insert on public.chat_mentions
  for each row execute function private.notify_chat_mention();

-- Advance only through a message the page actually rendered. A concurrent
-- arrival after the query can no longer be swallowed by a later now().
create or replace function public.mark_chat_thread_read(
  target_thread_id uuid, through_message_id uuid
)
returns void language plpgsql security invoker set search_path = ''
as $fn$
declare
  me uuid := (select auth.uid());
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

revoke execute on function public.mark_chat_thread_read(uuid, uuid)
  from public, anon;
grant execute on function public.mark_chat_thread_read(uuid, uuid)
  to authenticated, service_role;

revoke all on table public.chat_notifications
  from public, anon, authenticated;
grant select on table public.chat_notifications to authenticated;
grant update (read_at) on table public.chat_notifications to authenticated;
grant select, insert, update, delete on table public.chat_notifications
  to service_role;

-- Supabase creates this publication; plain Postgres does not. Both checks make
-- this safe in the local harness and on a repeated hosted rehearsal.
do $publication$
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'chat_notifications'
    ) then
      alter publication supabase_realtime add table public.chat_notifications;
    end if;
  end if;
end;
$publication$;
