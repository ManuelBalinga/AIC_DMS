-- Managed offline copies are renewable leases, not permanent downloads.
alter table public.documents
  add column if not exists offline_allowed boolean not null default true;

comment on column public.documents.offline_allowed is
  'Owner-controlled veto for managed offline browser copies.';

create table if not exists public.offline_document_leases (
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  -- A browser-generated cache identifier, never an authentication factor.
  client_device_id uuid not null,
  first_granted_at timestamptz not null default now(),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  last_validated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text check (
    revocation_reason is null
    or revocation_reason in ('expired', 'permission_revoked', 'owner_veto')
  ),
  grant_count integer not null default 1 check (grant_count > 0),
  primary key (user_id, client_device_id, document_id),
  check (expires_at > granted_at),
  check (
    (revoked_at is null and revocation_reason is null)
    or (revoked_at is not null and revocation_reason is not null)
  )
);

create index if not exists offline_document_leases_document_idx
  on public.offline_document_leases (document_id, granted_at desc);
create index if not exists offline_document_leases_active_expiry_idx
  on public.offline_document_leases (expires_at) where revoked_at is null;

alter table public.offline_document_leases enable row level security;
drop policy if exists offline_document_leases_select on public.offline_document_leases;
create policy offline_document_leases_select on public.offline_document_leases
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles viewer
      where viewer.id = (select auth.uid()) and viewer.deactivated_at is null
    )
    and (
      user_id = (select auth.uid())
      or private.can_manage_document(document_id, (select auth.uid()))
    )
  );

-- Editors may update ordinary metadata; only the active owner controls this
-- veto, so a trigger protects the individual column.
create or replace function private.protect_document_offline_setting()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if new.offline_allowed is distinct from old.offline_allowed
     and not exists (
       select 1 from public.profiles p
       where p.id = (select auth.uid())
         and p.id = old.owner_id and p.deactivated_at is null
     ) then
    raise exception 'Only the document owner may change offline availability'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke execute on function private.protect_document_offline_setting()
  from public, anon, authenticated, service_role;
drop trigger if exists documents_protect_offline_setting on public.documents;
create trigger documents_protect_offline_setting
  before update of offline_allowed on public.documents
  for each row execute function private.protect_document_offline_setting();

create or replace function private.revoke_offline_leases_on_veto()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
begin
  if old.offline_allowed and not new.offline_allowed then
    update public.offline_document_leases l
       set revoked_at = now(), revocation_reason = 'owner_veto',
           last_validated_at = now()
     where l.document_id = new.id and l.revoked_at is null;
  end if;
  return new;
end;
$fn$;
revoke execute on function private.revoke_offline_leases_on_veto()
  from public, anon, authenticated, service_role;
drop trigger if exists documents_revoke_offline_leases on public.documents;
create trigger documents_revoke_offline_leases
  after update of offline_allowed on public.documents
  for each row execute function private.revoke_offline_leases_on_veto();

