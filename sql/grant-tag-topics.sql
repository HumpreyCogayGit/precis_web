\set ON_ERROR_STOP on

-- Lets Precis Web read the tag -> topic map behind /api/topic-trends (web/lib/topicTrends.js).
--
-- The home page's "Rising Now" panel ranks TAGS within a topic (and across both). public.public_articles already rolls tags up into topics[] per article, but that
-- cannot say which of an article's tags made it AI and which made it Cyber Security, so the
-- endpoint needs the map itself. tag_topics holds only the public taxonomy (the same labels
-- scraper/blogscraper/taxonomy.py ships), no article or reader data, so granting it does not
-- widen the role's reach into scraper internals.
--
-- Usage with psql and an owner/admin credential:
--   psql "$ADMIN_DATABASE_URL" -f sql/grant-tag-topics.sql
--
-- Requires tag_topics (scraper/migrations/2026-09-08_tag_topics.sql, pushed by publish_to_neon).

BEGIN;

-- Same default and skip-when-absent behaviour as create-readonly-web-role.sql, so this file
-- also applies cleanly to a single-role stage or developer database.
\if :{?web_role}
\else
  \set web_role precis_web_readonly
\endif

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'web_role')
    THEN format('GRANT SELECT ON TABLE public.tag_topics TO %I', :'web_role')
  ELSE format('SELECT %L AS skipped_grant_role_not_present', :'web_role')
END
\gexec

COMMIT;

\echo 'tag_topics readable by the Precis Web role.'
