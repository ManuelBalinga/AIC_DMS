-- Phase 5 collaboration: threaded replies, explicit mentions, reactions, and
-- retention-safe edits/retraction. Direct messages remain excluded from Ask by
-- migration 0009; these tables inherit the same participant boundary.

alter table public.chat_messages
  add column if not exists parent_id uuid references public.chat_messages (id) on delete restrict,
  add column if not exists retracted_at timestamptz,
  add column if not exists retracted_by uuid references public.profiles (id) on delete set null;

create index if not exists chat_messages_parent_id_idx
  on public.chat_messages (parent_id, created_at);
create index if not exists chat_messages_retracted_by_idx
  on public.chat_messages (retracted_by);

create table if not exists public.chat_mentions (
  message_id        uuid not null references public.chat_messages (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (message_id, mentioned_user_id)
);

create index if not exists chat_mentions_mentioned_user_idx
  on public.chat_mentions (mentioned_user_id, created_at desc);

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '🎉', '👀', '✅')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists chat_reactions_user_idx
  on public.chat_reactions (user_id);

-- Every edit is append-only history. Retraction leaves the original body in
-- storage for audit/retention but readers receive a tombstone from the UI.
create table if not exists public.chat_message_versions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete restrict,
  body       text not null,
  edited_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists chat_message_versions_message_idx
  on public.chat_message_versions (message_id, created_at desc);
create index if not exists chat_message_versions_edited_by_idx
  on public.chat_message_versions (edited_by);

-- A reply must point at a root message in the same conversation. This is a
-- trigger because PostgreSQL CHECK constraints cannot query the parent row.
create or replace function private.validate_chat_message_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  parent_thread uuid;
  parent_parent uuid;
begin
  if tg_op = 'UPDATE' then
    if new.thread_id <> old.thread_id
      or new.sender_id is distinct from old.sender_id
      or new.parent_id is distinct from old.parent_id
      or new.created_at <> old.created_at then
      raise exception 'Message identity fields cannot be changed';
    end if;

    if old.retracted_at is not null and new is distinct from old then
      raise exception 'A retracted message cannot be changed';
    end if;

    if new.body is distinct from old.body and new.retracted_at is not distinct from old.retracted_at then
      insert into public.chat_message_versions (message_id, body, edited_by)
      values (old.id, old.body, (select auth.uid()));
      new.edited_at := now();
      new.embedding := null;
    end if;

    if new.retracted_at is distinct from old.retracted_at then
      if old.retracted_at is not null
        or new.retracted_at is null
        or new.retracted_by is distinct from (select auth.uid())
        or old.sender_id is distinct from (select auth.uid()) then
        raise exception 'Invalid message retraction';
      end if;
      insert into public.chat_message_versions (message_id, body, edited_by)
      values (old.id, old.body, (select auth.uid()));
      new.retracted_at := now();
      new.body := '[Message retracted]';
      new.embedding := null;
    elsif new.retracted_by is distinct from old.retracted_by then
      raise exception 'Retraction identity cannot be changed';
    end if;
  end if;

  if new.parent_id is not null then
    select m.thread_id, m.parent_id
      into parent_thread, parent_parent
    from public.chat_messages m
    where m.id = new.parent_id;

    if parent_thread is null or parent_thread <> new.thread_id then
      raise exception 'A reply must belong to the same conversation';
    end if;
    if parent_parent is not null then
      raise exception 'Replies may only be one level deep';
    end if;
  end if;

  return new;
end;
$fn$;

revoke execute on function private.validate_chat_message_write()
  from public, anon, authenticated, service_role;

drop trigger if exists chat_messages_validate_write on public.chat_messages;
create trigger chat_messages_validate_write
  before insert or update on public.chat_messages
  for each row execute function private.validate_chat_message_write();

alter table public.chat_mentions enable row level security;
alter table public.chat_reactions enable row level security;
alter table public.chat_message_versions enable row level security;

drop policy if exists chat_mentions_select on public.chat_mentions;
create policy chat_mentions_select on public.chat_mentions
  for select using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.is_chat_participant(m.thread_id, (select auth.uid()))
    )
  );

drop policy if exists chat_mentions_insert on public.chat_mentions;
create policy chat_mentions_insert on public.chat_mentions
  for insert with check (
    exists (
      select 1
      from public.chat_messages m
      where m.id = message_id
        and m.sender_id = (select auth.uid())
        and private.is_chat_participant(m.thread_id, mentioned_user_id)
    )
  );

drop policy if exists chat_reactions_select on public.chat_reactions;
create policy chat_reactions_select on public.chat_reactions
  for select using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.is_chat_participant(m.thread_id, (select auth.uid()))
    )
  );

drop policy if exists chat_reactions_insert on public.chat_reactions;
create policy chat_reactions_insert on public.chat_reactions
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.is_chat_participant(m.thread_id, (select auth.uid()))
    )
  );

drop policy if exists chat_reactions_delete_own on public.chat_reactions;
create policy chat_reactions_delete_own on public.chat_reactions
  for delete using (user_id = (select auth.uid()));

drop policy if exists chat_message_versions_select on public.chat_message_versions;
create policy chat_message_versions_select on public.chat_message_versions
  for select using (
    exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.is_chat_participant(m.thread_id, (select auth.uid()))
    )
  );

-- Deletion contradicts the agreed retention model. RLS and the Data API grant
-- both deny it, so a future UI regression cannot erase conversation history.
drop policy if exists chat_messages_delete_own on public.chat_messages;
revoke delete on table public.chat_messages from authenticated;

grant select, insert on table public.chat_mentions to authenticated;
grant select, insert, delete on table public.chat_reactions to authenticated;
grant select on table public.chat_message_versions to authenticated;

-- Message plus mentions is one transaction: nobody can see a message whose
-- relational mentions were lost to a second-request failure.
create or replace function public.send_chat_message(
  target_thread_id uuid,
  message_body text,
  reply_to_id uuid default null,
  mentioned_user_ids uuid[] default '{}'::uuid[]
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
  if me is null then raise exception 'Not signed in'; end if;
  if length(btrim(message_body)) = 0 or length(btrim(message_body)) > 4000 then
    raise exception 'Message body is invalid';
  end if;

  insert into public.chat_messages (thread_id, sender_id, body, parent_id)
  values (target_thread_id, me, btrim(message_body), reply_to_id)
  returning id into new_message_id;

  insert into public.chat_mentions (message_id, mentioned_user_id)
  select new_message_id, member_id
  from (select distinct unnest(mentioned_user_ids) as member_id) mentions
  where member_id <> me;

  return new_message_id;
end;
$fn$;

revoke execute on function public.send_chat_message(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.send_chat_message(uuid, text, uuid, uuid[]) to authenticated, service_role;
