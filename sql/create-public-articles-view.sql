\set ON_ERROR_STOP on

-- Creates the public read model used by Precis Web.
--
-- The public API must read this view instead of the scraper-owned articles table.
-- The view intentionally exposes only public fields, truncates article bodies to
-- an excerpt, and withholds records flagged by the scraper for review.
--
-- It is also where an article's SUBJECT is decided. articles.topic is not that:
-- it is the source prior, the subject a publisher is usually about, and it is
-- wrong for any publisher covering more than one. The subject a reader sees is
-- rolled up here from the article's own tags through tag_topics, so it is
-- derived rather than stored and cannot drift from the tags it comes from.
-- Changing the map in scraper/blogscraper/taxonomy.py re-files the whole archive
-- on the next connect, with no backfill and nothing to re-publish.
--
-- Two columns, deliberately:
--   topic   scalar, the PRIMARY -- one label, for where there is only room for
--           one (the article card). Never used for filtering.
--   topics  array, the FULL rollup -- what every filter and facet reads, so an
--           article that is genuinely both AI and Cyber Security is found under
--           both instead of one arbitrarily winning.
--
-- Usage with psql and an owner/admin credential:
--   psql "$ADMIN_DATABASE_URL" -f sql/create-public-articles-view.sql
--
-- Requires tag_topics (scraper/migrations/2026-09-08_tag_topics.sql).

BEGIN;

CREATE OR REPLACE VIEW public.public_articles
WITH (security_barrier = true)
AS
SELECT
  url,
  site,
  -- The primary subject: the first topic of the first tag that has one. tag_all.py
  -- writes `tags` most-confident-first, so "first" means "the tag the classifier was
  -- surest about". Falls back to the source prior for the 84% of articles that have
  -- no tags yet. Still column 3 and still text: CREATE OR REPLACE VIEW allows an
  -- expression to change but not a name, type or position, and changing those would
  -- mean dropping the view and re-granting precis_web_readonly.
  COALESCE(
    (
      SELECT tt.topic
        FROM unnest(a.tags) WITH ORDINALITY AS u(tag, ord)
        JOIN public.tag_topics tt ON tt.tag = u.tag
       -- tt.position breaks the tie when one tag maps to several topics. Without it
       -- this ORDER BY is ambiguous and the winner is whatever the planner returns
       -- first, which disagreed with taxonomy.topic_for_tags about whether an
       -- "AI Security" article leads with Cyber Security or AI.
       ORDER BY u.ord, tt.position
       LIMIT 1
    ),
    a.topic
  ) AS topic,
  title,
  author,
  published_at,
  image_url,
  CASE
    WHEN body_text IS NULL OR btrim(body_text) = '' THEN NULL
    WHEN length(regexp_replace(body_text, '\s+', ' ', 'g')) > 360
      THEN left(regexp_replace(body_text, '\s+', ' ', 'g'), 360) || '…'
    ELSE regexp_replace(body_text, '\s+', ' ', 'g')
  END AS excerpt,                   -- unchanged for now; remove after the UI migrates
  fetched_at,
  summary,                          -- new: one sentence, written at scrape time. Appended
                                     -- last: CREATE OR REPLACE VIEW can only add columns at
                                     -- the end without dropping the view (and its grants).
  tags,                             -- content-derived tag labels; the filter panel's third
                                     -- facet group. Appended after summary for the same
                                     -- reason. Display labels, not slugs — the slug is
                                     -- derived from the label (see lib/articles.js), so the
                                     -- label is never round-tripped through the URL.

  -- The full subject rollup, and what every topic filter and facet count reads.
  -- Multi-valued because subjects are: an article tagged "AI Security" belongs under
  -- both AI and Cyber Security, and the scalar above only decides which one leads.
  -- Ordered by topics.display_order so the array is deterministic rather than
  -- dependent on tag order. Falls back to the source prior, as a one-element array,
  -- for articles whose tags roll up to nothing — including untagged ones. An article
  -- with neither tags nor a prior correctly gets an empty array and appears under no
  -- topic at all, rather than being swept into a catch-all.
  -- Appended last, for the same CREATE OR REPLACE reason as summary and tags.
  COALESCE(
    NULLIF(
      ARRAY(
        SELECT t.name
          FROM public.topics t
         WHERE EXISTS (
           SELECT 1 FROM public.tag_topics tt
            WHERE tt.topic = t.name AND tt.tag = ANY(a.tags)
         )
         ORDER BY t.display_order
      ),
      '{}'::text[]
    ),
    CASE WHEN a.topic IS NULL THEN '{}'::text[] ELSE ARRAY[a.topic] END
  ) AS topics
FROM public.articles a
WHERE COALESCE(a.needs_review, FALSE) = FALSE;

COMMENT ON VIEW public.public_articles IS
  'Public Precis Web read model. Exposes only public article fields, returns excerpts instead of body_text, and excludes scraper-flagged records where needs_review is true.';

COMMIT;

\echo 'Public Precis Web article view configured.'