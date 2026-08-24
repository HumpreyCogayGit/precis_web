const { fetchTopics } = require('../lib/articles');
const { allowMethods, sendServerError } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  try {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(await fetchTopics());
  } catch (err) {
    sendServerError(res, 'Failed to fetch topics', err);
  }
};