\set ON_ERROR_STOP on

-- Full-text search for Precis Web, as a SECURITY DEFINER function.
--
-- WHY THIS IS NOT JUST A QUERY AGAINST public.public_articles
--
-- The obvious implementation -- add `@@ websearch_to_tsquery(...)` to a SELECT over
-- the public view -- cannot use the GIN index, and is slow for a reason that gets
-- worse as the archive grows. public.public_articles is declared WITH
-- (security_barrier = true), which stops the planner from pushing any qual below
-- the view. Measured on 2026-09-06 against 3,361 published articles:
--
--   SELECT ... FROM public_articles WHERE <vec> @@ <query>   ->  1675 ms  (Seq Scan)
--   the same without the excerpt column in the target list   ->    59 ms  (Seq Scan)
--   the same against public.articles                         ->  0.78 ms  (Index Scan)
--
-- The 1.6 seconds is the view's excerpt expression -- regexp_replace over body_text
-- -- being evaluated for all 3,361 rows before the filter is applied, because the
-- filter sits above the barrier. Dropping the barrier would fix the plan but throw
-- away a deliberate protection, so instead the matching happens inside a function
-- owned by the table owner, and the read-only web role is granted EXECUTE on the
-- function rather than SELECT on the table.
--
-- The function reproduces every guarantee the view makes: needs_review rows are
-- withheld, only public columns are returned, and body_text is only ever returned
-- as the same 360-character excerpt.
--
-- WHY IT IS SHAPED IN TWO STAGES
--
-- `matched` sorts and pages a deliberately narrow tuple (site, url, rank,
-- fetched_at), then the outer query joins back on the (site, url) primary key for
-- the display columns. That is what keeps the excerpt's regexp_replace off every
-- matching row and on only the page being returned -- a broad query like "ai"
-- matches thousands of rows but still only builds the excerpt for match_limit of
-- them.
--
-- total_count is a window over the full match set, computed before LIMIT, so the
-- caller gets the page and the true total from one round trip.
--
-- Usage with an owner/admin credential:
--   psql "$ADMIN_DATABASE_URL" -f sql/create-search-articles-function.sql
--
-- Requires idx_articles_search (scraper/migrations/2026-09-06_articles_search_index.sql).
-- The indexed expression and the one below must stay character-for-character
-- identical or the planner silently reverts to a sequential scan.

BEGIN;

