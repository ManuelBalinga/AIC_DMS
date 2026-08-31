-- Phase 5 Teams foundation.
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
  from public, anon, authenticated, service_role;

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
  from public, anon, authenticated, service_role;

drop trigger if exists chat_participants_protect_identity on public.chat_participants;
create trigger chat_participants_protect_identity
  before update on public.chat_participants
  for each row execute function private.protect_chat_participant_identity();

-- Request-aware helpers. Each captures auth.uid() internally, checks that the
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
    join public.profiles me on me.id = (select auth.uid())
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
          or private.is_administrator(me.id)
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
    join public.profiles me on me.id = (select auth.uid())
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
    join public.profiles me on me.id = (select auth.uid())
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
    join public.profiles me on me.id = (select auth.uid())
    where t.id = check_thread_id
      and me.deactivated_at is null
      and (
        (t.kind = 'direct' and exists (
          select 1 from public.chat_participants p
          where p.thread_id = t.id and p.user_id = me.id
        ))
        or
        (t.kind = 'team' and (
          t.created_by = me.id or private.is_administrator(me.id)
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
    join public.profiles me on me.id = (select auth.uid())
    where t.id = check_thread_id
      and t.kind = 'team'
      and me.deactivated_at is null
      and (
        t.created_by = me.id
        or private.is_administrator(me.id)
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
    join public.profiles me on me.id = (select auth.uid())
    where t.id = check_thread_id
      and t.kind = 'team'
      and me.deactivated_at is null
      and (
        target_user_id = me.id
        or t.created_by = me.id
        or private.is_administrator(me.id)
      )
  );
$fn$;

revoke execute on function private.can_view_chat_thread(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_read_chat_messages(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_post_chat_message(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_update_chat_thread(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_add_team_member(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_remove_team_member(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Policies execute as the querying role, so the request-aware predicates they
-- call must be executable by authenticated. They remain outside the exposed
-- API schema and capture auth.uid() internally; PUBLIC and anon still receive
-- no callable surface.
grant execute on function private.can_view_chat_thread(uuid)
  to authenticated, service_role;
grant execute on function private.can_read_chat_messages(uuid)
  to authenticated, service_role;
grant execute on function private.can_post_chat_message(uuid)
  to authenticated, service_role;
grant execute on function private.can_update_chat_thread(uuid)
  to authenticated, service_role;
grant execute on function private.can_add_team_member(uuid)
  to authenticated, service_role;
grant execute on function private.can_remove_team_member(uuid, uuid)
  to authenticated, service_role;

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
  from public, anon, authenticated, service_role;

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
  me uuid := auth.uid();
  found uuid;
begin
  if me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if other_user_id = me then raise exception 'Cannot message yourself'; end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = me and p.deactivated_at is null
  ) or not exists (
    select 1 from public.profiles p
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
-- captures auth.uid(), validates active staff and writes only the new Team plus
-- its requested active members in one transaction.
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
  me uuid := auth.uid();
  new_team_id uuid;
begin
  if me is null or not exists (
    select 1 from public.profiles p
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
        select 1 from public.profiles p
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
declare me uuid := auth.uid();
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
    select 1 from public.profiles p
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
  for select to authenticated
  using (private.can_view_chat_thread(id));

drop policy if exists chat_threads_insert on public.chat_threads;
create policy chat_threads_insert on public.chat_threads
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and kind = 'team'
    and is_group = true
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.deactivated_at is null
    )
  );

drop policy if exists chat_threads_update on public.chat_threads;
create policy chat_threads_update on public.chat_threads
  for update to authenticated
  using (private.can_update_chat_thread(id))
  with check (private.can_update_chat_thread(id));

drop policy if exists chat_participants_select on public.chat_participants;
create policy chat_participants_select on public.chat_participants
  for select to authenticated
  using (private.can_view_chat_thread(thread_id));

drop policy if exists chat_participants_insert on public.chat_participants;
create policy chat_participants_insert on public.chat_participants
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.chat_threads t
      join public.profiles target on target.id = user_id
      where t.id = thread_id
        and t.kind = 'team'
        and target.deactivated_at is null
        and (
          private.can_add_team_member(t.id)
          or (
            user_id = (select auth.uid())
            and t.visibility = 'open'
          )
        )
    )
  );

drop policy if exists chat_participants_update_self on public.chat_participants;
create policy chat_participants_update_self on public.chat_participants
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and private.can_read_chat_messages(thread_id)
  )
  with check (
    user_id = (select auth.uid())
    and private.can_read_chat_messages(thread_id)
  );

drop policy if exists chat_participants_delete on public.chat_participants;
create policy chat_participants_delete on public.chat_participants
  for delete to authenticated
  using (private.can_remove_team_member(thread_id, user_id));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (private.can_read_chat_messages(thread_id));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.can_post_chat_message(thread_id)
  );

drop policy if exists chat_messages_update_own on public.chat_messages;
create policy chat_messages_update_own on public.chat_messages
  for update to authenticated
  using (
    sender_id = (select auth.uid())
    and private.can_post_chat_message(thread_id)
  )
  with check (
    sender_id = (select auth.uid())
    and private.can_post_chat_message(thread_id)
  );

drop policy if exists chat_messages_delete_own on public.chat_messages;

drop policy if exists chat_mentions_select on public.chat_mentions;
create policy chat_mentions_select on public.chat_mentions
  for select to authenticated
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
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.chat_messages m
      join public.chat_participants mentioned
        on mentioned.thread_id = m.thread_id
       and mentioned.user_id = mentioned_user_id
      where m.id = message_id
        and m.sender_id = (select auth.uid())
        and m.retracted_at is null
        and private.can_post_chat_message(m.thread_id)
    )
  );

drop policy if exists chat_reactions_select on public.chat_reactions;
create policy chat_reactions_select on public.chat_reactions
  for select to authenticated
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
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.retracted_at is null
        and private.can_post_chat_message(m.thread_id)
    )
  );

