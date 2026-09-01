const { fetchArticles } = require('../../lib/articles');
const { allowMethods, sendError } = require('../../lib/http');
const { RATE_LIMITS, checkRateLimit } = require('../../lib/rateLimit');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  if (!checkRateLimit(req, res, RATE_LIMITS.articles)) {
    return;
  }

  try {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(await fetchArticles({
      site: req.query.site,
      topic: req.query.topic,
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  } catch (err) {
    sendError(res, 'Failed to fetch articles', err, req);
  }
};