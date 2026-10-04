# PrecisNews Web - Agent Instructions

## Project

This repository (`precis_web`) is the public face of PrecisNews, an AI and cybersecurity news
aggregator: a read-only JSON API plus a React single-page app, deployed to Vercel.

It does not scrape, tag, summarize or score anything. That happens in the pipeline repository
that this one is cloned into (`../scraper`, `../scoring`, `../infra`, `../Admin`; see
`../AGENTS.md`). The two share only the hosted PostgreSQL database (Supabase): the pipeline
publishes rows, this app reads them.

## Stack

| Layer | What |
|---|---|
| API | Node 24, CommonJS, Express 5 (`server.js`, local only) and Vercel Serverless Functions (`api/*.js`, production). Shared logic in `lib/`. `pg` for PostgreSQL. |
| Frontend | `react-app/`: React 19, React Router 7, Vite 7, plain JavaScript/JSX, plain CSS (`src/App.css`, `src/index.css`). Tests with Vitest + Testing Library (jsdom). |
| Hosting | Vercel (`vercel.json`: builds, routes, security headers). `npm run build` runs `scripts/build.sh`, which builds `react-app/` into `public/`. |
| Database objects | `sql/`: public view, search function, read-only role, grants, dated migrations. |
| CI | `.github/workflows/security-ci.yml`: backend tests, frontend tests, `npm audit --omit=dev` for both package roots, production build, Gitleaks. |

There is no TypeScript, no ESLint/Prettier config and no CSS framework. Do not introduce them as
a side effect of another task.

## Layout

```
server.js            local Express API (port 5000)
api/                 one Vercel function per route; api/articles/[site].js for /api/articles/:site
lib/                 articles, trending, topicTrends, tldr, imageProxy, db, http, cors,
                     rateLimit, securityHeaders, svgRaster
react-app/src/       main.jsx (router), App.jsx (home), pages/, components/, filters.js,
                     trendFilters.js, analytics.js, *.test.jsx beside the code
sql/                 hosted-database SQL, applied by hand
tests/               backend tests (node --test)
docs/                moderation, auth readiness, monitoring, image proxy allowlist
SECURITY_AUDIT_PLAN.md  audit findings and remediation checklist (some items still open)
maintenance/         static page shipped when MAINTENANCE_MODE=1
design_handoff_*/    design references, not shipped code
```

Routes: `/` (App), `/trending`, `/tldr`, `/threats`, `/privacy`, `/terms`. Every route except `/`
is lazy-loaded in `main.jsx`; keep new pages lazy.

API: `/api/health`, `/api/articles`, `/api/articles/:site`, `/api/article-count`, `/api/search`,
`/api/sites`, `/api/topics`, `/api/trending`, `/api/topic-trends`, `/api/tldr`, `/api/image-proxy`.
All are `GET`.

## Before Making Changes

- Inspect the existing implementation before changing it.
- Follow the existing architecture and patterns.
- Do not rewrite working components unnecessarily.
- Prefer small, focused changes.
- Do not introduce dependencies unless they are actually needed.
- There are two package roots. Check `package.json` (API) or `react-app/package.json` (frontend)
  before adding a library, and add it to the right one.

## Code Changes

- Preserve existing behavior unless the task explicitly requires a behavior change.
- Prefer simple, maintainable code over clever abstractions.
- Reuse existing utilities/components where possible.
- Keep functions focused.
- Avoid duplicated logic.
- Do not silently change APIs or data contracts.
- Comments in this codebase explain why a decision was made. Keep that habit; do not strip them.

## API Rules

- **Every route exists twice.** Add or change it in `server.js` and in `api/<name>.js`, with the
  logic in `lib/` so both call the same function. `vercel.json` maps `/api/(.*)` to
  `/api/$1.js`; a route with a path parameter needs its own entry there. Keep the parameters the
  two entry points pass in sync.
- **Handler shape** (`api/*.js`): `allowMethods` -> `checkRateLimit(RATE_LIMITS.x)` ->
  `setDataCacheHeaders` -> respond (`sendTimedJson` for a `Server-Timing` header) ->
  `sendError` in the catch.
- **Read-only, public relations only.** Article data comes through `public.public_articles`,
  never the `articles` table: the view withholds `body_text` (it returns an excerpt),
  `needs_review` rows, `hidden_sites` sources and `article_exclusions` matches. Other reads are
  `tag_topics`, `tldr_digests`, `trend_leaderboard`, `entity_candidates*` and the
  `search_articles` function. The app connects with a read-only role; no endpoint writes.
- **Validate input and parameterize SQL.** Never interpolate request values into SQL text. Invalid
  parameters throw an error with `statusCode = 400` and return `400`, they are not silently
  ignored. Existing bounds: `limit` 1-300, `offset` 0-10000, filter values up to 120 characters
  and 25 per group.
- **Caching.** Database-backed responses are CDN-cached for hours under the `precis-data` tag
  (`lib/http.js`), and refreshed after a publish with `npm run cache:refresh`. Errors and
  `/api/health` are `no-store`. A new data endpoint should call `setDataCacheHeaders`; anything
  per-user or time-sensitive must not.
