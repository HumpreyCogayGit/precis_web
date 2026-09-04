# Vercel Deployment Plan

This plan deploys only the public Precis web UI and read-only API to Vercel. The Python scraper stays local and writes into the same hosted PostgreSQL database that the Vercel API reads from.

> Runtime note: the codebase is intended to stay compatible with current Node releases, including Node 26 locally. Vercel currently supports Node `24.x`, `22.x`, and `20.x` for builds/functions, so production is pinned to Node `24.x` until Vercel adds Node 26 support.

## Target architecture

```text
Local machine
  blogscraper CLI ── BLOGSCRAPER_DATABASE_URL / write-capable role ──► Hosted PostgreSQL

Vercel
  Vite React static site ── /api/* ──► Vercel Serverless Functions ── DATABASE_URL/POSTGRES_URL / read-only role ──► Hosted PostgreSQL
```

## What changed to make this deployable

- `precis_web/api/*` exposes Vercel Serverless Functions for:
  - `GET /api/articles`
  - `GET /api/articles?topic=...&site=...&tags=...&not_tags=...&limit=50&offset=0`
  - `GET /api/articles/:site?topic=...&limit=50&offset=0`
  - `GET /api/article-count`
  - `GET /api/sites`
  - `GET /api/topics`
  - `GET /api/health`
  - `GET /api/image-proxy?url=...`
- `precis_web/lib/*` centralizes DB queries and image proxy behavior so local Express and Vercel use the same logic.
- `precis_web/react-app` uses Vite, same-origin API routes in production, and `http://localhost:5000` as the local dev default.
- `precis_web/vercel.json` builds the Vite app, copies `react-app/dist` to Vercel's root `public/` directory, rewrites `/api/*` to serverless functions, and serves React routes from `index.html`.

## Deployment steps

### 1. Create or select a hosted PostgreSQL database

Use Vercel Postgres/Neon/Supabase/Railway or another provider that allows external connections from both:

- Vercel Serverless Functions
- Your local machine running the scraper

Prefer a pooled Neon/Vercel connection string for Vercel, usually including `channel_binding=require&sslmode=require`.

### 2. Initialize the database schema

From your local repo, point the scraper at the hosted DB. `Storage` creates the schema automatically on first connection.

```bash
export BLOGSCRAPER_DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require'
python - <<'PY'
from blogscraper.storage import Storage
storage = Storage()
storage.close()
print('Schema initialized')
PY
```

Then run at least one scraper config to seed data:

```bash
python -m blogscraper run -c configs/nvidia.json
```

### 3. Create the public read model and dedicated read-only web database role

Create a separate role for Vercel before deploying publicly. Run this with an owner/admin database credential, not the web credential:

```bash
cd precis_web
psql "$ADMIN_DATABASE_URL" \
  -v web_role=precis_web_readonly \
  -v web_password="$(openssl rand -base64 32)" \
  -f sql/create-readonly-web-role.sql
```

The role script includes `sql/create-public-articles-view.sql`, which creates or replaces `public.public_articles`. That view is the only relation the public web role should be able to read. It exposes public fields, derives a 360-character excerpt from `body_text`, and excludes records where `needs_review` is true.

**Existing deployments must re-run that view script** — the filter panel's Tags group reads `public_articles.tags`, and a view created before that column was added will still be serving the old column list. `CREATE OR REPLACE VIEW` appends the column in place and keeps the existing grants, so no role changes are needed:

```bash
psql "$ADMIN_DATABASE_URL" -f sql/create-public-articles-view.sql
```

Build the Vercel `DATABASE_URL` or `POSTGRES_URL` from that `precis_web_readonly` role and password. Keep the local scraper on its separate write-capable `BLOGSCRAPER_DATABASE_URL` credential. The scraper/admin credential remains responsible for writing `articles`, reviewing held records, and rerunning failed extractions.

Validate the read-only role before using it in production:

```bash
psql "$WEB_READONLY_DATABASE_URL" -f sql/verify-readonly-web-role.sql
```

