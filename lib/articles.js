const { query } = require('./db');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10000;
const EXCERPT_LENGTH = 360;
const MAX_SITE_LENGTH = 120;
const MAX_TOPIC_LENGTH = 120;
const PUBLIC_ARTICLES_RELATION = 'public.public_articles';

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

function getArticleTimestamp(article) {
  const dateCandidates = [article.published_at]
    .filter(Boolean)
    .flatMap((value) => {
      const normalized = String(value).trim().replace(/^Published\s+/i, '');
      return [normalized, `${normalized} UTC`];
    });

  for (const candidate of dateCandidates) {
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

function buildFetchArticlesQuery({ site, topic, limit, offset } = {}) {
  const clauses = [];
  const params = [];
  const pagination = normalizePagination({ limit, offset });
  const normalizedSite = normalizeFilter(site, 'site', MAX_SITE_LENGTH);
  const normalizedTopic = normalizeFilter(topic, 'topic', MAX_TOPIC_LENGTH);

  if (normalizedSite) {
    params.push(normalizedSite);
    clauses.push(`site = $${params.length}`);
  }

  if (normalizedTopic) {
    params.push(normalizedTopic);
    clauses.push(`topic = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(pagination.limit, pagination.offset);
  const limitPlaceholder = `$${params.length - 1}`;
  const offsetPlaceholder = `$${params.length}`;

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
    OFFSET ${offsetPlaceholder}
  `,
    params,
  };
}

async function fetchArticles({ site, topic, limit, offset } = {}) {
  const { text, params } = buildFetchArticlesQuery({ site, topic, limit, offset });
  const result = await query(text, params);

  return sortArticlesNewestFirst(result.rows);
}

async function fetchSites() {
  const result = await query(`
    SELECT DISTINCT site
    FROM ${PUBLIC_ARTICLES_RELATION}
    ORDER BY site
  `);

  return result.rows.map((row) => row.site);
}

async function fetchTopics() {
  const result = await query(`
    SELECT DISTINCT topic AS name
    FROM ${PUBLIC_ARTICLES_RELATION}
    WHERE topic IS NOT NULL
      AND btrim(topic) <> ''
    ORDER BY name
  `);

  return result.rows.map((row) => row.name);
}

module.exports = {
  DEFAULT_LIMIT,
  EXCERPT_LENGTH,
  MAX_LIMIT,
  MAX_OFFSET,
  MAX_SITE_LENGTH,
  MAX_TOPIC_LENGTH,
  PUBLIC_ARTICLES_RELATION,
  QueryValidationError,
  buildFetchArticlesQuery,
  fetchArticles,
  fetchSites,
  fetchTopics,
  normalizeFilter,
  normalizePagination,
};