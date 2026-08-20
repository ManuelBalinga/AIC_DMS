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

\echo ''
\echo 'Permission boundary: all checks passed.'
