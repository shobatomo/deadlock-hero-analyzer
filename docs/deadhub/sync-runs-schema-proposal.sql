-- REVIEW PROPOSAL ONLY. Not applied to an existing database.
-- Requires the existing private schema / server login; changes only this new table.
begin;
create table deadhub_private.sync_runs (
  run_id uuid primary key,
  owner_id uuid not null,
  source text not null check(source in ('manual','registration','cron_endpoint')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  outcome text not null default 'started',
  result_code text,
  processed_count integer check(processed_count >= 0),
  constraint sync_runs_result_shape check (
    (outcome='started' and finished_at is null and result_code is null and processed_count is null)
    or (finished_at is not null and finished_at >= started_at and (
      (outcome='success' and result_code is not null and result_code='complete' and processed_count is not null)
      or (outcome='partial' and result_code is not null and result_code='page_limit' and processed_count is not null)
      or (outcome='skipped' and processed_count is null and result_code is not null and result_code in ('not_registered','busy','cooldown','shared_busy'))
      or (outcome='failed' and processed_count is null and result_code is not null and result_code in (
        'already_registered','provider_paused','shared_unavailable','rate_limited','provider_timeout',
        'provider_failed','invalid_provider','response_too_large','sync_failed','lease_lost','unexpected_result'))
    ))
  )
);
-- No account FK: a verified caller may fail before registration exists.
create index sync_runs_latest_idx on deadhub_private.sync_runs(owner_id,source,started_at desc,run_id desc);
create index sync_runs_unfinished_idx on deadhub_private.sync_runs(owner_id,source,started_at) where outcome='started';
create index sync_runs_success_idx on deadhub_private.sync_runs(owner_id,source,started_at desc,run_id desc) where outcome='success';
create index sync_runs_failed_idx on deadhub_private.sync_runs(owner_id,source,started_at desc,run_id desc) where outcome='failed';
alter table deadhub_private.sync_runs enable row level security;
alter table deadhub_private.sync_runs force row level security;
create policy sync_runs_read on deadhub_private.sync_runs for select to deadhub_app_login
  using(owner_id=nullif(current_setting('deadhub.owner_id',true),'')::uuid);
create policy sync_runs_start on deadhub_private.sync_runs for insert to deadhub_app_login
  with check(owner_id=nullif(current_setting('deadhub.owner_id',true),'')::uuid and outcome='started');
create policy sync_runs_finish on deadhub_private.sync_runs for update to deadhub_app_login
  using(owner_id=nullif(current_setting('deadhub.owner_id',true),'')::uuid and outcome='started')
  with check(owner_id=nullif(current_setting('deadhub.owner_id',true),'')::uuid and outcome<>'started');
revoke all on deadhub_private.sync_runs from public,deadhub_app_login;
-- Remove direct grants inherited from managed-project table defaults as well.
do $$ declare excluded_role text; begin
  for excluded_role in select rolname from pg_roles where rolname in ('anon','authenticated','service_role') loop
    execute format('revoke all on deadhub_private.sync_runs from %I',excluded_role);
  end loop;
end; $$;
grant select on deadhub_private.sync_runs to deadhub_app_login;
grant insert(run_id,owner_id,source) on deadhub_private.sync_runs to deadhub_app_login;
grant update(finished_at,outcome,result_code,processed_count) on deadhub_private.sync_runs to deadhub_app_login;
-- No new roles, memberships, functions, API exposure, DELETE or TRUNCATE grant.
-- No retention job or deletion. Retain until an explicit archival/deletion review.
commit;
