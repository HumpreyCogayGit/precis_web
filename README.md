# Precis Web Application

This is a React web application that displays news blog items from the Precis Scraper database.

## Requirements

- Node.js 24.x for Vercel deployment. The app should also be tested locally on newer Node releases such as Node 26 before switching production when Vercel supports them.
- PostgreSQL database with the scraper schema from `blogscraper.storage.Storage`

## Setup Instructions

1. **Install dependencies for API server:**
   ```bash
   cd precis_web
   npm install
   ```

2. **Start the API server:**
   ```bash
   cp .env.example .env
   # edit .env and set DATABASE_URL to your pooled Neon/Vercel Postgres URL
   npm start
   ```
   
   This will start the server on http://localhost:5000

3. **In a separate terminal, start the Vite React application:**
   ```bash
   cd precis_web/react-app
   npm install
   npm start
   ```

   This will start the React app on http://localhost:5173

## API Endpoints

- `GET /api/health` - Public liveness check returning only `{ "ok": true }`
- `GET /api/articles` - Get articles as `{ items, facets }`, optionally filtered/paginated with
  `?topic=...&source=...&tags=...&not_tags=...&limit=50&offset=0`
- `GET /api/articles/:site` - Get articles from specific site, with the same filters
- `GET /api/article-count` - Count articles for a candidate filter combination
- `GET /api/sites` - Get list of all available sites
- `GET /api/topics` - Get list of all available topics
- `GET /api/image-proxy?url=...` - Proxy remote article images for browser display

### Article filters

Every include list is OR within itself and AND across groups; an empty group is no constraint,
never "match nothing". All accept a single comma-separated value.

| Parameter | Meaning |
| --- | --- |
| `topic=AI,Cyber Security` | article topic, OR within |
| `site=open_ai,nvidia` | source, OR within |
| `tags=zero-day-exploit,ransomware` | tag slugs, OR within |
| `not_tags=advisory` | tag slugs to remove, always AND NOT |

Selecting more tags always widens the result — there is no intersection mode. A `tags_mode`
parameter existed briefly and is now ignored; the web app strips it from the URL on the next
write, so older links keep working and quietly lose it.

Tags travel as **slugs** — lowercase, hyphenated, derived from the display label
(`Zero-Day / Exploit` → `zero-day-exploit`). The label stays on the article record and is never
round-tripped through a URL. Exclusion is evaluated before inclusion and wins: a slug in both
`tags` and `not_tags` is dropped from `tags`.

The `facets` block carries the day's totals for all three groups as `{ slug, label, count }`,
tallied from the very items in the same response so a count and the rows behind it cannot
disagree. The web app filters and recounts that array in the browser as the user works.

Article list pagination and filters are strictly validated. `limit` must be an integer from 1 to
300, `offset` must be an integer from 0 to 10000, and `site`/`topic`/`tags`/`not_tags` values
must be 120 characters or fewer with at most 25 values each. Invalid values return
`400 Bad Request` instead of being silently ignored.

## Features

- Responsive grid layout for displaying blog articles
- Filter by source website
- Displays title, author, publish date, and article excerpt
- Clean modern UI with hover effects and proper spacing

## Notes

The local API and Vercel Serverless Functions read from `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `DATABASE_URL_UNPOOLED`, or `POSTGRES_URL_NON_POOLING`.
If neither is set, local development falls back to `postgresql://localhost:5432/Precis_Scraper`. Production fails closed with a clear configuration error when no database environment variable is set.

Production database TLS verifies server certificates by default. Use a provider connection string with `sslmode=require`, `verify-ca`, or `verify-full`. If your database provider requires a custom CA, set `PG_SSL_CA` or `POSTGRES_CA_CERT` to the PEM bundle. `PG_SSL_ALLOW_UNAUTHORIZED=true` is an explicit insecure opt-in for exceptional provider compatibility only and should not be used for normal production.

Keep real database credentials only in local ignored `.env` files and Vercel Environment Variables. Do not commit real Neon/Vercel Postgres URLs to GitHub. The public web API reads `public.public_articles`, a view that exposes only public article fields, returns a truncated `excerpt` instead of `body_text`, and excludes rows where `needs_review` is true. Use a dedicated read-only database role with access to that view only; see `sql/create-public-articles-view.sql`, `sql/create-readonly-web-role.sql`, and `sql/verify-readonly-web-role.sql`.

The current moderation model is automatic publication for scraper records with `needs_review = FALSE`; scraper-flagged records are held from the public view until reviewed or re-extracted. See `docs/content-moderation.md`. Before adding admin/write features, implement the authentication, authorization, CSRF, and audit-log readiness criteria in `docs/auth-readiness.md`.

The frontend uses Vite. Set `VITE_API_BASE_URL` only when you need the browser to call a separate API origin; leave it unset on Vercel for same-origin `/api/*` calls. The local Express API allows the Vite dev origins by default. In production, Express CORS defaults to no cross-origin browser access; set `CORS_ALLOWED_ORIGINS` to exact trusted origins only if you intentionally deploy a separate frontend origin.

For production deployment details, including how to keep the scraper local while hosting the site and database, see `DEPLOYMENT.md`.

## Security validation

Run the backend security tests from the repository root:

```bash
npm run test:backend
```

Run the frontend security tests from `react-app/`:

```bash
npm test -- --run
```

The GitHub Actions workflow at `.github/workflows/security-ci.yml` runs backend tests, frontend tests, `npm audit --omit=dev` for both package roots, the production build, and Gitleaks secret scanning. Dependabot is configured in `.github/dependabot.yml` for backend, frontend, and GitHub Actions dependency updates.

Production monitoring and abuse-alert guidance is documented in `docs/monitoring.md`.