The verification script confirms reads used by `/api/articles`, `/api/sites`, and `/api/topics` through `public.public_articles`, then verifies the role cannot directly `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, or `DROP` internal tables.

### 4. Configure Vercel project

In Vercel:

1. Import the Git repository.
2. Set **Root Directory** to `precis_web`.
3. Use the repo settings from `vercel.json` or set the framework as a static Vite app.
4. Set **Node.js Version** to `24.x`. Switch this to `26.x` only after Vercel officially supports Node 26 for builds/functions.
5. Set environment variables:

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` or `POSTGRES_URL` | Vercel Production/Preview | Pooled hosted PostgreSQL connection string for API functions using the dedicated read-only web role |
| `POSTGRES_PRISMA_URL` | Vercel Production/Preview, optional | Alternative pooled Neon/Vercel URL with connection timeout |
| `DATABASE_URL_UNPOOLED` or `POSTGRES_URL_NON_POOLING` | Local/admin jobs only, optional | Direct database connection for uses that require no pooler |
| `PGSSLMODE=require` | Vercel Production/Preview, if your URL does not include `sslmode=require` | Enables verified SSL for hosted Postgres |
| `PG_SSL_CA` or `POSTGRES_CA_CERT` | Vercel Production/Preview, provider-dependent | Optional PEM CA bundle when your DB provider requires a custom CA for certificate verification |
| `PG_SSL_ALLOW_UNAUTHORIZED=false` | Avoid in production | Explicit insecure opt-in only for exceptional provider compatibility; default production behavior verifies DB certificates |
| `PG_POOL_MAX=1` | Vercel Production/Preview | Keeps serverless Postgres connection usage low unless you use a pooled DB URL |
| `VITE_API_BASE_URL` | Usually unset on Vercel | Leave blank so the browser calls same-origin `/api/*` |
| `VITE_GA_MEASUREMENT_ID` | Vercel Production, optional | GA4 measurement ID; unset falls back to the default in `react-app/src/analytics.js`. Set it to an empty string on Preview so preview builds stay out of the analytics property |
| `CORS_ALLOWED_ORIGINS` | Usually unset on Vercel | Comma-separated exact origins only when a separate frontend origin must call the Express API; same-origin Vercel `/api` calls do not need CORS |
| `IMAGE_PROXY_TIMEOUT_MS=5000` | Optional | Limits remote image fetch time |
| `IMAGE_PROXY_MAX_BYTES=5242880` | Optional | Limits proxied image size to 5 MB |
| `IMAGE_PROXY_ALLOWED_HOSTS` | Vercel Production/Preview | Required comma-separated hostname allowlist for proxied images |

The current value, generated from every distinct `image_url` host in the database, lives in [docs/image-proxy-allowlist.md](docs/image-proxy-allowlist.md) — copy it from there and regenerate after adding scraper configs. Values should match the image CDN hostnames emitted by your scraper configs: start with the exact hostnames observed in stored `image_url` values, then add only trusted parent domains when subdomains are required. Example:

```text
IMAGE_PROXY_ALLOWED_HOSTS=cdn.openai.com,substackcdn.com,blogs.nvidia.com,storage.googleapis.com
```

The image proxy intentionally rejects private-network targets, revalidates every redirect hop, blocks SVG responses, limits downloads to `IMAGE_PROXY_MAX_BYTES`, and sends `X-Content-Type-Options: nosniff` plus a restrictive image-response CSP. If `IMAGE_PROXY_ALLOWED_HOSTS` is missing in production, image proxy requests fail closed with `503`.

Database connections fail closed in production when no database URL or `POSTGRES_HOST`/`POSTGRES_USER`/`POSTGRES_DATABASE` values are configured. Local development may still use `postgresql://localhost:5432/Precis_Scraper` when no DB env vars are set. Query parameters for article APIs are rejected with `400 Bad Request` when malformed or outside documented ranges (`limit` 1-100, `offset` 0-10000, `site`/`topic` length up to 120 characters).

The local Express API permits the Vite dev origins (`http://localhost:5173`, `http://127.0.0.1:5173`) by default. In production, cross-origin browser requests are denied unless `CORS_ALLOWED_ORIGINS` explicitly lists trusted origins. Vercel serverless functions are normally same-origin and do not require CORS.

