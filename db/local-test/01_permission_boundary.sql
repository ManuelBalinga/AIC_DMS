\set ON_ERROR_STOP on

-- Permission-boundary test for the RLS policies (master plan section 15).
--
-- RLS fails silently: a wrong policy does not raise, it returns rows. So every
-- check below RAISES on the wrong answer rather than printing a number for a
-- human to eyeball -- a test you have to read carefully is a test that passes
-- by accident.
--
-- Run via: npm run verify:rls:local

-- Returns its result rather than raising a NOTICE: psql sends notices to
-- stderr, where a caller capturing stdout never sees them. A wrong answer still
-- raises, which stops the script.
create or replace function pg_temp.expect(label text, actual anyelement, wanted anyelement)
returns text language plpgsql as $$
begin
  if actual is distinct from wanted then
    raise exception 'FAIL % -- expected %, got %', label, wanted, actual;
  end if;
  return format('  ok  %s (%s)', label, actual);
end $$;

-- The mirror image of expect(): the statement must be refused. Returns its
-- result for the same reason -- a check whose success is invisible is a check
-- nobody notices has stopped running.
create or replace function pg_temp.expect_denied(label text, stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL % -- the statement was allowed', label;
exception
  when insufficient_privilege then
    return format('  ok  %s (denied)', label);
end $$;

-- Trigger-enforced invariants raise data exceptions rather than privilege
-- errors. Keep those checks distinct from expect_denied so a test documents
-- whether the database rejected an operation because of RLS or because the
-- attempted state itself is invalid.
create or replace function pg_temp.expect_error(label text, stmt text, wanted_state text)
returns text language plpgsql as $$
begin
  begin
    execute stmt;
  exception
    when others then
      if sqlstate is distinct from wanted_state then
        raise exception 'FAIL % -- expected SQLSTATE %, got %', label, wanted_state, sqlstate;
      end if;
      return format('  ok  %s (rejected: %s)', label, sqlstate);
  end;

  raise exception 'FAIL % -- the statement was allowed', label;
end $$;

-- Two users. The handle_new_user trigger should mirror each into public.profiles.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@aic.test'),
  ('22222222-2222-2222-2222-222222222222','outsider@aic.test');

select pg_temp.expect('handle_new_user mirrored both users into profiles', count(*)::bigint, 2::bigint) from public.profiles;

-- A document owned by the first user, with one chunk.
insert into public.documents (id, owner_id, title, file_name, storage_path, mime_type, size_bytes, tags)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',
        'Confidential fee schedule','fees.pdf',
        '11111111-1111-1111-1111-111111111111/33333333-3333-3333-3333-333333333333/fees.pdf',
        'application/pdf',1024, array['i363']);

insert into public.document_chunks (document_id, chunk_index, content)
values ('33333333-3333-3333-3333-333333333333', 0, 'The i363 fee is 500 cedis.');

-- ---- as the OUTSIDER -------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select pg_temp.expect('outsider sees no documents', count(*)::bigint, 0::bigint) from public.documents;
select pg_temp.expect('outsider sees no chunks', count(*)::bigint, 0::bigint) from public.document_chunks;
select pg_temp.expect('outsider gets no keyword hits', count(*)::bigint, 0::bigint) from public.search_document_chunks('fee', 10);
select pg_temp.expect('can_read_document says no', public.can_read_document('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222'), false);

-- ---- as the OWNER ----------------------------------------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect('owner sees their document', count(*)::bigint, 1::bigint) from public.documents;
select pg_temp.expect('owner sees their chunks', count(*)::bigint, 1::bigint) from public.document_chunks;

-- Owner grants access to the outsider.
insert into public.document_access (document_id, user_id, granted_by)
values ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111');

-- ---- outsider AFTER the grant ---------------------------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect('granted user sees the document', count(*)::bigint, 1::bigint) from public.documents;
select pg_temp.expect('granted user sees the chunks', count(*)::bigint, 1::bigint) from public.document_chunks;

-- Outsider must not be able to hand the document to somebody else.
select pg_temp.expect('granted user cannot re-share it', public.can_manage_document('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222'), false);

-- ---- revoke ----------------------------------------------------------------
reset role;
delete from public.document_access where document_id='33333333-3333-3333-3333-333333333333';

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect('revoked user sees no documents', count(*)::bigint, 0::bigint) from public.documents;
select pg_temp.expect('revoked user sees no chunks', count(*)::bigint, 0::bigint) from public.document_chunks;
reset role;


