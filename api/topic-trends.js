const { fetchTopicTrends } = require('../lib/topicTrends');
const { sendTimedJson } = require('../lib/db');
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
    await sendTimedJson(res, () => fetchTopicTrends({ limit: req.query.limit }));
  } catch (err) {
    sendError(res, 'Failed to fetch topic trends', err, req);
  }
};
