const { checkDatabase } = require('../lib/db');
const { allowMethods } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res)) {
    return;
  }

  try {
    await checkDatabase();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, node: process.version, database: 'ok' });
  } catch (err) {
    console.error('Health check failed', err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, node: process.version, database: 'error' });
  }
};