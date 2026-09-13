// Filter model for the trending page.
//
// The filter UNIT here is an entity, not an article, and that single difference is
// why this file exists at all. `passesFilter` in filters.js reads `article.site` --
// a scalar -- because an article has exactly one source. An entity is a thing several
// outlets are talking about, so it carries `sources[]`, and "filter to bleepingcomputer"
// has to mean "some outlet covering this is bleepingcomputer".
//
// Everything UNDERNEATH that difference is shape-agnostic and is imported rather than
// reimplemented: groupOverlap is already the array-vs-list form, tagPredicate already
// takes slugs rather than an article, and the whole URL round-trip is already pure.
// filters.js, FilterPanel.jsx and App.jsx are deliberately untouched -- the home page
// depends on all three, and the existing suite passing unedited is the proof.

import {
  EMPTY_FILTER,
  groupOverlap,
  normalizeQuery,
  queryTerms,
  slugifyTag,
  tagPredicate,
} from './filters';
import { formatSiteName } from './sources';

// The trending page's own control, with no equivalent on `/`: "how many outlets have
// to be covering this".
//
// Default 1, NOT the 2 the original plan proposed. PLAN-A2's calibration measured 0.48
// multi-source stories per day, and found the AI half of the corpus is first-party
// company blogs which are single-source BY CONSTRUCTION. Defaulting to 2 would hide
// most genuine AI entities behind a control the reader never touched.
export const DEFAULT_MIN_SOURCES = 1;
export const MAX_MIN_SOURCES = 6;

export const EMPTY_TREND_FILTER = { ...EMPTY_FILTER, minSources: DEFAULT_MIN_SOURCES };

const asArray = (value) => (Array.isArray(value) ? value : []);

// Same WeakMap discipline as articleTagSlugs: entity objects are replaced wholesale
// on each fetch, so the cache empties itself.
const tagSlugCache = new WeakMap();

export const entityTagSlugs = (entity) => {
  if (!entity || typeof entity !== 'object') {
    return [];
  }

  const cached = tagSlugCache.get(entity);
  if (cached) {
    return cached;
  }

  const slugs = asArray(entity.tags).map(slugifyTag).filter(Boolean);
  tagSlugCache.set(entity, slugs);
  return slugs;
};

// What the free-text box matches. The entity name and the discovery query are the
// obvious two; member headlines are included because the reader is searching for a
// story, and they rarely know the one-or-two-word name the extractor settled on.
// Source SLUGS are excluded in favour of their display names for the same reason
// articleSearchText does it: nobody types "open_ai".
const searchTextCache = new WeakMap();

export const entitySearchText = (entity) => {
  if (!entity || typeof entity !== 'object') {
    return '';
  }

  const cached = searchTextCache.get(entity);
  if (cached !== undefined) {
    return cached;
  }

  const text = normalizeQuery([
    entity.entity,
    entity.discovery_query,
    entity.representative_title,
    ...asArray(entity.sources).map(formatSiteName),
    ...asArray(entity.articles).map((article) => article.title),
  ].filter(Boolean).join(' '));

  searchTextCache.set(entity, text);
  return text;
};

// Every term must appear, matching the home page's AND-across-terms behaviour.
export const entityQueryPredicate = (entity, query) => {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return true;
  }

  const haystack = entitySearchText(entity);
  return terms.every((term) => haystack.includes(term));
};

// Whether the entity has any external score behind it.
//
// Deliberately scored_at and NOT score_state. score_state is the QUEUE state, and
// `pending` is the normal resting state of a candidate that has already been scored
// many times over -- it means "due for a refresh", not "never scored". Reading it as
// the latter labelled two thirds of a live board "not scored yet" while that same row
// was displaying its momentum.
export const hasExternalScore = (entity) => Boolean(entity?.scored_at);

export const minSourcesOf = (filter) => {
  const value = Number(filter?.minSources);
  return Number.isInteger(value) && value >= 1 ? Math.min(value, MAX_MIN_SOURCES) : DEFAULT_MIN_SOURCES;
};

// srcs is distinct_source_count as the pipeline computed it over the whole window.
// `sources` can be shorter after a filter, but the threshold deliberately reads the
// unfiltered count: "3 outlets are covering this" is a fact about the story, not
// about the current view.
export const passesEntityFilter = (entity, filter) => (
  groupOverlap(asArray(entity.sources), filter.sources)
  && groupOverlap(asArray(entity.topics), filter.topics)
  && tagPredicate(entityTagSlugs(entity), filter.tags)
  && (entity.srcs ?? 0) >= minSourcesOf(filter)
  && entityQueryPredicate(entity, filter.query)
);

