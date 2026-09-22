const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

// lib/db.js is swapped for a stub before any lib module loads it, so these tests
// exercise the real paging, trending and tldr logic against scripted query results
// without a database.
const dbPath = path.join(__dirname, '..', 'lib', 'db.js');
const calls = [];
let respond = () => ({ rows: [] });

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (text, params) => {
      calls.push({ text, params });
      return respond(text, params);
    },
  },
};

const { fetchArticles, sortArticlesNewestFirst } = require('../lib/articles');
const { fetchTrending, selectMemberArticles } = require('../lib/trending');
const { fetchTldr } = require('../lib/tldr');

function reset(handler) {
  calls.length = 0;
  respond = handler;
}

// The comparator sortArticlesNewestFirst used before timestamps were precomputed.
// Kept here so the rewrite is held to the exact ordering it replaced.
function legacySort(articles) {
  const parse = (value) => {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  };
  const articleTimestamp = (article) => {
    if (!article.published_at) {
      return 0;
    }
    const normalized = String(article.published_at).trim()
      .replace(/^Published\s+/i, '')
      .replace(/(?<=\d)(?:st|nd|rd|th)\b/gi, '');
    if (!normalized) {
      return 0;
    }
    const candidates = /\d{1,2}:\d{2}/.test(normalized)
      ? [normalized, `${normalized} UTC`]
      : [`${normalized} UTC`, normalized];
    for (const candidate of candidates) {
      const timestamp = Date.parse(candidate);
      if (!Number.isNaN(timestamp)) {
        return timestamp;
      }
    }
    return 0;
  };

  return [...articles].sort((a, b) => (articleTimestamp(b) - articleTimestamp(a))
    || (parse(b.fetched_at) - parse(a.fetched_at)));
}

test('precomputed sort orders articles exactly as the per-comparison sort did', () => {
  const articles = [
    { url: 'a', published_at: 'Thu, 03 Sep 2026 11:00:00 GMT', fetched_at: '2026-09-03T12:00:00Z' },
    { url: 'b', published_at: 'July 15th, 2026', fetched_at: '2026-09-01T00:00:00Z' },
    { url: 'c', published_at: null, fetched_at: '2026-09-05T00:00:00Z' },
    { url: 'd', published_at: 'Published 2026-09-04', fetched_at: '2026-09-04T01:00:00Z' },
    { url: 'e', published_at: '', fetched_at: '2026-09-06T00:00:00Z' },
    { url: 'f', published_at: '2026-09-04', fetched_at: '2026-09-04T02:00:00Z' },
    { url: 'g', published_at: 'not a date', fetched_at: null },
  ];

  assert.deepEqual(sortArticlesNewestFirst(articles).map((a) => a.url), legacySort(articles).map((a) => a.url));
  // Sorting returns a new array and leaves the input alone.
  assert.equal(articles[0].url, 'a');
});

const INDEX_ROWS = Array.from({ length: 5 }, (_, i) => ({
  site: i === 3 ? 'other' : 'nvidia',
  // Two rows share a url across sites: the page must match on (site, url).
  url: i === 3 ? 'u1' : `u${i}`,
  published_at: `2026-09-0${9 - i}T00:00:00Z`,
  fetched_at: `2026-09-0${9 - i}T00:00:00Z`,
  tags: i % 2 ? ['LLM Release'] : ['AI Security'],
  topics: ['AI'],
}));

function articlesResponder(text, params) {
  if (/url = ANY/.test(text)) {
    return {
      rows: INDEX_ROWS
        .filter((row) => params[0].includes(row.url))
        .reverse()
        .map((row) => ({ ...row, title: `${row.site}/${row.url}`, excerpt: 'x' })),
    };
  }
  return { rows: INDEX_ROWS };
}

test('article pages carry the paging cursor and whole-working-set facets', async () => {
  reset(articlesResponder);

  const first = await fetchArticles({ limit: 2, offset: 0, site: 'paging-first' });
  assert.deepEqual(first.items.map((item) => item.title), ['nvidia/u0', 'nvidia/u1']);
  assert.equal(first.total, 5);
  assert.equal(first.next_offset, 2);
  // Facets count all five working-set rows, not the two on this page.
  assert.equal(first.facets.sources.find((s) => s.slug === 'nvidia').count, 4);
  assert.equal(first.facets.topics[0].count, 5);

  // Display columns are read only for the page's urls.
  const pageCall = calls.find((call) => /url = ANY/.test(call.text));
  assert.deepEqual(pageCall.params, [['u0', 'u1']]);

  const last = await fetchArticles({ limit: 2, offset: 4, site: 'paging-first' });
  assert.deepEqual(last.items.map((item) => item.title), ['nvidia/u4']);
  assert.equal(last.next_offset, null);
  assert.equal(last.facets, null);

  const shared = await fetchArticles({ limit: 1, offset: 3, site: 'paging-first' });
  assert.deepEqual(shared.items.map((item) => item.title), ['other/u1']);
});