-- ---------------------------------------------------------------------------
-- Document roles, and the administrator who may manage but not read.
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444','admin@aic.test'),
  ('55555555-5555-5555-5555-555555555555','editor@aic.test');
update public.profiles set role = 'administrator'
  where id = '44444444-4444-4444-4444-444444444444';

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

-- The heart of "manage access, not content": the row is visible so access can
-- be administered, the chunks are not so the contents stay closed.
select pg_temp.expect('admin sees the document row', count(*)::bigint, 1::bigint)
  from public.documents;
select pg_temp.expect('admin cannot read its chunks', count(*)::bigint, 0::bigint)
  from public.document_chunks;
select pg_temp.expect('admin can_read_document says no',
  public.can_read_document('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'), false);
select pg_temp.expect('admin can still manage access',
  public.can_manage_document('33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444'), true);
select pg_temp.expect('admin gets no keyword hits either', count(*)::bigint, 0::bigint)
  from public.search_document_chunks('fee', 10);

-- Roles are ordered, so each includes the one below it.
reset role;
insert into public.document_access (document_id, user_id, role, granted_by)
values ('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555',
        'editor','11111111-1111-1111-1111-111111111111');

select pg_temp.expect('editor may edit',
  public.can_edit_document('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555'), true);
select pg_temp.expect('editor may comment',
  public.can_comment_on_document('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555'), true);
select pg_temp.expect('editor may not re-share',
  public.can_manage_document('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555'), false);

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select pg_temp.expect_error('an Editor cannot make themself the document owner',
  $q$update public.documents
       set owner_id = '55555555-5555-5555-5555-555555555555'
     where id = '33333333-3333-3333-3333-333333333333'$q$, '42501');

reset role;
update public.document_access set role = 'viewer'
  where user_id = '55555555-5555-5555-5555-555555555555';
select pg_temp.expect('viewer may read',
  public.can_read_document('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555'), true);
select pg_temp.expect('viewer may not comment',
  public.can_comment_on_document('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555'), false);
select pg_temp.expect('viewer may not edit',
  public.can_edit_document('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555'), false);

-- ---------------------------------------------------------------------------
-- Comments inherit the document's privacy exactly.
-- ---------------------------------------------------------------------------
insert into public.document_comments (document_id, author_id, body)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','Is this current?');

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.expect('admin cannot read comments either', count(*)::bigint, 0::bigint)
  from public.document_comments;

set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select pg_temp.expect('viewer can read comments', count(*)::bigint, 1::bigint)
  from public.document_comments;
reset role;

-- ---------------------------------------------------------------------------
-- The last active administrator cannot be demoted or deactivated.
-- ---------------------------------------------------------------------------
do $$
begin
  update public.profiles set role = 'member'
    where id = '44444444-4444-4444-4444-444444444444';
  raise exception 'FAIL last administrator was demoted';
exception
  when check_violation then
    raise notice 'ok  last administrator cannot be demoted';
end $$;

do $$
begin
  update public.profiles set deactivated_at = now()
    where id = '44444444-4444-4444-4444-444444444444';
  raise exception 'FAIL last administrator was deactivated';
exception
  when check_violation then
    raise notice 'ok  last administrator cannot be deactivated';
end $$;


-- ---------------------------------------------------------------------------
-- Chat: a private conversation is private (migration 0008)
--
-- The same silent-failure risk as documents, with a sharper edge: a leaking
-- policy here exposes what two colleagues said to each other, which no
-- administrator setting is supposed to reveal.
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666','bob@aic.test'),
  ('77777777-7777-7777-7777-777777777777','carol@aic.test');

-- ---- ALICE (the existing owner account) starts a DM with BOB --------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select public.find_or_create_direct_thread('66666666-6666-6666-6666-666666666666') as thread \gset

select pg_temp.expect('the direct thread is idempotent',
  public.find_or_create_direct_thread('66666666-6666-6666-6666-666666666666'), :'thread'::uuid);

insert into public.chat_messages (thread_id, sender_id, body)
values (:'thread'::uuid, '11111111-1111-1111-1111-111111111111',
        'The i363 fee schedule is going up next quarter.');

