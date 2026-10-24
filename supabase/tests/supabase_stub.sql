-- Minimal stand-ins for the Supabase platform so 001_init.sql can be tested on
-- plain Postgres (CI or local). Mirrors the roles, default privileges, auth
-- helpers, storage tables, vault and pg_net shapes the migration relies on.

do $$ begin
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create role authenticator login noinherit password 'authenticator';
exception when duplicate_object then null;
end $$;
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, phone text,
  raw_user_meta_data jsonb default '{}'
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt()->>'role'
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid
);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- vault + pg_net shapes; calls are recorded so tests can assert on them
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('project_url', 'http://edge.test'), ('service_role_key', 'test-key');
create schema net;
create table net.calls (id serial primary key, url text, headers jsonb, body jsonb, at timestamptz default now());
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$
  insert into net.calls (url, headers, body) values (url, headers, body) returning id
$$;
grant usage on schema net to authenticator; grant select on net.calls to authenticator;
