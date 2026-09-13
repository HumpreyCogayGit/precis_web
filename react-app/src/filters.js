// Filter model for the Precis filter panel.
//
// One object, three groups and a free-text query. All three include lists are OR
// within themselves and AND across groups; tags additionally carry an exclude
// list, which is always AND NOT. There is no per-group combiner: selecting two
// tags widens the result, it never narrows it. The query is ANDed on top of all
// of them, which is what makes the panel's counts read "within this search".
//
// Two copies of this object exist in the app at all times: `applied`, which drives
// the article list and the URL, and `draft`, which drives the panel. That split is
// what makes "close on apply" mean anything — do not merge them.

import { formatSiteName } from './sources';

export const EMPTY_TAG_FILTER = { in: [], not: [] };
// `all` is the absence of a date constraint, not a range covering everything —
// the working set is one page of the corpus, so a literal "everything" range
// would be a claim the loaded rows cannot back.
export const EMPTY_DATE_RANGE = { preset: 'all', from: null, to: null };
export const EMPTY_FILTER = {
  sources: [], topics: [], tags: EMPTY_TAG_FILTER, query: '', dateRange: EMPTY_DATE_RANGE,
};

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

// --- Text query ---------------------------------------------------------------

// The query travels through the model and the URL as the reader typed it, so the
// input stays a faithful controlled field and a shared link keeps its casing.
// Normalisation happens at match time instead.
export const MAX_QUERY_LENGTH = 120;
const MAX_QUERY_TERMS = 8;

export const sanitizeQueryInput = (value) => String(value ?? '').slice(0, MAX_QUERY_LENGTH);

export const normalizeQuery = (value) => (
  sanitizeQueryInput(value).toLowerCase().replace(/\s+/g, ' ').trim()
);

// Every term must match (AND), and a term matches as a plain substring — no
// stemming, no fuzziness. Same contract as the panel's own facet search, so the
// two boxes never disagree about what "matches" means.
//
// Splitting is memoised on the last query string because computeFacetRows runs
// filterArticles once per facet row: without this, one keystroke re-splits the
// same string thousands of times.
let lastQueryInput;
let lastQueryTerms = [];

export const queryTerms = (query) => {
  if (query === lastQueryInput) {
    return lastQueryTerms;
  }

  const normalized = normalizeQuery(query);
  lastQueryInput = query;
  lastQueryTerms = normalized ? normalized.split(' ').slice(0, MAX_QUERY_TERMS) : [];
  return lastQueryTerms;
};

export const hasQuery = (filter) => queryTerms(filter?.query).length > 0;

// Only the fields the reader can see on a result row. `excerpt` is deliberately
// excluded: it is body_text truncated to 360 characters, so matching it returns
// hits whose matched words appear nowhere in the row that comes back. The site is
// indexed both as stored ("open_ai") and as displayed ("OpenAI") — nobody types
// the slug. Cached in a WeakMap for the same reason articleTagSlugs is: the
// article objects are replaced wholesale when new data arrives.
const searchTextCache = new WeakMap();

export const articleSearchText = (article) => {
  if (!article || typeof article !== 'object') {
    return '';
  }

  const cached = searchTextCache.get(article);
  if (cached !== undefined) {
    return cached;
  }

  const text = [
    article.title,
    article.summary,
    ...(Array.isArray(article.tags) ? article.tags : []),
    ...articleTopics(article),
    article.site,
    formatSiteName(article.site),
  ].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ');

  searchTextCache.set(article, text);
  return text;
};

// An empty query is no constraint at all, exactly like an empty group.
export const queryPredicate = (article, query) => {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return true;
  }

  const haystack = articleSearchText(article);
  return terms.every((term) => haystack.includes(term));
};

// --- Dates --------------------------------------------------------------------

// published_at is free-form text — every source dates its posts differently — so
// the API cannot sort or filter on it in SQL (see lib/articles.js). The date
// filter therefore runs here, over the same working set every other group
// filters, which is also what lets the preset chips carry an exact count.
//
// Every boundary in this section is UTC. parseDateTimestamp pins a date-only
// string to UTC midnight and the cards render their dates in UTC
// (formatShortDate in App.jsx), so computing days in the viewer's local zone
// would put an article in a different day than the one printed on its own row.

// Matches an explicit time-of-day (e.g. "14:47" or "T09:00"). Date-only strings
// are ambiguous: JS parses them as local time, which makes ordering depend on
// each visitor's timezone rather than the article's actual date.
const HAS_TIME_COMPONENT = /\d{1,2}:\d{2}/;

// Mirrors lib/articles.js: "July 15th, 2026" (Zero Day Initiative) is NaN to Date.parse.
const ORDINAL_SUFFIX = /(?<=\d)(?:st|nd|rd|th)\b/gi;

