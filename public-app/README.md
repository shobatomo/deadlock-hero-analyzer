# FYTH public preview candidate

Node 22 + React/Vite. FYTH analysis observations are fetched on explicit request and never persisted by the analysis endpoints.

Install with npm ci and npm --prefix frontend ci using the official npm registry. Run npm run build, npm test, npm start for the local artifact harness.

Analysis-only configuration: FYTH_REFERENCE_SOURCE=database, FYTH_DB_READ_URL (reader only), FYTH_DB_CA_CERT. v2 references are selected explicitly. Never configure general writer credentials or service_role keys. The optional Deadhub API below has a separate restricted database connection and Cron credential; the analysis endpoints do not use them.

Approved feedback preparation: a separate, increment-only connection may be enabled after parent-reviewed SQL and retention checks. The reference reader remains unchanged. Default FYTH_FEEDBACK_ENABLED is off; disabled mode does not inspect feedback connection values or create a pool. Server-only FYTH_FEEDBACK_DB_URL is restricted to fyth_feedback_app_login on project adxoqjgmhmortztqngcz; FYTH_FEEDBACK_DB_CA_CERT preserves TLS verification. Password creation and Production secret entry are user-operated, not automated by this task. Preview remains disconnected. No behavioural analytics or optional reasons are included.

Git auto-deployment is disabled. GitHub code publication, project selection and any preview/production deployment require separate approval. The local routing harness is not a Vercel runtime test.

User-operated metadata-only connection probe: keep FYTH_FEEDBACK_ENABLED=false and run npm run feedback:check-connection locally with the dedicated connection supplied privately. It never invokes increment/expiry or enables the API; no public probe endpoint is added. Connection success is separate from Cron, backup and Vercel runtime verification. Automatic shutdown on a failed daily retention job is not implemented: do not activate Production until retention monitoring and the stopping procedure are established.

Anonymous diagnosis usage preparation: FYTH_USAGE_ENABLED defaults off; uses only FYTH_USAGE_DB_URL / FYTH_USAGE_DB_CA_CERT for dedicated fyth_usage_app_login after usage-schema, LOGIN and expiry-job approval; never falls back to feedback credentials. Stores UTC day/fixed event/count only; does not track individuals or rendered screens. See ../docs/fyth/usage-handoff.md. No new permission or runtime collection is activated by this code change.

Deadhub record MVP candidate: `/deadhub`, `/api/deadhub/*`. Disabled unless `DEADHUB_ENABLED=true` and `VERCEL_ENV=production`. Steam OpenID owner login, separate persistent per-match records, JST calendar and daily sync. See [setup, verification and pending approvals](../docs/deadhub/handoff.md). Production schema, role activation, environment settings and deployment are NOT applied by this implementation. No Steam password or Steam Web API key is required. Sessions use random opaque secure cookies, with only token hashes stored in the private DB.

Local checks: Node 22; `npm run test:deadhub` (Docker required; disposable PostgreSQL only) and `npm run test:deadhub-browser` (Playwright path configurable with `DEADHUB_PLAYWRIGHT_MODULE`, Chromium at `/usr/bin/chromium`). Browser fixtures are synthetic. `npm start` serves `/deadhub` in the disconnected state; it is not a production login or Cron verification.