Public abuse controls are implemented in-process with the following starting limits per client IP:

- `/api/image-proxy`: 45 requests/minute
- `/api/articles`, `/api/articles/:site`, `/api/sites`, `/api/topics`: 120 requests/minute
- `/api/health`: 20 requests/minute

These limits are sufficient for local Express and provide best-effort protection for warm Vercel function instances. For high-traffic production, add Vercel Firewall/WAF or an external shared rate-limit store for globally consistent enforcement.

### 5. Deploy

```bash
cd precis_web
npm install
npm run build
npm test
```

GitHub Actions also runs these checks on pushes and pull requests through `.github/workflows/security-ci.yml`: backend security tests, frontend tests, backend/frontend `npm audit --omit=dev`, production build verification, and Gitleaks secret scanning. Dependabot updates are configured in `.github/dependabot.yml`.

Then deploy from Vercel UI or CLI. If using CLI:

```bash
cd precis_web
npx vercel
```

### 6. Keep scraper local

Use the hosted DB connection string whenever you run the scraper locally:

```bash
export BLOGSCRAPER_DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require'
python -m blogscraper run -c configs/nvidia.json -c configs/alibaba.json
```

The web deployment does not need scraper configs or local snapshots. HTML snapshots remain local under `data/snapshots/`; only article metadata/content stored in PostgreSQL is displayed on Vercel.

### 7. Configure production monitoring

Use `docs/monitoring.md` as the monitoring runbook. At minimum, configure dashboards and alerts for `/api/image-proxy` volume/upstream hosts, API 4xx/5xx rates, database latency and connection count, Vercel function duration/timeouts, bandwidth/egress, and `rate_limit_exceeded` log events.

## Verification checklist

- Visit `https://your-project.vercel.app/api/health` and confirm it returns exactly `{ "ok": true }` and does not expose Node/runtime/database details.
- Visit `https://your-project.vercel.app/api/sites` and confirm it returns a JSON array.
- Visit `https://your-project.vercel.app/api/articles?limit=10` and confirm articles are returned.
- Confirm article list responses include `excerpt` and `tags` and do not include `body_text`.
- Confirm `GET /api/articles?limit=10` returns `{ items, facets }` and that `facets.tags` entries
  carry a slug, a label and a count. An empty `facets.tags` means the view has not been recreated
  since the tag column was added — re-run `sql/create-public-articles-view.sql`.
- Visit `https://your-project.vercel.app/api/articles?tags=zero-day-exploit&limit=10` and confirm
  every returned article carries that tag. Swap it for `?not_tags=zero-day-exploit` and confirm
  none of them do. Passing the same slug in both is not an empty result: `not_tags` wins and the
  slug is dropped from `tags`, so the response is every article *without* that tag.
- Confirm `psql "$WEB_READONLY_DATABASE_URL" -f sql/verify-readonly-web-role.sql` passes, including direct `articles` table denial and `public.public_articles` access.
- Confirm records with `needs_review = TRUE` do not appear through `/api/articles`, `/api/sites`, or `/api/topics`; see `docs/content-moderation.md`.
- Confirm invalid article query parameters such as `?limit=abc`, `?offset=-1`, and excessively long `topic` values return `400 Bad Request`.
- Open the home page and verify filters, images, and article links work.
- Confirm response headers include `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, and `X-Frame-Options`.
- Confirm production starts only when a production DB URL/env tuple is present and that DB TLS certificate verification is enabled or configured with your provider CA.
- Confirm repeated requests beyond the documented limits receive `429 Too Many Requests`.
- Confirm CI security gates are required before merging deployment changes.
- Confirm dashboards and alert routes from `docs/monitoring.md` are active.
- Run the local scraper against the hosted DB and refresh Vercel after ~1 minute; new articles should appear after cache revalidation.

## Important security note

Do not commit real database credentials. Store production credentials only in Vercel Environment Variables and local shell/private `.env` files. `.env`, `.env.*`, `.vercel/`, key/certificate files, and common secret files are ignored. If any real database password has been committed previously or shared outside a trusted channel, rotate it before deploying publicly.