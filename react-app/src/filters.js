// Filter model for the Precis filter panel.
//
// One object, three groups. Sources and topics carry an include list each and are
// always OR within themselves; tags additionally carry an exclude list and a
// combiner, because "show me anything tagged either of these" and "show me only
// things tagged both of these" are both useful and only the user knows which.
//
// Two copies of this object exist in the app at all times: `applied`, which drives
// the article list and the URL, and `draft`, which drives the panel. That split is
// what makes "close on apply" mean anything — do not merge them.

export const TAG_MODES = ['any', 'all'];
export const DEFAULT_TAG_MODE = 'any';

export const EMPTY_TAG_FILTER = { in: [], not: [], mode: DEFAULT_TAG_MODE };
export const EMPTY_FILTER = { sources: [], topics: [], tags: EMPTY_TAG_FILTER };

export const TAG_ROW_CAP = 8;
export const FACET_ROW_CAP = 5;

// Tags are stored and displayed as labels ("Zero-Day / Exploit") but travel
// through the URL as slugs ("zero-day-exploit"), so a label is never round-tripped.
// Keep in step with slugifyTag in precis_web/lib/articles.js.
export const slugifyTag = (label) => (
  String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
);

// A well-formed slug is kept even when today's edition has nothing under it — the
// user shared that link on purpose, and the row/chip reads an honest 0. Anything
// that could not have come from slugifyTag is dropped instead (see §6 of the
// handoff: an unknown tag is dropped from the filter and from the URL).
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 120;

export const isTagSlug = (value) => (
  typeof value === 'string' && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value)
);

// Acronyms the scraper's tag vocabulary uses. Only needed to label a tag that is
// in the URL but absent from today's items, so no label came back with the data.
const SLUG_WORD_OVERRIDES = {
  ai: 'AI', apt: 'APT', iam: 'IAM', iot: 'IoT', llm: 'LLM', saas: 'SaaS',
};