select public.promote_chat_thread_to_document(
  :'thread'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Private decision', 'Private conversation snapshot.',
  'private-decision.md',
  '11111111-1111-1111-1111-111111111111/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/private-decision.md',
  256, array['decision']
);
select pg_temp.expect('DM promotion creates no Team grant', count(*)::bigint, 0::bigint)
  from public.document_team_access
  where document_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select pg_temp.expect_error('a document row cannot bind another storage path',
  $q$insert into public.documents (
    id, owner_id, title, file_name, storage_path, mime_type, size_bytes
  ) values (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111',
    'Forged', 'private-decision.md',
    '66666666-6666-6666-6666-666666666666/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/private-decision.md',
    'text/markdown', 256
  )$q$, '23514');

select pg_temp.expect('sender sees their own message', count(*)::bigint, 1::bigint) from public.chat_messages;
select pg_temp.expect('the trigger counted the message', message_count, 1)
  from public.chat_threads where id = :'thread'::uuid;

-- ---- BOB, the other participant -------------------------------------------
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select pg_temp.expect('participant sees the thread', count(*)::bigint, 1::bigint) from public.chat_threads;
select pg_temp.expect('participant sees both participants', count(*)::bigint, 2::bigint) from public.chat_participants;
select pg_temp.expect('participant sees the message', count(*)::bigint, 1::bigint) from public.chat_messages;
select pg_temp.expect('a DM co-participant does not inherit its promoted document', count(*)::bigint, 0::bigint)
  from public.documents where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
-- Migration 0009: a direct message is never a retrieval source. Bob can read
-- this message — it is his conversation — but Ask cannot reach it. Reading a
-- conversation and retrieving from it are separate permissions, and this is
-- the assertion that keeps them separate.
select pg_temp.expect('a participant does not retrieve a direct message', count(*)::bigint, 0::bigint)
  from public.search_chat_messages('fee schedule', 10);

-- The other half of the insert policy, and the half that is easy to leave out:
-- being in the thread does not let you sign somebody else's name to a message.
select pg_temp.expect_denied('a participant cannot post as someone else',
  format($q$insert into public.chat_messages (thread_id, sender_id, body)
            values (%L, '11111111-1111-1111-1111-111111111111', 'not me')$q$, :'thread'));

-- ---- CAROL, who is in no thread at all ------------------------------------
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
select pg_temp.expect('outsider sees no threads', count(*)::bigint, 0::bigint) from public.chat_threads;
select pg_temp.expect('outsider sees no participants', count(*)::bigint, 0::bigint) from public.chat_participants;
select pg_temp.expect('outsider sees no messages', count(*)::bigint, 0::bigint) from public.chat_messages;
select pg_temp.expect('outsider retrieves nothing by keyword', count(*)::bigint, 0::bigint)
  from public.search_chat_messages('fee schedule', 10);
select pg_temp.expect('is_chat_participant says no',
  private.is_chat_participant(:'thread'::uuid, '77777777-7777-7777-7777-777777777777'), false);

-- Writing into somebody else's conversation, and adding themselves to it.
select pg_temp.expect_denied('outsider cannot post into a thread they are not in',
  format($q$insert into public.chat_messages (thread_id, sender_id, body)
            values (%L, '77777777-7777-7777-7777-777777777777', 'let me in')$q$, :'thread'));

select pg_temp.expect_denied('outsider cannot add themselves to a thread',
  format($q$insert into public.chat_participants (thread_id, user_id)
            values (%L, '77777777-7777-7777-7777-777777777777')$q$, :'thread'));

-- ---- THE ADMINISTRATOR, who is not a participant --------------------------
-- Migration 0007 took document reading away from administrators. Private
-- messages were never theirs to begin with, and this is the assertion that
-- says so out loud.
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.expect('administrator sees no threads', count(*)::bigint, 0::bigint) from public.chat_threads;
select pg_temp.expect('administrator sees no messages', count(*)::bigint, 0::bigint) from public.chat_messages;
select pg_temp.expect('administrator retrieves nothing by keyword', count(*)::bigint, 0::bigint)
  from public.search_chat_messages('fee schedule', 10);

-- ---- A direct conversation's two-person identity cannot be changed --------
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
delete from public.chat_participants
  where thread_id = :'thread'::uuid and user_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect('a participant cannot remove another', count(*)::bigint, 2::bigint)
  from public.chat_participants where thread_id = :'thread'::uuid;

delete from public.chat_participants
  where thread_id = :'thread'::uuid and user_id = '66666666-6666-6666-6666-666666666666';
select pg_temp.expect('a direct participant cannot leave', count(*)::bigint, 2::bigint)
  from public.chat_participants where thread_id = :'thread'::uuid;


