const { query } = require('./db');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;
const EXCERPT_LENGTH = 360;
const MAX_SITE_LENGTH = 120;
const MAX_TOPIC_LENGTH = 120;
const MAX_MULTI_VALUES = 25;
const PUBLIC_ARTICLES_RELATION = 'public.public_articles';
// published_at is free-form text (format varies per source), so it can't be sorted
// correctly in SQL. We pull a working set ordered by fetched_at, then sort that set by
// published_at in JS. This constant must stay well above the total article count, or
// articles from sources that haven't been rescraped recently (old fetched_at) but have
// a newer published_at can be dropped from the working set before the published_at sort
// ever sees them.
const WORKING_SET_LIMIT = 5000;

class QueryValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'QueryValidationError';
    this.statusCode = 400;
    this.field = field;
  }
}

function getSingleQueryValue(value, field) {
  if (Array.isArray(value)) {
    throw new QueryValidationError(`${field} must be provided only once`, field);
  }

  return value;
}

function parseStrictInteger(value, { field, defaultValue, min = 0, max }) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(getSingleQueryValue(value, field)).trim();

  if (!/^\d+$/.test(normalized)) {
    throw new QueryValidationError(`${field} must be a non-negative integer`, field);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw new QueryValidationError(`${field} is outside the allowed range`, field);
  }

  return parsed;
}

function normalizePagination({ limit, offset } = {}) {
  return {
    limit: parseStrictInteger(limit, {
      field: 'limit',
      defaultValue: DEFAULT_LIMIT,
      min: 1,
      max: MAX_LIMIT,
    }),
    offset: parseStrictInteger(offset, {
      field: 'offset',
      defaultValue: 0,
      min: 0,
      max: MAX_OFFSET,
    }),
  };
}

function normalizeFilter(value, field, maxLength) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = String(getSingleQueryValue(value, field)).trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw new QueryValidationError(`${field} exceeds the maximum allowed length`, field);
  }

  return normalized;
}

// Like normalizeFilter, but accepts a single comma-separated query value (e.g.
// "ai-models,funding") and splits it into a deduped list — the multi-select
// filter panel serializes selections this way instead of repeating the query
// key, so a repeated key (an array here) is still rejected by
// getSingleQueryValue just like normalizeFilter does.
function normalizeMultiFilter(value, field, maxLength, maxValues = MAX_MULTI_VALUES) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = String(getSingleQueryValue(value, field));
  const seen = new Set();
  const values = [];

  for (const rawValue of normalized.split(',')) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.length > maxLength) {
      throw new QueryValidationError(`${field} exceeds the maximum allowed length`, field);
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      values.push(trimmed);
    }
  }

  if (values.length === 0) {
    return undefined;
  }

  if (values.length > maxValues) {
    throw new QueryValidationError(`${field} accepts at most ${maxValues} values`, field);
  }

  return values;
}

// Appends an equality (single value) or ANY() (multiple values) clause so a
// single-value filter still produces the same plain "$n" scalar param it
// always has, instead of always wrapping in an array.
function appendMultiClause(clauses, params, column, values) {
  if (!values) {
    return;
  }

  if (values.length === 1) {
    params.push(values[0]);
    clauses.push(`${column} = $${params.length}`);
  } else {
    params.push(values);
    clauses.push(`${column} = ANY($${params.length}::text[])`);
  }
}

// Matches an explicit time-of-day (e.g. "14:47" or "T09:00"). Date-only strings
// (no time component) are ambiguous: JS parses them as local time, which makes
// ordering depend on the server's timezone rather than the article's actual date.
// Pin those to UTC midnight instead so sorting is deterministic everywhere.
const HAS_TIME_COMPONENT = /\d{1,2}:\d{2}/;

