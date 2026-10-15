# Deadhub pre-release security review — 2026-10-15

An independent security-review agent inspected implementation commit `0b7d598641823d78ef3806a86a5ee2008d503a52`, then independently re-reviewed the local security fixes before the follow-up commit. The reviewer did not edit application files, access secrets, modify production, or push. Disposable review databases were removed.

## Findings and resolution

| Finding | Initial evidence | Resolution |
| --- | --- | --- |
| Medium: unauthenticated login starts could exhaust a shared 100-request pending-state cap | 100 starts succeeded; request 101 failed for approximately ten minutes | Login start now issues only a random host-only cookie and fixed Steam redirect; it performs no DB operations. Only Steam-verified nonce/state hashes enter the DB. Independent recheck: 150 successful starts, 150 unique states, zero DB calls. |
| Low: re-login could not rotate an existing session at the ten-session cap | New session creation preceded old-session revocation | Verify replay uniqueness, remove only the same owner's previous token, enforce cap and insert replacement in one transaction. Independent simultaneous exchange at the cap: one success, total ten sessions. |
| Defense in depth: direct Supabase role grants could survive a PUBLIC-only revoke | Synthetic global default grants left direct function EXECUTE; actual project had no global default grants and private schema USAGE was denied | Explicitly revoke schema/table/function privileges from existing anon/authenticated/service_role. Under synthetic global grants all three layers were independently confirmed denied. |

The independent re-review found no new release-blocking issue in the inspected scope. It also confirmed that replayed nonce/state cannot revoke a valid session, and a failed replacement insert rolls back both previous-session removal and replay-state storage.

## Boundaries checked

- Steam verification endpoint and claimed-ID namespace are fixed; no arbitrary discovery/verification requests.
- Exact signed return URL, required signed fields, matching claimed ID/identity, fresh nonce, duplicate-parameter rejection, cookie/state equality and owner allowlist.
- High-entropy opaque session, only hashes in storage, Secure/HttpOnly/SameSite cookie, revocation and server-side owner validation on every protected request.
- Same-origin browser writes, Cron bearer authentication separate from cookies, no public registration/mutation endpoint.
- Parameterized SQL, transaction-local owner context, RLS, restricted dedicated DB login, non-exposed private schema, no direct auth-table access.
- Explicit fail-closed runtime gate; no fallback to existing FYTH writer credentials.

State cookies have a ten-minute browser lifetime. Verified nonce/state hashes are unique across app instances and retained for twenty minutes. Session expiry is seven days. Session/nonce cleanup happens inside verified login; no additional retention job is introduced.

The committed regression suite covers these fixes with synthetic data in PostgreSQL 17.11. This is an implementation review, not proof of deployed production ACLs, an owner's real Steam login, or Vercel scheduled execution. Those remain separate post-approval checks. No general bot/rate-limiting service is claimed; eliminating shared unauthenticated state prevents the reproduced application-level lockout.

Reference: [Supabase database function privileges](https://supabase.com/docs/guides/database/functions), [Steam authentication documentation](https://partner.steamgames.com/doc/features/auth).
