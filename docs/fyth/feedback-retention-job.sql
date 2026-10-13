-- REVIEW ONLY: apply separately after parent review on adxoqjgmhmortztqngcz.
-- Does not enable extensions, change existing jobs, or store credentials.
-- Requires installed pg_cron, confirmed UTC/GMT scheduler timezone,
-- and the same approved migration administrator's SET maintenance membership.
begin;
do $$
begin
 if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') then raise exception 'pg_cron must already be installed'; end if;
 if coalesce(pg_catalog.current_setting('cron.timezone', true), 'GMT') not in ('UTC','GMT','Etc/UTC') then raise exception 'UTC scheduler required'; end if;
 if exists(select 1 from cron.job where jobname='fyth-feedback-expire-daily') then raise exception 'job already exists: review before changing'; end if;
end;
$$;
select cron.schedule('fyth-feedback-expire-daily', '0 0 * * *',
 $job$BEGIN; SET LOCAL ROLE fyth_feedback_maintenance; SELECT fyth_feedback_private.expire_counts(); COMMIT;$job$);
commit;
-- After approval, inspect this named job and its job_run_details only.
-- Adapter stays disabled until expiry and monitoring/backup conditions are verified.
