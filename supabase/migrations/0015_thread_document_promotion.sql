-- Phase 5: turn a conversation snapshot into a governed document.
-- Storage is written by the server before this RPC. The database half stays
-- atomic: either the document and its Team grant both exist, or neither does.

-- A document row is what authorises the download route to sign private bytes.
-- Bind that row to the uploader's own object on insert, then make the binding
-- immutable. This also prevents an Editor from turning themself into owner;
-- only the existing administrator transfer workflow may change owner_id.
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
     and not private.is_administrator((select auth.uid())) then
    raise exception 'Only an administrator may transfer document ownership'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

revoke execute on function private.protect_document_binding()
  from public, anon, authenticated, service_role;

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
  me uuid := (select auth.uid());
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
) from public, anon;
grant execute on function public.promote_chat_thread_to_document(
  uuid, uuid, text, text, text, text, bigint, text[]
) to authenticated, service_role;
