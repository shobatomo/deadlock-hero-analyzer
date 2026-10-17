-- REVIEW PROPOSAL ONLY. Apply separately after explicit production approval.
-- Coordination metadata only; no player identity or match data.
begin;
create table deadhub_private.sync_gate (
  singleton boolean primary key default true check(singleton),
  lease_token uuid,
  lease_until timestamptz,
  retry_after timestamptz not null default '-infinity',
  check ((lease_token is null) = (lease_until is null))
);
insert into deadhub_private.sync_gate(singleton) values(true);
alter table deadhub_private.sync_gate enable row level security;
alter table deadhub_private.sync_gate force row level security;
revoke all on deadhub_private.sync_gate from public;
do $$ declare excluded_role text; begin
  for excluded_role in select rolname from pg_roles where rolname in ('anon','authenticated','service_role') loop
    execute format('revoke all on deadhub_private.sync_gate from %I',excluded_role);
  end loop;
end; $$;
create policy sync_gate_server on deadhub_private.sync_gate to deadhub_app_login
  using(singleton) with check(singleton);
-- Remove direct default grants too. Inherited role privileges require a separate
-- production metadata review; revoking this role's ACL cannot remove inheritance.
revoke all on deadhub_private.sync_gate from deadhub_app_login;
grant select,update on deadhub_private.sync_gate to deadhub_app_login;
-- No INSERT/DELETE/TRUNCATE, new function/role/credential, or session rights.
commit;