-- ---------------------------------------------------------------------------
-- Chat: a closed Team conversation is an explicit retrieval source
--
-- The counter-case to the assertion above, and the reason 0009 filters on
-- `is_group` rather than switching message retrieval off wholesale. A named
-- group conversation is a deliberate shared space, closer to a team channel
-- than to a private word between two colleagues, and Ask is still allowed to
-- read it — for its participants, and for nobody else.
--
-- The body here is deliberately identical to the direct message above. That is
-- what makes these assertions worth running: the same sentence exists in both a
-- private and a group conversation, so a count of 1 proves the filter
-- discriminates on the thread rather than on the text.
-- ---------------------------------------------------------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.chat_threads (id, created_by, topic, is_group, kind, visibility, purpose)
values ('88888888-8888-8888-8888-888888888888',
        '11111111-1111-1111-1111-111111111111', 'i363 planning', true,
        'team', 'closed', 'Coordinate the i363 rollout.');

insert into public.chat_participants (thread_id, user_id) values
  ('88888888-8888-8888-8888-888888888888','11111111-1111-1111-1111-111111111111'),
  ('88888888-8888-8888-8888-888888888888','77777777-7777-7777-7777-777777777777');

insert into public.chat_messages (thread_id, sender_id, body)
values ('88888888-8888-8888-8888-888888888888',
        '11111111-1111-1111-1111-111111111111',
        'The i363 fee schedule is going up next quarter.')
returning id as group_message \gset

select public.create_team(
  'Open promotion boundary', 'Readable company-wide, writable by members.',
  'open', '{}'::uuid[]
) as open_team \gset

select pg_temp.expect('a participant retrieves from a group thread', count(*)::bigint, 1::bigint)
  from public.search_chat_messages('fee schedule', 10);

-- Team document access follows current membership. The grant is one durable
-- row; it is not copied into a per-person ACL. Direct conversations are never
-- valid permission groups.
insert into public.document_team_access (document_id, team_id, role, granted_by)
values ('33333333-3333-3333-3333-333333333333',
        '88888888-8888-8888-8888-888888888888', 'viewer',
        '11111111-1111-1111-1111-111111111111');
select pg_temp.expect('a Team manager sees the inherited-document warning count',
  public.team_document_grant_count('88888888-8888-8888-8888-888888888888'), 1::bigint);
select pg_temp.expect_error('a direct conversation cannot receive document access',
  format($q$insert into public.document_team_access (document_id, team_id, role, granted_by)
            values ('33333333-3333-3333-3333-333333333333', %L, 'viewer',
                    '11111111-1111-1111-1111-111111111111')$q$, :'thread'), '23514');

insert into public.documents
  (id, owner_id, title, file_name, storage_path, mime_type, size_bytes, tags)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '11111111-1111-1111-1111-111111111111', 'Restricted reference test',
   'reference.txt',
   '11111111-1111-1111-1111-111111111111/dddddddd-dddd-dddd-dddd-dddddddddddd/reference.txt',
   'text/plain', 32, array['reference'])
returning id as reference_doc \gset

select pg_temp.expect('a closed Team reports one reader without document access',
  public.document_reference_gap_count(
    '88888888-8888-8888-8888-888888888888', :'reference_doc'::uuid), 1::bigint);

select public.send_chat_message(
  '88888888-8888-8888-8888-888888888888',
  'This reference stays locked until access is granted.', null, '{}'::uuid[],
  array[:'reference_doc'::uuid], 'locked'
) as locked_reference_message \gset

-- ---------------------------------------------------------------------------
-- Chat collaboration and retention (migration 0011)
-- ---------------------------------------------------------------------------

-- Editing keeps the previous body as append-only history and invalidates the
-- old embedding. The sender can inspect that history while the message is
-- live; it is not a second message that changes the thread counter.
update public.chat_messages
   set body = 'The revised i363 fee schedule takes effect next quarter.'
 where id = :'group_message'::uuid;

select pg_temp.expect('an edit changes the visible message body', body,
  'The revised i363 fee schedule takes effect next quarter.')
  from public.chat_messages where id = :'group_message'::uuid;
select pg_temp.expect('an edit is marked', edited_at is not null, true)
  from public.chat_messages where id = :'group_message'::uuid;
select pg_temp.expect('an edit retains the previous body', body,
  'The i363 fee schedule is going up next quarter.')
  from public.chat_message_versions where message_id = :'group_message'::uuid;
