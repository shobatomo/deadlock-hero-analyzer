# Deadhub MVP implementation handoff

Status: implementation and local verification complete; **not deployed, not yet ready for the owner's production use**. No production DB, permissions, credentials, Auth settings, or deployment have been changed. Repository and existing service names are unchanged.

## Current implementation checked

- Base: `fyth/optional-feedback` at `e6da35bc8726aece739b76b2ee3adae2c024e245`. Public app checked against `c3c426da2275862d4693ee25c391fe3817495cb0`. Work branch: `deadhub/record-mvp`.
- Reuse: `public-app` Node 22 / Express 5 / React-Vite, pg/TLS connection pattern, Steam ID normalization, hero names/assets, existing Vercel project layout. Existing analysis collection and processing are unchanged.
- Existing personal analysis data was request-only. No existing application owner registration, record table or record scheduler was available. Parent DB investigation found only reference/feedback/usage tables; Supabase standard auth tables alone did not establish an app login flow.
- Added a separate `/deadhub` screen, `api/deadhub.js`, private record/auth schema proposal and independent record provider/sync. FYTH remains available at `/` and `/result`. Existing analysis, feedback, usage, their credentials and worker schedules are untouched.

## Open and register after activation

1. After the approved production activation, open **`https://deadlock-fyth.vercel.app/deadhub`** on PC or phone. This route is not deployed yet.
2. Choose **Steamでログインする**, authenticate on Steam's official site, then return. Only the configured owner SteamID64 is allowed.
3. Choose **このアカウントを登録して過去30日を取得**. The target Steam identity comes from the verified login, never an editable client-supplied ID.
4. After synchronization, select a colored day. The page shows games, win/loss/unknown, K/D/A and damage. Reloading resolves the session and reads the database. **最新の記録を取得** performs a manual update.

Until activation, `npm ci`, `npm --prefix frontend ci`, `npm run build`, `npm start` in `public-app` serves **http://127.0.0.1:3031/deadhub** with an honest disconnected message. It deliberately does not provide a fake authenticated user or production DB fallback.

## Data and acquisition

Source checked on 2026-10-15:

