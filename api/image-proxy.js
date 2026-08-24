const { proxyImage } = require('../lib/imageProxy');
const { allowMethods, sendServerError } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  try {
    return await proxyImage(req, res);
  } catch (err) {
    return sendServerError(res, 'Failed to proxy image', err);
  }
};