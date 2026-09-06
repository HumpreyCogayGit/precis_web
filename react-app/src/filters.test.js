import { describe, expect, test } from 'vitest';
import {
  EMPTY_FILTER,
  MAX_QUERY_LENGTH,
  buildTagRail,
  buildVocabulary,
  computeFacetRows,
  filterArticles,
  filtersToSearchParams,
  hasQuery,
  isTagSlug,
  labelFromTagSlug,
  normalizeQuery,
  passesFilter,
  pickDiverseTop,
  queryTerms,
  readFiltersFromSearch,
  sanitizeQueryInput,
  slugifyTag,
  sortFacetRows,
} from './filters';

const article = (url, site, topic, tags) => ({ url, site, topic, tags });

// A small edition with enough tag overlap to tell an OR from an intersection.
const EDITION = [
  article('a1', 'open_ai', 'AI', ['LLM Release', 'Agentic AI']),
  article('a2', 'open_ai', 'AI', ['LLM Release']),
  article('a3', 'nvidia', 'AI', ['Agentic AI', 'AI Hardware & Chips']),
  article('a4', 'krebs_on_security', 'Cyber Security', ['Ransomware', 'Data Breach']),
  article('a5', 'krebs_on_security', 'Cyber Security', ['Ransomware']),
  article('a6', 'nvidia', 'AI', []),
];

const withFilter = (overrides = {}) => ({
  ...EMPTY_FILTER,
  ...overrides,
  tags: { ...EMPTY_FILTER.tags, ...(overrides.tags || {}) },
});

const urlsMatching = (filter) => filterArticles(EDITION, filter).map((item) => item.url);

describe('slugs', () => {
  test('labels slug to lowercase hyphenated form and back to a readable label', () => {
    expect(slugifyTag('Zero-Day / Exploit')).toBe('zero-day-exploit');
    expect(slugifyTag('Identity & Access (IAM)')).toBe('identity-access-iam');
    expect(slugifyTag('  LLM Release  ')).toBe('llm-release');
    expect(labelFromTagSlug('ai-safety-alignment')).toBe('AI Safety Alignment');
  });

  test('only well-formed slugs survive; display labels and junk do not', () => {
    expect(isTagSlug('new-llm-releases')).toBe(true);
    expect(isTagSlug('Zero-Day / Exploit')).toBe(false);
    expect(isTagSlug('-leading')).toBe(false);
    expect(isTagSlug('double--hyphen')).toBe(false);
    expect(isTagSlug('')).toBe(false);
  });
});