drop policy if exists chat_reactions_delete_own on public.chat_reactions;
create policy chat_reactions_delete_own on public.chat_reactions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and private.can_read_chat_messages(m.thread_id)
    )
  );

drop policy if exists chat_message_versions_select on public.chat_message_versions;
create policy chat_message_versions_select on public.chat_message_versions
  for select to authenticated
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
  left join public.profiles p on p.id = m.sender_id
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
  left join public.profiles p on p.id = m.sender_id
  where m.retracted_at is null
    and t.kind = 'team'
    and to_tsvector('english', m.body)
      @@ websearch_to_tsquery('english', query_text)
  order by 7 desc
  limit least(greatest(match_count, 1), 50);
$fn$;

-- Least-privilege Data API and RPC surface. RLS remains the row authority.
revoke all privileges on table public.chat_threads from anon;
revoke all privileges on table public.chat_participants from anon;
revoke all privileges on table public.chat_messages from anon;
revoke all privileges on table public.chat_mentions from anon;
revoke all privileges on table public.chat_reactions from anon;
revoke all privileges on table public.chat_message_versions from anon;

revoke all privileges on table public.chat_threads from authenticated;
revoke all privileges on table public.chat_participants from authenticated;
revoke all privileges on table public.chat_messages from authenticated;
revoke all privileges on table public.chat_mentions from authenticated;
revoke all privileges on table public.chat_reactions from authenticated;
revoke all privileges on table public.chat_message_versions from authenticated;

grant select, insert, update on table public.chat_threads to authenticated;
grant select, insert, update, delete on table public.chat_participants to authenticated;
grant select, insert, update on table public.chat_messages to authenticated;
grant select, insert on table public.chat_mentions to authenticated;
grant select, insert, delete on table public.chat_reactions to authenticated;
grant select on table public.chat_message_versions to authenticated;

revoke execute on function private.find_or_create_direct_thread(uuid)
  from public, anon, authenticated, service_role;

revoke execute on function public.find_or_create_direct_thread(uuid) from public, anon;
revoke execute on function public.create_team(text, text, public.chat_team_visibility, uuid[]) from public, anon;
revoke execute on function public.join_team(uuid) from public, anon;
revoke execute on function public.add_team_member(uuid, uuid) from public, anon;
revoke execute on function public.remove_team_member(uuid, uuid) from public, anon;
revoke execute on function public.match_chat_messages(vector, integer, double precision) from public, anon;
revoke execute on function public.search_chat_messages(text, integer) from public, anon;

grant execute on function public.find_or_create_direct_thread(uuid) to authenticated, service_role;
grant execute on function public.create_team(text, text, public.chat_team_visibility, uuid[]) to authenticated, service_role;
grant execute on function public.join_team(uuid) to authenticated, service_role;
grant execute on function public.add_team_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.match_chat_messages(vector, integer, double precision) to authenticated, service_role;
grant execute on function public.search_chat_messages(text, integer) to authenticated, service_role;
