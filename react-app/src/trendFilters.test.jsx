import { describe, expect, test } from 'vitest';
import { filtersToSearchParams, readFiltersFromSearch } from './filters';
import {
  DEFAULT_MIN_SOURCES,
  buildEntityVocabulary,
  computeEntityFacetRows,
  countTrendFilterValues,
  entityTagSlugs,
  filterEntities,
  hasExternalScore,
  passesEntityFilter,
  readTrendFilterFromSearch,
  trendFilterToSearchParams,
} from './trendFilters';

const entity = (name, { sources = [], topics = [], tags = [], srcs, articles = [] } = {}) => ({
  candidate_key: name.toLowerCase().replace(/\s+/g, '-'),
  entity: name,
  discovery_query: `${name} something happened`,
  representative_title: `${name} something happened`,
  sources,
  topics,
  tags,
  srcs: srcs ?? sources.length,
  score_state: 'done',
  articles,
});

const ASTRA = entity('Astra', {
  sources: ['open_ai', 'hackernews', 'securityweek'],
  topics: ['AI', 'Cyber Security'],
  tags: ['LLM Release', 'AI Security'],
});

const GEMINI = entity('Gemini', {
  sources: ['google_innovation_ai'],
  topics: ['AI'],
  tags: ['LLM Release'],
});

const SCREENCONNECT = entity('ScreenConnect', {
  sources: ['bleepingcomputer', 'securityweek'],
  topics: ['Cyber Security'],
  tags: ['Zero-Day / Exploit'],
});

const ALL = [ASTRA, GEMINI, SCREENCONNECT];

const filter = (overrides = {}) => ({
  sources: [],
  topics: [],
  tags: { in: [], not: [] },
  query: '',
  minSources: DEFAULT_MIN_SOURCES,
  ...overrides,
});

describe('the entity is the filter unit, not the article', () => {
  // The whole reason this module exists. passesFilter compares article.site, a
  // scalar; an entity has sources[], so a source selection has to mean "some
  // outlet covering this is that one".
  test('a source filter matches any covering outlet, not just a lead', () => {
    expect(passesEntityFilter(ASTRA, filter({ sources: ['securityweek'] }))).toBe(true);
    expect(passesEntityFilter(GEMINI, filter({ sources: ['securityweek'] }))).toBe(false);
  });

  test('an empty group is no constraint at all', () => {
    expect(filterEntities(ALL, filter())).toHaveLength(3);
  });

  test('selecting two values in one group widens, never narrows', () => {
    const one = filterEntities(ALL, filter({ topics: ['AI'] })).length;
    const two = filterEntities(ALL, filter({ topics: ['AI', 'Cyber Security'] })).length;
    expect(two).toBeGreaterThanOrEqual(one);
    expect(two).toBe(3);
  });

  test('groups are ANDed across each other', () => {
    expect(filterEntities(ALL, filter({ topics: ['AI'], sources: ['bleepingcomputer'] }))).toHaveLength(0);
  });

  test('tags are slugged, and exclusion beats inclusion', () => {
    expect(entityTagSlugs(ASTRA)).toEqual(['llm-release', 'ai-security']);

    expect(filterEntities(ALL, filter({ tags: { in: ['llm-release'], not: [] } })))
      .toEqual([ASTRA, GEMINI]);
    expect(filterEntities(ALL, filter({ tags: { in: ['llm-release'], not: ['ai-security'] } })))
      .toEqual([GEMINI]);
  });
});

describe('min. distinct sources', () => {
  test('defaults to 1, so single-source entities are not hidden by a control nobody touched', () => {
    // PLAN-A2 measured that the AI half of the corpus is first-party company blogs,
    // single-source by construction. A default of 2 would silently drop them.
    expect(DEFAULT_MIN_SOURCES).toBe(1);
    expect(filterEntities(ALL, filter())).toContain(GEMINI);
  });

  test('raising the threshold drops entities below it', () => {
    expect(filterEntities(ALL, filter({ minSources: 2 }))).toEqual([ASTRA, SCREENCONNECT]);
    expect(filterEntities(ALL, filter({ minSources: 3 }))).toEqual([ASTRA]);
  });

  test('reads the pipeline-wide count, not the length of the filtered sources array', () => {
    // srcs is a fact about the story ("3 outlets are covering this"), not about
    // the current view, so it must not move when a source facet is selected.
    const narrowed = filter({ sources: ['open_ai'], minSources: 3 });
    expect(passesEntityFilter(ASTRA, narrowed)).toBe(true);
  });
});

describe('"not scored yet" reads the score, not the queue', () => {
  // Measured on the live board: 10 of 51 candidates sat in score_state 'pending' or
  // 'running' while every one of them already had a score and a momentum label.
  // pending means "due for a refresh", not "never scored".
  test('a re-queued entity that already has a score is not called unscored', () => {
    expect(hasExternalScore({ score_state: 'pending', scored_at: '2026-09-08T09:00:00Z' })).toBe(true);
    expect(hasExternalScore({ score_state: 'running', scored_at: '2026-09-08T09:00:00Z' })).toBe(true);
  });

  test('only the absence of a score row counts as unscored', () => {
    expect(hasExternalScore({ score_state: 'pending', scored_at: null })).toBe(false);
    expect(hasExternalScore({ score_state: 'failed', scored_at: null })).toBe(false);
    expect(hasExternalScore(undefined)).toBe(false);
  });

  test('an unscored entity still ranks and is never filtered out for it', () => {
    const unscored = { ...entity('Fresh', { sources: ['open_ai'] }), scored_at: null, score_state: 'pending' };
    expect(filterEntities([...ALL, unscored], filter())).toContain(unscored);
  });
});

