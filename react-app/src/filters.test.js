import { describe, expect, test } from 'vitest';
import {
  EMPTY_FILTER,
  buildVocabulary,
  computeFacetRows,
  filterArticles,
  filtersToSearchParams,
  isTagSlug,
  labelFromTagSlug,
  passesFilter,
  readFiltersFromSearch,
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
});
