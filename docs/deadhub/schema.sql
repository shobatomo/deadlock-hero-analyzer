-- REVIEW CANDIDATE ONLY. Do not apply to production without approval.
-- Separate from all FYTH aggregate roles/schemas. No credentials or LOGIN activation.
begin;
create role deadhub_app_login nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 3;
create schema deadhub_private;
revoke all on schema deadhub_private from public;
grant usage on schema deadhub_private to deadhub_app_login;

create table deadhub_private.accounts (
  owner_id uuid primary key,
  steam_account_id bigint not null unique check (steam_account_id between 1 and 2147483647),
  created_at timestamptz not null default now(),
  initial_from timestamptz not null,
  sync_status text not null default 'never' check (sync_status in ('never','running','partial','success','error')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  retry_after timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  window_from timestamptz,
  window_until timestamptz,
  cursor_match_id bigint,
  coverage_from timestamptz,
  coverage_until timestamptz,
  check ((window_from is null) = (window_until is null)),
  check (window_from is null or window_from < window_until),
  check (coverage_from is null or coverage_from < coverage_until)
);
create table deadhub_private.matches (
  owner_id uuid not null references deadhub_private.accounts(owner_id),
  match_id bigint not null check (match_id > 0),
  started_at timestamptz not null,
  hero_id integer check (hero_id >= 0),
  won boolean,
  kills integer check (kills >= 0),
  deaths integer check (deaths >= 0),
  assists integer check (assists >= 0),
  hero_damage bigint check (hero_damage >= 0),
  duration_s integer check (duration_s >= 0),
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, match_id)
);
create index matches_owner_started_idx on deadhub_private.matches(owner_id, started_at desc);
alter table deadhub_private.accounts enable row level security;
alter table deadhub_private.accounts force row level security;
alter table deadhub_private.matches enable row level security;
alter table deadhub_private.matches force row level security;
create policy account_owner on deadhub_private.accounts to deadhub_app_login
  using (owner_id = nullif(current_setting('deadhub.owner_id', true),'')::uuid)
  with check (owner_id = nullif(current_setting('deadhub.owner_id', true),'')::uuid);
create policy match_owner on deadhub_private.matches to deadhub_app_login
  using (owner_id = nullif(current_setting('deadhub.owner_id', true),'')::uuid)
  with check (owner_id = nullif(current_setting('deadhub.owner_id', true),'')::uuid);
grant select, insert, update on deadhub_private.accounts, deadhub_private.matches to deadhub_app_login;
-- No DELETE/TRUNCATE, schema CREATE, membership, auth schema access or FYTH access.
-- Owner context is server-set after Steam OpenID verification. This connection
-- must never be exposed to a browser. This schema is not a PostgREST API schema.

create table deadhub_private.login_states (token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null);
create table deadhub_private.openid_nonces (token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null);
create table deadhub_private.sessions (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null,
  steam_account_id bigint not null check(steam_account_id between 1 and 2147483647),
  expires_at timestamptz not null
);
create index sessions_expiry_idx on deadhub_private.sessions(expires_at);
alter table deadhub_private.login_states enable row level security;
alter table deadhub_private.openid_nonces enable row level security;
alter table deadhub_private.sessions enable row level security;
-- No direct table grants. These narrowly scoped definer functions are callable
-- only by the private server login. Raw session/state tokens never enter the DB.
create function deadhub_private.begin_login(p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(190846239,1);
  delete from deadhub_private.login_states where expires_at<=now();
  if (select count(*) from deadhub_private.login_states)>=100 then return false; end if;
  insert into deadhub_private.login_states values(p_hash,now()+interval '10 minutes');
  return true;
end; $$;
create function deadhub_private.consume_login(p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  delete from deadhub_private.login_states where token_hash=p_hash and expires_at>now();
  return found;
end; $$;
create function deadhub_private.open_session(p_hash text,p_owner uuid,p_account bigint,p_nonce text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(190846239,2);
  delete from deadhub_private.openid_nonces where expires_at<=now();
  delete from deadhub_private.sessions where expires_at<=now();
  insert into deadhub_private.openid_nonces values(p_nonce,now()+interval '20 minutes') on conflict do nothing;
  if not found then return false; end if;
  if (select count(*) from deadhub_private.sessions where owner_id=p_owner)>=10 then return false; end if;
  insert into deadhub_private.sessions values(p_hash,p_owner,p_account,now()+interval '7 days');
  return true;
end; $$;
create function deadhub_private.resolve_session(p_hash text)
returns table(owner_id uuid,steam_account_id bigint) language sql security definer set search_path='' as $$
  select owner_id,steam_account_id from deadhub_private.sessions where token_hash=p_hash and expires_at>now();
$$;
create function deadhub_private.close_session(p_hash text) returns void language sql security definer set search_path='' as $$
  delete from deadhub_private.sessions where token_hash=p_hash;
$$;
revoke all on function deadhub_private.begin_login(text),deadhub_private.consume_login(text),
  deadhub_private.open_session(text,uuid,bigint,text),deadhub_private.resolve_session(text),deadhub_private.close_session(text) from public;
grant execute on function deadhub_private.begin_login(text),deadhub_private.consume_login(text),
  deadhub_private.open_session(text,uuid,bigint,text),deadhub_private.resolve_session(text),deadhub_private.close_session(text) to deadhub_app_login;
commit;
