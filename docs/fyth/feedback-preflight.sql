-- READ-ONLY: parent review on confirmed project adxoqjgmhmortztqngcz.
-- Never reads pg_authid, passwords, env, connection URLs, request bodies or users.
select current_user, current_database(), version();
select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
 from pg_catalog.pg_roles where rolname in ('fyth_reader','fyth_feedback_owner','fyth_feedback_submitter','fyth_feedback_maintenance','fyth_feedback_app_login');
select nspname from pg_catalog.pg_namespace where nspname='fyth_feedback_private';
select extname, extversion from pg_catalog.pg_extension where extname='pg_cron';
select pg_catalog.current_setting('cron.timezone', true) as cron_timezone;
-- Existing PUBLIC grants are inherited by every role and cannot be denied to one
-- role. If sensitive unrelated objects are public, stop for a separate review;
-- never revoke existing global grants as part of this migration.
select table_schema,table_name,privilege_type from information_schema.table_privileges
 where grantee='PUBLIC' and table_schema not in ('pg_catalog','information_schema') order by 1,2,3;
select routine_schema,routine_name,privilege_type from information_schema.routine_privileges
 where grantee='PUBLIC' and routine_schema not in ('pg_catalog','information_schema') order by 1,2;
-- Confirm normal/error/audit SQL logs do not persist per-answer bound values.
-- No changes here; any required global logging change needs separate review.
select name,setting,context from pg_catalog.pg_settings where name in (
 'log_statement','log_min_duration_statement','log_min_duration_sample',
 'log_parameter_max_length','log_parameter_max_length_on_error','pgaudit.log_parameter'
) order by name;