function getArticleTimestamp(article) {
  const value = article.published_at;
  if (!value) {
    return 0;
  }

  const normalized = String(value).trim().replace(/^Published\s+/i, '');
  if (!normalized) {
    return 0;
  }

  const candidates = HAS_TIME_COMPONENT.test(normalized)
    ? [normalized, `${normalized} UTC`]
    : [`${normalized} UTC`, normalized];

  for (const candidate of candidates) {
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return 0;
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortArticlesNewestFirst(articles) {
  return [...articles].sort((a, b) => {
    const timestampDelta = getArticleTimestamp(b) - getArticleTimestamp(a);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return parseTimestamp(b.fetched_at) - parseTimestamp(a.fetched_at);
  });
}

function buildFetchArticlesWhere({ site, topic } = {}) {
  const clauses = [];
  const params = [];
  const normalizedSites = normalizeMultiFilter(site, 'site', MAX_SITE_LENGTH);
  const normalizedTopics = normalizeMultiFilter(topic, 'topic', MAX_TOPIC_LENGTH);

  appendMultiClause(clauses, params, 'site', normalizedSites);
  appendMultiClause(clauses, params, 'topic', normalizedTopics);

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function buildFetchArticlesQuery({ site, topic } = {}) {
  const { where, params } = buildFetchArticlesWhere({ site, topic });
  params.push(WORKING_SET_LIMIT);
  const limitPlaceholder = `$${params.length}`;

  return {
    text: `
    SELECT
      url,
      site,
      topic,
      title,
      author,
      published_at,
      image_url,
      summary,
      excerpt,
      fetched_at
    FROM ${PUBLIC_ARTICLES_RELATION}
    ${where}
    ORDER BY fetched_at DESC NULLS LAST
    LIMIT ${limitPlaceholder}
  `,
    params,
  };
}

async function fetchArticles({ site, topic, limit, offset } = {}) {
  const pagination = normalizePagination({ limit, offset });
  const { text, params } = buildFetchArticlesQuery({ site, topic });
  const result = await query(text, params);
  const sorted = sortArticlesNewestFirst(result.rows);

  return sorted.slice(pagination.offset, pagination.offset + pagination.limit);
}

// Returns every source with how many articles it has under the given topic
// filter (cross-filtered by the *other* facet group, never its own), so the
// filter panel can show a live count next to each row and cap/sort by it.
async function fetchSites({ topic } = {}) {
  const normalizedTopics = normalizeMultiFilter(topic, 'topic', MAX_TOPIC_LENGTH);
  const params = [];
  const clauses = [];

  appendMultiClause(clauses, params, 'topic', normalizedTopics);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(`
    SELECT site AS name, COUNT(*)::int AS count
    FROM ${PUBLIC_ARTICLES_RELATION}
    ${where}
    GROUP BY site
    ORDER BY count DESC, site ASC
  `, params);

  return result.rows;
}

async function fetchTopics({ site } = {}) {
  const normalizedSites = normalizeMultiFilter(site, 'site', MAX_SITE_LENGTH);
  const params = [];
  const clauses = ['topic IS NOT NULL', "btrim(topic) <> ''"];

  appendMultiClause(clauses, params, 'site', normalizedSites);

  const where = `WHERE ${clauses.join(' AND ')}`;
  const result = await query(`
    SELECT topic AS name, COUNT(*)::int AS count
    FROM ${PUBLIC_ARTICLES_RELATION}
    ${where}
    GROUP BY topic
    ORDER BY count DESC, name ASC
  `, params);

  return result.rows;
}

// Backs the filter panel's live "Show N results" / "Show all N" label: a
// plain COUNT(*) over the same WHERE clause fetchArticles uses, so it reflects
// the true total instead of the length of one (WORKING_SET_LIMIT-bounded) page.
async function countArticles({ site, topic } = {}) {
  const { where, params } = buildFetchArticlesWhere({ site, topic });
  const result = await query(`
    SELECT COUNT(*)::int AS count
    FROM ${PUBLIC_ARTICLES_RELATION}
    ${where}
  `, params);

  return result.rows[0]?.count ?? 0;
}

module.exports = {
  DEFAULT_LIMIT,
  EXCERPT_LENGTH,
  MAX_LIMIT,
  MAX_MULTI_VALUES,
  MAX_OFFSET,
  MAX_SITE_LENGTH,
  MAX_TOPIC_LENGTH,
  PUBLIC_ARTICLES_RELATION,
  QueryValidationError,
  WORKING_SET_LIMIT,
  buildFetchArticlesQuery,
  countArticles,
  fetchArticles,
  fetchSites,
  fetchTopics,
  normalizeFilter,
  normalizeMultiFilter,
  normalizePagination,
};