select pg_temp.expect('editing does not increment the thread message count', message_count, 1)
  from public.chat_threads where id = '88888888-8888-8888-8888-888888888888';

-- A reply and its mentions are written atomically by the RPC. A root may have
-- replies; a reply may not itself become the parent of another reply.
select public.send_chat_message(
  '88888888-8888-8888-8888-888888888888',
  'Carol, please confirm the revised date.',
  :'group_message'::uuid,
  array['77777777-7777-7777-7777-777777777777']::uuid[]
) as reply_message \gset

select pg_temp.expect('a reply keeps its root-message ancestry', parent_id,
  :'group_message'::uuid)
  from public.chat_messages where id = :'reply_message'::uuid;
select pg_temp.expect('the reply records its participant mention', count(*)::bigint, 1::bigint)
  from public.chat_mentions
  where message_id = :'reply_message'::uuid
    and mentioned_user_id = '77777777-7777-7777-7777-777777777777';

select pg_temp.expect_error('a reply cannot have a reply of its own',
  format($q$select public.send_chat_message(
    '88888888-8888-8888-8888-888888888888',
    'Nested reply', %L, '{}'::uuid[])$q$, :'reply_message'), 'P0001');
select pg_temp.expect('the rejected nested reply was not partially inserted', count(*)::bigint, 2::bigint)
  from public.chat_messages
  where thread_id = '88888888-8888-8888-8888-888888888888';

select pg_temp.expect_error('a message cannot mention someone outside its conversation',
  $q$select public.send_chat_message(
    '88888888-8888-8888-8888-888888888888',
    'This must roll back', null,
    array['66666666-6666-6666-6666-666666666666']::uuid[])$q$, '42501');
select pg_temp.expect('a failed mention rolls its message back too', count(*)::bigint, 2::bigint)
  from public.chat_messages
  where thread_id = '88888888-8888-8888-8888-888888888888';

-- Carol is a member of this one, unlike the direct thread above.
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
select pg_temp.expect('the other member retrieves it too', count(*)::bigint, 1::bigint)
  from public.search_chat_messages('revised i363 fee schedule', 10);
select pg_temp.expect('a Team member inherits its document', count(*)::bigint, 1::bigint)
  from public.documents where id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect('a Team member inherits access to its chunks', count(*)::bigint, 1::bigint)
  from public.document_chunks where document_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect('a Team viewer cannot comment',
  public.can_comment_on_document('33333333-3333-3333-3333-333333333333',
                                 '77777777-7777-7777-7777-777777777777'), false);
select pg_temp.expect('a Team reader sees a title-free locked card', count(*)::bigint, 1::bigint)
  from public.list_chat_document_references('88888888-8888-8888-8888-888888888888')
  where message_id = :'locked_reference_message'::uuid
    and locked and document_id is null and title is null;
select pg_temp.expect_denied('raw document-reference rows are not selectable',
  'select * from public.chat_document_references');
select pg_temp.expect('a participant sees edit history', count(*)::bigint, 1::bigint)
  from public.chat_message_versions where message_id = :'group_message'::uuid;
select pg_temp.expect('a mentioned participant sees their mention', count(*)::bigint, 1::bigint)
  from public.chat_mentions where message_id = :'reply_message'::uuid;

insert into public.chat_reactions (message_id, user_id, emoji)
values (:'reply_message'::uuid, '77777777-7777-7777-7777-777777777777', '👍');
select pg_temp.expect('a participant can react once', count(*)::bigint, 1::bigint)
  from public.chat_reactions where message_id = :'reply_message'::uuid;

-- Bob remains in his direct thread and was never in this Team.
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select pg_temp.expect('a non-member retrieves nothing from a group thread', count(*)::bigint, 0::bigint)
  from public.search_chat_messages('revised i363 fee schedule', 10);
select pg_temp.expect('a non-member sees no edit history', count(*)::bigint, 0::bigint)
  from public.chat_message_versions;
select pg_temp.expect('a non-member sees no mentions', count(*)::bigint, 0::bigint)
  from public.chat_mentions;
select pg_temp.expect('a non-member sees no reactions', count(*)::bigint, 0::bigint)
  from public.chat_reactions;
select pg_temp.expect('a non-member does not inherit a Team document', count(*)::bigint, 0::bigint)
  from public.documents where id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect('a non-member does not inherit Team document chunks', count(*)::bigint, 0::bigint)
  from public.document_chunks where document_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect_error('a closed-Team outsider cannot query document references',
  $q$select * from public.list_chat_document_references(
    '88888888-8888-8888-8888-888888888888')$q$, '42501');
