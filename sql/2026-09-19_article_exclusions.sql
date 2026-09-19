\set ON_ERROR_STOP on

-- Per-article exclusion list for Precis Web.
--
-- Three ways to keep something off the site, from widest to narrowest:
--
--   1. public.hidden_sites        a whole source, back catalogue included
--   2. public.article_exclusions  every article matching a rule (this file)
--   3. hide_articles.py           flips needs_review on specific rows already
--                                 scraped; a new article that matches is not caught
--
-- Use this one for recurring noise from an otherwise good source, e.g. Schneier's
-- weekly "Friday Squid Blogging" open thread. A rule is:
--
--   site           restrict to one source; NULL = any source
--   title_pattern  POSIX regex against the title, case-insensitive
--   url_pattern    POSIX regex against the URL, case-insensitive
--
-- NULL columns are no constraint; every non-NULL one must match. At least one
-- pattern is required, so a rule can never hide a whole source (that is what
-- hidden_sites is for). Nothing is deleted from public.articles: DELETE the rule
-- and its articles come back on the next request.
--
-- Usage with psql and an owner/admin credential:
--   psql "$ADMIN_DATABASE_URL" -f sql/2026-09-19_article_exclusions.sql
--
-- Manage rules afterwards with scraper/scripts/exclusions.py, or by hand:
--   INSERT INTO public.article_exclusions(site, title_pattern, reason)
--     VALUES ('schneier', '^Friday Squid Blogging', 'weekly open thread, not news');
--   DELETE FROM public.article_exclusions WHERE id = 1;
--
-- SAFE TO RE-RUN.

BEGIN;

CREATE TABLE IF NOT EXISTS public.article_exclusions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site          text,
  title_pattern text,
  url_pattern   text,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_exclusions_needs_pattern
    CHECK (title_pattern IS NOT NULL OR url_pattern IS NOT NULL),
  -- Evaluating the regex once here rejects an invalid pattern at INSERT time.
  -- Without it, one bad row would make every public read raise instead.
  CONSTRAINT article_exclusions_title_regex_valid
    CHECK (title_pattern IS NULL OR ('' ~* title_pattern) IS NOT NULL),
  CONSTRAINT article_exclusions_url_regex_valid
    CHECK (url_pattern IS NULL OR ('' ~* url_pattern) IS NOT NULL),
  CONSTRAINT article_exclusions_unique
    UNIQUE NULLS NOT DISTINCT (site, title_pattern, url_pattern)
);

COMMENT ON TABLE public.article_exclusions IS
  'Rules withholding matching articles from every public read path (public_articles, search_public_articles). Display-only: articles stay in public.articles and return when the rule is deleted.';

-- No grant to precis_web_readonly, for the same reason as hidden_sites: the view
-- and the SECURITY DEFINER search function read this table as their owner.

INSERT INTO public.article_exclusions (site, title_pattern, reason)
VALUES ('schneier', '^Friday Squid Blogging', 'Weekly open thread, not news')
ON CONFLICT ON CONSTRAINT article_exclusions_unique DO NOTHING;

COMMIT;

-- Re-apply the two public read paths with the exclusion. Both files are
-- idempotent (CREATE OR REPLACE) and keep their existing grants.
\ir create-public-articles-view.sql
\ir create-search-articles-function.sql

\echo 'article_exclusions installed; public read paths now honour it.'
