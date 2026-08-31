# Vercel Deployment Plan

This plan deploys only the public Precis web UI and read-only API to Vercel. The Python scraper stays local and writes into the same hosted PostgreSQL database that the Vercel API reads from.

> Runtime note: the codebase is intended to stay compatible with current Node releases, including Node 26 locally. Vercel currently supports Node `24.x`, `22.x`, and `20.x` for builds/functions, so production is pinned to Node `24.x` until Vercel adds Node 26 support.

## Target architecture

```text
Local machine
  blogscraper CLI ── BLOGSCRAPER_DATABASE_URL ──► Hosted PostgreSQL

Vercel
  Vite React static site ── /api/* ──► Vercel Serverless Functions ── DATABASE_URL/POSTGRES_URL ──► Hosted PostgreSQL
```

## What changed to make this deployable

- `precis_web/api/*` exposes Vercel Serverless Functions for:
  - `GET /api/articles`
  - `GET /api/articles?topic=...&limit=50&offset=0`
  - `GET /api/articles/:site?topic=...&limit=50&offset=0`
  - `GET /api/sites`
  - `GET /api/topics`
  - `GET /api/health`
  - `GET /api/image-proxy?url=...`
- `precis_web/lib/*` centralizes DB queries and image proxy behavior so local Express and Vercel use the same logic.
- `precis_web/react-app` uses Vite, same-origin API routes in production, and `http://localhost:5000` as the local dev default.
- `precis_web/vercel.json` builds `react-app/dist` and rewrites `/api/*` to serverless functions while serving React routes from `index.html`.

## Deployment steps

### 1. Create or select a hosted PostgreSQL database

Use Vercel Postgres/Neon/Supabase/Railway or another provider that allows external connections from both:

- Vercel Serverless Functions
- Your local machine running the scraper

Prefer a pooled connection string for Vercel, usually ending with `sslmode=require`.

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

### 3. Configure Vercel project

In Vercel:

1. Import the Git repository.
2. Set **Root Directory** to `precis_web`.
3. Use the repo settings from `vercel.json` or set the framework as a static Vite app.
4. Set **Node.js Version** to `24.x`. Switch this to `26.x` only after Vercel officially supports Node 26 for builds/functions.
5. Set environment variables:

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` or `POSTGRES_URL` | Vercel Production/Preview | Hosted PostgreSQL connection string for API functions |
| `PGSSLMODE=require` | Vercel Production/Preview, if your URL does not include `sslmode=require` | Enables SSL for hosted Postgres |
| `PG_POOL_MAX=1` | Vercel Production/Preview | Keeps serverless Postgres connection usage low unless you use a pooled DB URL |
| `VITE_API_BASE_URL` | Usually unset on Vercel | Leave blank so the browser calls same-origin `/api/*` |
| `IMAGE_PROXY_TIMEOUT_MS=5000` | Optional | Limits remote image fetch time |
| `IMAGE_PROXY_MAX_BYTES=5242880` | Optional | Limits proxied image size to 5 MB |
| `IMAGE_PROXY_ALLOWED_HOSTS` | Optional | Comma-separated hostname allowlist for proxied images |

### 4. Deploy

```bash
cd precis_web
npm install
npm run build
npm test
```

Then deploy from Vercel UI or CLI. If using CLI:

```bash
cd precis_web
npx vercel
```

### 5. Keep scraper local

Use the hosted DB connection string whenever you run the scraper locally:

```bash
export BLOGSCRAPER_DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require'
python -m blogscraper run -c configs/nvidia.json -c configs/alibaba.json
```

The web deployment does not need scraper configs or local snapshots. HTML snapshots remain local under `data/snapshots/`; only article metadata/content stored in PostgreSQL is displayed on Vercel.

## Verification checklist

- Visit `https://your-project.vercel.app/api/health` and confirm it returns `{ "ok": true, ... }`.
- Visit `https://your-project.vercel.app/api/sites` and confirm it returns a JSON array.
- Visit `https://your-project.vercel.app/api/articles?limit=10` and confirm articles are returned.
- Open the home page and verify filters, images, and article links work.
- Run the local scraper against the hosted DB and refresh Vercel after ~1 minute; new articles should appear after cache revalidation.

## Important security note

Do not commit real database credentials. Store production credentials only in Vercel environment variables and local shell/private `.env` files. If any real database password has been committed previously, rotate it before deploying publicly.