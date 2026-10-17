# Deadhub invitation trial — local review

Base: `deadhub/record-mvp` at `ca4af2a4efb75532220c3493a63449d1c185b4d6`.
Scope: the existing owner plus one invited friend, private individual records,
friend-initiated updates only. No palette change or public player directory.

## Proposed behavior

- Optional server setting `DEADHUB_INVITED_STEAM_IDS` accepts a comma-separated
  list of canonical 17-digit public Steam IDs. The existing owner is always
  included. The list is deduplicated and limited to **two distinct accounts total**
  (owner plus one friend), at most four raw entries / 71 characters.
- Only an absent setting (`undefined`) keeps the current owner-only behavior.
  Empty values/elements, whitespace, URLs, account-number shortcuts, invalid
  ranges, and a second distinct friend fail closed before constructing the DB
  pool. Diagnostics contain only `DEADHUB_INIT_INVITATIONS`, never the values.
- No actual invited or owner Steam ID has been added to source, fixtures,
  documentation, or the public bundle. All tests use generated synthetic IDs.
- Existing Steam OpenID validation and server sessions remain authoritative.
  Each request checks the configured allowlist and deterministic owner mapping.
  Registration, profile, records, and sync use only that verified identity.
  Query/body IDs cannot select another owner; nonempty write bodies are rejected.
- Registration fixes the initial window at the previous 30 days. A failed first
  fetch preserves registration and its window; the user can retry manually.
  Existing `(owner_id, match_id)` uniqueness and forced RLS keep the same match
  separate for two players. No record/session schema or auth function changes.
- The authenticated records response derives `sync_mode` from comparison with
  the existing `cronOwner`. Only that owner sees the daily schedule. The friend
  sees manual-only guidance before and after registration. Unknown/missing mode
  never promises automatic fetching.
- The cron route still calls only `sync(cronOwner)` and its schedule remains
  `0 21 * * *` UTC (06:00–06:59 JST with the existing scheduler behavior).

## Shared metadata-request control

The new `sync_gate` is one durable private DB row with an opaque token and
timestamps, without player identity or records. Whenever the invitation setting
is **present**, all owner, friend, and cron syncs use it. An explicitly configured
owner-only list also enables coordination; an absent setting does not require the
new table and preserves the existing single-owner behavior.

An atomic conditional `UPDATE` admits one sync for 90 seconds. It uses the DB
clock and works across independent clients/instances and transaction poolers;
there is no process-local or session-level advisory lock. Contending requests
return `shared_busy` with `Retry-After` before acquiring an owner lease or calling
the provider. Missing table, row, or permission prevents provider work.

The existing three-page limit and 2.1-second page spacing remain. The 45-second
budget now starts before shared admission and is checked using a monotonic clock
and an abort signal, including immediately after delays. Normal release permits
the next sync only after another 2.1 seconds. Release matches the token, so a
stale worker cannot release a replacement lease. An abandoned lease expires.
No connection or DB transaction is held across an external API request.

A provider 429 persists the wait in the shared row, not just the user's account.
`Retry-After` supports delta-seconds and HTTP dates with a 60-second minimum and
**no 24-hour truncation**. Finite waits up to 2,147,483,647 whole seconds (the
account SQL integer representation, about 68 years) are retained. Shared storage
uses bigint milliseconds, so waits beyond 24.8 days cannot overflow an int.
Other failed provider responses with Retry-After, including 503, share that wait.
The pause remains available to shared cleanup even if recording the owner's
failure throws. Successful pages and cursors retain existing atomicity.

Out-of-range numeric/date waits and numeric overflow persist PostgreSQL
`infinity`: an indefinite stop requiring administrator review, never a shorter
automatic retry. The same protection applies to the owner-only store even when
the shared gate is disabled. Infinity is not exposed as an invalid JSON date;
the affected account returns `sync_paused: true`, its update button stays disabled,
and the API returns `provider_paused`/503 without a misleading Retry-After header.
The other user's account remains untouched: their button can still submit, but
the shared gate rejects each attempt with that same safe error before calling
the provider. The records endpoint does not read the global gate for UI state.
Malformed ordinary headers retain the existing 60-second fallback; oversized
unparseable headers also stop conservatively. No automatic unpause is provided.