select pg_temp.expect_error('a closed-Team outsider cannot promote it',
  $q$select public.promote_chat_thread_to_document(
    '88888888-8888-8888-8888-888888888888',
    '12121212-1212-1212-1212-121212121212', 'Closed theft', 'No',
    'closed-theft.md',
    '66666666-6666-6666-6666-666666666666/12121212-1212-1212-1212-121212121212/closed-theft.md',
    10, '{}'::text[])$q$, '42501');
select pg_temp.expect_error('an open-Team reader cannot promote without joining',
  format($q$select public.promote_chat_thread_to_document(
    %L, '13131313-1313-1313-1313-131313131313', 'Open theft', 'No',
    'open-theft.md',
    '66666666-6666-6666-6666-666666666666/13131313-1313-1313-1313-131313131313/open-theft.md',
    10, '{}'::text[])$q$, :'open_team'), '42501');
select pg_temp.expect_denied('a non-member cannot react to a message',
  format($q$insert into public.chat_reactions (message_id, user_id, emoji)
            values (%L, '66666666-6666-6666-6666-666666666666', '👍')$q$, :'reply_message'));

-- Group or direct, the administrator is not a participant and gets nothing.
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.expect('administrator retrieves nothing from a group thread', count(*)::bigint, 0::bigint)
  from public.search_chat_messages('revised i363 fee schedule', 10);
select pg_temp.expect('administrator sees no edit history', count(*)::bigint, 0::bigint)
  from public.chat_message_versions;
select pg_temp.expect('administrator sees no mentions', count(*)::bigint, 0::bigint)
  from public.chat_mentions;
select pg_temp.expect('administrator sees no reactions', count(*)::bigint, 0::bigint)
  from public.chat_reactions;
select pg_temp.expect_error('a closed-Team administrator cannot query document references',
  $q$select * from public.list_chat_document_references(
    '88888888-8888-8888-8888-888888888888')$q$, '42501');
select pg_temp.expect_error('a non-member administrator cannot promote a closed Team',
  $q$select public.promote_chat_thread_to_document(
    '88888888-8888-8888-8888-888888888888',
    '14141414-1414-1414-1414-141414141414', 'Admin theft', 'No',
    'admin-theft.md',
    '44444444-4444-4444-4444-444444444444/14141414-1414-1414-1414-141414141414/admin-theft.md',
    10, '{}'::text[])$q$, '42501');

-- Retraction is the only ordinary-user removal operation. It leaves a visible
-- tombstone, clears derived search data, hides version history, and cannot be
-- reversed. There is deliberately no DELETE policy even for the sender.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.send_chat_message(
  '88888888-8888-8888-8888-888888888888',
  'Grant Team Viewer access and send in one transaction.', null, '{}'::uuid[],
  array[:'reference_doc'::uuid], 'grant_team'
) as granted_reference_message \gset

select public.promote_chat_thread_to_document(
  '88888888-8888-8888-8888-888888888888',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'i363 Team decision', 'Promoted conversation snapshot.',
  'i363-team-decision.md',
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/i363-team-decision.md',
  512, array['team', 'decision']
);
select pg_temp.expect('promotion creates an owned Markdown document', count(*)::bigint, 1::bigint)
  from public.documents
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and owner_id = '11111111-1111-1111-1111-111111111111'
    and mime_type = 'text/markdown';
select pg_temp.expect('Team promotion creates one Viewer grant', count(*)::bigint, 1::bigint)
  from public.document_team_access
  where document_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and team_id = '88888888-8888-8888-8888-888888888888'
    and role = 'viewer';
select pg_temp.expect_error('promotion rejects a mismatched storage path',
  $q$select public.promote_chat_thread_to_document(
    '88888888-8888-8888-8888-888888888888',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Bad path', 'No',
    'bad.md', 'someone-else/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/bad.md',
    10, '{}'::text[])$q$, '22023');

update public.chat_messages
   set retracted_at = now(),
       retracted_by = '11111111-1111-1111-1111-111111111111'
 where id = :'group_message'::uuid;

select pg_temp.expect('retraction leaves a visible tombstone', body, '[Message retracted]')
  from public.chat_messages where id = :'group_message'::uuid;
select pg_temp.expect('retraction records who withdrew the message', retracted_by,
  '11111111-1111-1111-1111-111111111111'::uuid)
  from public.chat_messages where id = :'group_message'::uuid;