- **Security headers.** The CSP in `lib/securityHeaders.js` must stay byte-identical to the one
  in `vercel.json`. `script-src` has no `'unsafe-inline'`; do not add inline scripts.
- **Image proxy.** Hosts must be in `IMAGE_PROXY_ALLOWED_HOSTS` in production. When a new source
  needs one, record it in `docs/image-proxy-allowlist.md`. Do not loosen the private-address,
  redirect, size or timeout checks in `lib/imageProxy.js`.
- **Database connection.** `lib/db.js` verifies TLS and fails closed in production when no
  database variable is set; do not add a production fallback. On Vercel the pool is one
  connection, so do not rely on running queries in parallel.
- **Schema changes** go in `sql/` as a dated file, and the view/function definitions
  (`create-public-articles-view.sql`, `create-search-articles-function.sql`) are updated to match.
  A new column must also exist in the pipeline's schema and publish step, so it usually needs a
  matching change in `../scraper`. `sql/create-readonly-web-role.sql` is git-ignored on purpose.
- Do not add authenticated, admin or write features without meeting `docs/auth-readiness.md`.

## UI

- Preserve the existing visual design unless UI redesign is explicitly requested.
- Prefer existing components and styling conventions: plain CSS classes in `App.css`, theme via
  `ThemeToggle` (check both light and dark).
- Ensure responsive behavior.
- Check loading, empty, error, and success states.
- API calls use same-origin `/api/*` in production. `VITE_API_BASE_URL` is for local development
  only (`react-app/.env`; Vite does not read the repository-root `.env`).
- Only `VITE_`-prefixed variables reach the browser and they are inlined at build time. Never
  put a secret in one.
- Analytics (`analytics.js`, GA4) loads only in production builds; keep it that way.

## News / AI Content

- Never invent facts, sources, quotes, statistics, or article details.
- Preserve links to original sources.
- Clearly distinguish source content from generated summaries (TLDR digests are generated;
  article excerpts are source text).
- Summaries must remain faithful to the source.
- Do not fabricate citations.
- Treat source credibility and evidence separately from trend popularity.

## Trends and Ranking

The trend engine itself lives in `../scoring`. This repository only reads its output
(`lib/trending.js`) and computes one ranking of its own: rising tags per topic in
`lib/topicTrends.js`. When changing either:

- Preserve explainability.
- Keep scoring dimensions independent where possible.
- Document changes to formulas and constants (`PRIOR_WEIGHT`, windows, mention floor) in the code
  comment beside them.
- Avoid arbitrary changes to weights without documenting the reason.
- Update `tests/topicTrends.test.js` with known examples before and after.
- `trending_score` is a rank, not a measurement. Do not present it as an absolute value.

## Security

- Never hardcode API keys, tokens, passwords, or credentials.
- Never commit `.env` files containing secrets. `.env`, `.env.local`, `.env.neon-backup` and
  `react-app/.env` are ignored; only the `.env.example` files are tracked. Gitleaks runs in CI.
- Do not print values from the `.env` files into logs, output or commits.
- Use environment variables for credentials.
- Validate external input.
- Treat article content and URLs as untrusted input. Render it as text, never as HTML.
- Do not execute code obtained from news/article/model content.
- Log through `lib/http.js` (`log`, `logMetric`), which redacts connection strings and secrets.

## Testing

After meaningful code changes:

1. Backend: `npm run test:backend` (`node --test tests/*.test.js`).
2. Frontend: `cd react-app && npm test -- --run`.
3. Build: `npm run build` from the repository root.
4. There is no lint or type-check step. Do not report one as run.
5. Report what was tested and any checks that could not be run.

Backend tests run without a database (they stub the query layer); keep new tests that way.
`tests/security.test.js` asserts the public-view, validation and SQL-parameter rules above, so a
change to those rules needs a matching test change, not a deleted test.

Local run: `npm start` (API on `http://localhost:5000`) and, in another terminal,
`cd react-app && npm start` (Vite on `http://localhost:5173`).

## Deployment

- Vercel deploys from git. Do not deploy, change Vercel environment variables or run
  `npm run cache:refresh` unless asked.
- `MAINTENANCE_MODE=1` (a Vercel environment variable) makes `scripts/build.sh` ship
  `maintenance/index.html` instead of the app.
- `public/` and `react-app/dist/` are build output and ignored. Do not edit or commit them.
- See `DEPLOYMENT.md` and `docs/monitoring.md`.

## Git

- This is its own repository, separate from the parent PrecisNews folder. Run git from here.
- Do not commit unless explicitly asked.
- Do not reset/revert unrelated user changes.
- Do not modify unrelated files.
- Before destructive operations, explain what will be affected.

## Working Style

When a task is complex:

1. Inspect the relevant code.
2. Explain the implementation plan.
3. Make the smallest coherent change.
4. Test it.
5. Summarize changed files and verification.

When requirements are ambiguous, inspect the existing implementation first
and ask only when the ambiguity materially affects the implementation.
