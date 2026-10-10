# FYTH public preview candidate

Node 22 + React/Vite. Personal observations are fetched on explicit request and never persisted by this app.

Install with npm ci and npm --prefix frontend ci using the official npm registry. Run npm run build, npm test, npm start for the local artifact harness.

Server-only configuration: FYTH_REFERENCE_SOURCE=database, FYTH_DB_READ_URL (reader only), FYTH_DB_CA_CERT. v2 references are selected explicitly. Never configure writer credentials or CRON_SECRET in this app.

Git auto-deployment is disabled. GitHub code publication, project selection and any preview/production deployment require separate approval. The local routing harness is not a Vercel runtime test.
