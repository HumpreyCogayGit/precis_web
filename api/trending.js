const { fetchTrending } = require('../lib/trending');
const { sendTimedJson } = require('../lib/db');
const { allowMethods, sendError } = require('../lib/http');
const { RATE_LIMITS, checkRateLimit } = require('../lib/rateLimit');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  if (!checkRateLimit(req, res, RATE_LIMITS.articles)) {
    return;
  }

  try {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
    await sendTimedJson(res, () => fetchTrending({
      limit: req.query.limit,
      articlesPerEntity: req.query.articles_per_entity,
    }));
  } catch (err) {
    sendError(res, 'Failed to fetch trending entities', err, req);
  }
};
