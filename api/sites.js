const { fetchSites } = require('../lib/articles');
const { allowMethods, sendError, setDataCacheHeaders } = require('../lib/http');
const { RATE_LIMITS, checkRateLimit } = require('../lib/rateLimit');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  if (!checkRateLimit(req, res, RATE_LIMITS.articles)) {
    return;
  }

  try {
    setDataCacheHeaders(res);
    res.status(200).json(await fetchSites({ topic: req.query.topic }));
  } catch (err) {
    sendError(res, 'Failed to fetch sites', err, req);
  }
};