\set ON_ERROR_STOP on

-- Creates the public read model used by Precis Web.
--
-- The public API must read this view instead of the scraper-owned articles table.
-- The view intentionally exposes only public fields, truncates article bodies to
-- an excerpt, and withholds records flagged by the scraper for review.
--
-- Usage with psql and an owner/admin credential:
--   psql "$ADMIN_DATABASE_URL" -f sql/create-public-articles-view.sql

BEGIN;

CREATE OR REPLACE VIEW public.public_articles
WITH (security_barrier = true)
AS
SELECT
  url,
  site,
  topic,
  title,
  author,
  published_at,
  image_url,
  CASE
    WHEN body_text IS NULL OR btrim(body_text) = '' THEN NULL
    WHEN length(regexp_replace(body_text, '\s+', ' ', 'g')) > 360
      THEN left(regexp_replace(body_text, '\s+', ' ', 'g'), 360) || '…'
    ELSE regexp_replace(body_text, '\s+', ' ', 'g')
  END AS excerpt,
  fetched_at
FROM public.articles
WHERE COALESCE(needs_review, FALSE) = FALSE;

COMMENT ON VIEW public.public_articles IS
  'Public Precis Web read model. Exposes only public article fields, returns excerpts instead of body_text, and excludes scraper-flagged records where needs_review is true.';

COMMIT;

\echo 'Public Precis Web article view configured.'