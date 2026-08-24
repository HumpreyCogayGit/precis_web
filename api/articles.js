const { fetchArticles } = require('../lib/articles');
const { allowMethods, sendServerError } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  try {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(await fetchArticles({ topic: req.query.topic }));
  } catch (err) {
    sendServerError(res, 'Failed to fetch articles', err);
  }
};