describe('free-text query', () => {
  test('matches the entity name, the discovery query and member headlines', () => {
    const withArticle = entity('Sality P2P', {
      sources: ['hackernews'],
      articles: [{ url: 'u', title: '23-Year-Old Botnet Disrupted', site: 'hackernews' }],
    });

    expect(passesEntityFilter(withArticle, filter({ query: 'sality' }))).toBe(true);
    expect(passesEntityFilter(withArticle, filter({ query: 'botnet' }))).toBe(true);
    expect(passesEntityFilter(withArticle, filter({ query: 'ransomware' }))).toBe(false);
  });

  test('matches the source display name rather than its slug', () => {
    // Nobody types "open_ai".
    expect(passesEntityFilter(ASTRA, filter({ query: 'openai' }))).toBe(true);
  });

  test('every term must match', () => {
    expect(passesEntityFilter(ASTRA, filter({ query: 'astra something' }))).toBe(true);
    expect(passesEntityFilter(ASTRA, filter({ query: 'astra ransomware' }))).toBe(false);
  });
});

describe('facet counts answer "what happens if I click this?"', () => {
  const vocabulary = buildEntityVocabulary(ALL);

  test('the vocabulary counts stories, and labels sources for humans', () => {
    expect(vocabulary.topics.get('AI').count).toBe(2);
    expect(vocabulary.sources.get('open_ai').label).toBe('OpenAI');
  });

  test('with nothing selected, a row counts what it returns on its own', () => {
    const rows = computeEntityFacetRows(ALL, filter(), 'topics', vocabulary);
    const ai = rows.find((row) => row.slug === 'AI');
    expect(ai).toMatchObject({ count: 2, showPlus: false, state: 'available' });
  });

  test('with something selected, a row counts what it would ADD, and earns its +', () => {
    const draft = filter({ topics: ['AI'] });
    const rows = computeEntityFacetRows(ALL, draft, 'topics', vocabulary);
    const cyber = rows.find((row) => row.slug === 'Cyber Security');

    // Cyber Security alone matches 2, but Astra is already in via AI, so clicking
    // adds only ScreenConnect.
    expect(cyber).toMatchObject({ count: 1, showPlus: true, state: 'available' });
  });

  test('a dead combination stays visible and disabled rather than vanishing', () => {
    const draft = filter({ sources: ['bleepingcomputer'] });
    const rows = computeEntityFacetRows(ALL, draft, 'topics', vocabulary);
    const ai = rows.find((row) => row.slug === 'AI');

    expect(ai.state).toBe('unavailable');
    expect(ai.count).toBe(0);
  });
});

describe('URL round-trip', () => {
  test('the shared half stays byte-identical to a home-page link', () => {
    const applied = filter({ topics: ['AI'], sources: ['open_ai'], tags: { in: ['llm-release'], not: [] } });
    const params = trendFilterToSearchParams(applied, filtersToSearchParams);

    expect(params.get('topic')).toBe('AI');
    expect(params.get('source')).toBe('open_ai');
    expect(params.get('tags')).toBe('llm-release');
  });

  test('the default threshold is left out, so a link carries no control nobody moved', () => {
    expect(trendFilterToSearchParams(filter(), filtersToSearchParams).has('min_sources')).toBe(false);
    expect(trendFilterToSearchParams(filter({ minSources: 3 }), filtersToSearchParams).get('min_sources')).toBe('3');
  });

  test('a written filter reads back as itself', () => {
    const applied = filter({ topics: ['AI'], minSources: 3, tags: { in: ['llm-release'], not: ['ai-security'] } });
    const search = `?${trendFilterToSearchParams(applied, filtersToSearchParams)}`;
    const restored = readTrendFilterFromSearch(search, readFiltersFromSearch);

    expect(restored.topics).toEqual(['AI']);
    expect(restored.minSources).toBe(3);
    expect(restored.tags).toEqual({ in: ['llm-release'], not: ['ai-security'] });
    expect(filterEntities(ALL, restored)).toEqual(filterEntities(ALL, applied));
  });

  test('a junk threshold falls back to the default rather than emptying the page', () => {
    expect(readTrendFilterFromSearch('?min_sources=nonsense', readFiltersFromSearch).minSources).toBe(1);
    expect(readTrendFilterFromSearch('?min_sources=0', readFiltersFromSearch).minSources).toBe(1);
    expect(readTrendFilterFromSearch('?min_sources=999', readFiltersFromSearch).minSources).toBe(1);
  });

  test('a raised threshold counts as a selection, or Clear all would read as empty', () => {
    expect(countTrendFilterValues(filter())).toBe(0);
    expect(countTrendFilterValues(filter({ minSources: 2 }))).toBe(1);
  });
});
