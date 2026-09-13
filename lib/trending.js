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
// How many member articles each entity carries. The Trending page shows all of them;
// the home page's Top Stories only wants one per entity and asks for 1.
const DEFAULT_ARTICLES_PER_ENTITY = 20;
const MAX_ARTICLES_PER_ENTITY = 20;

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
// WHY THREE QUERIES AND NOT ONE. This used to be a single statement with a LATERAL join
// from each candidate into public.public_articles. A join clause cannot be pushed below
// that view's security barrier, so the view was expanded far beyond the rows needed:
// 2575 ms on staging (2026-09-13). The same data as three queries -- leaderboard,
// candidate->url links, then the articles by `url = ANY(...)`, which does reach the
// primary key -- took ~20 ms. The per-candidate ordering and cap move into JS.
const LEADERBOARD_SQL = `
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
    c.representative_url
  FROM trend_leaderboard l
  JOIN entity_candidates c USING (candidate_key)
  -- Restated rather than inherited: the view's own ORDER BY is not binding once it
  -- is joined, and the planner is free to discard it.
  ORDER BY l.heat DESC NULLS LAST, l.entity ASC
  LIMIT $1
`;

const CANDIDATE_ARTICLE_LINKS_SQL = `
  SELECT candidate_key, article_url
  FROM entity_candidate_articles
  WHERE candidate_key = ANY($1)
`;

// The articles come through public.public_articles rather than `articles` directly
// (which is what the trend_evidence QA view does). This is reader-facing, so it has
// to inherit the view's needs_review filter and its topics[] taxonomy rollup.
// Verified 2026-09-08: no candidate loses articles to needs_review, so this costs
// nothing today and is correct when it eventually does. No excerpt: nothing on either
// page renders one for a trending article.
const MEMBER_ARTICLES_SQL = `
  SELECT
    url,
    site,
    title,
    published_at,
    fetched_at,
    image_url,
    summary,
    topic,
    topics,
    tags
  FROM public.public_articles
  WHERE url = ANY($1::text[])
`;

function normalizeIntegerParam(value, { field, defaultValue, max }) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new QueryValidationError(`${field} must be an integer between 1 and ${max}`, field);
  }

  return parsed;
}

function normalizeLimit(value) {
  return normalizeIntegerParam(value, { field: 'limit', defaultValue: DEFAULT_LIMIT, max: MAX_LIMIT });
}

function normalizeArticlesPerEntity(value) {
  return normalizeIntegerParam(value, {
    field: 'articles_per_entity',
    defaultValue: DEFAULT_ARTICLES_PER_ENTITY,
    max: MAX_ARTICLES_PER_ENTITY,
  });
}

// Postgres hands back NULL for an empty text[]; the client treats these as arrays
// unconditionally, so they are normalized once here rather than guarded at every
// use site.
const toArray = (value) => (Array.isArray(value) ? value : []);

const fetchedAtMs = (article) => {
  const timestamp = article.fetched_at ? new Date(article.fetched_at).getTime() : NaN;
  return Number.isNaN(timestamp) ? -Infinity : timestamp;
};

// One candidate's member articles: the newest `perEntity` by fetched_at (NULLS LAST, as
// the SQL used to order them), then true publication order via sortArticlesNewestFirst.
//
// ORDER BY fetched_at, not published_at: articles.published_at is TEXT holding raw
// RFC-822 strings, so only fetched_at can pick "the newest N" without parsing. The
// representative article is kept even when it falls outside that window -- it is the
// headline the entity is named after, and a 1-article pool must be that one.
function selectMemberArticles(candidate, urls, articlesByUrl, perEntity) {
  const members = [...new Set(urls)]
    .flatMap((url) => articlesByUrl.get(url) || [])
    .map((article) => ({ ...article, is_representative: article.url === candidate.representative_url }))
    .sort((a, b) => fetchedAtMs(b) - fetchedAtMs(a));

  let selected = members.slice(0, perEntity);
  const representative = members.find((article) => article.is_representative);

  if (representative && !selected.includes(representative)) {
    selected = [representative, ...selected.slice(0, perEntity - 1)];
  }

  return sortArticlesNewestFirst(selected);
}

async function fetchTrending({ limit, articlesPerEntity } = {}) {
  const normalizedLimit = normalizeLimit(limit);
  const perEntity = normalizeArticlesPerEntity(articlesPerEntity);

  const leaderboard = await query(LEADERBOARD_SQL, [normalizedLimit]);
  const candidateKeys = leaderboard.rows.map((row) => row.candidate_key);

  const urlsByCandidate = new Map();
  const articlesByUrl = new Map();

  if (candidateKeys.length > 0) {
    const links = await query(CANDIDATE_ARTICLE_LINKS_SQL, [candidateKeys]);
    for (const { candidate_key: key, article_url: url } of links.rows) {
      if (!urlsByCandidate.has(key)) {
        urlsByCandidate.set(key, []);
      }
      urlsByCandidate.get(key).push(url);
    }

    const urls = [...new Set(links.rows.map((row) => row.article_url))];
    if (urls.length > 0) {
      const articles = await query(MEMBER_ARTICLES_SQL, [urls]);
      for (const article of articles.rows) {
        if (!articlesByUrl.has(article.url)) {
          articlesByUrl.set(article.url, []);
        }
        articlesByUrl.get(article.url).push(article);
      }
    }
  }

  return leaderboard.rows.map((row, index) => ({
    ...row,
    // The display rank. trending_score is deliberately NOT surfaced as a headline
    // number: the scoring engine marks its SCORE_REFERENCE_CEILING as PROVISIONAL
    // and only relative ordering is reliable, so the page shows position, momentum
    // and source count instead. See the comment on trend_leaderboard.
    rank: index + 1,
    sources: toArray(row.sources),
    topics: toArray(row.topics),
    tags: toArray(row.tags),
    articles: selectMemberArticles(row, urlsByCandidate.get(row.candidate_key) || [], articlesByUrl, perEntity),
  }));
}

module.exports = {
  CANDIDATE_ARTICLE_LINKS_SQL,
  DEFAULT_ARTICLES_PER_ENTITY,
  DEFAULT_LIMIT,
  LEADERBOARD_SQL,
  MAX_ARTICLES_PER_ENTITY,
  MAX_LIMIT,
  MEMBER_ARTICLES_SQL,
  fetchTrending,
  normalizeArticlesPerEntity,
  normalizeLimit,
  selectMemberArticles,
};
