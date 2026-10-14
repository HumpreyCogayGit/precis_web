const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_SITE_URL,
  META_END,
  META_START,
  PAGE_META,
  buildSitemap,
  escapeHtml,
  normalizeSiteUrl,
  outputPathFor,
  renderShell,
} = require('../lib/pageMeta');
const { renderPages } = require('../scripts/render-pages');

const SITE = 'https://precisnews.vercel.app';
const SHELL = `<html><head>\n${META_START}\n<title>old</title>\n${META_END}\n<script src="/assets/app.js"></script></head></html>`;

test('every page has a title, description and an absolute route path', () => {
  const paths = PAGE_META.pages.map((page) => page.path);
  assert.deepEqual(paths, ['/', '/tldr', '/trending', '/threats', '/privacy', '/terms']);
  for (const page of PAGE_META.pages) {
    assert.ok(page.title.length > 0 && page.title.length <= 70, `${page.path} title length`);
    assert.ok(page.description.length > 0 && page.description.length <= 200, `${page.path} description length`);
  }
});

test('vercel.json routes every non-home page to its rendered shell', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const route = vercel.routes.find((r) => r.dest === '/$1/index.html');
  assert.ok(route, 'page route exists');
  assert.ok(
    vercel.routes.indexOf(route) < vercel.routes.findIndex((r) => r.handle === 'filesystem'),
    'page route runs before the filesystem handler',
  );
  const pattern = new RegExp(route.src);
  for (const page of PAGE_META.pages.filter((p) => p.path !== '/')) {
    assert.ok(pattern.test(page.path), `${page.path} is routed`);
    assert.ok(pattern.test(`${page.path}/`), `${page.path}/ is routed`);
  }
  assert.ok(!pattern.test('/tldr/x'));
});

test('renderShell replaces only the marked block', () => {
  const page = PAGE_META.pages.find((p) => p.path === '/tldr');
  const html = renderShell(SHELL, page, SITE);

  assert.ok(!html.includes('<title>old</title>'));
  assert.ok(html.includes(`<title>${escapeHtml(page.title)}</title>`));
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/tldr" />`));
  assert.ok(html.includes(`<meta property="og:url" content="${SITE}/tldr" />`));
  assert.ok(html.includes(`<meta property="og:image" content="${SITE}/og-default.png" />`));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  assert.ok(html.includes('<script src="/assets/app.js"></script>'));
  assert.equal(html.split(META_START).length, 2);
});

test('renderShell leaves a page without markers (the maintenance page) untouched', () => {
  const maintenance = '<html><head><title>Back soon</title></head></html>';
  assert.equal(renderShell(maintenance, PAGE_META.pages[0], SITE), maintenance);
});

test('meta values are HTML-escaped', () => {
  const html = renderShell(SHELL, { path: '/x', title: '"><script>alert(1)</script>', description: 'a & b' }, SITE);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  assert.ok(html.includes('content="a &amp; b"'));
});

test('SITE_URL must be a bare http(s) origin', () => {
  assert.equal(normalizeSiteUrl(undefined), DEFAULT_SITE_URL);
  assert.equal(normalizeSiteUrl('https://precisnews.vercel.app/'), SITE);
  assert.throws(() => normalizeSiteUrl('javascript:alert(1)'));
  assert.throws(() => normalizeSiteUrl('https://example.com/path'));
  assert.throws(() => normalizeSiteUrl('https://example.com/?q="><x'));
  assert.throws(() => normalizeSiteUrl('not a url'));
});

test('sitemap lists every page with an absolute URL', () => {
  const xml = buildSitemap(SITE, '2026-10-14');
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  for (const page of PAGE_META.pages) {
    assert.ok(xml.includes(`<loc>${SITE}${page.path}</loc>`), page.path);
  }
  assert.equal(xml.split('<url>').length - 1, PAGE_META.pages.length);
  assert.ok(xml.includes('<lastmod>2026-10-14</lastmod>'));
});

test('renderPages writes a shell per route and the sitemap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-pages-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
    renderPages(dir, SITE, '2026-10-14');

    for (const page of PAGE_META.pages) {
      const html = fs.readFileSync(path.join(dir, outputPathFor(page)), 'utf8');
      assert.ok(html.includes(`<link rel="canonical" href="${SITE}${page.path}" />`), page.path);
    }
    assert.ok(fs.existsSync(path.join(dir, 'sitemap.xml')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
