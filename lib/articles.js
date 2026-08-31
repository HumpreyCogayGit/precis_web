const { query } = require('./db');

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

async function fetchArticles({ site, topic } = {}) {
  const clauses = [];
  const params = [];

  if (site) {
    params.push(site);
    clauses.push(`site = $${params.length}`);
  }

  if (topic) {
    params.push(topic);
    clauses.push(`topic = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(`
    SELECT url, site, topic, title, author, published_at, image_url, body_text, fetched_at
    FROM articles
    ${where}
    ORDER BY fetched_at DESC NULLS LAST
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
};