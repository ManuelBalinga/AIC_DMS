-- Security and query-planning hardening identified by the hosted Supabase
-- advisors on 31 August 2026.

-- Trigger functions are invoked by their triggers, not called as public RPCs.
-- PostgreSQL grants EXECUTE to PUBLIC for new functions by default, which made
-- these implementation details callable through PostgREST.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_last_administrator() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.touch_chat_thread() from public, anon, authenticated;
revoke execute on function public.touch_conversation_on_message() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- SECURITY DEFINER policy helpers belong outside the exposed API schema. The
-- policy dependencies follow the function OIDs when they move, so the policies
-- keep working without being recreated.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.is_administrator(uuid) set schema private;
alter function public.can_read_document(uuid, uuid) set schema private;
alter function public.can_manage_document(uuid, uuid) set schema private;
alter function public.can_comment_on_document(uuid, uuid) set schema private;
alter function public.can_edit_document(uuid, uuid) set schema private;
alter function public.is_chat_participant(uuid, uuid) set schema private;
alter function public.find_or_create_direct_thread(uuid) set schema private;

alter function private.is_administrator(uuid) set search_path = '';
alter function private.can_read_document(uuid, uuid) set search_path = '';
alter function private.can_comment_on_document(uuid, uuid) set search_path = '';
alter function private.can_edit_document(uuid, uuid) set search_path = '';
alter function private.is_chat_participant(uuid, uuid) set search_path = '';
alter function private.find_or_create_direct_thread(uuid) set search_path = '';

-- can_manage_document called is_administrator by its old public-qualified name;
-- replace its body after both functions have moved.
create or replace function private.can_manage_document(
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
        or private.is_administrator(check_user_id)
      )
  );
$fn$;

revoke execute on function private.is_administrator(uuid) from public, anon;
revoke execute on function private.can_read_document(uuid, uuid) from public, anon;
revoke execute on function private.can_manage_document(uuid, uuid) from public, anon;
revoke execute on function private.can_comment_on_document(uuid, uuid) from public, anon;
revoke execute on function private.can_edit_document(uuid, uuid) from public, anon;
revoke execute on function private.is_chat_participant(uuid, uuid) from public, anon;
revoke execute on function private.find_or_create_direct_thread(uuid) from public, anon;

grant execute on function private.is_administrator(uuid) to authenticated, service_role;
grant execute on function private.can_read_document(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_manage_document(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_comment_on_document(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_edit_document(uuid, uuid) to authenticated, service_role;
grant execute on function private.is_chat_participant(uuid, uuid) to authenticated, service_role;
grant execute on function private.find_or_create_direct_thread(uuid) to authenticated, service_role;

-- Two permission checks and direct-thread creation are intentional application
-- RPCs. Their public wrappers run as the caller, require the supplied identity
-- to equal auth.uid(), and delegate the RLS-recursion-breaking work privately.
create or replace function public.can_manage_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select case
    when check_user_id = (select auth.uid())
      then private.can_manage_document(check_document_id, check_user_id)
    else false
  end;
$fn$;

create or replace function public.can_comment_on_document(
  check_document_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select case
    when check_user_id = (select auth.uid())
      then private.can_comment_on_document(check_document_id, check_user_id)
    else false
  end;
$fn$;

create or replace function public.find_or_create_direct_thread(other_user_id uuid)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $fn$
  select private.find_or_create_direct_thread(other_user_id);
$fn$;

revoke execute on function public.can_manage_document(uuid, uuid) from public, anon;
revoke execute on function public.can_comment_on_document(uuid, uuid) from public, anon;
revoke execute on function public.find_or_create_direct_thread(uuid) from public, anon;
grant execute on function public.can_manage_document(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_comment_on_document(uuid, uuid) to authenticated, service_role;
grant execute on function public.find_or_create_direct_thread(uuid) to authenticated, service_role;

-- Future functions start private-by-default. A migration that intentionally
-- exposes an RPC must grant it explicitly, alongside its authentication model.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- Data API grants are a separate gate from RLS. The project inherited every
-- table privilege (including TRUNCATE and TRIGGER) for both API roles. Anonymous
-- visitors need no application tables; signed-in users receive only operations
-- the application actually performs, with RLS still deciding which rows.
revoke all privileges on all tables in schema public from anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.invitations to authenticated;
grant select, insert, update, delete on table public.documents to authenticated;
grant select, insert, update, delete on table public.document_access to authenticated;
grant select on table public.document_chunks to authenticated;
grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert on table public.conversation_messages to authenticated;
grant select, insert on table public.message_citations to authenticated;
grant select, insert, update, delete on table public.document_comments to authenticated;
grant select, insert, update on table public.chat_threads to authenticated;
grant select, insert, update, delete on table public.chat_participants to authenticated;
grant select, insert, update, delete on table public.chat_messages to authenticated;
grant select on table public.document_embeddings to authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;

-- The trigger body only references NEW and NOW(), so it needs no caller-
-- controlled schema lookup. This closes the mutable-search-path advisor finding.
alter function public.touch_updated_at() set search_path = pg_catalog;

-- PostgreSQL does not create indexes for the referencing side of foreign keys.
-- These columns are used for joins and for referential actions, so covering
-- indexes prevent full-table scans as the document and conversation history grows.
create index if not exists chat_messages_sender_id_idx
  on public.chat_messages (sender_id);

create index if not exists chat_threads_created_by_idx
  on public.chat_threads (created_by);

create index if not exists document_access_granted_by_idx
  on public.document_access (granted_by);

create index if not exists document_comments_author_id_idx
  on public.document_comments (author_id);

create index if not exists document_comments_resolved_by_idx
  on public.document_comments (resolved_by);

create index if not exists invitations_invited_by_idx
  on public.invitations (invited_by);

create index if not exists message_citations_document_id_idx
  on public.message_citations (document_id);

create index if not exists message_citations_thread_id_idx
  on public.message_citations (thread_id);
