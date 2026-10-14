// Per-page <head> tags for the SPA. Link previews (Slack, X, LinkedIn, Facebook)
// and most crawlers never run JavaScript, so a single index.html with one title is
// all they ever see. scripts/render-pages.js uses this at build time to write one
// HTML shell per route with its own title, description, canonical and Open Graph
// tags. The page list is shared with the React app (src/pageMeta.json), which sets
// the same title client-side on navigation.
const PAGE_META = require('../react-app/src/pageMeta.json');

const DEFAULT_SITE_URL = 'https://precisnews.vercel.app';
const META_START = '<!-- precis:meta -->';
const META_END = '<!-- /precis:meta -->';

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// SITE_URL ends up in every canonical and og:url, so anything other than a bare
// http(s) origin is refused rather than written into the HTML.
function normalizeSiteUrl(value) {
  const raw = (value || DEFAULT_SITE_URL).trim();
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    throw new Error(`SITE_URL is not a valid URL: ${raw}`);
  }

  if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`SITE_URL must be a bare http(s) origin, got: ${raw}`);
  }

  return url.origin;
}

function absoluteUrl(siteUrl, pathname) {
  return `${siteUrl}${pathname}`;
}

function renderMetaTags(page, siteUrl) {
  const canonical = absoluteUrl(siteUrl, page.path);
  const image = absoluteUrl(siteUrl, page.image || PAGE_META.defaultImage);
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);

  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(PAGE_META.siteName)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ].join('\n    ');
}

// Returns the HTML unchanged when the markers are missing: the maintenance page
// (scripts/build.sh, MAINTENANCE_MODE=1) has none, and must ship as-is.
function renderShell(html, page, siteUrl) {
  const start = html.indexOf(META_START);
  const end = html.indexOf(META_END);
  if (start === -1 || end === -1 || end < start) {
    return html;
  }

  return `${html.slice(0, start + META_START.length)}\n    ${renderMetaTags(page, siteUrl)}\n    ${html.slice(end)}`;
}

function buildSitemap(siteUrl, lastmod) {
  const urls = PAGE_META.pages.map((page) => [
    '  <url>',
    `    <loc>${escapeHtml(absoluteUrl(siteUrl, page.path))}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    '  </url>',
  ].join('\n'));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

// public/<route>/index.html for every page but the home page, which is index.html.
function outputPathFor(page) {
  return page.path === '/' ? 'index.html' : `${page.path.slice(1)}/index.html`;
}

module.exports = {
  DEFAULT_SITE_URL,
  META_END,
  META_START,
  PAGE_META,
  buildSitemap,
  escapeHtml,
  normalizeSiteUrl,
  outputPathFor,
  renderMetaTags,
  renderShell,
};
