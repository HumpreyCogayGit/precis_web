\set ON_ERROR_STOP on

-- Per-source visibility switch for Precis Web.
--
-- Two separate things can be turned off for a source, and they are not the same:
--
--   1. SCRAPING     blogscraper configs disable <site>   (ops database)
--      Stops the scheduler queueing new batches. Already-scraped articles keep
--      appearing on the site.
--   2. DISPLAY      a row in public.hidden_sites          (content database, here)
--      Withholds everything that source has ever produced from every public read
--      path. Nothing is deleted; DELETE the row and the whole back catalogue
--      returns on the next request.
--
-- Turn a source off completely = do both. Reverse either independently.
--
-- Usage with psql and an owner/admin credential:
--   psql "$ADMIN_DATABASE_URL" -f sql/2026-09-16_hidden_sites.sql
--
-- Hide a source:
--   INSERT INTO public.hidden_sites(site, reason) VALUES ('oss_security', 'CVE list noise')
--     ON CONFLICT (site) DO NOTHING;
-- Bring it back:
--   DELETE FROM public.hidden_sites WHERE site = 'oss_security';

BEGIN;

CREATE TABLE IF NOT EXISTS public.hidden_sites (
  site      text PRIMARY KEY,
  reason    text,
  hidden_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hidden_sites IS
  'Sources withheld from every public read path. Display-only: the articles stay in public.articles and return as soon as the row is deleted. Scraping is controlled separately, by site_configs.active in the ops database.';

-- No grant to precis_web_readonly is needed or wanted. public.public_articles is
-- a view and search_public_articles is SECURITY DEFINER, so both consult this
-- table as their owner; the web role must not be able to read, let alone change,
-- the hide list itself.

COMMIT;

-- Re-apply the two public read paths with the hidden_sites exclusion. Both files
-- are idempotent (CREATE OR REPLACE) and keep their existing grants.
\ir create-public-articles-view.sql
\ir create-search-articles-function.sql

\echo 'hidden_sites installed; public read paths now honour it.'
