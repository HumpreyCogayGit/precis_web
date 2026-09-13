const { allowMethods } = require('../lib/http');
const { RATE_LIMITS, checkRateLimit } = require('../lib/rateLimit');

module.exports = function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  if (!checkRateLimit(req, res, RATE_LIMITS.health)) {
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
};
