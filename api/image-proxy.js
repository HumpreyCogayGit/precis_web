const { proxyImage } = require('../lib/imageProxy');
const { allowMethods, sendError } = require('../lib/http');
const { RATE_LIMITS, checkRateLimit } = require('../lib/rateLimit');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  if (!checkRateLimit(req, res, RATE_LIMITS.imageProxy)) {
    return;
  }

  try {
    return await proxyImage(req, res);
  } catch (err) {
    return sendError(res, 'Failed to proxy image', err, req);
  }
};