export const labelFromTagSlug = (slug) => (
  String(slug)
    .split('-')
    .map((word) => SLUG_WORD_OVERRIDES[word] || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
);

// Slugging every tag of every article on every keystroke would be wasteful, and
// the article objects are replaced wholesale whenever new data arrives, so a
// WeakMap keyed by the article is both safe and self-cleaning.
const tagSlugCache = new WeakMap();

export const articleTagSlugs = (article) => {
  if (!article || typeof article !== 'object') {
    return [];
  }

  const cached = tagSlugCache.get(article);
  if (cached) {
    return cached;
  }

  const slugs = (Array.isArray(article.tags) ? article.tags : [])
    .map(slugifyTag)
    .filter(Boolean);

  tagSlugCache.set(article, slugs);
  return slugs;
};

// An empty group is no constraint at all — never "match nothing".
export const groupOr = (value, list) => list.length === 0 || list.includes(value);

// Exclusion is evaluated first and wins: a tag in `not` removes the article even
// when a tag in `in` matched it.
export const tagPredicate = (slugs, { in: included = [], not: excluded = [], mode = DEFAULT_TAG_MODE } = {}) => {
  if (excluded.length > 0 && excluded.some((slug) => slugs.includes(slug))) {
    return false;
  }

  if (included.length === 0) {
    return true;
  }

  return mode === 'all'
    ? included.every((slug) => slugs.includes(slug))
    : included.some((slug) => slugs.includes(slug));
};

export const passesFilter = (article, filter) => (
  groupOr(article.site, filter.sources)
  && groupOr(article.topic, filter.topics)
  && tagPredicate(articleTagSlugs(article), filter.tags)
);

export const filterArticles = (articles, filter) => articles.filter((article) => passesFilter(article, filter));

export const countFilterValues = (filter) => (
  filter.sources.length + filter.topics.length + filter.tags.in.length + filter.tags.not.length
);

export const isFilterEmpty = (filter) => countFilterValues(filter) === 0;

// --- Facets -----------------------------------------------------------------

// The day's totals for one group: the panel's starting state before anything is
// selected. Derived from the items actually loaded, so a facet that would return
// nothing reads an honest 0 rather than going silently missing.
const tally = (articles, pick) => {
  const facets = new Map();

  for (const article of articles) {
    for (const { slug, label } of pick(article)) {
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

// Sources and topics keep slug === label: their query-string form has always been
// the raw stored value ("open_ai", "AI"), and changing it now would break links
// people already hold. Only tags, which are new here, use real slugs.
export const buildVocabulary = (articles) => ({
  tags: tally(articles, (article) => (
    articleTagSlugs(article).map((slug, index) => ({ slug, label: article.tags[index] }))
  )),
  sources: tally(articles, (article) => (article.site ? [{ slug: article.site, label: article.site }] : [])),
  topics: tally(articles, (article) => (article.topic ? [{ slug: article.topic, label: article.topic }] : [])),
});

const withValueAdded = (filter, group, slug) => (
  group === 'tags'
    ? { ...filter, tags: { ...filter.tags, in: [...filter.tags.in, slug] } }
    : { ...filter, [group]: [...filter[group], slug] }
);

const includeListFor = (filter, group) => (group === 'tags' ? filter.tags.in : filter[group]);

/**
 * Availability counts. Every number in the panel answers one question: what
 * happens if I click this?
 *
 *   ALL mode, unselected            → rows that would be LEFT (a remainder)
 *   ANY mode, unselected, in filled → rows that would be ADDED (rendered with a +)
 *   ANY mode, unselected, in empty  → rows the facet returns on its own
 *   selected (included or excluded) → the facet's own total for the day
 *
 * The `+` never appears in ALL mode: the number is a remainder there, and
 * labelling a shrink as an addition is the fastest way to make this lie.
 *
 * `0` means clicking would produce an empty list. The row stays, dimmed and
 * disabled — removing it would reshuffle the list on every click and hide the
 * fact that a combination is dead.
 */
export const computeFacetRows = (articles, draft, group, vocabulary) => {
  const totals = vocabulary[group] || new Map();
  const baseCount = filterArticles(articles, draft).length;
  const includeList = includeListFor(draft, group);
  const mode = group === 'tags' ? draft.tags.mode : DEFAULT_TAG_MODE;
  const excludeList = group === 'tags' ? draft.tags.not : [];

  return [...totals.values()].map(({ slug, label, count: dayCount }) => {
    if (includeList.includes(slug)) {
      return { slug, label, count: dayCount, showPlus: false, state: 'included' };
    }

    if (excludeList.includes(slug)) {
      return { slug, label, count: dayCount, showPlus: false, state: 'excluded' };
    }

    const withCount = filterArticles(articles, withValueAdded(draft, group, slug)).length;
    const isDelta = mode !== 'all' && includeList.length > 0;
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

// Ordering is frozen while the panel is open: the numbers are recomputed on every
// draft change, but rows must not move under the cursor, so this runs once when
// the panel opens and the resulting order is reused until it is reopened.
export const sortFacetRows = (rows) => [...rows].sort((a, b) => {
  const aDead = a.state === 'unavailable';
  const bDead = b.state === 'unavailable';

  if (aDead !== bDead) {
    return aDead ? 1 : -1;
  }

  return b.count - a.count || a.label.localeCompare(b.label);
});

// --- URL --------------------------------------------------------------------

const parseCommaList = (value) => (
  value ? [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))] : []
);

export const parseTagMode = (value) => (TAG_MODES.includes(value) ? value : DEFAULT_TAG_MODE);

export const readFiltersFromSearch = (search, defaultTopics = []) => {
  const params = new URLSearchParams(search);
  const excluded = parseCommaList(params.get('not_tags')).filter(isTagSlug);
  const excludedSet = new Set(excluded);

  return {
    topics: params.has('topic') ? parseCommaList(params.get('topic')) : [...defaultTopics],
    sources: parseCommaList(params.get('source')),
    tags: {
      // A slug named in both lists resolves to excluded — the panel has no state
      // for a tag that is included and excluded at once.
      in: parseCommaList(params.get('tags')).filter((slug) => isTagSlug(slug) && !excludedSet.has(slug)),
      not: excluded,
      mode: parseTagMode(params.get('tags_mode')),
    },
  };
};

export const filtersToSearchParams = (filter, search = '') => {
  const params = new URLSearchParams(search);

  const write = (key, values) => {
    if (values.length > 0) {
      params.set(key, values.join(','));
    } else {
      params.delete(key);
    }
  };

  write('source', filter.sources);
  write('topic', filter.topics);
  write('tags', filter.tags.in);
  write('not_tags', filter.tags.not);

  // `mode` is part of the filter, not a view preference, so it is serialized —
  // but only when it differs from the default, to keep shared links readable.
  if (filter.tags.in.length > 0 && filter.tags.mode === 'all') {
    params.set('tags_mode', 'all');
  } else {
    params.delete('tags_mode');
  }

  return params;
};
