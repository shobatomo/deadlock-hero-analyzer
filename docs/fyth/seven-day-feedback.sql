-- READ ONLY. Target adxoqjgmhmortztqngcz; existing management access only.
-- If necessary use existing SET membership for fyth_feedback_owner, not new GRANT.
-- UTC today + previous 6 calendar dates. Today is partial.
WITH bounds AS (
 SELECT pg_catalog.timezone('UTC',pg_catalog.now())::date AS today
), days AS (
 SELECT bounds.today - n.day_offset AS day FROM bounds
 CROSS JOIN pg_catalog.generate_series(0,6) AS n(day_offset)
), totals AS (
 SELECT day,
  pg_catalog.sum(count) FILTER(WHERE choice='使ってみたいと思った') AS wanted,
  pg_catalog.sum(count) FILTER(WHERE choice='使ってみたいとは思わなかった') AS unwanted,
  pg_catalog.sum(count) FILTER(WHERE choice='まだ分からない') AS unsure
 FROM fyth_feedback_private.daily_counts CROSS JOIN bounds
 WHERE day BETWEEN bounds.today - 6 AND bounds.today
 GROUP BY day
)
SELECT bounds.today::text AS window_end_utc, days.day::text AS day_utc,
 COALESCE(totals.wanted,0)::text AS feedback_wanted,
 COALESCE(totals.unwanted,0)::text AS feedback_unwanted,
 COALESCE(totals.unsure,0)::text AS feedback_unsure
FROM days CROSS JOIN bounds LEFT JOIN totals ON totals.day=days.day
ORDER BY days.day;
