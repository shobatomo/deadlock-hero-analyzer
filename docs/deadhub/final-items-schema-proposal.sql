-- REVIEW PROPOSAL ONLY. Do not execute before explicit database-change approval.
-- Apply before deploying code that selects/inserts final_items.
-- Existing rows remain NULL; no backfill, role/grant/policy/cron changes.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
alter table deadhub_private.matches
  add column final_items jsonb,
  add constraint matches_final_items_shape check (
    final_items is null or
    case when jsonb_typeof(final_items) = 'array' then
      jsonb_array_length(final_items) <= 32 and octet_length(final_items::text) <= 65536
    else false end
  );
comment on column deadhub_private.matches.final_items is
  'Observed final shop upgrades [{id,name,image}]. NULL means unknown; [] is explicitly empty. Names/images are catalog display data; order is not slot order.';
commit;