create or replace function public.request_offline_document(
  target_document_id uuid, client_device_id uuid
)
returns table (document_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $fn$
declare
  me uuid := (select auth.uid());
  permitted boolean;
  lease_expiry timestamptz := now() + interval '30 days';
begin
  if me is null or target_document_id is null or client_device_id is null
     or not exists (
       select 1 from public.profiles p
       where p.id = me and p.deactivated_at is null
     ) then
    raise exception 'An active user, document and device are required'
      using errcode = '42501';
  end if;

  -- Serialize with an owner veto. If this wins, the following veto revokes the
  -- lease; if the veto wins, this observes false.
  select d.offline_allowed into permitted
  from public.documents d where d.id = target_document_id for share;
  if not found or not coalesce(permitted, false)
     or not private.can_read_document(target_document_id, me) then
    raise exception 'This document is not available offline'
      using errcode = '42501';
  end if;

  insert into public.offline_document_leases as l (
    user_id, document_id, client_device_id, first_granted_at, granted_at,
    expires_at, last_validated_at, revoked_at, revocation_reason, grant_count
  ) values (
    me, target_document_id, client_device_id, now(), now(), lease_expiry,
    now(), null, null, 1
  )
  on conflict (user_id, client_device_id, document_id) do update
    set granted_at = now(), expires_at = lease_expiry,
        last_validated_at = now(), revoked_at = null,
        revocation_reason = null, grant_count = l.grant_count + 1;

  return query select target_document_id, lease_expiry;
end;
$fn$;

create or replace function public.revalidate_offline_documents(
  client_device_id uuid, target_document_ids uuid[]
)
returns table (document_id uuid, allowed boolean, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $fn$
declare
  me uuid := (select auth.uid());
  checked_id uuid;
  active_profile boolean;
  permitted boolean;
  lease public.offline_document_leases%rowtype;
  renewed_expiry timestamptz;
begin
  if me is null or client_device_id is null then
    raise exception 'A signed-in user and device are required'
      using errcode = '42501';
  end if;
  if cardinality(coalesce(target_document_ids, '{}'::uuid[])) > 500 then
    raise exception 'At most 500 offline documents may be checked at once'
      using errcode = '22023';
  end if;
  select exists (
    select 1 from public.profiles p
    where p.id = me and p.deactivated_at is null
  ) into active_profile;

  for checked_id in
    select distinct requested.id
    from unnest(coalesce(target_document_ids, '{}'::uuid[])) requested(id)
    where requested.id is not null
  loop
    document_id := checked_id; allowed := false; expires_at := null;
    select l.* into lease
    from public.offline_document_leases l
    where l.user_id = me
      and l.client_device_id = revalidate_offline_documents.client_device_id
      and l.document_id = checked_id
    for update;
    if not found then return next; continue; end if;

    expires_at := lease.expires_at;
    if lease.revoked_at is not null then return next; continue; end if;
    if lease.expires_at <= now() then
      update public.offline_document_leases l
      set revoked_at = now(), revocation_reason = 'expired',
          last_validated_at = now()
      where l.user_id = me
        and l.client_device_id = revalidate_offline_documents.client_device_id
        and l.document_id = checked_id;
      return next; continue;
    end if;

    select d.offline_allowed into permitted
    from public.documents d where d.id = checked_id for share;
    if not active_profile or not found or not coalesce(permitted, false)
       or not private.can_read_document(checked_id, me) then
      update public.offline_document_leases l
      set revoked_at = now(),
          revocation_reason = case
            when not coalesce(permitted, false) then 'owner_veto'
            else 'permission_revoked'
          end,
          last_validated_at = now()
      where l.user_id = me
        and l.client_device_id = revalidate_offline_documents.client_device_id
        and l.document_id = checked_id;
      return next; continue;
    end if;

    renewed_expiry := now() + interval '30 days';
    update public.offline_document_leases l
    set expires_at = renewed_expiry, last_validated_at = now()
    where l.user_id = me
      and l.client_device_id = revalidate_offline_documents.client_device_id
      and l.document_id = checked_id;
    allowed := true; expires_at := renewed_expiry;
    return next;
  end loop;
end;
$fn$;

revoke execute on function public.request_offline_document(uuid, uuid)
  from public, anon;
revoke execute on function public.revalidate_offline_documents(uuid, uuid[])
  from public, anon;
grant execute on function public.request_offline_document(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.revalidate_offline_documents(uuid, uuid[])
  to authenticated, service_role;

-- Ordinary sessions can inspect permitted audit rows but cannot forge, alter,
-- or erase them; all writes pass through the caller-checking RPCs above.
revoke all on table public.offline_document_leases
  from public, anon, authenticated;
grant select on table public.offline_document_leases to authenticated;
grant select, insert, update, delete on table public.offline_document_leases
  to service_role;