CREATE OR REPLACE FUNCTION public.search_public_articles(
  q text,
  sites text[] DEFAULT NULL,
  topics text[] DEFAULT NULL,
  tag_slugs text[] DEFAULT NULL,
  not_tag_slugs text[] DEFAULT NULL,
  match_limit integer DEFAULT 50,
  match_offset integer DEFAULT 0
)
RETURNS TABLE (
  url text,
  site text,
  topic text,
  title text,
  author text,
  published_at text,
  image_url text,
  excerpt text,
  fetched_at timestamptz,
  summary text,
  tags text[],
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned so a caller cannot shadow a referenced object by putting a schema of
-- their own ahead of public. Mandatory for any SECURITY DEFINER function.
SET search_path = public, pg_temp
AS $$
  WITH tsq AS (
    SELECT websearch_to_tsquery('english', q) AS value
  ),
  matched AS (
    SELECT
      a.site,
      a.url,
      a.fetched_at,
      ts_rank_cd(
        to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.summary, '')),
        tsq.value
      ) AS rank,
      count(*) OVER () AS total_count
    FROM public.articles a
    CROSS JOIN tsq
    WHERE COALESCE(a.needs_review, FALSE) = FALSE
      AND to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.summary, '')) @@ tsq.value
      -- A NULL array means "no constraint on this group", matching the empty-group
      -- rule the filter panel and lib/articles.js both use.
      AND (sites IS NULL OR a.site = ANY(sites))
      -- Topic is the rollup of the article's own tags through tag_topics, matched by
      -- overlap because an article can carry several. Resolved here rather than read
      -- from a column for the same reason the tag predicate below is: there is no
      -- stored topic to read. a.topic is only the source prior, used when nothing
      -- rolls up — matching on it alone would hide every multi-topic article from all
      -- but one of its topics.
      AND (
        topics IS NULL
        OR EXISTS (
          SELECT 1 FROM public.tag_topics tt
           WHERE tt.tag = ANY(COALESCE(a.tags, '{}'::text[])) AND tt.topic = ANY(topics)
        )
        OR (
          a.topic = ANY(topics)
          AND NOT EXISTS (
            SELECT 1 FROM public.tag_topics tt
             WHERE tt.tag = ANY(COALESCE(a.tags, '{}'::text[]))
          )
        )
      )
      -- Slugs are resolved against the row's own tags array rather than the tags
      -- table, and the expression is the SQL twin of slugifyTag in
      -- web/lib/articles.js and react-app/src/filters.js. All three must agree.
      -- Exclusion is evaluated first and wins, exactly as it does in the panel.
      AND (
        not_tag_slugs IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(COALESCE(a.tags, '{}'::text[])) AS t
          WHERE btrim(lower(regexp_replace(t, '[^a-zA-Z0-9]+', '-', 'g')), '-') = ANY(not_tag_slugs)
        )
      )
      AND (
        tag_slugs IS NULL
        OR EXISTS (
          SELECT 1 FROM unnest(COALESCE(a.tags, '{}'::text[])) AS t
          WHERE btrim(lower(regexp_replace(t, '[^a-zA-Z0-9]+', '-', 'g')), '-') = ANY(tag_slugs)
        )
      )
    ORDER BY rank DESC, a.fetched_at DESC NULLS LAST
    -- Clamped here as well as in lib/articles.js: the function is the security
    -- boundary, so it does not rely on its caller having validated anything. Keep
    -- the ceiling in step with MAX_LIMIT there (5000) — if this one is lower it
    -- silently truncates a result set the API believes it is allowed to return.
    LIMIT LEAST(GREATEST(COALESCE(match_limit, 50), 1), 5000)
    OFFSET GREATEST(COALESCE(match_offset, 0), 0)
  )
  SELECT
    a.url,
    a.site,
    -- The primary topic, character-for-character the expression in
    -- public.public_articles. A reader who arrives via search must see the same label
    -- on the card as one who arrives through the edition; returning a.topic here would
    -- show the source prior instead of what the article's own tags say.
    COALESCE(
      (
        SELECT tt.topic
          FROM unnest(a.tags) WITH ORDINALITY AS u(tag, ord)
          JOIN public.tag_topics tt ON tt.tag = u.tag
         ORDER BY u.ord, tt.position
         LIMIT 1
      ),
      a.topic
    ) AS topic,
    a.title,
    a.author,
    a.published_at,
    a.image_url,
    -- Identical to public.public_articles: the excerpt contract does not change
    -- just because the reader arrived via search.
    CASE
      WHEN a.body_text IS NULL OR btrim(a.body_text) = '' THEN NULL
      WHEN length(regexp_replace(a.body_text, '\s+', ' ', 'g')) > 360
        THEN left(regexp_replace(a.body_text, '\s+', ' ', 'g'), 360) || '…'
      ELSE regexp_replace(a.body_text, '\s+', ' ', 'g')
    END AS excerpt,
    a.fetched_at,
    a.summary,
    a.tags,
    m.total_count
  FROM matched m
  JOIN public.articles a ON a.site = m.site AND a.url = m.url
  ORDER BY m.rank DESC, m.fetched_at DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.search_public_articles IS
  'Full-text search over public article title and summary. SECURITY DEFINER so the read-only web role can use idx_articles_search without SELECT on public.articles; withholds needs_review rows and returns the same public column set and 360-character excerpt as public.public_articles.';

-- A SECURITY DEFINER function is granted to PUBLIC by default. Revoke first, then
-- grant only to the role that needs it.
REVOKE ALL ON FUNCTION public.search_public_articles(
  text, text[], text[], text[], text[], integer, integer
) FROM PUBLIC;

-- Same default as create-readonly-web-role.sql. Override with
--   -v web_role=some_other_role
\if :{?web_role}
\else
  \set web_role precis_web_readonly
\endif

-- Skipped rather than failed when the role is absent, so this file also applies
-- cleanly to a single-role stage or developer database, where the API connects as
-- the owner and there is no separate read-only role to grant to.
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'web_role')
    THEN format(
      'GRANT EXECUTE ON FUNCTION public.search_public_articles(text, text[], text[], text[], text[], integer, integer) TO %I',
      :'web_role'
    )
  ELSE format('SELECT %L AS skipped_grant_role_not_present', :'web_role')
END
\gexec

COMMIT;

\echo 'Article search function configured.'
