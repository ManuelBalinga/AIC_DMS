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

-- Two users. The handle_new_user trigger should mirror each into public.profiles.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','owner@aic.test'),
  ('22222222-2222-2222-2222-222222222222','outsider@aic.test');

select pg_temp.expect('handle_new_user mirrored both users into profiles', count(*)::bigint, 2::bigint) from public.profiles;

-- A document owned by the first user, with one chunk.
insert into public.documents (id, owner_id, title, file_name, storage_path, mime_type, size_bytes, tags)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',
        'Confidential fee schedule','fees.pdf','owner/fees.pdf','application/pdf',1024, array['i363']);

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

\echo ''
\echo 'Permission boundary: all checks passed.'