select pg_temp.expect('retraction clears the derived embedding', embedding is null, true)
  from public.chat_messages where id = :'group_message'::uuid;

-- The retained record is intentionally unavailable through an ordinary
-- participant session, but still exists for a properly authorised audit.
reset role;
select pg_temp.expect('retraction retains both historical bodies for audit', count(*)::bigint, 2::bigint)
  from public.chat_message_versions where message_id = :'group_message'::uuid;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.expect('retracted text leaves keyword retrieval', count(*)::bigint, 0::bigint)
  from public.search_chat_messages('revised i363 fee schedule', 10);
select pg_temp.expect('retraction hides retained versions from ordinary readers', count(*)::bigint, 0::bigint)
  from public.chat_message_versions where message_id = :'group_message'::uuid;

select pg_temp.expect_error('a sender cannot reverse a retraction',
  format($q$update public.chat_messages
              set retracted_at = null, retracted_by = null, body = 'restored'
            where id = %L$q$, :'group_message'), 'P0001');

-- Use the unreferenced reply for this assertion. If DELETE permission ever
-- regresses, it will really disappear rather than merely being stopped by the
-- root message's ON DELETE RESTRICT relationship.
select pg_temp.expect_denied('hard delete is rejected at the privilege boundary',
  format('delete from public.chat_messages where id = %L', :'reply_message'));
select pg_temp.expect('hard delete is denied even to the sender', count(*)::bigint, 1::bigint)
  from public.chat_messages where id = :'reply_message'::uuid;

-- Replies remain attached to the tombstone, preserving the conversation's
-- shape after the root is withdrawn.
select pg_temp.expect('retraction preserves reply ancestry', count(*)::bigint, 1::bigint)
  from public.chat_messages
  where id = :'reply_message'::uuid and parent_id = :'group_message'::uuid;

-- The other participant sees the tombstone and collaboration metadata but not
-- retained message versions after retraction.
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
select pg_temp.expect('a participant sees the retraction tombstone', body, '[Message retracted]')
  from public.chat_messages where id = :'group_message'::uuid;
select pg_temp.expect('a participant cannot read retained retracted text', count(*)::bigint, 0::bigint)
  from public.chat_message_versions where message_id = :'group_message'::uuid;
select pg_temp.expect('reactions remain visible on an unretracted reply', count(*)::bigint, 1::bigint)
  from public.chat_reactions where message_id = :'reply_message'::uuid;
select pg_temp.expect('a later Team grant dynamically unlocks both old and new cards', count(*)::bigint, 2::bigint)
  from public.list_chat_document_references('88888888-8888-8888-8888-888888888888')
  where not locked and document_id = :'reference_doc'::uuid
    and title = 'Restricted reference test';
select pg_temp.expect('the atomic Team grant unlocks the referenced document', count(*)::bigint, 1::bigint)
  from public.documents where id = :'reference_doc'::uuid;
select pg_temp.expect('a Team member reads the promoted Team document', count(*)::bigint, 1::bigint)
  from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select pg_temp.expect('a Team member does not inherit a promoted DM document', count(*)::bigint, 0::bigint)
  from public.documents where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select pg_temp.expect_error('a non-participant cannot promote a direct conversation',
  format($q$select public.promote_chat_thread_to_document(
    %L, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Stolen', 'No',
    'stolen.md',
    '77777777-7777-7777-7777-777777777777/ffffffff-ffff-ffff-ffff-ffffffffffff/stolen.md',
    10, '{}'::text[])$q$, :'thread'), '42501');

-- Leaving a Team removes inherited document access immediately without
-- changing the grant row or any unrelated direct-message membership.
select public.remove_team_member(
  '88888888-8888-8888-8888-888888888888',
  '77777777-7777-7777-7777-777777777777'
);
select pg_temp.expect('leaving a Team removes inherited document metadata', count(*)::bigint, 0::bigint)
  from public.documents where id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect('leaving a Team removes inherited document chunks', count(*)::bigint, 0::bigint)
  from public.document_chunks where document_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect('leaving a Team removes promoted-document access', count(*)::bigint, 0::bigint)
  from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Offline copies are server-authored, renewable leases (migration 0017).
reset role;
update public.document_access set role = 'editor'
where document_id = '33333333-3333-3333-3333-333333333333'
  and user_id = '55555555-5555-5555-5555-555555555555';

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select pg_temp.expect('a reader receives one thirty-day offline lease',
  count(*)::bigint, 1::bigint)
