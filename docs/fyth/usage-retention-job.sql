-- Separate parent-reviewed step only after schema/roles and scheduler exist.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_cron') THEN RAISE EXCEPTION 'pg_cron must already be installed'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='fyth-usage-expire-daily') THEN RAISE EXCEPTION 'usage job already exists: inspect before applying'; END IF;
END $$;
SELECT cron.schedule('fyth-usage-expire-daily','5 0 * * *',
 'BEGIN; SET LOCAL ROLE fyth_usage_maintenance; SET LOCAL statement_timeout = ''5s''; SET LOCAL lock_timeout = ''500ms''; SELECT fyth_usage_private.expire_counts(); COMMIT;');
COMMIT;
