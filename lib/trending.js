const { query } = require('./db');
const { QueryValidationError, sortArticlesNewestFirst } = require('./articles');

// The trending read model: one row per entity, ordered by heat, each carrying the
// articles that put it there.
//
// WHY ONE ENDPOINT AND NOT TWO. The obvious shape is /api/trending for the list plus
// /api/trending/:key/articles for the drill-down. This returns both in one response
// instead, because the whole app is built on the working-set pattern (see fetchArticles
// in lib/articles.js and its consumer in App.jsx): fetch once, then filter and expand
// entirely in the browser, so a count and the rows behind it can never disagree. There
// are ~48 candidates with a handful of articles each, so the payload is small and
// expanding a row costs no round trip and shows no spinner.

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

// The scorer keeps every run in entity_candidate_scores, so a candidate that failed
// once and succeeded later still has both rows. trend_leaderboard already resolves
// that to the newest per candidate via LATERAL, which is the main reason this reads
// the view rather than the base tables.
//
// Two columns are needed that the view does not project, so entity_candidates is
// joined back in:
//   sources[]            -- the view exposes only `srcs`, a COUNT. Source faceting
//                           needs the actual list.
//   representative_*     -- the headline that became the discovery query, shown as
//                           the row's title.
//
// The articles come through public.public_articles rather than `articles` directly
// (which is what the trend_evidence QA view does). This is reader-facing, so it has
// to inherit the view's needs_review filter, its excerpt truncation and its topics[]
// taxonomy rollup. Verified 2026-09-08: no candidate loses articles to needs_review,
// so this costs nothing today and is correct when it eventually does.
//
// ORDER BY fetched_at, not published_at: articles.published_at is TEXT holding raw
// RFC-822 strings ("Thu, 03 Sep 2026 11:00:00 GMT"), so sorting it in SQL sorts by
// day-of-week name. fetched_at is a real timestamptz. This is the same two-step the
// article list uses -- indexed ordering in SQL, then sortArticlesNewestFirst in JS to
// get true publication order out of the text column.
const TRENDING_SQL = `
  SELECT
    l.candidate_key,
    l.entity,
    l.srcs,
    l.lift,
    l.trending_score,
    l.heat,
    l.r_lift,
    l.r_score,
    l.now_n,
    l.base_n,
    l.momentum,
    l.momentum_label,
    l.velocity_direction,
    l.confidence,
    l.sources_ok,
    l.topics,
    l.tags,
    l.score_state,
    l.scored_at,
    l.discovery_query,
    c.sources,
    c.representative_title,
    c.representative_url,
    COALESCE(ev.articles, '[]'::json) AS articles
  FROM trend_leaderboard l
  JOIN entity_candidates c USING (candidate_key)
  LEFT JOIN LATERAL (
    SELECT json_agg(x) AS articles
    FROM (
      SELECT
        a.url,
        a.site,
        a.title,
        a.published_at,
        a.fetched_at,
        a.image_url,
        a.summary,
        a.topic,
        a.topics,
        a.tags,
        (a.url = c.representative_url) AS is_representative
      FROM entity_candidate_articles ea
      JOIN public.public_articles a ON a.url = ea.article_url
      WHERE ea.candidate_key = l.candidate_key
      ORDER BY a.fetched_at DESC NULLS LAST
      LIMIT 20
    ) x
  ) ev ON TRUE
  -- Restated rather than inherited: the view's own ORDER BY is not binding once it
  -- is joined, and the planner is free to discard it.
  ORDER BY l.heat DESC NULLS LAST, l.entity ASC
  LIMIT $1
`;

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new QueryValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  return parsed;
}

// Postgres hands back NULL for an empty text[]; the client treats these as arrays
// unconditionally, so they are normalized once here rather than guarded at every
// use site.
const toArray = (value) => (Array.isArray(value) ? value : []);

async function fetchTrending({ limit } = {}) {
  const result = await query(TRENDING_SQL, [normalizeLimit(limit)]);

  return result.rows.map((row, index) => ({
    ...row,
    // The display rank. trending_score is deliberately NOT surfaced as a headline
    // number: the scoring engine marks its SCORE_REFERENCE_CEILING as PROVISIONAL
    // and only relative ordering is reliable, so the page shows position, momentum
    // and source count instead. See the comment on trend_leaderboard.
    rank: index + 1,
    sources: toArray(row.sources),
    topics: toArray(row.topics),
    tags: toArray(row.tags),
    articles: sortArticlesNewestFirst(toArray(row.articles)),
  }));
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  TRENDING_SQL,
  fetchTrending,
  normalizeLimit,
};