The implementation relies on the existing **65-second Vercel function limit**
being shorter than the 90-second shared lease. This controls only Deadhub bulk
metadata calls using this same gate. Old deployments, other apps sharing an IP,
public item assets, and Steam verification/profile endpoints are outside it.
If runtime duration or sync budget changes, review the lease before deploying.

**Failure limitation:** if the DB write that stores a 429 pause itself fails,
the surviving lease blocks work only until its expiry; the full provider pause
cannot then be guaranteed. The request reports a safe failure. An absolute
fail-closed guarantee during that outage would require a more conservative
persisted hold/recovery design, potentially stopping updates indefinitely after
a crash. This proposal does not claim that stronger guarantee.

**Cron contention:** if the friend's update overlaps the scheduled owner run,
the cron reports `skipped/shared_busy`. There is no same-day automatic retry
queue; the owner can retry manually or wait for the next scheduled invocation.
The cron target, schedule, and credentials are unchanged.

## Separate production approvals required

Nothing in this list was applied to production:

1. Apply the reviewed [invitation-sync-gate.sql](invitation-sync-gate.sql) to the
   existing private Deadhub schema. It creates **one table and one RLS policy**,
   inserts its single coordination row, enables and forces RLS, and grants only
   **SELECT/UPDATE on that table to `deadhub_app_login`**. It revokes PUBLIC and
   existing `anon`, `authenticated`, `service_role` grants. It also revokes ALL
   **direct** grants on this new table from `deadhub_app_login` before granting
   SELECT/UPDATE, removing extra default INSERT/DELETE privileges. **Inherited
   role privileges are not removed by that REVOKE**: before production approval,
   inspect role membership, effective table privileges, table ownership and
   superuser/BYPASSRLS flags through metadata. This local review cannot certify
   the production role graph. No new functions,
   roles, login grants, credentials, schema exposure, or existing-table changes.
2. Approve the final code publication/deployment and a **Production-only**
   `DEADHUB_INVITED_STEAM_IDS` setting. Its actual value should be the friend's
   Steam ID supplied in the conversation. Keep the current owner setting and all
   existing DB/auth/Cron settings unchanged. Do not use a frontend `VITE_` value.
3. Coordinate rollout so no uncoordinated old instance is still syncing. A safe
   staged sequence is: apply DDL, deploy this code with an explicit owner-only
   invitation value, drain old requests (at least 90 seconds), then deploy the
   friend value. Avoid the cron window and manual updates during the transition.
   Verify only the current production deployment receives traffic/cron. Draining
   leases for 90 seconds does not clear provider waits: preserve any longer or
   infinite pause, including one observed before this deployment.
4. The friend then logs in through Steam themselves, registers themselves, and
   checks initial acquisition and manual refresh. The owner verifies the next
   actual scheduled run. These are future production acceptance checks.

To revoke the friend, deploy an explicit owner-only invitation value so shared
coordination stays enabled. Existing sessions are rejected by each new runtime's
allowlist without deleting saved records. Old runtimes keep their configuration
snapshot; revocation is **not instantaneous across old deployments**. Drain them
as above. Returning to an absent setting bypasses the shared gate and therefore
requires ensuring no invited/old coordinated sync remains active first. It must
also preserve outstanding shared provider pauses; a 90-second drain is not a
substitute for waiting out Retry-After. For an infinite stop, investigate the
provider instruction and separately approve a recovery plan for both the shared
row and affected account retry_after values. Do not clear them merely to retry
or as an incidental part of rollout/rollback. No recovery SQL was executed.

## Local verification

Node 22.22.1, locked existing packages, no dependency or lockfile changes.

