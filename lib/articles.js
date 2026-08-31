const { query } = require('./db');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseNonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePagination({ limit, offset } = {}) {
  return {
    limit: Math.min(parseNonNegativeInteger(limit, DEFAULT_LIMIT), MAX_LIMIT),
    offset: parseNonNegativeInteger(offset, 0),
  };
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

async function fetchArticles({ site, topic, limit, offset } = {}) {
  const clauses = [];
  const params = [];
  const pagination = normalizePagination({ limit, offset });

  if (site) {
    params.push(site);
    clauses.push(`site = $${params.length}`);
  }

  if (topic) {
    params.push(topic);
    clauses.push(`topic = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(pagination.limit, pagination.offset);
  const limitPlaceholder = `$${params.length - 1}`;
  const offsetPlaceholder = `$${params.length}`;

  const result = await query(`
    SELECT url, site, topic, title, author, published_at, image_url, body_text, fetched_at
    FROM articles
    ${where}
    ORDER BY fetched_at DESC NULLS LAST
    LIMIT ${limitPlaceholder}
    OFFSET ${offsetPlaceholder}
  `, params);

  return sortArticlesNewestFirst(result.rows);
}

async function fetchSites() {
  const result = await query(`
    SELECT DISTINCT site
    FROM articles
    ORDER BY site
  `);

  return result.rows.map((row) => row.site);
}

async function fetchTopics() {
  const result = await query(`
    SELECT DISTINCT topic AS name
    FROM articles
    WHERE topic IS NOT NULL
      AND btrim(topic) <> ''
    ORDER BY name
  `);

  return result.rows.map((row) => row.name);
}

module.exports = {
  fetchArticles,
  fetchSites,
  fetchTopics,
  normalizePagination,
};