export const parseDateTimestamp = (dateValue) => {
  if (!dateValue) {
    return 0;
  }

  const normalizedDate = String(dateValue).trim()
    .replace(/^Published\s+/i, '')
    .replace(ORDINAL_SUFFIX, '');
  if (!normalizedDate) {
    return 0;
  }

  const candidates = HAS_TIME_COMPONENT.test(normalizedDate)
    ? [normalizedDate, `${normalizedDate} UTC`]
    : [`${normalizedDate} UTC`, normalizedDate];

  for (const candidate of candidates) {
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return 0;
};

// The date bar counts the working set once per chip on every render, so parsing
// each article's date on every pass would mean thousands of Date.parse calls for
// a bar nobody touched. Cached the same way articleTagSlugs and articleSearchText
// are: a WeakMap keyed by the article, which the wholesale replacement of the
// article objects on each fetch empties for us.
const timestampCache = new WeakMap();

export const articleTimestamp = (article) => {
  if (!article || typeof article !== 'object') {
    return 0;
  }

  const cached = timestampCache.get(article);
  if (cached !== undefined) {
    return cached;
  }

  const timestamp = parseDateTimestamp(article.published_at);
  timestampCache.set(article, timestamp);
  return timestamp;
};

export const DAY_MS = 86_400_000;

// A day key is the calendar day itself ("2026-09-08"), never an instant: it is
// what the URL carries and what the calendar grid compares, so it stays free of
// any time component that a timezone could shift.
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isDateKey = (value) => (
  typeof value === 'string'
  && DATE_KEY_PATTERN.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
);

export const toDateKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);

export const dateKeyOf = (year, monthIndex, day) => toDateKey(Date.UTC(year, monthIndex, day));

export const startOfDay = (key) => Date.parse(`${key}T00:00:00.000Z`);
export const endOfDay = (key) => Date.parse(`${key}T23:59:59.999Z`);

export const todayKey = (now = Date.now()) => toDateKey(now);

// The chips, in the order the bar renders them. `all` is the default and has no
// row here because it is the absence of a range, not one of them.
export const DATE_PRESETS = ['today', 'week', 'month'];

export const DATE_PRESET_LABELS = {
  all: 'All',
  today: 'Today',
  week: 'This week',
  month: 'This month',
  custom: 'Custom',
};

/**
 * Calendar boundaries for a preset, as day keys.
 *
 * "This week" is the Monday-to-Sunday week the current day falls in and "this
 * month" the whole calendar month — not a rolling 7 or 30 days. That is what the
 * reader means by the words, and it is what makes two people opening the same
 * link on the same day see the same edition. Both therefore run to the end of the
 * period, which is usually in the future; nothing is published there, so the
 * range costs nothing and stays honest about the period it names.
 */
export const presetRange = (preset, now = Date.now()) => {
  const today = new Date(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();

  if (preset === 'today') {
    const key = dateKeyOf(year, month, day);
    return { from: key, to: key };
  }

  if (preset === 'week') {
    // getUTCDay is Sunday-based; the site's weeks start on Monday.
    const startOfWeek = Date.UTC(year, month, day);
    const offset = (new Date(startOfWeek).getUTCDay() + 6) % 7;
    return {
      from: toDateKey(startOfWeek - offset * DAY_MS),
      to: toDateKey(startOfWeek + (6 - offset) * DAY_MS),
    };
  }

  if (preset === 'month') {
    // Day 0 of the next month is the last day of this one.
    return { from: dateKeyOf(year, month, 1), to: dateKeyOf(year, month + 1, 0) };
  }

  return null;
};

// filterArticles runs once per facet row inside computeFacetRows, so resolving
// the range per article would mean thousands of Date.parse calls per keystroke.
// The memo is keyed on the range object — replaced whenever the filter changes —
// plus the UTC day number, which is pure arithmetic and expires a resolution that
// a page left open across midnight would otherwise keep serving.
let lastRangeInput;
let lastRangeDay;
let lastResolvedRange = null;

/**
 * A range in its final form: two day keys plus the instants they bracket, or
 * null for "no date constraint". A custom range missing or malforming either end
 * resolves to null rather than to half a range — a URL with only `from` filters
 * nothing instead of silently truncating the edition.
 */
export const resolveDateRange = (range, now = Date.now()) => {
  const day = Math.floor(now / DAY_MS);
  if (range === lastRangeInput && day === lastRangeDay) {
    return lastResolvedRange;
  }

  const bounds = (() => {
    if (!range || !range.preset || range.preset === 'all') {
      return null;
    }

    if (range.preset === 'custom') {
      return isDateKey(range.from) && isDateKey(range.to)
        ? { from: range.from, to: range.to }
        : null;
    }

    return presetRange(range.preset, now);
  })();

  // Day keys sort lexically, so a backwards pair is caught without parsing. It is
  // a slip (a hand-edited link, a picker click out of order), not an empty range.
  const resolved = bounds
    ? (() => {
      const [from, to] = bounds.from <= bounds.to ? [bounds.from, bounds.to] : [bounds.to, bounds.from];
      return { from, to, start: startOfDay(from), end: endOfDay(to) };
    })()
    : null;

  lastRangeInput = range;
  lastRangeDay = day;
  lastResolvedRange = resolved;
  return resolved;
};

export const hasDateRange = (filter) => resolveDateRange(filter?.dateRange) !== null;

// An article whose date never parsed has no day to be in, so it stays out of
// every range rather than leaking into all of them. Unfiltered, it still shows —
// this is the one predicate that can drop it.
export const datePredicate = (article, range) => {
  const resolved = resolveDateRange(range);
  if (!resolved) {
    return true;
  }

  const timestamp = articleTimestamp(article);
  return timestamp > 0 && timestamp >= resolved.start && timestamp <= resolved.end;
};

// --- Predicate ----------------------------------------------------------------

// An empty group is no constraint at all — never "match nothing".
export const groupOr = (value, list) => list.length === 0 || list.includes(value);

// The same rule for a group whose value on the article is a list, not a scalar.
// An article carries every topic its tags roll up to, so "is this article in the
// AI topic" is an overlap question. Passing article.topics to groupOr instead
// would compare an array against strings and quietly fail for every article.
export const groupOverlap = (values, list) => (
  list.length === 0 || (Array.isArray(values) && values.some((value) => list.includes(value)))
);

// public_articles exposes both: `topics` is the full rollup used for filtering and
// facets, `topic` the primary label shown on a card. Fall back to the scalar so a
// row from an older payload still filters correctly rather than vanishing.
export const articleTopics = (article) => {
  if (Array.isArray(article?.topics)) {
    return article.topics;
  }
  return article?.topic ? [article.topic] : [];
};

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
  && groupOverlap(articleTopics(article), filter.topics)
  && tagPredicate(articleTagSlugs(article), filter.tags)
  && datePredicate(article, filter.dateRange)
  && queryPredicate(article, filter.query)
);