- [Live OpenAPI](https://api.deadlock-api.com/openapi.json)
- [Bulk metadata source, pinned faf6870](https://github.com/deadlock-api/deadlock-api/blob/faf6870f687a7cbd4e552779aec4bea42e66a6b6/api/src/routes/v1/matches/bulk_metadata.rs)
- [Provider enum mapping](https://github.com/deadlock-api/deadlock-api/blob/faf6870f687a7cbd4e552779aec4bea42e66a6b6/tools/ingest-worker/src/models/enums.rs)

Only `GET /v1/matches/metadata` with `account_ids`, `only_filtered_players=true`, `match_mode=ranked,unranked`, `include_info`, `include_player_kda`, `include_player_final_stats`, explicit Unix time bounds, descending match ID and limit 30. No game-mode filter, no skill/rank threshold, no minimum duration/hero eligibility filter. Training/private/bot modes are outside this MVP and this is stated as ranked/normal matches in the UI.

We do **not** call `/players/{account}/match-history`: current source may contact Steam even with `force_refetch=false` for bot friends. We do **not** send `match_ids`: current bulk source can enqueue unknown matches. No Steam fallback or new parsing jobs are triggered. Only provider-stored metadata is available here; matches with no stored metadata are invisible, so full personal history completeness cannot be asserted. A visible row with sparse fields is preserved and those fields remain null.

| Stored record | Source / semantics |
| --- | --- |
| owner ID | Stable internal UUID derived from the verified Steam account; server supplied |
| match ID | `match_id`, unique with owner ID |
| started_at | `start_time`, explicit UTC `timestamptz`; provider's UTC DateTime string is normalized |
| hero | Matching player's `hero_id`, nullable |
| win/loss | Player `team` versus `winning_team` only for `match_outcome=TeamWin`; otherwise null |
| K/D/A | Matching player's `kills`, `deaths`, `assists`, nullable |
| damage | `final_stats.player_damage`, **対プレイヤーの最終スナップショット**; not overall/creep damage or snapshot maximum |
| duration | `duration_s`, nullable |
| fetched_at / updated_at | Database timestamps for first acquisition / most recent update |

Provider `final_stats` is the last available sample, not a guarantee that a complete end-of-game snapshot exists. Zero and missing are distinct. A later null does not erase an already-observed numeric value. Daily totals are computed from saved match rows, with known/total counts for partial sums. A match belongs once to its **JST start date**, even across midnight. Calendar color indicates presence only, including losses.

## Synchronization and scheduling

- Initial window: the 30 days preceding persistent registration; no full-history crawl.
- Subsequent window starts at the previous completed upper bound minus **7 days**, never before the initial lower bound. Stopping several days does not skip the gap. Seven days is a conservative MVP overlap, not a provider delay SLA; the measured volume is small (18 games / 30 days). Data arriving more than seven days late may remain absent.
- At most 3 sequential pages of 30 per invocation, 12-second per-request timeout, 2 MB response cap, 45-second acquisition budget plus bounded DB commits, 2.1-second inter-page spacing. Provider limit observed in OpenAPI: 30 bulk requests/min/IP. No automatic retries. Provider retry delays are persisted, with a minimum 60-second cooldown.
- Each page and its descending ID cursor commit together. A stopped or capped scan resumes its fixed window/cursor before a fresh overlap scan. Partial progress never advances completed coverage. The UI says when work remains.
- DB row locking acquires a 90-second lease with a unique fencing token. Concurrent manual/Cron executions and stale workers cannot duplicate or overwrite the next execution. The cooldown survives process restarts.
- `public-app/vercel.json` adds only **`/api/deadhub/cron` → `0 21 * * *` UTC**, independent of the existing reference worker and the two DB retention jobs. The endpoint requires a separate Cron bearer token and runs the configured registered owner. There are no browser-driven scheduled writes.
- Requested nominal time: 06:00 JST. With [Vercel Hobby Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), expected delivery is **06:00–06:59 JST**, not a minute-level guarantee. Existing plan is not independently verified. The current implementation has **no verified production scheduled invocation**. A successful local HTTP call is not Cron verification.

## Steam login and permissions

[Steam's documented OpenID provider](https://steamcommunity.com/dev) and [OpenID 2.0 verification requirements](https://openid.net/specs/openid-authentication-2_0.html) were checked. No Steam Web API key, Steam password, independent application password or Supabase Auth configuration is needed.

- Fixed HTTPS origin/realm/return URL and the Steam claimed-ID namespace/endpoint. No Host-header redirects, arbitrary discovery URLs or client account selection.
- Random 256-bit state bound to an HttpOnly Secure SameSite=Lax `__Host-` cookie with a 10-minute browser lifetime. Starting login performs no database writes and consumes no shared pending-login capacity. After Steam verification, state and nonce hashes are accepted atomically with independent uniqueness constraints and a 20-minute replay retention window. Neither raw value is stored.
- Required signed fields, identical identity/claimed ID, exact return URL, namespace, duplicate-param rejection and fresh response nonce. Assertion verified server-to-server using Steam `check_authentication`; invalid responses never create sessions. Nonce hashes are unique across app instances.
- Random 256-bit opaque session cookie, HttpOnly / Secure / SameSite=Lax / Path=/, expires in seven days. Only the token hash is stored; logout revokes it. No signing secret is required. Re-login atomically replaces the same owner's previous token before checking the ten-session cap. A rejected/replayed assertion cannot revoke an existing session.
- The server verifies the allowlisted Steam identity on each read/write, then supplies the internal owner to a transaction-local DB context. Record RLS enforces owner separation. Steam registration cannot be changed or deleted through any app endpoint.
- Browser POSTs require same-origin JSON. No CORS access. Responses use no-store/no-referrer. No raw provider responses, request bodies, driver errors or credentials are logged by this code.
- `deadhub_app_login` is separate from all FYTH roles, NOLOGIN in the draft, no bypass RLS, no schema creation, deletion/truncation, broad memberships or direct session-table access. Auth functions use a fixed empty search path. PUBLIC plus existing `anon`, `authenticated` and `service_role` receive explicit schema/table/function revokes; only the private application role can execute these functions. No `service_role` connection.

## Local evidence, separated by scope

### Synthetic fixtures

`npm run test:deadhub`: ten test groups on disposable PostgreSQL 17.11. Covers JST midnight/month/year/leap boundaries; true zero/null/partial sums; provider account/range/ordering validation; bounded pagination and 429; registration uniqueness; RLS and forbidden deletion/session access; upsert and delayed field completion; separate owners using the same match ID; persisted restart reads; parallel lease acquisition, cooldown, stale worker fencing, cursor recovery, stopped-day catchup; partial failure retention; Steam callback verification/replay/identity/return URL/signed-field/nonce/CSRF/authorization; Cron versus browser credentials; disabled runtime and credential separation. Security regressions also cover 120 unauthenticated login starts without DB allocation, separate state/nonce replay rejection, session rotation at the cap, concurrent exchange, other-owner protection, invalid Steam verification, and revocation under synthetic global Supabase-style default grants.

`npm run test:deadhub-browser`: synthetic-only page/API fixtures at widths **1280, 390, 320**. Month navigation, keyboard day selection, partial totals, update in progress/complete/failure, records remaining after failure and reload, no horizontal overflow, day height >=44px. Disconnected screen checked. Screenshots, when generated, are marked as dummy data and kept in `/tmp`, not published or included in git.

Node **22.23.3** production build passed. Existing `npm test` passed: **85 existing FYTH tests** across backend and frontend suites, plus public-bundle validation (125 allowed source files, 55 artifacts, 0 source maps, 0 sensitive-pattern hits). `git diff --check` passed. No changes to analysis source, reference data, analysis SQL migrations or the separate worker deployment configuration.

### Live API → disposable local DB

Allowed owner account was used on 2026-10-15. **No real Steam browser login and no production record writes** were performed. Separate production inspection was limited to read-only project/role/default-grant/event-trigger metadata.

- Completed query window: **2026-09-15 08:42:47 UTC – 2026-10-15 08:42:47 UTC** (JST 17:42:47).
- Initial result: **18 actual matches**, observed **2026-09-15 11:32:40 UTC – 2026-10-14 12:54:56 UTC** (JST Sep 15 20:32:40 – Oct 14 21:54:56).
- Match ID/time, hero, win/loss, K/D/A, damage and duration were available in all 18. Acquisition/update timestamps were generated by PostgreSQL.
- The actual provider client and store saved these rows. PostgreSQL was restarted, a new connection read the same 18 records, then the normal 7-day overlap retrieved 4 rows. **Total count remained 18; duplicate increase 0.** Two API calls totalled 70,899 response bytes for this successful run.
- Raw provider history was not saved to git/logs/attachments. The local DB was disposable and removed after verification. These records are not present in production.

## Approval and owner steps still required

Exact existing targets, confirmed by read-only inspection on 2026-10-15:

- Supabase **DeadlockFYTH**, project **`adxoqjgmhmortztqngcz`**, ap-northeast-1, PostgreSQL 17.11.
- Vercel **deadlock-fyth**, project **`prj_eknZdUrfiSOL4eOdfK3OEODut17w`**, team **`team_H1BMitz1DUJuT83Bx7ofDF8X`**, source directory **`public-app`**, Node 22, Production environment. Canonical app origin: **`https://deadlock-fyth.vercel.app`**. The separate reference worker is not a deployment target.

1. Review/apply **[schema.sql](schema.sql)** once on that Supabase project. It creates `deadhub_private` with **four tables** (`accounts`, `matches`, `openid_nonces`, `sessions`), **two owner RLS policies**, indexes/constraints and **three private auth functions** (`open_session`, `resolve_session`, `close_session`). All tables have RLS; records additionally FORCE RLS. Functions are SECURITY DEFINER with an empty fixed search path and schema-qualified commands, owned by the migration executor. No FYTH objects or `auth.users` are changed.
2. Approve/activate only `deadhub_app_login` and privately provision its password/verified TLS connection. Run **[preflight.sql](preflight.sql)** with that login. Do not widen `fyth_reader`/`fyth_writer`, reuse their credentials, or expose the private schema through a public database API.
3. In the existing app project's **Production-only** environment, configure `DEADHUB_DB_URL`, optional `DEADHUB_DB_CA_CERT`, `DEADHUB_OWNER_STEAM_ID` (owner's allowed SteamID64), `DEADHUB_PUBLIC_ORIGIN` (exact HTTPS origin, no trailing slash), a >=32-character random `CRON_SECRET`, and the activation gate `DEADHUB_ENABLED`. Keep the gate disabled until ready. `VERCEL_ENV` is platform-managed and only read by the application. No Preview connection or credentials. Do not change the separate existing worker's secret or schedule. Secret values must be provisioned through an approved private channel, never migration files, git, command arguments or report output.
4. Approve deployment of the final reviewed commit to the existing app, then activate the gate. Git auto-deployment remains disabled. No GitHub push, merge or deployment was performed here; these are separate approval steps.
5. Owner performs real Steam login, registration and initial sync at `/deadhub`, reloads, and confirms personal dates/stats. This is the first production end-to-end proof; the local test does not replace it.
6. After the next 06:00–06:59 JST window, verify an actual Vercel scheduled invocation and the saved sync timestamp/outcome. Until then report scheduling **configured, unverified**. Observe a subsequent real match/late update as a separate production check.

The draft role is NOLOGIN, connection limit 3, no superuser/create-db/create-role/replication/bypass-RLS. After separately approved LOGIN activation it receives only schema USAGE, SELECT/INSERT/UPDATE on accounts/matches, and EXECUTE on the three auth functions. It receives no DELETE/TRUNCATE, schema CREATE, role memberships or direct auth-table privileges. These are proposed privileges on new objects only, not permission changes already performed.

No destructive changes, paid service changes or credential creation have been performed. Disabling `DEADHUB_ENABLED` stops both records API and scheduled acquisition without deleting existing records. Production owner login, durable re-access and actual scheduled invocation remain independent unverified checks.
