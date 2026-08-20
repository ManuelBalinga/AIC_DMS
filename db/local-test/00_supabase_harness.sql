-- Minimal stand-in for the Supabase-managed objects the migrations reference,
-- so the schema and its RLS policies can be exercised on a plain Postgres.
--
-- What this DOES prove: the migrations apply cleanly and in order, and the
-- policies grant and deny exactly what they should.
--
-- What it does NOT prove, and cannot: that Supabase's own role grants,
-- ownership and PostgREST exposure behave the same way. `npm run verify:rls`
-- against a real project is still the authority. This catches policy logic
-- errors early and for free; it does not replace the real check.
--
-- `auth.uid()` reads a GUC here instead of a JWT, which is what lets the test
-- impersonate a user with `set request.jwt.claim.sub`.

-- Roles are cluster-wide, not per-database, so a second run would error.
do $$ begin create role anon nologin noinherit;
exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit;
exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- Supabase reads the JWT; here it reads a GUC so the harness can impersonate.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists storage.buckets (
  id              text primary key,
  name            text not null,
  public          boolean default false,
  file_size_limit bigint
);

create table if not exists storage.objects (
  id       uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name     text
);

-- Supabase grants these to the API roles by default; the harness must say so.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