test('the first page carries leads from further down so the lead carousel is whole at first paint', async () => {
  const rows = INDEX_ROWS.map((row, i) => ({
    ...row,
    lead_topics: i === 4 ? ['Cyber Security'] : [],
  }));
  reset((text, params) => {
    if (/url = ANY/.test(text)) {
      return {
        rows: rows
          .filter((row) => params[0].includes(row.url))
          .map((row) => ({ ...row, title: `${row.site}/${row.url}` })),
      };
    }
    return { rows };
  });

  const first = await fetchArticles({ limit: 2, offset: 0, site: 'paging-leads' });
  assert.deepEqual(first.items.map((item) => item.title), ['nvidia/u0', 'nvidia/u1', 'nvidia/u4']);
  // The cursor still counts only the page itself, so the lead also arrives in its own page.
  assert.equal(first.next_offset, 2);

  const later = await fetchArticles({ limit: 2, offset: 2, site: 'paging-leads' });
  assert.deepEqual(later.items.map((item) => item.title), ['nvidia/u2', 'other/u1']);
});

test('page requests for the same filter reuse one index query', async () => {
  reset(articlesResponder);

  await fetchArticles({ limit: 2, offset: 0, site: 'paging-cache' });
  await fetchArticles({ limit: 2, offset: 2, site: 'paging-cache' });

  assert.equal(calls.filter((call) => !/url = ANY/.test(call.text)).length, 1);
});

test('trending keeps the newest articles per entity and always its representative', () => {
  const candidate = { representative_url: 'old' };
  const byUrl = new Map([
    ['old', [{ url: 'old', site: 's', published_at: '2026-09-01', fetched_at: '2026-09-01T00:00:00Z' }]],
    ['mid', [{ url: 'mid', site: 's', published_at: '2026-09-02', fetched_at: '2026-09-02T00:00:00Z' }]],
    ['new', [{ url: 'new', site: 's', published_at: '2026-09-03', fetched_at: '2026-09-03T00:00:00Z' }]],
  ]);
  const urls = ['old', 'mid', 'new', 'new', 'missing'];

  const all = selectMemberArticles(candidate, urls, byUrl, 20);
  assert.deepEqual(all.map((a) => a.url), ['new', 'mid', 'old']);
  assert.deepEqual(all.map((a) => a.is_representative), [false, false, true]);

  // The representative is the oldest, but a one-article pool must still be it.
  assert.deepEqual(selectMemberArticles(candidate, urls, byUrl, 1).map((a) => a.url), ['old']);
  assert.deepEqual(selectMemberArticles(candidate, urls, byUrl, 2).map((a) => a.url), ['new', 'old']);
  assert.deepEqual(selectMemberArticles({ representative_url: null }, urls, byUrl, 1).map((a) => a.url), ['new']);
});

test('trending assembles entities from three queries in rank order', async () => {
  reset((text) => {
    if (/FROM trend_leaderboard/.test(text)) {
      return {
        rows: [
          { candidate_key: 'k1', entity: 'One', representative_url: 'a', sources: null, topics: null, tags: ['x'] },
          { candidate_key: 'k2', entity: 'Two', representative_url: null, sources: ['s'], topics: ['AI'], tags: null },
        ],
      };
    }
    if (/FROM entity_candidate_articles/.test(text)) {
      return { rows: [{ candidate_key: 'k1', article_url: 'a' }, { candidate_key: 'k1', article_url: 'b' }] };
    }
    return {
      rows: [
        { url: 'a', site: 's', fetched_at: new Date('2026-09-01T00:00:00Z') },
        { url: 'b', site: 's', fetched_at: new Date('2026-09-02T00:00:00Z') },
      ],
    };
  });

  const entities = await fetchTrending({ limit: '2', articlesPerEntity: '1' });

  assert.deepEqual(entities.map((e) => [e.rank, e.entity]), [[1, 'One'], [2, 'Two']]);
  assert.deepEqual(entities[0].articles.map((a) => [a.url, a.is_representative]), [['a', true]]);
  assert.deepEqual(entities[1].articles, []);
  assert.deepEqual([entities[0].sources, entities[0].topics, entities[1].tags], [[], [], []]);
  assert.deepEqual(calls[0].params, [2]);
  assert.deepEqual(calls[1].params, [['k1', 'k2']]);
  assert.deepEqual(calls[2].params, [['a', 'b']]);

  await assert.rejects(() => fetchTrending({ articlesPerEntity: '21' }), /articles_per_entity/);
});

test('tldr reads every topic in one query and fills missing topics with null', async () => {
  reset(() => ({ rows: [{ topic: 'AI', generated_at: 't', items: [] }] }));

  assert.deepEqual(await fetchTldr({}), {
    digests: { AI: { topic: 'AI', generated_at: 't', items: [] }, 'Cyber Security': null },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [['AI', 'Cyber Security']]);

  reset(() => ({ rows: [] }));
  assert.equal(await fetchTldr({ topic: 'Cyber Security' }), null);
  assert.deepEqual(calls[0].params, [['Cyber Security']]);
});
