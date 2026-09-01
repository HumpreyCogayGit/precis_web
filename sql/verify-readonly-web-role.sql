\set ON_ERROR_STOP on

-- Verifies that the connected role can perform public Precis Web reads through
-- public.public_articles and has no direct internal table or schema privileges.
--
-- Usage with psql:
--   psql "$WEB_READONLY_DATABASE_URL" -f sql/verify-readonly-web-role.sql

SELECT current_user AS checked_role, current_database() AS checked_database;

-- Read checks matching the public API surface.
SELECT
  url,
  site,
  topic,
  title,
  author,
  published_at,
  image_url,
  excerpt,
  fetched_at
FROM public.public_articles
ORDER BY fetched_at DESC NULLS LAST
LIMIT 1;

SELECT DISTINCT site
FROM public.public_articles
ORDER BY site
LIMIT 1;

SELECT DISTINCT topic AS name
FROM public.public_articles
WHERE topic IS NOT NULL
  AND btrim(topic) <> ''
ORDER BY name
LIMIT 1;

WITH checks AS (
  SELECT 'public_articles SELECT' AS check_name, has_table_privilege(current_user, 'public.public_articles', 'SELECT') AS passed
  UNION ALL
  SELECT 'articles direct SELECT denied', NOT has_table_privilege(current_user, 'public.articles', 'SELECT')
  UNION ALL
  SELECT 'articles INSERT denied', NOT has_table_privilege(current_user, 'public.articles', 'INSERT')
  UNION ALL
  SELECT 'articles UPDATE denied', NOT has_table_privilege(current_user, 'public.articles', 'UPDATE')
  UNION ALL
  SELECT 'articles DELETE denied', NOT has_table_privilege(current_user, 'public.articles', 'DELETE')
  UNION ALL
  SELECT 'schema CREATE denied', NOT has_schema_privilege(current_user, 'public', 'CREATE')
  UNION ALL
  SELECT 'articles DROP denied', NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'articles'
      AND pg_catalog.pg_get_userbyid(c.relowner) = current_user
  )
)
SELECT check_name, passed
FROM checks;

DO $$
BEGIN
  IF EXISTS (
    WITH checks AS (
      SELECT has_table_privilege(current_user, 'public.public_articles', 'SELECT') AS passed
      UNION ALL SELECT NOT has_table_privilege(current_user, 'public.articles', 'SELECT')
      UNION ALL SELECT NOT has_table_privilege(current_user, 'public.articles', 'INSERT')
      UNION ALL SELECT NOT has_table_privilege(current_user, 'public.articles', 'UPDATE')
      UNION ALL SELECT NOT has_table_privilege(current_user, 'public.articles', 'DELETE')
      UNION ALL SELECT NOT has_schema_privilege(current_user, 'public', 'CREATE')
      UNION ALL SELECT NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'articles'
          AND pg_catalog.pg_get_userbyid(c.relowner) = current_user
      )
    )
    SELECT 1 FROM checks WHERE NOT passed
  ) THEN
    RAISE EXCEPTION 'Read-only privilege verification failed';
  END IF;
END $$;

\echo 'Read-only Precis Web database role verification completed.'