export const filterEntities = (entities, filter) => (
  entities.filter((entity) => passesEntityFilter(entity, filter))
);

// --- Facets -----------------------------------------------------------------

const tally = (entities, pick) => {
  const facets = new Map();

  for (const entity of entities) {
    for (const { slug, label } of pick(entity)) {
      if (!slug) {
        continue;
      }

      const facet = facets.get(slug);
      if (facet) {
        facet.count += 1;
      } else {
        facets.set(slug, { slug, label, count: 1 });
      }
    }
  }

  return facets;
};

// Sources and topics keep slug === label, exactly as on the home page, so the two
// pages' links stay interchangeable in their query-string form.
export const buildEntityVocabulary = (entities) => ({
  tags: tally(entities, (entity) => (
    entityTagSlugs(entity).map((slug, index) => ({ slug, label: entity.tags[index] }))
  )),
  sources: tally(entities, (entity) => (
    asArray(entity.sources).map((site) => ({ slug: site, label: formatSiteName(site) }))
  )),
  topics: tally(entities, (entity) => (
    asArray(entity.topics).map((topic) => ({ slug: topic, label: topic }))
  )),
});

const withValueAdded = (filter, group, slug) => (
  group === 'tags'
    ? { ...filter, tags: { ...filter.tags, in: [...filter.tags.in, slug] } }
    : { ...filter, [group]: [...filter[group], slug] }
);

const includeListFor = (filter, group) => (group === 'tags' ? filter.tags.in : filter[group]);

// The entity-shaped twin of computeFacetRows. The counting semantics are preserved
// exactly -- every number answers "what happens if I click this?", a click can only
// ever add rows so an addition earns its `+`, and a 0 row stays visible but dead
// rather than disappearing and reshuffling the list. FilterPanel reads these rows
// without knowing or caring that they now count stories rather than articles.
export const computeEntityFacetRows = (entities, draft, group, vocabulary) => {
  const totals = vocabulary[group] || new Map();
  const baseCount = filterEntities(entities, draft).length;
  const includeList = includeListFor(draft, group);
  const excludeList = group === 'tags' ? draft.tags.not : [];

  return [...totals.values()].map(({ slug, label, count: dayCount }) => {
    if (includeList.includes(slug)) {
      return { slug, label, count: dayCount, showPlus: false, state: 'included' };
    }

    if (excludeList.includes(slug)) {
      return { slug, label, count: dayCount, showPlus: false, state: 'excluded' };
    }

    const withCount = filterEntities(entities, withValueAdded(draft, group, slug)).length;
    const isDelta = includeList.length > 0;
    const count = isDelta ? withCount - baseCount : withCount;

    return {
      slug,
      label,
      count,
      showPlus: isDelta,
      state: count > 0 ? 'available' : 'unavailable',
    };
  });
};

// --- URL --------------------------------------------------------------------

// minSources is the only key the shared reader/writer does not know about, so it is
// layered on top of them rather than forked from them: the source/topic/tag/query
// halves of a /trending link stay byte-identical to a `/` link.
export const readTrendFilterFromSearch = (search, readFiltersFromSearch) => {
  const base = readFiltersFromSearch(search);
  const raw = Number(new URLSearchParams(search).get('min_sources'));

  return {
    ...base,
    minSources: Number.isInteger(raw) && raw >= 1 && raw <= MAX_MIN_SOURCES ? raw : DEFAULT_MIN_SOURCES,
  };
};

export const trendFilterToSearchParams = (filter, filtersToSearchParams, search = '') => {
  const params = filtersToSearchParams(filter, search);
  const minSources = minSourcesOf(filter);

  // The default is the absence of a constraint, so it is left out entirely -- a
  // shared link should not carry a control the reader never moved.
  if (minSources > DEFAULT_MIN_SOURCES) {
    params.set('min_sources', String(minSources));
  } else {
    params.delete('min_sources');
  }

  return params;
};

// Reset and the "N selected" badge both have to account for minSources, or a filter
// carrying only a raised threshold reads as empty.
export const countTrendFilterValues = (filter) => (
  filter.sources.length
  + filter.topics.length
  + filter.tags.in.length
  + filter.tags.not.length
  + (minSourcesOf(filter) > DEFAULT_MIN_SOURCES ? 1 : 0)
);