describe('front-page source diversity', () => {
  // Newest-first, which is the order pickDiverseTop is contracted to receive.
  const feed = (...sites) => sites.map((site, index) => ({ url: `u${index}`, site }));
  const sitesOf = (items) => items.map((item) => item.site);
  const urlsOf = (items) => items.map((item) => item.url);

  test('six sources within reach fill the front page one apiece, newest first', () => {
    const articles = feed('nvidia', 'open_ai', 'krebs', 'anthropic', 'hf_blog', 'meta_ai', 'nvidia');
    const { top, rest } = pickDiverseTop(articles, 6);

    expect(sitesOf(top)).toEqual(['nvidia', 'open_ai', 'krebs', 'anthropic', 'hf_blog', 'meta_ai']);
    expect(top[0]).toBe(articles[0]);
    expect(rest).toEqual([articles[6]]);
  });

  test('a burst is skipped past for fresh sources, and the skipped items keep their order below', () => {
    const articles = feed(
      'nvidia', 'nvidia', 'nvidia', 'nvidia', 'nvidia',
      'open_ai', 'krebs', 'anthropic', 'hf_blog', 'meta_ai',
    );
    const { top, rest } = pickDiverseTop(articles, 6);

    // The lead is still the newest item overall; the other four nvidia posts are
    // demoted so five different mastheads sit under it.
    expect(top[0]).toBe(articles[0]);
    expect(sitesOf(top)).toEqual(['nvidia', 'open_ai', 'krebs', 'anthropic', 'hf_blog', 'meta_ai']);
    expect(new Set(sitesOf(top)).size).toBe(6);
    expect(urlsOf(rest)).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  test('too few distinct sources backfills by recency rather than short-changing the tier', () => {
    const articles = feed('nvidia', 'nvidia', 'open_ai', 'nvidia', 'krebs', 'nvidia', 'nvidia');
    const { top, rest } = pickDiverseTop(articles, 6);

    // Diversity first (u0, u2, u4), then the newest of what is left.
    expect(urlsOf(top)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5']);
    expect(urlsOf(rest)).toEqual(['u6']);
  });

  test('top + rest is always an exact partition of the input', () => {
    const articles = feed('nvidia', 'open_ai', 'nvidia', 'krebs', 'nvidia');
    const { top, rest } = pickDiverseTop(articles, 6);

    expect(top).toHaveLength(5);
    expect(rest).toHaveLength(0);
    expect(new Set([...top, ...rest]).size).toBe(articles.length);
    expect(urlsOf([...top, ...rest]).sort()).toEqual(urlsOf(articles).sort());
  });

  test('a single-source day is left exactly as recency ordered it', () => {
    // The three App-level fixtures lean on this: with nothing to diversify, the
    // split has to stay the plain slice it was before.
    const articles = feed(...Array.from({ length: 20 }, () => 'open_ai'));
    const { top, rest } = pickDiverseTop(articles, 6);

    expect(top).toEqual(articles.slice(0, 6));
    expect(rest).toEqual(articles.slice(6));
  });

  test('a source beyond the reach is not promoted; recency takes the slot instead', () => {
    const articles = [...feed(...Array.from({ length: 8 }, () => 'nvidia')), { url: 'stale', site: 'hf_blog' }];
    const { top, rest } = pickDiverseTop(articles, 6, { reach: 3 });

    // hf_blog is the one other source on offer, but it sits past the reach cutoff,
    // so the tier fills by recency and leaves it where it was.
    expect(urlsOf(top)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5']);
    expect(urlsOf(rest)).toEqual(['u6', 'u7', 'stale']);
  });

  test('articles with no site share one bucket instead of each reading as a new source', () => {
    const articles = [
      { url: 'u0' }, { url: 'u1', site: '' }, { url: 'u2', site: 'nvidia' }, { url: 'u3', site: 'open_ai' },
    ];
    const { top } = pickDiverseTop(articles, 2);

    expect(urlsOf(top)).toEqual(['u0', 'u2']);
  });

  test('keyOf collapses sibling feeds that share one masthead', () => {
    const articles = feed('open_ai', 'open_ai_releases', 'nvidia');
    const masthead = (article) => (article.site.startsWith('open_ai') ? 'OpenAI' : article.site);

    // Keyed on the raw site the two OpenAI feeds read as two sources...
    expect(sitesOf(pickDiverseTop(articles, 2).top)).toEqual(['open_ai', 'open_ai_releases']);
    // ...but the reader only ever sees one byline, so the display name is what counts.
    expect(sitesOf(pickDiverseTop(articles, 2, { keyOf: masthead }).top)).toEqual(['open_ai', 'nvidia']);
  });
});

describe('pass(article) truth table', () => {
  test('an empty group is no constraint, never "match nothing"', () => {
    expect(urlsMatching(EMPTY_FILTER)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  test('sources and topics are OR within a group and AND across groups', () => {
    expect(urlsMatching(withFilter({ sources: ['open_ai', 'nvidia'] }))).toEqual(['a1', 'a2', 'a3', 'a6']);
    expect(urlsMatching(withFilter({ topics: ['AI'], sources: ['krebs_on_security'] }))).toEqual([]);
  });

  test('selected tags are OR\'d, so adding one can only widen the result', () => {
    expect(urlsMatching(withFilter({ tags: { in: ['llm-release'] } }))).toEqual(['a1', 'a2']);
    expect(urlsMatching(withFilter({ tags: { in: ['llm-release', 'ransomware'] } })))
      .toEqual(['a1', 'a2', 'a4', 'a5']);
    // Two tags one article carries do not intersect down to that article.
    expect(urlsMatching(withFilter({ tags: { in: ['llm-release', 'agentic-ai'] } })))
      .toEqual(['a1', 'a2', 'a3']);
  });

  test('exclusion wins over an include that matched the same article', () => {
    expect(urlsMatching(withFilter({ tags: { in: ['llm-release'], not: ['agentic-ai'] } })))
      .toEqual(['a2']);
    expect(urlsMatching(withFilter({ tags: { not: ['ransomware'] } })))
      .toEqual(['a1', 'a2', 'a3', 'a6']);
  });

  test('an untagged article passes an empty tag filter and fails any include list', () => {
    expect(passesFilter(EDITION[5], EMPTY_FILTER)).toBe(true);
    expect(passesFilter(EDITION[5], withFilter({ tags: { in: ['llm-release'] } }))).toBe(false);
    expect(passesFilter(EDITION[5], withFilter({ tags: { not: ['llm-release'] } }))).toBe(true);
  });
});

describe('availability counts', () => {
  const vocabulary = buildVocabulary(EDITION);
  const rowsFor = (filter, group = 'tags') => Object.fromEntries(
    computeFacetRows(EDITION, filter, group, vocabulary)
      .map((row) => [row.slug, row]),
  );

  test('with nothing selected, a tag reads the rows it returns on its own', () => {
    const rows = rowsFor(EMPTY_FILTER);
    expect(rows['llm-release']).toMatchObject({ count: 2, showPlus: false, state: 'available' });
    expect(rows.ransomware).toMatchObject({ count: 2, showPlus: false });
  });

  test('a selection switches the other rows to what they would ADD, prefixed with +', () => {
    const rows = rowsFor(withFilter({ tags: { in: ['llm-release'] } }));

    // a1 already matches llm-release, so agentic-ai only brings a3.
    expect(rows['agentic-ai']).toMatchObject({ count: 1, showPlus: true, state: 'available' });
    expect(rows.ransomware).toMatchObject({ count: 2, showPlus: true });
    // The selected tag itself falls back to its own total for the day.
    expect(rows['llm-release']).toMatchObject({ count: 2, showPlus: false, state: 'included' });
  });

  test('an excluded tag keeps its own day total and its excluded state', () => {
    const rows = rowsFor(withFilter({ tags: { not: ['ransomware'] } }));
    expect(rows.ransomware).toMatchObject({ count: 2, state: 'excluded' });
    // Excluding ransomware cannot make data-breach reachable: a4 carries both.
    expect(rows['data-breach']).toMatchObject({ count: 0, state: 'unavailable' });
  });

  test('sources and topics follow the same rule against the same draft', () => {
    const rows = rowsFor(withFilter({ tags: { in: ['ransomware'] } }), 'sources');
    expect(rows.krebs_on_security).toMatchObject({ count: 2, state: 'available' });
    expect(rows.open_ai).toMatchObject({ count: 0, state: 'unavailable' });
  });

  test('dead rows sink below live ones instead of disappearing', () => {
    // Excluding ransomware kills data-breach: a4 is the only article with both.
    const sorted = sortFacetRows(computeFacetRows(
      EDITION,
      withFilter({ tags: { not: ['ransomware'] } }),
      'tags',
      vocabulary,
    ));

    expect(sorted.map((row) => row.slug)).toContain('data-breach');
    const firstDead = sorted.findIndex((row) => row.state === 'unavailable');
    expect(sorted.slice(firstDead).every((row) => row.state === 'unavailable')).toBe(true);
  });
});

describe('URL serialization', () => {
  test('reads all three groups', () => {
    expect(readFiltersFromSearch('?topic=AI&source=nvidia&tags=security,new-exploits')).toEqual({
      topics: ['AI'],
      sources: ['nvidia'],
      tags: { in: ['security', 'new-exploits'], not: [] },
      query: '',
    });
  });

  test('not_tags wins when a slug appears in both lists', () => {
    const filter = readFiltersFromSearch('?tags=funding,security&not_tags=funding');
    expect(filter.tags.in).toEqual(['security']);
    expect(filter.tags.not).toEqual(['funding']);
  });

  test('an unknown-shaped tag is dropped and does not survive the next write', () => {
    const filter = readFiltersFromSearch('?tags=Zero-Day %2F Exploit,llm-release');
    expect(filter.tags.in).toEqual(['llm-release']);
    expect(filtersToSearchParams(filter).get('tags')).toBe('llm-release');
  });

  test('a missing topic parameter falls back to the default topic', () => {
    expect(readFiltersFromSearch('', ['AI']).topics).toEqual(['AI']);
    expect(readFiltersFromSearch('?topic=', ['AI']).topics).toEqual([]);
  });

  test('a stale tags_mode is ignored on read and stripped on the next write', () => {
    const filter = readFiltersFromSearch('?tags=a,b&tags_mode=all');

    expect(filter.tags).toEqual({ in: ['a', 'b'], not: [] });
    expect(filtersToSearchParams(filter, '?tags=a,b&tags_mode=all').get('tags_mode')).toBe(null);
  });

  test('an emptied group is removed from an existing query string', () => {
    const params = filtersToSearchParams(EMPTY_FILTER, '?topic=AI&tags=x&not_tags=y&view=cards');

    expect(params.get('topic')).toBe(null);
    expect(params.get('tags')).toBe(null);
    expect(params.get('not_tags')).toBe(null);
    expect(params.get('view')).toBe('cards');
  });

  test('the discover rail is ordered by count, then alphabetically on a tie', () => {
    expect(buildTagRail(EDITION)).toEqual([
      { slug: 'agentic-ai', label: 'Agentic AI', count: 2 },
      { slug: 'llm-release', label: 'LLM Release', count: 2 },
      { slug: 'ransomware', label: 'Ransomware', count: 2 },
      { slug: 'ai-hardware-chips', label: 'AI Hardware & Chips', count: 1 },
      { slug: 'data-breach', label: 'Data Breach', count: 1 },
    ]);
  });

  test('the rail only ever offers tags the given slice can deliver', () => {
    // An untagged article contributes nothing, and a tag no article carries is
    // never invented — every chip is guaranteed to return at least one row.
    expect(buildTagRail([EDITION[5]])).toEqual([]);
    expect(buildTagRail(EDITION).every(({ count }) => count > 0)).toBe(true);
  });
});

describe('text search', () => {
  // Titles and summaries are what the reader sees, so that is what the corpus for
  // these tests carries. `excerpt` is present on the first row to prove it is NOT
  // searched.
  const SEARCHABLE = [
    {
      url: 's1',
      site: 'open_ai',
      topic: 'AI',
      tags: ['LLM Release'],
      title: 'Introducing Codex',
      summary: 'A new coding agent for developers.',
      excerpt: 'This body text mentions kubernetes at length.',
    },
    {
      url: 's2',
      site: 'krebs_on_security',
      topic: 'Cyber Security',
      tags: ['Ransomware'],
      title: 'Hospital chain hit by ransomware',
      summary: 'Attackers demanded payment in bitcoin.',
    },
    {
      url: 's3',
      site: 'x_ai_news',
      topic: 'AI',
      tags: [],
      title: 'Grok gains vision',
      summary: null,
    },
  ];

  const searchUrls = (query) => filterArticles(SEARCHABLE, withFilter({ query })).map((item) => item.url);

  test('normalizes case, surrounding and internal whitespace', () => {
    expect(normalizeQuery('  CODEX   Agent ')).toBe('codex agent');
    expect(queryTerms(' Codex  Agent ')).toEqual(['codex', 'agent']);
  });

  test('an empty or whitespace-only query is no constraint at all', () => {
    expect(searchUrls('')).toEqual(['s1', 's2', 's3']);
    expect(searchUrls('   ')).toEqual(['s1', 's2', 's3']);
    expect(hasQuery(withFilter({ query: '   ' }))).toBe(false);
  });

  test('every term must match — terms are ANDed, not ORed', () => {
    expect(searchUrls('codex')).toEqual(['s1']);
    expect(searchUrls('codex coding')).toEqual(['s1']);
    // 'codex' is only in s1 and 'ransomware' only in s2, so ANDing them matches nothing.
    expect(searchUrls('codex ransomware')).toEqual([]);
  });

  test('matches the title, the summary, a tag, the topic and the source', () => {
    expect(searchUrls('grok')).toEqual(['s3']);              // title
    expect(searchUrls('bitcoin')).toEqual(['s2']);           // summary
    expect(searchUrls('llm release')).toEqual(['s1']);       // tag label
    expect(searchUrls('cyber security')).toEqual(['s2']);    // topic
    expect(searchUrls('open_ai')).toEqual(['s1']);           // stored site slug
  });

  test('matches the source by the name the reader actually sees', () => {
    // Nobody types "x_ai_news"; the byline reads "xAI".
    expect(searchUrls('xai')).toEqual(['s3']);
    expect(searchUrls('openai')).toEqual(['s1']);
  });

  test('does not match the excerpt, whose text never appears on the row', () => {
    expect(searchUrls('kubernetes')).toEqual([]);
  });

  test('a null summary is skipped rather than matching the string "null"', () => {
    expect(searchUrls('null')).toEqual([]);
  });

  test('the query is ANDed with the facet groups, never ORed', () => {
    expect(filterArticles(SEARCHABLE, withFilter({ query: 'a', topics: ['AI'] })).map((i) => i.url))
      .toEqual(['s1', 's3']);
    // The source group excludes s1, so the query cannot bring it back.
    expect(filterArticles(SEARCHABLE, withFilter({ query: 'codex', sources: ['x_ai_news'] })))
      .toEqual([]);
  });

  test('a query narrows the panel counts, so a facet reads what it would deliver', () => {
    const vocabulary = buildVocabulary(SEARCHABLE);
    const rows = computeFacetRows(SEARCHABLE, withFilter({ query: 'codex' }), 'topics', vocabulary);
    const ai = rows.find((row) => row.slug === 'AI');

    // Two AI articles in the edition, but only one of them mentions "codex".
    expect(vocabulary.topics.get('AI').count).toBe(2);
    expect(ai.count).toBe(1);
    expect(rows.find((row) => row.slug === 'Cyber Security').state).toBe('unavailable');
  });

  test('input is capped rather than truncating mid-match at match time', () => {
    expect(sanitizeQueryInput('x'.repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe('the query in the URL', () => {
  test('round-trips through ?q=, preserving the reader’s casing', () => {
    expect(readFiltersFromSearch('?q=OpenAI%20Codex').query).toBe('OpenAI Codex');
    expect(filtersToSearchParams(withFilter({ query: 'OpenAI Codex' })).get('q')).toBe('OpenAI Codex');
  });

  test('composes with the facet groups in one query string', () => {
    const filter = readFiltersFromSearch('?q=codex&topic=AI&source=open_ai');

    expect(filter.query).toBe('codex');
    expect(filter.topics).toEqual(['AI']);
    expect(filter.sources).toEqual(['open_ai']);
  });

  test('a half-typed query is trimmed on the way out, and an empty one is removed', () => {
    expect(filtersToSearchParams(withFilter({ query: 'codex ' })).get('q')).toBe('codex');
    expect(filtersToSearchParams(withFilter({ query: '   ' })).get('q')).toBe(null);
    expect(filtersToSearchParams(EMPTY_FILTER, '?q=stale').get('q')).toBe(null);
  });
});
