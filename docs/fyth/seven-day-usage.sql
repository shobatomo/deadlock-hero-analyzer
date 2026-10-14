-- READ ONLY. Target adxoqjgmhmortztqngcz; existing management access only.
-- If necessary use existing SET membership for fyth_usage_owner, not new GRANT.
-- UTC today + previous 6 calendar dates. Today is partial.
WITH bounds AS (
 SELECT pg_catalog.timezone('UTC',pg_catalog.now())::date AS today
), days AS (
 SELECT bounds.today - n.day_offset AS day FROM bounds
 CROSS JOIN pg_catalog.generate_series(0,6) AS n(day_offset)
), totals AS (
 SELECT day,
  pg_catalog.sum(count) FILTER(WHERE event='diagnosis_requested') AS requested,
  pg_catalog.sum(count) FILTER(WHERE event='diagnosis_ready') AS ready,
  pg_catalog.sum(count) FILTER(WHERE event='diagnosis_withheld') AS withheld,
  pg_catalog.sum(count) FILTER(WHERE event='diagnosis_error') AS errors,
  pg_catalog.sum(count) FILTER(WHERE event='diagnosis_disconnected') AS disconnected
 FROM fyth_usage_private.daily_counts CROSS JOIN bounds
 WHERE day BETWEEN bounds.today - 6 AND bounds.today
 GROUP BY day
)
SELECT bounds.today::text AS window_end_utc, days.day::text AS day_utc,
 COALESCE(totals.requested,0)::text AS diagnosis_requested,
 COALESCE(totals.ready,0)::text AS diagnosis_ready,
 COALESCE(totals.withheld,0)::text AS diagnosis_withheld,
 COALESCE(totals.errors,0)::text AS diagnosis_error,
 COALESCE(totals.disconnected,0)::text AS diagnosis_disconnected
FROM days CROSS JOIN bounds LEFT JOIN totals ON totals.day=days.day
ORDER BY days.day;
