// Filter model for the Precis filter panel.
//
// One object, three groups. All three include lists are OR within themselves and
// AND across groups; tags additionally carry an exclude list, which is always
// AND NOT. There is no per-group combiner: selecting two tags widens the result,
// it never narrows it.
//
// Two copies of this object exist in the app at all times: `applied`, which drives
// the article list and the URL, and `draft`, which drives the panel. That split is
// what makes "close on apply" mean anything — do not merge them.

export const EMPTY_TAG_FILTER = { in: [], not: [] };
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
export const tagPredicate = (slugs, { in: included = [], not: excluded = [] } = {}) => {
  if (excluded.length > 0 && excluded.some((slug) => slugs.includes(slug))) {
    return false;
  }

  return included.length === 0 || included.some((slug) => slugs.includes(slug));
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

// --- Front page ---------------------------------------------------------------

// The front page (lead + "Previous stories") must not become one publisher's feed
// just because that source shipped a burst. One pass over the newest DIVERSITY_REACH
// items takes the first article of each source; anything still unfilled falls back to
// pure recency — which is also what keeps a single-source day, or an applied source
// filter, behaving exactly as it does today. The reach is what stops a quiet source
// whose newest item is days old from being promoted above the fold.
export const DIVERSITY_REACH = 40;

// Matches the `article.site || 'unknown'` convention the source tally uses, so items
// with no site collapse into one bucket rather than each counting as a fresh source.
const defaultSourceKey = (article) => article?.site || 'unknown';

/**
 * Splits a newest-first list into the front page and everything below it.
 *
 * `articles` must already be sorted newest-first. Index 0 is always taken on the
 * first pass (its source is by definition unseen), so the lead stays the newest
 * article overall. Both lists are rebuilt by walking the input in order, so a
 * backfilled pick never lands out of sequence and `top` + `rest` is always an exact
 * partition of the input — no article is duplicated, none is dropped.
 *
 * `keyOf` exists because several stored sites share one masthead (`open_ai` and
 * `open_ai_releases` both read "OpenAI"). Diversity is about what the reader sees,
 * so the caller passes the displayed name; the filter panel keeps treating them as
 * the two separate feeds they are.
 */
export const pickDiverseTop = (articles, count, { reach = DIVERSITY_REACH, keyOf = defaultSourceKey } = {}) => {
  const chosen = new Set();
  const seenSources = new Set();

  const limit = Math.min(articles.length, reach);
  for (let index = 0; index < limit && chosen.size < count; index += 1) {
    const key = keyOf(articles[index]) || 'unknown';
    if (seenSources.has(key)) {
      continue;
    }

    seenSources.add(key);
    chosen.add(index);
  }

  for (let index = 0; index < articles.length && chosen.size < count; index += 1) {
    chosen.add(index);
  }

  const top = [];
  const rest = [];
  articles.forEach((article, index) => {
    (chosen.has(index) ? top : rest).push(article);
  });

  return { top, rest };
};

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

// The Discover rail's chips. Counted over the exact slice the rail will filter,
// so a chip can never advertise a number that section cannot deliver, and a chip
// that would return nothing is never rendered in the first place. Ordering is
// count-desc so the day's live subjects lead, alphabetical on ties so the rail
// doesn't reshuffle between two tags that happen to be level.
export const buildTagRail = (articles) => [...tally(articles, (article) => (
  articleTagSlugs(article).map((slug, index) => ({ slug, label: article.tags[index] }))
)).values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

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
 *   unselected, nothing else picked → rows the facet returns on its own
 *   unselected, something picked    → rows that would be ADDED (rendered with a +)
 *   selected (included or excluded) → the facet's own total for the day
 *
 * Because every group is OR within itself, a click can only ever add rows, so the
 * second case is always an addition and always earns its `+`.
 *
 * `0` means clicking would produce an empty list. The row stays, dimmed and
 * disabled — removing it would reshuffle the list on every click and hide the
 * fact that a combination is dead.
 */
export const computeFacetRows = (articles, draft, group, vocabulary) => {
  const totals = vocabulary[group] || new Map();
  const baseCount = filterArticles(articles, draft).length;
  const includeList = includeListFor(draft, group);
  const excludeList = group === 'tags' ? draft.tags.not : [];

  return [...totals.values()].map(({ slug, label, count: dayCount }) => {
    if (includeList.includes(slug)) {
      return { slug, label, count: dayCount, showPlus: false, state: 'included' };
    }

    if (excludeList.includes(slug)) {
      return { slug, label, count: dayCount, showPlus: false, state: 'excluded' };
    }

    const withCount = filterArticles(articles, withValueAdded(draft, group, slug)).length;
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
  // Selected tags are always combined with OR, so there is no mode to carry.
  // Cleared here too, so a link saved before that was settled stops claiming one.
  params.delete('tags_mode');

  return params;
};