export const filterArticles = (articles, filter) => articles.filter((article) => passesFilter(article, filter));

// Facet selections only. The query is not counted here because it has its own
// visible affordance in the header — adding it to the Filters badge would claim a
// selection the panel cannot show.
export const countFilterValues = (filter) => (
  filter.sources.length + filter.topics.length + filter.tags.in.length + filter.tags.not.length
);

// Reset and "Clear all" do have to account for both: a filter carrying only a
// query, or only a date range, is not empty.
export const isFilterEmpty = (filter) => (
  countFilterValues(filter) === 0 && !hasQuery(filter) && !hasDateRange(filter)
);

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
  topics: tally(articles, (article) => articleTopics(article).map((topic) => ({ slug: topic, label: topic }))),
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

// A preset travels as `date=week` and a custom range as `from`/`to`, so a shared
// "this week" link still means this week when it is opened next month, while a
// hand-picked range stays the exact days it was picked as.
export const readDateRangeFromParams = (params) => {
  const preset = params.get('date');
  if (DATE_PRESETS.includes(preset)) {
    return { preset, from: null, to: null };
  }

  const from = params.get('from');
  const to = params.get('to');
  if (isDateKey(from) && isDateKey(to)) {
    return from <= to
      ? { preset: 'custom', from, to }
      : { preset: 'custom', from: to, to: from };
  }

  return EMPTY_DATE_RANGE;
};

export const readFiltersFromSearch = (search, defaultTopics = []) => {
  const params = new URLSearchParams(search);
  const excluded = parseCommaList(params.get('not_tags')).filter(isTagSlug);
  const excludedSet = new Set(excluded);

  return {
    topics: params.has('topic') ? parseCommaList(params.get('topic')) : [...defaultTopics],
    sources: parseCommaList(params.get('source')),
    query: sanitizeQueryInput(params.get('q')),
    dateRange: readDateRangeFromParams(params),
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

  // Trimmed on the way out so a half-typed "openai " doesn't leave a trailing
  // space in every link the reader copies.
  const trimmedQuery = sanitizeQueryInput(filter.query).trim();
  if (trimmedQuery) {
    params.set('q', trimmedQuery);
  } else {
    params.delete('q');
  }

  // Rewritten from scratch every time: a preset and a custom pair are mutually
  // exclusive, so leaving a stale `from` beside a fresh `date` would produce a
  // link that reads back as neither.
  params.delete('date');
  params.delete('from');
  params.delete('to');

  const range = filter.dateRange;
  if (range && DATE_PRESETS.includes(range.preset)) {
    params.set('date', range.preset);
  } else if (range?.preset === 'custom' && isDateKey(range.from) && isDateKey(range.to)) {
    params.set('from', range.from);
    params.set('to', range.to);
  }

  write('source', filter.sources);
  write('topic', filter.topics);
  write('tags', filter.tags.in);
  write('not_tags', filter.tags.not);
  // Selected tags are always combined with OR, so there is no mode to carry.
  // Cleared here too, so a link saved before that was settled stops claiming one.
  params.delete('tags_mode');

  return params;
};
