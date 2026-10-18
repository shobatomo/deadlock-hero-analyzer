-- REVIEW PROPOSAL ONLY: not applied to any existing or production database.
-- Apply with the matches table owner (or an authorized migration role).
-- Apply before deploying code that selects/inserts player_healing.
-- One nullable column, no default/backfill, grants, policies, roles or cron changes.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
alter table deadhub_private.matches
  add column player_healing bigint
    constraint matches_player_healing_nonnegative check (player_healing >= 0);
comment on column deadhub_private.matches.player_healing is
  'API final_stats.player_healing as provided. NULL means unavailable; 0 is observed zero. No sum with self_healing/teammate_healing. Final snapshot may precede match end; healing scope is not asserted.';
commit;
