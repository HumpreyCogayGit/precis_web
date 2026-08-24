# Vercel Deployment Plan

This plan deploys only the public Precis web UI and read-only API to Vercel. The Python scraper stays local and writes into the same hosted PostgreSQL database that the Vercel API reads from.

## Target architecture

```text
Local machine
  blogscraper CLI ── BLOGSCRAPER_DATABASE_URL ──► Hosted PostgreSQL

Vercel
  React static site ── /api/* ──► Vercel Serverless Functions ── DATABASE_URL/POSTGRES_URL ──► Hosted PostgreSQL
```

## What changed to make this deployable

- `precis_web/api/*` exposes Vercel Serverless Functions for:
  - `GET /api/articles`
  - `GET /api/articles/:site`
  - `GET /api/sites`
  - `GET /api/topics`
  - `GET /api/image-proxy?url=...`
- `precis_web/lib/*` centralizes DB queries and image proxy behavior so local Express and Vercel use the same logic.
- `precis_web/react-app/src/App.js` now uses same-origin API routes in production and keeps `http://localhost:5000` as the local dev default.
- `precis_web/vercel.json` builds `react-app` and rewrites `/api/*` to serverless functions while serving React routes from `index.html`.

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
3. Keep the detected framework as static/Create React App or use the repo settings from `vercel.json`.
4. Set environment variables:

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` or `POSTGRES_URL` | Vercel Production/Preview | Hosted PostgreSQL connection string for API functions |
| `PGSSLMODE=require` | Vercel Production/Preview, if your URL does not include `sslmode=require` | Enables SSL for hosted Postgres |
| `REACT_APP_API_BASE_URL` | Usually unset on Vercel | Leave blank so the browser calls same-origin `/api/*` |

### 4. Deploy

```bash
cd precis_web
npm install
npm run build
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

- Visit `https://your-project.vercel.app/api/sites` and confirm it returns a JSON array.
- Visit `https://your-project.vercel.app/api/articles` and confirm articles are returned.
- Open the home page and verify filters, images, and article links work.
- Run the local scraper against the hosted DB and refresh Vercel after ~1 minute; new articles should appear after cache revalidation.

## Important security note

Do not commit real database credentials. Store production credentials only in Vercel environment variables and local shell/private `.env` files. If any real database password has been committed previously, rotate it before deploying publicly.