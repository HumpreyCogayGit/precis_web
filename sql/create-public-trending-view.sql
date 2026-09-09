\set ON_ERROR_STOP on

-- The public read model behind /api/trending (web/lib/trending.js).
--
-- This is the web twin of scoring/sql/qa-views.sql's trend_leaderboard. That file is for QA
-- against the local staging database and installs five views; this installs only the one the
-- web app reads, on the hosted database Precis Web connects to. The two are kept column-for-
-- column identical on purpose: web/lib/trending.js selects heat, r_lift, r_score, now_n,
-- base_n, momentum, sources_ok and the rest by name, so a narrower shape here would break it.
--
-- The view resolves each candidate to its newest score via LATERAL, which is the reason the
-- API reads it rather than the append-only entity_candidate_scores base table.
--
-- Usage with psql and an owner/admin credential:
--   psql "$ADMIN_DATABASE_URL" -f sql/create-public-trending-view.sql
--
-- Requires the entity_candidates and entity_candidate_scores tables to already exist on the
-- remote (applied by scraper `publish --init-remote`).

BEGIN;

-- Dropped rather than replaced: CREATE OR REPLACE VIEW cannot add, remove or reorder columns,
-- and this view's shape tracks the QA leaderboard's, which changes as the engine does.
DROP VIEW IF EXISTS trend_leaderboard;

CREATE VIEW trend_leaderboard AS
WITH latest AS (
  SELECT c.*, s.trending_score, s.trend_score, s.momentum, s.momentum_label,
         s.velocity_direction, s.confidence, s.active_sources, s.scored_at
    FROM entity_candidates c
    LEFT JOIN LATERAL (
      SELECT * FROM entity_candidate_scores s
       WHERE s.candidate_key = c.candidate_key
       ORDER BY s.scored_at DESC
       LIMIT 1
    ) s ON TRUE
),
ranked AS (
  SELECT *,
         -- NULLS LAST so an unscored candidate is not treated as the quietest thing on the
         -- internet; it simply has no external evidence yet.
         rank() OVER (ORDER BY lift DESC NULLS LAST)           AS r_lift,
         rank() OVER (ORDER BY trending_score DESC NULLS LAST) AS r_score
    FROM latest
)
SELECT
  display_name                          AS entity,
  distinct_source_count                 AS srcs,
  round(lift::numeric, 1)               AS lift,
  trending_score,
  -- Reciprocal Rank Fusion of lift (internal novelty) and trending_score (external attention).
  -- k = 10, not the customary 60, because the candidate set is ~35 rows and 60 flattens it.
  -- See scoring/sql/qa-views.sql for the full rationale.
  round((1.0/(10 + r_lift) + 1.0/(10 + r_score))::numeric, 5) AS heat,
  r_lift, r_score,
  mention_count                         AS now_n,
  baseline_count                        AS base_n,
  round(priority::numeric, 2)           AS priority,
  trend_score,
  momentum,
  momentum_label,
  velocity_direction,
  round(confidence::numeric, 2)         AS confidence,
  array_length(active_sources, 1)       AS sources_ok,
  topics,
  tags,
  score_state,
  scored_at,
  discovery_query,
  candidate_key
FROM ranked
ORDER BY heat DESC;

COMMENT ON VIEW trend_leaderboard IS
  'Public read model for /api/trending, ordered by heat (Reciprocal Rank Fusion of lift and '
  'trending_score). Column-for-column identical to the QA leaderboard in '
  'scoring/sql/qa-views.sql because web/lib/trending.js selects its columns by name. '
  'trending_score is a RANK, not a measurement: the engine marks SCORE_REFERENCE_CEILING as '
  'PROVISIONAL and only relative ordering is reliable.';

-- Same default and skip-when-absent behaviour as create-readonly-web-role.sql, so this file
-- also applies cleanly to a single-role stage or developer database.
\if :{?web_role}
\else
  \set web_role precis_web_readonly
\endif

-- Unlike the article path, which reads a single view, web/lib/trending.js joins the base
-- tables back in: entity_candidates for sources[] and representative_* (the view exposes only
-- the srcs COUNT), and entity_candidate_articles for the member articles behind each row.
-- The role therefore needs SELECT on those two tables in addition to the view. They hold only
-- derived trend data, no reader PII, so this does not widen the role's reach into scraper
-- internals the way granting on articles or seen_urls would.
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'web_role')
    THEN format(
      'GRANT SELECT ON TABLE trend_leaderboard, entity_candidates, entity_candidate_articles TO %I',
      :'web_role'
    )
  ELSE format('SELECT %L AS skipped_grant_role_not_present', :'web_role')
END
\gexec

COMMIT;

\echo 'Public Precis Web trending view configured.'
