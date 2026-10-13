-- Generated using Supabase CLI 2.120.0 migration new. Executed in isolated tests only.
begin;
-- TARGET ONLY: Deadlock FYTH / adxoqjgmhmortztqngcz / PostgreSQL 17.11.
-- No passwords. Application LOGIN remains disabled until the user configures it.
create role fyth_feedback_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role fyth_feedback_submitter nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role fyth_feedback_maintenance nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role fyth_feedback_app_login nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 2;
grant fyth_feedback_submitter to fyth_feedback_app_login with inherit true, set false;
alter role fyth_feedback_app_login set default_transaction_isolation = 'read committed';
alter role fyth_feedback_app_login set statement_timeout = '2s';
alter role fyth_feedback_app_login set lock_timeout = '500ms';
alter role fyth_feedback_app_login set idle_in_transaction_session_timeout = '5s';
-- PostgreSQL 17 non-superuser migration administrators need SET membership to
-- transfer ownership and to run the bounded retention job. Never grant to app.
do $$
begin
 if pg_catalog.current_setting('server_version_num')::integer < 170000 then raise exception 'PostgreSQL 17 required'; end if;
 execute pg_catalog.format('GRANT fyth_feedback_owner TO %I WITH SET TRUE, INHERIT FALSE', current_user);
 execute pg_catalog.format('GRANT fyth_feedback_maintenance TO %I WITH SET TRUE, INHERIT FALSE', current_user);
end;
$$;
create schema fyth_feedback_private authorization fyth_feedback_owner;
-- Non-superuser administrator transfers the remaining DDL to this narrow owner.
set local role fyth_feedback_owner;
-- This new owner is dedicated to feedback; remove future PUBLIC function defaults.
alter default privileges for role fyth_feedback_owner revoke execute on functions from public;
revoke all on schema fyth_feedback_private from public, anon, authenticated;
create table fyth_feedback_private.daily_counts (
 day date not null,
 choice text not null check (choice in (
  '使ってみたいと思った', '使ってみたいとは思わなかった', 'まだ分からない'
 )),
 count bigint not null check (count > 0),
 primary key (day, choice)
);
alter table fyth_feedback_private.daily_counts owner to fyth_feedback_owner;
alter table fyth_feedback_private.daily_counts enable row level security;
revoke all on fyth_feedback_private.daily_counts from public, anon, authenticated,
 fyth_feedback_submitter, fyth_feedback_maintenance;

-- SECURITY DEFINER is deliberate: submitter can increment only, with no direct
-- table SELECT/INSERT/UPDATE/DELETE. Owner is NOLOGIN and owns only this schema.
-- No auth.uid(): public anonymous survey; access is a private SQL runtime role.
create function fyth_feedback_private.increment_choice(p_choice text)
returns text language plpgsql security definer set search_path = '' as $$
declare today date := pg_catalog.timezone('UTC', pg_catalog.now())::date;
begin
 -- A stale transaction snapshot must not weaken the global daily budget.
 if pg_catalog.current_setting('transaction_isolation') <> 'read committed'
 then raise exception 'read committed required'; end if;
 if p_choice is null or p_choice not in (
  '使ってみたいと思った', '使ってみたいとは思わなかった', 'まだ分からない'
 ) then raise exception 'invalid choice'; end if;
 -- Global serialization across all public-app instances, no identifier/event storage.
 -- This advisory-lock namespace must be reviewed for collision before applying.
 if not pg_catalog.pg_try_advisory_xact_lock(190846237, 1) then return 'not_stored'; end if;
 -- Approved initial daily anonymous response budget: 1000 total across choices.
 if (select coalesce(pg_catalog.sum(count), 0)
     from fyth_feedback_private.daily_counts where day = today) >= 1000
 then return 'not_stored'; end if;
 delete from fyth_feedback_private.daily_counts where day < today - 29;
 insert into fyth_feedback_private.daily_counts as totals (day, choice, count)
 values (today, p_choice, 1)
 on conflict (day, choice) do update set count = totals.count + 1;
 return 'stored';
end;
$$;
alter function fyth_feedback_private.increment_choice(text) owner to fyth_feedback_owner;
revoke all on function fyth_feedback_private.increment_choice(text)
 from public, anon, authenticated, fyth_feedback_maintenance;
grant usage on schema fyth_feedback_private to fyth_feedback_submitter;
grant execute on function fyth_feedback_private.increment_choice(text) to fyth_feedback_submitter;

create function fyth_feedback_private.expire_counts()
returns void language sql security definer set search_path = '' as $$
 delete from fyth_feedback_private.daily_counts
 where day < pg_catalog.timezone('UTC', pg_catalog.now())::date - 29;
$$;
alter function fyth_feedback_private.expire_counts() owner to fyth_feedback_owner;
revoke all on function fyth_feedback_private.expire_counts()
 from public, anon, authenticated, fyth_feedback_submitter;
grant usage on schema fyth_feedback_private to fyth_feedback_maintenance;
grant execute on function fyth_feedback_private.expire_counts() to fyth_feedback_maintenance;
-- No passwords, enabling LOGIN, service_role grants, scheduler creation,
-- or grants to the existing public-app reader. Review Cron SQL separately.
commit;
