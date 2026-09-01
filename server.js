const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { fetchArticles, fetchSites, fetchTopics } = require('./lib/articles');
const { createCorsOptions } = require('./lib/cors');
const { log, logRequest, sendError } = require('./lib/http');
const { proxyImage } = require('./lib/imageProxy');
const { RATE_LIMITS, rateLimitMiddleware } = require('./lib/rateLimit');
const { securityHeadersMiddleware } = require('./lib/securityHeaders');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(securityHeadersMiddleware);
app.use(logRequest);
app.use(cors(createCorsOptions()));
app.use(express.json());

// API Routes
app.get('/api/health', rateLimitMiddleware(RATE_LIMITS.health), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.get('/api/articles', rateLimitMiddleware(RATE_LIMITS.articles), async (req, res) => {
  try {
    res.json(await fetchArticles({ topic: req.query.topic, limit: req.query.limit, offset: req.query.offset }));
  } catch (err) {
    sendError(res, 'Failed to fetch articles', err, req);
  }
});

app.get('/api/articles/:site', rateLimitMiddleware(RATE_LIMITS.articles), async (req, res) => {
  try {
    const { site } = req.params;
    res.json(await fetchArticles({ site, topic: req.query.topic, limit: req.query.limit, offset: req.query.offset }));
  } catch (err) {
    sendError(res, 'Failed to fetch articles', err, req);
  }
});

app.get('/api/sites', rateLimitMiddleware(RATE_LIMITS.articles), async (req, res) => {
  try {
    res.json(await fetchSites({ topic: req.query.topic }));
  } catch (err) {
    sendError(res, 'Failed to fetch sites', err, req);
  }
});

app.get('/api/topics', rateLimitMiddleware(RATE_LIMITS.articles), async (req, res) => {
  try {
    res.json(await fetchTopics({ site: req.query.site }));
  } catch (err) {
    sendError(res, 'Failed to fetch topics', err, req);
  }
});

app.get('/api/image-proxy', rateLimitMiddleware(RATE_LIMITS.imageProxy), async (req, res) => {
  try {
    return await proxyImage(req, res);
  } catch (err) {
    return sendError(res, 'Failed to proxy image', err, req);
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err.message === 'CORS origin is not allowed') {
    log('warn', 'cors_rejected', {
      requestId: req.requestId,
      origin: req.headers.origin,
      path: req.path,
    });
    return res.status(403).json({ error: 'CORS origin is not allowed', requestId: req.requestId });
  }

  return sendError(res, 'Internal server error', err, req);
});

app.listen(port, () => {
  log('info', 'server_started', { port, node: process.version });
});