```sh
node --experimental-test-module-mocks --import ./tests/deadhub-review-register.mjs \
  --test --test-reporter=spec tests/deadhub-*.test.mjs \
  public-app/scripts/test-feedback-store.mjs \
  public-app/scripts/test-windows-usage-probe.mjs
```

Final result: the previous **135** tests plus **20** added tests = **155 passed,
0 failed, 0 skipped**.
The additions cover strict configuration, two users and an uninvited user,
forged owners, revoked/expired sessions, cron targeting, shared contention,
deadline checks, 429 formats, long/out-of-range waits, safe indefinite-stop
responses and UI, first failure/retry, and schedule guidance.

```sh
node --import ./tests/deadhub-review-register.mjs \
  tests/deadhub-invitations-postgres.mjs <postgres-bin-directory> <temporary-root>
node tests/deadhub-invitations-browser.mjs <playwright-module> <chromium> <output>
```

The additional **14 PostgreSQL integration groups all passed**, with no failures
or skips. They create a fresh cluster on
127.0.0.1 in a new temp folder and stop it afterward. They never read an existing
DB URL or data folder. PostgreSQL **16.0** was available locally; production's
PostgreSQL 17 was not tested. Actual concurrent DB clients verified single
admission, spacing, abandoned/stale leases, shared numeric/date 429 cooldown,
real RLS and same-match separation, initial failure recovery, session expiry,
missing gate failure, removal of default direct INSERT/DELETE grants, retained
2-day/30-day/max-int waits, infinite stops in both shared and owner-only modes,
and a 503 provider wait. API responses and accounts are synthetic.

Browser checks cover **1280 / 390 / 320px × owner/friend**: invitation guidance,
registration failure then manual retry, correct daily/manual copy, removed
session, indefinite-stop display/disabled refresh, zero horizontal overflow,
zero page exceptions, and zero external
requests. Representative desktop, narrow mobile, and initial-failure screenshots
were inspected, along with the stopped-account UI at 320px and 1280px. No
CSS/color change was made. The production frontend build and
public-manifest/bundle verification are also part of the handoff evidence.
The build passed; bundle verification passed with 138 source files, 55 artifacts,
zero source maps, zero sensitive-pattern hits, and zero external calls. The
existing Deadhub browser suite also passed at all three widths (month/keyboard
navigation, partial totals, update/error preservation, reload, disabled gate).
Only module/executable/output paths were adapted in a temporary runner.

The old Docker-based `tests/deadhub.test.mjs` suite is not run here (Docker is
unavailable). The separate real-PostgreSQL runner above covers the new DB design;
it is not a claim that the old Docker suite or production environment was tested.
Real Steam login, real player history, physical phones, and Safari remain untested.

## Independent review

A separate reviewer completed source/diff review and independently passed **31
focused tests** plus **14 real PostgreSQL groups** after the final hardening.
An additional independent PostgreSQL test confirmed that three friend updates
during an infinite shared stop each return 503, with zero external page calls
and unchanged friend account state (`sync_paused: false`). Both new review
clusters were confirmed stopped with `pg_ctl status`. The reviewer also
reproduced the other-user enabled-button behavior in JSDOM; this is the known
UI limitation above, not a bypass of the server gate. Earlier review inspected
320px registration and 1280px friend screenshots. No unresolved P1/P2 finding
remains. Lease/outage, inheritance, revocation, and cron-contention limits are
explicitly retained above.

Related primary documentation checked:
[PostgreSQL row locking](https://www.postgresql.org/docs/17/explicit-locking.html),
[Read Committed concurrent updates](https://www.postgresql.org/docs/17/transaction-iso.html),
[Supabase connection/pooling guidance](https://supabase.com/docs/guides/database/connecting-to-postgres),
[HTTP Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after).

The original workspace and previous modal checkout were preserved. No commit,
push, deployment, production DB/auth/permission/environment change, or secret
inspection was performed. Local DB changes occurred only in disposable test
clusters. `.agents/skills` is absent in the checked-out base; existing handoff,
README, offline loader, and Supabase/Postgres skill guidance were followed.
