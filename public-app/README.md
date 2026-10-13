# FYTH public preview candidate

Node 22 + React/Vite. Personal observations are fetched on explicit request and never persisted by this app.

Install with npm ci and npm --prefix frontend ci using the official npm registry. Run npm run build, npm test, npm start for the local artifact harness.

Server-only configuration: FYTH_REFERENCE_SOURCE=database, FYTH_DB_READ_URL (reader only), FYTH_DB_CA_CERT. v2 references are selected explicitly. Never configure general writer credentials, service_role keys or CRON_SECRET in this app.

Approved feedback preparation: a separate, increment-only connection may be enabled after parent-reviewed SQL and retention checks. The reference reader remains unchanged. Default FYTH_FEEDBACK_ENABLED is off; disabled mode does not inspect feedback connection values or create a pool. Server-only FYTH_FEEDBACK_DB_URL is restricted to fyth_feedback_app_login on project adxoqjgmhmortztqngcz; FYTH_FEEDBACK_DB_CA_CERT preserves TLS verification. Password creation and Production secret entry are user-operated, not automated by this task. Preview remains disconnected. No behavioural analytics or optional reasons are included.

Git auto-deployment is disabled. GitHub code publication, project selection and any preview/production deployment require separate approval. The local routing harness is not a Vercel runtime test.

User-operated metadata-only connection probe: keep FYTH_FEEDBACK_ENABLED=false and run npm run feedback:check-connection locally with the dedicated connection supplied privately. It never invokes increment/expiry or enables the API; no public probe endpoint is added. Connection success is separate from Cron, backup and Vercel runtime verification. Automatic shutdown on a failed daily retention job is not implemented: do not activate Production until retention monitoring and the stopping procedure are established.
