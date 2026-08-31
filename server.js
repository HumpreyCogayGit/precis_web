const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { fetchArticles, fetchSites, fetchTopics } = require('./lib/articles');
const { proxyImage } = require('./lib/imageProxy');

const app = express();
const port = process.env.PORT || 5000;
const { checkDatabase } = require('./lib/db');

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.get('/api/health', async (req, res) => {
  try {
    await checkDatabase();
    res.json({ ok: true, node: process.version, database: 'ok' });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ ok: false, node: process.version, database: 'error' });
  }
});

app.get('/api/articles', async (req, res) => {
  try {
    res.json(await fetchArticles({ topic: req.query.topic, limit: req.query.limit, offset: req.query.offset }));
  } catch (err) {
    console.error('Error fetching articles:', err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

app.get('/api/articles/:site', async (req, res) => {
  try {
    const { site } = req.params;
    res.json(await fetchArticles({ site, topic: req.query.topic, limit: req.query.limit, offset: req.query.offset }));
  } catch (err) {
    console.error('Error fetching articles:', err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

app.get('/api/sites', async (req, res) => {
  try {
    res.json(await fetchSites());
  } catch (err) {
    console.error('Error fetching sites:', err);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

app.get('/api/topics', async (req, res) => {
  try {
    res.json(await fetchTopics());
  } catch (err) {
    console.error('Error fetching topics:', err);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

app.get('/api/image-proxy', async (req, res) => {
  try {
    return await proxyImage(req, res);
  } catch (err) {
    console.error('Error proxying image:', err);
    return res.status(500).json({ error: 'Failed to proxy image' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});