from public.request_offline_document(
  '33333333-3333-3333-3333-333333333333',
  '99999999-9999-9999-9999-999999999999'
)
where expires_at between now() + interval '29 days'
                     and now() + interval '31 days';
select pg_temp.expect_denied('a reader cannot forge an offline audit row',
  $q$insert into public.offline_document_leases
      (user_id, document_id, client_device_id)
    values (
      '55555555-5555-5555-5555-555555555555',
      '33333333-3333-3333-3333-333333333333',
      '98989898-9898-9898-9898-989898989898'
    )$q$);
select pg_temp.expect_error('an Editor cannot set the owner-only offline veto',
  $q$update public.documents set offline_allowed = false
    where id = '33333333-3333-3333-3333-333333333333'$q$, '42501');

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.expect_error('a user without read access cannot request a lease',
  $q$select * from public.request_offline_document(
    '33333333-3333-3333-3333-333333333333',
    '97979797-9797-9797-9797-979797979797')$q$, '42501');

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select * from public.request_offline_document(
  '33333333-3333-3333-3333-333333333333',
  '96969696-9696-9696-9696-969696969696'
);
select pg_temp.expect('the owner sees leases issued for their document',
  count(*)::bigint, 2::bigint)
from public.offline_document_leases
where document_id = '33333333-3333-3333-3333-333333333333';
update public.documents set offline_allowed = false
where id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect('the owner veto revokes every active lease',
  count(*)::bigint, 2::bigint)
from public.offline_document_leases
where document_id = '33333333-3333-3333-3333-333333333333'
  and revoked_at is not null and revocation_reason = 'owner_veto';

set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select pg_temp.expect('revalidation reports an owner-vetoed lease as denied',
  allowed, false)
from public.revalidate_offline_documents(
  '99999999-9999-9999-9999-999999999999',
  array['33333333-3333-3333-3333-333333333333']::uuid[]
);

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.documents set offline_allowed = true
where id = '33333333-3333-3333-3333-333333333333';
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select * from public.request_offline_document(
  '33333333-3333-3333-3333-333333333333',
  '99999999-9999-9999-9999-999999999999'
);
reset role;
delete from public.document_access
where document_id = '33333333-3333-3333-3333-333333333333'
  and user_id = '55555555-5555-5555-5555-555555555555';

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select pg_temp.expect('revalidation denies a lease after read access is revoked',
  allowed, false)
from public.revalidate_offline_documents(
  '99999999-9999-9999-9999-999999999999',
  array['33333333-3333-3333-3333-333333333333']::uuid[]
);
select pg_temp.expect('permission loss is retained in the audit row',
  revocation_reason, 'permission_revoked')
from public.offline_document_leases
where user_id = '55555555-5555-5555-5555-555555555555'
  and client_device_id = '99999999-9999-9999-9999-999999999999'
  and document_id = '33333333-3333-3333-3333-333333333333';

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select * from public.request_offline_document(
  '33333333-3333-3333-3333-333333333333',
  '96969696-9696-9696-9696-969696969696'
);
reset role;
update public.offline_document_leases
set granted_at = now() - interval '31 days',
    expires_at = now() - interval '1 day'
where user_id = '11111111-1111-1111-1111-111111111111'
  and client_device_id = '96969696-9696-9696-9696-969696969696'
  and document_id = '33333333-3333-3333-3333-333333333333';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect('an expired lease is denied during batch validation',
  allowed, false)
from public.revalidate_offline_documents(
  '96969696-9696-9696-9696-969696969696',
  array['33333333-3333-3333-3333-333333333333']::uuid[]
);
select pg_temp.expect('expiry is retained in the audit row',
  revocation_reason, 'expired')
from public.offline_document_leases
where user_id = '11111111-1111-1111-1111-111111111111'
  and client_device_id = '96969696-9696-9696-9696-969696969696'
  and document_id = '33333333-3333-3333-3333-333333333333';

set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select pg_temp.expect('an administrator sees lease metadata but not bytes',
  count(*)::bigint, 2::bigint)
from public.offline_document_leases
where document_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.expect_error('an ungranted administrator cannot request a lease',
  $q$select * from public.request_offline_document(
    '33333333-3333-3333-3333-333333333333',
    '95959595-9595-9595-9595-959595959595')$q$, '42501');

reset role;

\echo ''
\echo 'Permission boundary: all checks passed.'
