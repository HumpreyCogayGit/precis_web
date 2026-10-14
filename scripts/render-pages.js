#!/usr/bin/env node
// Build step, run by scripts/build.sh after the Vite build is copied to public/.
// Writes one HTML shell per route with that page's meta tags, plus sitemap.xml.
// Static files rather than a function: the CDN serves them like any other asset,
// and there is no per-view invocation. vercel.json routes /tldr etc. to these files.
const fs = require('node:fs');
const path = require('node:path');

const {
  PAGE_META, buildSitemap, normalizeSiteUrl, outputPathFor, renderShell,
} = require('../lib/pageMeta');

function renderPages(publicDir, siteUrl, lastmod) {
  const template = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const written = [];

  for (const page of PAGE_META.pages) {
    const target = path.join(publicDir, outputPathFor(page));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderShell(template, page, siteUrl));
    written.push(path.relative(publicDir, target));
  }

  fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), buildSitemap(siteUrl, lastmod));
  written.push('sitemap.xml');
  return written;
}

if (require.main === module) {
  const publicDir = path.resolve(__dirname, '..', 'public');
  const siteUrl = normalizeSiteUrl(process.env.SITE_URL);
  const lastmod = new Date().toISOString().slice(0, 10);
  const written = renderPages(publicDir, siteUrl, lastmod);
  console.log(`render-pages: ${siteUrl} -> ${written.join(', ')}`);
}

module.exports = { renderPages };
