import './App.css';
import {
  createContext, useContext, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef,
} from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import FilterPanel from './FilterPanel.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import DateFilterBar, { rangeChipLabel as dateRangeChipLabel } from './DateFilterBar.jsx';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, SearchIcon } from './icons.jsx';
import {
  EMPTY_DATE_RANGE,
  EMPTY_FILTER,
  FACET_ROW_CAP,
  MAX_QUERY_LENGTH,
  TAG_ROW_CAP,
  articleTagSlugs,
  articleTimestamp,
  buildTagRail,
  buildVocabulary,
  computeFacetRows,
  countFilterValues,
  datePredicate,
  filterArticles,
  filtersToSearchParams,
  hasDateRange,
  hasQuery,
  isFilterEmpty,
  labelFromTagSlug,
  parseDateTimestamp,
  pickDiverseTop,
  queryTerms,
  readFiltersFromSearch,
  resolveDateRange,
  sanitizeQueryInput,
  sortFacetRows,
} from './filters';
import { formatSiteName } from './sources';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');
const INITIAL_ARTICLE_COUNT = 24;
// One working set per load. Filtering happens in the browser over this array, so
// it has to hold every row any draft could reach. Must not exceed MAX_LIMIT in
// lib/articles.js: the API rejects a larger limit with a 400 rather than quietly
// returning fewer rows.
const API_ARTICLE_LIMIT = 5000;
// The first request on mount asks for only this many rows, so the page can paint
// before the full working set is in. The server still has to scan/sort the same
// WORKING_SET_LIMIT rows either way (see lib/articles.js) — this only shrinks what
// gets serialized, sent over the wire and parsed before first render. The rest of
// the working set is fetched right behind it (see fetchArticles) and merged in
// once it lands, so facets and diverse-top selection settle onto the full set a
// moment later rather than blocking on it.
const FIRST_PAINT_ARTICLE_LIMIT = 200;
const BRIEF_COUNT = 5;
// One page of archive results. The count line reports the true total separately,
// so this caps what is rendered, not what was found.
const ARCHIVE_RESULT_LIMIT = 24;
// Below this, a query is still being typed rather than searched. Two characters is
// enough for "ai" and short enough not to fire on a stray keystroke.
const MIN_ARCHIVE_QUERY_LENGTH = 2;
const ARCHIVE_DEBOUNCE_MS = 400;
const PAGE_SIZE_OPTIONS = [24, 48, 96, 192];
const EVERYTHING_VIEW_MODES = ['cards', 'list', 'small-list'];

const proxiedImageUrl = (imageUrl) => (
  imageUrl ? `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}` : ''
);

const safeHttpUrl = (url) => {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (err) {
    return '';
  }
};

// Both of these now come from filters.js, which is where the date predicate lives:
// a range boundary and a sort key read off the same free-form string must never be
// derived two different ways, or an article can sort into a day the filter then
// refuses to show it in.
const getArticleTimestamp = (article) => articleTimestamp(article);

const sortArticlesNewestFirst = (articles) => (
  [...articles].sort((a, b) => {
    const timestampDelta = getArticleTimestamp(b) - getArticleTimestamp(a);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return parseDateTimestamp(b.fetched_at) - parseDateTimestamp(a.fetched_at);
  })
);

const formatShortDate = (dateValue) => {
  const timestamp = typeof dateValue === 'number' ? dateValue : parseDateTimestamp(dateValue);

  if (!timestamp) {
    return 'Date not captured';
  }

  // published_at is pinned to UTC when the source only gives a date (see
  // parseDateTimestamp), so render in UTC too — otherwise the displayed day can
  // drift by one depending on the viewer's own timezone.
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(timestamp));
};

// Exported for pages/TrendingPage.jsx. Export keyword only — no behaviour change,
// and the existing suite is the guard.
export const formatRelativeTime = (dateValue) => {
  const timestamp = parseDateTimestamp(dateValue);

  if (!timestamp) {
    return 'Date not captured';
  }

  const diffHours = (Date.now() - timestamp) / 3_600_000;

  if (diffHours < 1) {
    return 'Just now';
  }

  if (diffHours < 24) {
    return `${Math.max(1, Math.round(diffHours))}h ago`;
  }

  if (diffHours < 48) {
    return 'Yesterday';
  }

  return formatShortDate(timestamp);
};

const getSummaryText = (article) => {
  const summary = article.summary?.replace(/\s+/g, ' ').trim();
  return summary || null;
};

const SENTENCE_END_RE = /^.+?[.!?](?=\s|$)/;
const MAX_FALLBACK_WORDS = 25;

const stripLeadingTitle = (text, title) => {
  const normalizedTitle = title?.trim();
  let result = text;

  if (normalizedTitle && result.toLowerCase().startsWith(normalizedTitle.toLowerCase())) {
    result = result.slice(normalizedTitle.length);
  }

  return result.replace(/^[\s\-–—:.,]+/, '');
};

// Extractive fallback for when the scrape-time summary hasn't been generated yet
// (e.g. articles captured before the summarizer existed). Mirrors the same
// one-sentence, word-capped heuristic used server-side, applied to the excerpt
// so the lead story is never left with a blank gap under the headline.
const getLeadSummaryText = (article) => {
  const summary = getSummaryText(article);
  if (summary) {
    return summary;
  }

  const excerpt = article.excerpt?.replace(/\s+/g, ' ').trim();
  if (!excerpt) {
    return null;
  }

  const text = stripLeadingTitle(excerpt, article.title);
  if (!text) {
    return null;
  }

  const match = text.match(SENTENCE_END_RE);
  let sentence = match ? match[0].trim() : text;

  const words = sentence.split(' ');
  if (words.length > MAX_FALLBACK_WORDS) {
    sentence = `${words.slice(0, MAX_FALLBACK_WORDS).join(' ').replace(/[.,;:-]+$/, '')}…`;
  }

  return sentence || null;
};

const MAX_CARD_EXCERPT_CHARS = 220;

// Same intent as getLeadSummaryText's fallback, sized for a card blurb instead
// of a one-line brief: truncates at the last full word within the limit, never
// mid-word, so it never reproduces the "left(body_text, 360)" cut this
// redesign replaced.
const getCardSummaryText = (article) => {
  const summary = getSummaryText(article);
  if (summary) {
    return summary;
  }

  const excerpt = article.excerpt?.replace(/\s+/g, ' ').trim();
  if (!excerpt) {
    return null;
  }

  const text = stripLeadingTitle(excerpt, article.title);
  if (!text) {
    return null;
  }

  if (text.length <= MAX_CARD_EXCERPT_CHARS) {
    return text;
  }

  const truncated = text.slice(0, MAX_CARD_EXCERPT_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  const safe = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated).replace(/[.,;:-]+$/, '');
  return `${safe}…`;
};

// No default topic: the edition opens on everything the working set holds. Defaulting to
// one topic silently hid every article carrying another one — Cyber Security sources were
// invisible on a fresh load despite being scraped, tagged and published normally.
const readFiltersFromUrl = () => (
  typeof window === 'undefined'
    ? { ...EMPTY_FILTER }
    : readFiltersFromSearch(window.location.search)
);

// Written on Apply and on chip removal — not on every checkbox click, which would
// stack a history entry per click and make the back button unusable.
const writeFiltersToUrl = (filters) => {
  if (typeof window === 'undefined') {
    return;
  }

  const query = filtersToSearchParams(filters, window.location.search).toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
};

// The working set: today's edition, unfiltered. The API also accepts
// site/topic/tags/not_tags (see lib/articles.js) for callers that want
// the database to do the filtering, but the panel needs every reachable row in
// the browser — a facet count that disagreed with the list behind it would be
// worse than a slow one.
const buildArticleUrl = (limit = API_ARTICLE_LIMIT) => (
  `${API_BASE_URL}/api/articles?limit=${limit}&offset=0`
);

// The archive request. filtersToSearchParams gives the page's own query string, so
// the panel's selections narrow the archive the same way they narrow the edition —
// but the page and the API disagree on one name. The page has always called the
// source facet `source` (a public URL people hold links to), while every API route
// reads `site`. `q`, `topic`, `tags` and `not_tags` already match, so this is the
// only rename. Getting it wrong fails silently: the endpoint ignores the unknown
// key and returns unfiltered results.
const buildSearchUrl = (filters) => {
  const params = filtersToSearchParams(filters);
  const sources = params.get('source');

  if (sources) {
    params.set('site', sources);
  }
  params.delete('source');

  // published_at is free-form text no SQL predicate can bracket, so the date range
  // is applied to the response instead (see archiveExtras). Sending it would be
  // worse than useless: the endpoint ignores unknown keys, so the page would show
  // an unfiltered archive under a filtered edition and look like a bug.
  params.delete('date');
  params.delete('from');
  params.delete('to');

  params.set('limit', String(ARCHIVE_RESULT_LIMIT));
  return `${API_BASE_URL}/api/search?${params.toString()}`;
};

const EMPTY_ARCHIVE = {
  status: 'idle', query: '', items: [], total: 0,
};

const SlidersIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="18" r="2" fill="currentColor" stroke="none" />
  </svg>
);

const BookmarkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const CardsViewIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const ListViewIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="4" width="6" height="6" rx="1" />
    <path d="M12 5.5h9" />
    <rect x="3" y="14" width="6" height="6" rx="1" />
    <path d="M12 15.5h9" />
  </svg>
);

const SmallListViewIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);

const EVERYTHING_VIEW_OPTIONS = [
  { id: 'cards', label: 'Cards', Icon: CardsViewIcon },
  { id: 'list', label: 'List', Icon: ListViewIcon },
  { id: 'small-list', label: 'Small list', Icon: SmallListViewIcon },
];

const ViewModeToggle = ({ value, onChange }) => (
  <div className="view-toggle" role="group" aria-label="Everything else layout">
    {EVERYTHING_VIEW_OPTIONS.map(({ id, label, Icon }) => (
      <button
        key={id}
        type="button"
        className={`view-toggle-btn${value === id ? ' active' : ''}`}
        aria-pressed={value === id}
        title={label}
        onClick={() => onChange(id)}
      >
        <Icon />
        <span className="sr-only">{label}</span>
      </button>
    ))}
  </div>
);

const PageSizeSelect = ({ value, onChange }) => (
  <label className="page-size-select">
    <span className="page-size-select-label">Show</span>
    <select
      value={Number.isFinite(value) ? value : 'all'}
      onChange={(event) => {
        const { value: rawValue } = event.target;
        onChange(rawValue === 'all' ? Infinity : Number(rawValue));
      }}
    >
      {PAGE_SIZE_OPTIONS.map((count) => (
        <option key={count} value={count}>{count}</option>
      ))}
      <option value="all">All</option>
    </select>
  </label>
);

const ActiveFilterChip = ({ label, removeLabel, onRemove }) => (
  <button
    type="button"
    className="active-filter-chip"
    aria-label={removeLabel ?? `Clear ${label}`}
    onClick={onRemove}
  >
    <span>{label}</span>
    <CloseIcon />
  </button>
);

// How far one press of a rail arrow travels. A fixed step rather than a full
// page: the chip that was at the edge stays visible, so nothing is skipped over.
const DISCOVER_SCROLL_STEP = 240;

/**
 * The Discover rail: one scrolling row of tag chips that narrows the Everything
 * else section, and only that section.
 *
 * This is deliberately NOT a second filter. It never touches `applied`, the URL,
 * or the active-filter bar — an earlier chip scroller was deleted for blurring
 * that line (see design_handoff_precis_edition/README.md). It is a skim control
 * that lives inside the section it reorders, and its state dies with the page.
 *
 * One tag at a time: "All" clears, and re-pressing the active chip clears too.
 */
const DiscoverRail = ({ tags, active, expanded, onSelect, onToggleExpanded }) => {
  const trackRef = useRef(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  // The arrows are an affordance for real overflow only, so they are driven by
  // measurement rather than by the tag count — a short rail on a wide screen
  // shows none, and the same rail on a phone shows both.
  const syncOverflow = useCallback(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const maxScroll = track.scrollWidth - track.clientWidth;
    setOverflow({
      start: track.scrollLeft > 1,
      end: maxScroll > 1 && track.scrollLeft < maxScroll - 1,
    });
  }, []);

  useLayoutEffect(() => {
    syncOverflow();
    window.addEventListener('resize', syncOverflow);
    return () => window.removeEventListener('resize', syncOverflow);
  }, [syncOverflow, tags, expanded]);

  const scrollByStep = (direction) => {
    // The reduced-motion media query kills CSS `scroll-behavior`, but this is a
    // JS argument and would sail straight past it, so honour it by hand.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    trackRef.current?.scrollBy?.({
      left: direction * DISCOVER_SCROLL_STEP,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  // One chip is not a choice, it's a label.
  if (tags.length < 2) {
    return null;
  }

  return (
    <div className="discover-rail" role="group" aria-label="Discover by tag">
      <span className="discover-label">Discover</span>
      <div className="discover-viewport">
        {!expanded && overflow.start && (
          <button
            type="button"
            className="discover-scroll discover-scroll--start"
            aria-label="Scroll tags left"
            onClick={() => scrollByStep(-1)}
          >
            <ChevronLeftIcon />
          </button>
        )}
        <div
          ref={trackRef}
          className={`discover-track${expanded ? ' expanded' : ''}`}
          onScroll={syncOverflow}
        >
          <button
            type="button"
            className={`discover-chip${active === null ? ' active' : ''}`}
            aria-pressed={active === null}
            onClick={() => onSelect(null)}
          >
            All
          </button>
          {tags.map(({ slug, label, count }) => (
            <button
              key={slug}
              type="button"
              className={`discover-chip${active === slug ? ' active' : ''}`}
              aria-pressed={active === slug}
              onClick={() => onSelect(slug)}
            >
              {label}
              <span className="discover-chip-count">{count}</span>
            </button>
          ))}
        </div>
        {!expanded && overflow.end && (
          <button
            type="button"
            className="discover-scroll discover-scroll--end"
            aria-label="Scroll tags right"
            onClick={() => scrollByStep(1)}
          >
            <ChevronRightIcon />
          </button>
        )}
      </div>
      <button type="button" className="discover-see-all" onClick={onToggleExpanded}>
        {expanded ? 'See fewer' : 'See all'}
      </button>
    </div>
  );
};

// Length-tiered so long names (e.g. "KrebsOnSecurity", "Anthropic") shrink to
// fit on one line instead of wrapping mid-word into the subtitle below.
const getSourceNameSizeClass = (name) => {
  if (name.length > 12) {
    return ' fallback-news-image__source--long';
  }
  if (name.length > 7) {
    return ' fallback-news-image__source--medium';
  }
  return '';
};

const FALLBACK_IMAGE_VARIANT_COUNT = 5;

// Deterministic (not Math.random()) so a given article's fallback color stays
// put across re-renders instead of flickering to a new hue each time.
const hashToVariant = (seed, count) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % count;
};

const FallbackNewsImage = ({ site, seed, className = '' }) => {
  const sourceName = formatSiteName(site) || 'Precis';
  const variant = hashToVariant(seed || sourceName, FALLBACK_IMAGE_VARIANT_COUNT);

  return (
    <span
      className={`fallback-news-image fallback-news-image--${variant}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <span className="fallback-news-image__grid" />
      <span className="fallback-news-image__ticker">News Brief</span>
      <span className={`fallback-news-image__source${getSourceNameSizeClass(sourceName)}`}>{sourceName}</span>
      <span className="fallback-news-image__subtitle">Latest updates</span>
    </span>
  );
};

// Renders the fallback graphic whenever there's no image_url, and also falls
// back to it if the real image fails to load (broken link, timed-out fetch
// through the image proxy, etc.) rather than leaving a blank broken-image icon.
const ArticleImage = ({ article, className = '' }) => {
  const [hasError, setHasError] = useState(false);
  const imageUrl = article?.image_url;

  if (!imageUrl || hasError) {
    return (
      <FallbackNewsImage
        site={article?.site}
        seed={article?.url || article?.id || article?.title}
        className={className}
      />
    );
  }

  return (
    <img
      src={proxiedImageUrl(imageUrl)}
      alt=""
      className={className}
      onError={() => setHasError(true)}
    />
  );
};

// The active search terms as one alternation regex, or null when nothing is being
// searched. Passed by context rather than threaded as a prop: highlighting has to
// reach the headline and summary of four different row components plus the lead,
// and none of them otherwise care that a search is running.
const SearchHighlightContext = createContext(null);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildHighlightPattern = (terms) => (
  terms.length > 0 ? new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi') : null
);

// String.split with a single capturing group puts the delimiters at the odd
// indices, which is exactly the alternating plain/matched sequence we want.
const Highlight = ({ text }) => {
  const pattern = useContext(SearchHighlightContext);
  const value = text ?? '';

  if (!pattern || !value) {
    return value;
  }

  return value.split(pattern).map((part, index) => (
    index % 2 === 1
      ? <mark key={`${index}-${part}`} className="search-hit">{part}</mark>
      : part
  ));
};

const SafeArticleTitle = ({ article }) => {
  const articleUrl = safeHttpUrl(article.url);
  const title = <Highlight text={article.title} />;

  if (!articleUrl) {
    return <span>{title}</span>;
  }

  return <a href={articleUrl} target="_blank" rel="noopener noreferrer">{title}</a>;
};

const SaveAffordance = ({ iconOnly = false }) => (
  <button
    type="button"
    className={`save-affordance${iconOnly ? ' save-affordance--icon' : ''}`}
    disabled
    aria-label="Save for later (coming soon)"
  >
    <BookmarkIcon />
    {!iconOnly && <span>Save</span>}
  </button>
);

const BriefRow = ({ article, index }) => {
  const summaryText = getSummaryText(article);

  return (
    <div className="brief-row">
      <span className="brief-rank">{String(index + 1).padStart(2, '0')}</span>
      <span className="brief-thumb" aria-hidden="true">
        <ArticleImage article={article} />
      </span>
      <div className="brief-copy">
        <h4><SafeArticleTitle article={article} /></h4>
        {summaryText && <p><Highlight text={summaryText} /></p>}
        <div className="brief-meta">
          <span>Source: {formatSiteName(article.site)}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{formatRelativeTime(article.published_at)}</span>
        </div>
      </div>
      <SaveAffordance iconOnly />
    </div>
  );
};

const EverythingCard = ({ article }) => {
  const articleUrl = safeHttpUrl(article.url);
  const summaryText = getCardSummaryText(article);
  const image = <ArticleImage article={article} className="everything-card-image" />;

  return (
    <article className="everything-card">
      {articleUrl ? (
        <a href={articleUrl} target="_blank" rel="noopener noreferrer" className="everything-card-image-link" aria-label={`Open ${article.title}`}>
          {image}
        </a>
      ) : (
        <div className="everything-card-image-link" aria-hidden="true">{image}</div>
      )}
      <div className="everything-card-body">
        <div className="everything-card-meta">
          <span className="everything-card-site">Source: {formatSiteName(article.site)}</span>
          {article.topic && <span className="everything-card-topic">{article.topic}</span>}
          <span className="everything-card-date">{formatShortDate(article.published_at)}</span>
        </div>
        <h4><SafeArticleTitle article={article} /></h4>
        {summaryText && <p><Highlight text={summaryText} /></p>}
      </div>
    </article>
  );
};

const SmallListRow = ({ article }) => (
  <li className="small-list-row">
    <h4><SafeArticleTitle article={article} /></h4>
    <span className="small-list-meta">
      <span>Source: {formatSiteName(article.site)}</span>
      <span aria-hidden="true">&middot;</span>
      <span>{formatRelativeTime(article.published_at)}</span>
    </span>
  </li>
);

// Sources are stored as scraper keys ("open_ai") and need their display name.
// Topics and tags already carry a display label from the facet payload — passing
// a tag label back through the slug prettifier would turn "Zero-Day / Exploit"
// into "Zero Day / Exploit", so only a slug with no label ever goes near it.
const formatFacetLabel = (group, row) => (
  group === 'sources' ? formatSiteName(row.slug) : row.label
);

function App() {
  const [articles, setArticles] = useState([]);
  // The day's totals for all three groups, as returned alongside the items. Every
  // other number in the panel is recomputed from the draft; these are only the
  // starting state, and the size shown next to an already-selected facet.
  const [dayFacets, setDayFacets] = useState(null);
  const [applied, setApplied] = useState(() => readFiltersFromUrl());
  const [draft, setDraft] = useState(applied);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [openGroup, setOpenGroup] = useState('tags');
  const [expandedGroups, setExpandedGroups] = useState({});
  // Row ordering is frozen for as long as the panel is open: the counts are
  // recomputed on every draft change, but rows must not move under the cursor.
  const [frozenOrder, setFrozenOrder] = useState(null);
  const [panelAnchor, setPanelAnchor] = useState({ top: 70, right: 20 });
  const [pageSize, setPageSize] = useState(INITIAL_ARTICLE_COUNT);
  const [visibleCount, setVisibleCount] = useState(INITIAL_ARTICLE_COUNT);
  const [everythingViewMode, setEverythingViewMode] = useState(EVERYTHING_VIEW_MODES[0]);
  // The Discover rail's selection: a tag slug, or null for "All". Local to the
  // Everything else section on purpose — it is not part of the filter model and
  // never reaches `applied` or the URL.
  const [discoverTag, setDiscoverTag] = useState(null);
  const [discoverExpanded, setDiscoverExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  // True between first paint (the small FIRST_PAINT_ARTICLE_LIMIT fetch resolving)
  // and the full working set landing. Purely informational — nothing reads it to
  // decide what to render, since every view already works off whatever is
  // currently in `articles`.
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [error, setError] = useState(null);
  // The archive escalation. The header box searches the loaded working set
  // instantly; this is the other ~90% of the corpus, which only the server can
  // reach. Kept in its own state, and rendered in its own section, because the two
  // searches do not have the same semantics — the local one is a substring match
  // over what is on the row, the server one is stemmed full-text over title and
  // summary — so folding them into one count would put a number on screen that
  // neither half can account for.
  const [archive, setArchive] = useState(EMPTY_ARCHIVE);

  const filtersButtonRef = useRef(null);
  const panelRef = useRef(null);
  const initialLoadRef = useRef(true);
  // The panel's own facet-name box. The header search box is headerSearchRef.
  const searchInputRef = useRef(null);
  const headerSearchRef = useRef(null);

  const appliedKey = JSON.stringify(applied);
  const draftKey = JSON.stringify(draft);
  // The facet half of the filter, so the URL effect below can treat a deliberate
  // Apply differently from a keystroke in the search box.
  const appliedFacetsKey = JSON.stringify({ ...applied, query: '' });

  // Applies one /api/articles response to state. Shared by both phases below —
  // the shape (tolerating a bare array for a stale edge cache or older API
  // deployment) and the fields touched are identical either way.
  const applyArticlesResponse = (response) => {
    const payload = response.data;
    const items = Array.isArray(payload) ? payload : (payload?.items ?? []);

    setArticles(items);
    setDayFacets(Array.isArray(payload) ? null : (payload?.facets ?? null));
  };

  // Two requests, not one. The first asks for a small FIRST_PAINT_ARTICLE_LIMIT
  // slice so the page can clear `loading` and paint quickly; the second asks for
  // the full working set right behind it and replaces state again once it lands.
  // Facets and diverse-top selection (which run over `articles`) briefly reflect
  // only the first slice, then settle onto the full set — the same place they'd
  // end up with one blocking request, just not blocking first paint on it.
  const fetchArticles = useCallback(async () => {
    try {
      if (initialLoadRef.current) {
        setLoading(true);
      }

      const firstPaint = await axios.get(buildArticleUrl(FIRST_PAINT_ARTICLE_LIMIT));
      applyArticlesResponse(firstPaint);
      setVisibleCount(pageSize);
      setError(null);
    } catch (err) {
      setError(import.meta.env.DEV
        ? 'Failed to fetch articles. Start the Precis web server, then refresh this page'
        : 'Failed to fetch articles. Check the deployment environment variables and database connection');
      console.error('Error fetching articles:', err);
      initialLoadRef.current = false;
      setLoading(false);
      return;
    }

    initialLoadRef.current = false;
    setLoading(false);

    // Best-effort: the reader already has the first-paint slice on screen, so a
    // failure here is not worth the error page — just leave that slice in place
    // and let a manual refresh try again.
    setBackgroundLoading(true);
    try {
      const fullSet = await axios.get(buildArticleUrl(API_ARTICLE_LIMIT));
      applyArticlesResponse(fullSet);
    } catch (err) {
      console.error('Error fetching the full article working set:', err);
    } finally {
      setBackgroundLoading(false);
    }
  }, [pageSize]);

  // One fetch per load. Filtering, faceting and the predictive Apply label all
  // run over this array, so a count and the rows behind it can never disagree,
  // and ANY/ALL, exclusion and the panel search cost nothing.
  useEffect(() => {
    fetchArticles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Facet changes are discrete and deliberate (an Apply, a chip removal), so the
  // URL follows them immediately.
  useEffect(() => {
    writeFiltersToUrl(applied);
  }, [appliedFacetsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The query is not: it changes on every keystroke, and a replaceState per
  // character is history-API churn for a URL nobody reads mid-word. Both effects
  // write the whole filter, so whichever fires last still writes the truth.
  useEffect(() => {
    const timer = setTimeout(() => writeFiltersToUrl(applied), 200);
    return () => clearTimeout(timer);
  }, [applied.query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escalate to the archive. Debounced harder than the URL write because this one
  // costs a request, and cancelled on every change so a slow response for an
  // abandoned query can never overwrite the results of the current one.
  useEffect(() => {
    const trimmed = applied.query.trim();

    if (trimmed.length < MIN_ARCHIVE_QUERY_LENGTH) {
      setArchive(EMPTY_ARCHIVE);
      return undefined;
    }

    let cancelled = false;
    setArchive((current) => ({ ...current, status: 'loading' }));

    const timer = setTimeout(async () => {
      try {
        const response = await axios.get(buildSearchUrl(applied));
        if (cancelled) {
          return;
        }

        const payload = response.data ?? {};
        setArchive({
          status: 'ready',
          query: trimmed,
          items: Array.isArray(payload.items) ? payload.items : [],
          total: Number(payload.total) || 0,
        });
      } catch (err) {
        if (!cancelled) {
          setArchive({
            status: 'error', query: trimmed, items: [], total: 0,
          });
        }
      }
    }, ARCHIVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [applied.query, appliedFacetsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const appliedTagSlugs = [...applied.tags.in, ...applied.tags.not].join(',');
  const draftTagSlugs = [...draft.tags.in, ...draft.tags.not].join(',');

  // Vocabulary for the three groups, as slug -> { slug, label, count }. It comes
  // from the items actually loaded rather than from the scraper's global tag
  // table, so nothing is listed with a corpus-wide total it cannot deliver. Tags
  // named in the URL but absent from today are folded back in at 0: the user
  // shared that link on purpose and should see why it is empty.
  const vocabulary = useMemo(() => {
    const fromPayload = (facets) => new Map(facets.map((facet) => [facet.slug, { ...facet }]));
    const groups = dayFacets
      ? {
        tags: fromPayload(dayFacets.tags || []),
        sources: fromPayload(dayFacets.sources || []),
        topics: fromPayload(dayFacets.topics || []),
      }
      : buildVocabulary(articles);

    for (const slug of new Set([...applied.tags.in, ...applied.tags.not, ...draft.tags.in, ...draft.tags.not])) {
      if (!groups.tags.has(slug)) {
        groups.tags.set(slug, { slug, label: labelFromTagSlug(slug), count: 0 });
      }
    }

    return groups;
  }, [articles, dayFacets, appliedTagSlugs, draftTagSlugs]);

  const sortedArticles = useMemo(
    () => sortArticlesNewestFirst(filterArticles(articles, applied)),
    [articles, appliedKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const facetRows = useMemo(() => {
    if (!panelOpen) {
      return { tags: [], topics: [], sources: [] };
    }

    const decorate = (group) => computeFacetRows(articles, draft, group, vocabulary)
      .map((row) => ({ ...row, label: formatFacetLabel(group, row) }));

    return { tags: decorate('tags'), topics: decorate('topics'), sources: decorate('sources') };
  }, [panelOpen, articles, draftKey, vocabulary]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderRows = useCallback((group) => {
    const rows = facetRows[group];
    const order = frozenOrder?.[group];

    if (!order) {
      return sortFacetRows(rows);
    }

    const byslug = new Map(rows.map((row) => [row.slug, row]));
    const ordered = order.map((slug) => byslug.get(slug)).filter(Boolean);
    const placed = new Set(order);

    return [...ordered, ...rows.filter((row) => !placed.has(row.slug))];
  }, [facetRows, frozenOrder]);

  // The panel/scrim are portalled to document.body (see render below) so
  // `position: fixed` resolves against the real viewport instead of getting
  // trapped by the header's `backdrop-filter`, which — per spec — makes it a
  // containing block for fixed descendants. Once portalled, the panel has no
  // positioned ancestor to anchor to, so its desktop position is computed
  // here from the Filters button's own rect and applied as CSS custom
  // properties (see .filter-panel's `top`/`right` in App.css).
  const updatePanelAnchor = useCallback(() => {
    const rect = filtersButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setPanelAnchor({ top: rect.bottom + 10, right: window.innerWidth - rect.right });
    }
  }, []);

  const openPanel = useCallback(() => {
    updatePanelAnchor();
    setDraft(applied);
    setPanelQuery('');
    setExpandedGroups({});
    // Capture the row order once, from the draft the panel opens with. It stays
    // put until the panel is reopened, so a click never shuffles the list the
    // cursor is resting on.
    setFrozenOrder(Object.fromEntries(['tags', 'topics', 'sources'].map((group) => [
      group,
      sortFacetRows(computeFacetRows(articles, applied, group, vocabulary)).map((row) => row.slug),
    ])));
    setPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey, articles, vocabulary, updatePanelAnchor]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    filtersButtonRef.current?.focus();
  }, []);

  // Keep the desktop anchor accurate across resize/rotation while open (the
  // header is sticky at top:0, so scroll position doesn't otherwise move it).
  useEffect(() => {
    if (!panelOpen) {
      return undefined;
    }

    window.addEventListener('resize', updatePanelAnchor);
    return () => window.removeEventListener('resize', updatePanelAnchor);
  }, [panelOpen, updatePanelAnchor]);

  const applyPanel = () => {
    setApplied(draft);
    setPanelOpen(false);
    filtersButtonRef.current?.focus();
  };

  const withoutSlug = (list, slug) => list.filter((entry) => entry !== slug);

  // Clicking the row body toggles inclusion. A tag can never be in both lists, so
  // including one drops it from the exclusions.
  const toggleDraftFacet = (group, slug) => {
    setDraft((current) => {
      if (group !== 'tags') {
        const list = current[group];
        return {
          ...current,
          [group]: list.includes(slug) ? withoutSlug(list, slug) : [...list, slug],
        };
      }

      const { in: included, not: excluded } = current.tags;
      return {
        ...current,
        tags: {
          ...current.tags,
          in: included.includes(slug) ? withoutSlug(included, slug) : [...included, slug],
          not: withoutSlug(excluded, slug),
        },
      };
    });
  };

  // The row's − control moves a tag straight to excluded from any state; pressing
  // it again clears the exclusion.
  const toggleDraftExclude = (slug) => {
    setDraft((current) => {
      const { in: included, not: excluded } = current.tags;
      return {
        ...current,
        tags: {
          ...current.tags,
          in: withoutSlug(included, slug),
          not: excluded.includes(slug) ? withoutSlug(excluded, slug) : [...excluded, slug],
        },
      };
    });
  };

  // Bulk controls for the tag group. Selecting every tag is a widening, not a
  // narrowing — tags are OR'd — so it reads as "anything carrying a tag". A tag
  // that is currently excluded is left excluded: exclusion is a deliberate act,
  // and Clear is the control that undoes it.
  const selectAllDraftTags = (slugs) => {
    setDraft((current) => {
      const excluded = new Set(current.tags.not);
      const added = slugs.filter((slug) => !excluded.has(slug) && !current.tags.in.includes(slug));
      return { ...current, tags: { ...current.tags, in: [...current.tags.in, ...added] } };
    });
  };

  const clearDraftTags = () => {
    setDraft((current) => ({ ...current, tags: { in: [], not: [] } }));
  };

  // The date range is not one of the panel's groups — it has its own control in
  // the masthead — so Reset carries it through rather than silently clearing a
  // selection the panel never showed. "Clear all" in the active bar, which does
  // show the range as a chip, is the control that drops it.
  const resetDraft = () => {
    setDraft((current) => ({ ...EMPTY_FILTER, dateRange: current.dateRange }));
    setPanelQuery('');
  };

  const removeApplied = (updater) => {
    setApplied(updater);
    setDraft(updater);
  };

  const handleClearFilters = () => removeApplied(EMPTY_FILTER);

  const clearDateRange = () => {
    handleDateRangeChange(EMPTY_DATE_RANGE);
  };

  const removeSource = (slug) => removeApplied((current) => ({
    ...current,
    sources: withoutSlug(current.sources, slug),
  }));

  const removeTopic = (slug) => removeApplied((current) => ({
    ...current,
    topics: withoutSlug(current.topics, slug),
  }));

  const removeIncludedTag = (slug) => removeApplied((current) => ({
    ...current,
    tags: { ...current.tags, in: withoutSlug(current.tags.in, slug) },
  }));

  const removeExcludedTag = (slug) => removeApplied((current) => ({
    ...current,
    tags: { ...current.tags, not: withoutSlug(current.tags.not, slug) },
  }));

  // The query lives in the filter model, so it goes through the same applied/draft
  // pair as everything else — otherwise reopening the panel would silently drop it.
  // The section below the fold is a different length now, so paging starts over.
  const handleQueryChange = (value) => {
    removeApplied((current) => ({ ...current, query: sanitizeQueryInput(value) }));
    setVisibleCount(pageSize);
  };

  const clearQuery = () => {
    handleQueryChange('');
    headerSearchRef.current?.focus();
  };

  // The range goes through the same applied/draft pair as the query, for the same
  // reason: the panel's counts and its Apply label are computed from the draft, so
  // a range that only reached `applied` would make both of them lie.
  const handleDateRangeChange = (dateRange) => {
    removeApplied((current) => ({ ...current, dateRange }));
    setVisibleCount(pageSize);
  };

  // Every chip in the date bar counts the working set through the whole applied
  // filter with only its own range swapped in, so a chip's number is exactly what
  // the edition becomes when it is clicked — never a day's raw total that the
  // tags and sources already applied would cut down.
  const countForDateRange = useCallback(
    (dateRange) => filterArticles(articles, { ...applied, dateRange }).length,
    [articles, appliedKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const toggleGroup = (group) => setOpenGroup((current) => (current === group ? null : group));

  const toggleGroupExpanded = (group) => setExpandedGroups(
    (current) => ({ ...current, [group]: !current[group] }),
  );

  // Escape closes the panel; focus is trapped inside while it's open and
  // returned to the Filters button on close (handled by closePanel).
  useEffect(() => {
    if (!panelOpen) {
      return undefined;
    }

    const previouslyFocused = document.activeElement;
    searchInputRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }

      const focusable = panelRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused !== document.body) {
        previouslyFocused.focus();
      }
    };
  }, [panelOpen, closePanel]);

  // "/" and ⌘K jump to the search box — the shortcuts readers already expect. Both
  // are ignored while the caret is in another field, so "/" stays a literal slash
  // in the filter panel's own box.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (panelOpen || !event.key) {
        return;
      }

      const { target } = event;
      const isTyping = target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const isShortcut = (event.key === '/' && !isTyping)
        || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey));

      if (isShortcut) {
        event.preventDefault();
        headerSearchRef.current?.focus();
        headerSearchRef.current?.select();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen]);

  const appliedCount = countFilterValues(applied);
  const isSearching = hasQuery(applied);
  const searchTerms = queryTerms(applied.query);
  const highlightPattern = useMemo(() => buildHighlightPattern(searchTerms), [searchTerms]);

  // The Apply label is predictive and exact: it counts the same array, through the
  // same predicate, that the list behind the panel will use. With three tags in
  // ALL mode that is usually zero — and reading "Show 0 briefs" before committing
  // is the whole point.
  const draftResultCount = useMemo(
    () => (panelOpen ? filterArticles(articles, draft).length : 0),
    [panelOpen, articles, draftKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const applyLabel = isFilterEmpty(draft)
    ? `Show all ${articles.length}`
    : `Show ${draftResultCount} brief${draftResultCount === 1 ? '' : 's'}`;

  const panelGroups = [
    {
      key: 'topics', title: 'Topics', rows: orderRows('topics'), cap: FACET_ROW_CAP,
    },
    {
      key: 'sources', title: 'Sources', rows: orderRows('sources'), cap: FACET_ROW_CAP,
    },
    {
      key: 'tags', title: 'Tags', rows: orderRows('tags'), cap: TAG_ROW_CAP,
    },
  ].map((group) => ({
    ...group,
    open: openGroup === group.key,
    expanded: Boolean(expandedGroups[group.key]),
  }));

  // The tier above the fold is one source per slot where the day allows it, so a
  // single publisher's burst can't own the whole edition. Keyed on the byline the
  // reader actually sees, since two stored sites can share one masthead. See
  // pickDiverseTop.
  //
  // A search is not an edition, so it does not get a front page: promoting one hit
  // to a hero and burying the rest under "Previous stories" would be the app making
  // an editorial claim about a list the reader assembled. Under an active query the
  // split collapses and every result goes into one flat, ranked-by-recency list.
  const { top: frontPageArticles, rest: everythingElseAll } = useMemo(
    () => (isSearching
      ? { top: [], rest: sortedArticles }
      : pickDiverseTop(sortedArticles, 1 + BRIEF_COUNT, { keyOf: (article) => formatSiteName(article.site) })),
    [sortedArticles, isSearching],
  );

  const leadArticle = frontPageArticles[0];
  const leadArticleUrl = safeHttpUrl(leadArticle?.url);
  const leadImage = <ArticleImage key={leadArticle?.url} article={leadArticle} />;

  const alsoTodayArticles = frontPageArticles.slice(1);

  // Chips come from the section itself, not from the day's facets, so the rail
  // only ever offers tags that are actually down there to be found.
  const discoverTags = useMemo(() => buildTagRail(everythingElseAll), [everythingElseAll]);

  // The selection can go stale underneath the rail when the page filter changes
  // (an apply, a chip removal). Derive validity instead of clearing it in an
  // effect: no extra render, and a rail whose tag has vanished simply reads
  // "All" rather than showing an empty section.
  const activeDiscoverTag = discoverTags.some(({ slug }) => slug === discoverTag) ? discoverTag : null;

  const everythingElseVisible = activeDiscoverTag
    ? everythingElseAll.filter((article) => articleTagSlugs(article).includes(activeDiscoverTag))
    : everythingElseAll;

  const visibleEverythingElse = Number.isFinite(visibleCount)
    ? everythingElseVisible.slice(0, visibleCount)
    : everythingElseVisible;
  const hasMoreArticles = visibleCount < everythingElseVisible.length;

  // The masthead names the day the reader is looking at, so it follows the date
  // filter: an applied range retitles the edition instead of leaving "today" over
  // a week of briefs. Day keys are UTC, like every other date on the page.
  const editionDateLabel = useMemo(() => {
    const range = resolveDateRange(applied.dateRange);
    const dayFormat = new Intl.DateTimeFormat('en', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
    const spanFormat = new Intl.DateTimeFormat('en', {
      month: 'long', day: 'numeric', timeZone: 'UTC',
    });
    const asDate = (key) => new Date(`${key}T00:00:00.000Z`);

    if (!range) {
      return dayFormat.format(new Date());
    }

    return range.from === range.to
      ? dayFormat.format(asDate(range.from))
      : `${spanFormat.format(asDate(range.from))} – ${spanFormat.format(asDate(range.to))}`;
  }, [applied.dateRange]);

  const activeFilterChips = [];
  if (hasQuery(applied)) {
    const queryLabel = applied.query.trim();
    activeFilterChips.push({
      key: 'query',
      label: `search: ${queryLabel}`,
      onRemove: clearQuery,
    });
  }
  if (hasDateRange(applied)) {
    const rangeLabel = dateRangeChipLabel(applied.dateRange);
    activeFilterChips.push({
      key: 'date',
      label: `date: ${rangeLabel}`,
      onRemove: clearDateRange,
    });
  }
  for (const slug of applied.sources) {
    const sourceLabel = formatSiteName(slug);
    activeFilterChips.push({
      key: `source:${slug}`,
      label: `source: ${sourceLabel}`,
      onRemove: () => removeSource(slug),
    });
  }
  for (const slug of applied.topics) {
    activeFilterChips.push({
      key: `topic:${slug}`,
      label: `topic: ${slug}`,
      onRemove: () => removeTopic(slug),
    });
  }
  for (const slug of applied.tags.in) {
    const tagLabel = vocabulary.tags.get(slug)?.label ?? labelFromTagSlug(slug);
    activeFilterChips.push({
      key: `tag:${slug}`,
      label: `tag: ${tagLabel}`,
      removeLabel: `Remove filter: ${tagLabel}`,
      onRemove: () => removeIncludedTag(slug),
    });
  }
  for (const slug of applied.tags.not) {
    const tagLabel = vocabulary.tags.get(slug)?.label ?? labelFromTagSlug(slug);
    activeFilterChips.push({
      key: `not-tag:${slug}`,
      label: `not tag: ${tagLabel}`,
      removeLabel: `Stop excluding: ${tagLabel}`,
      onRemove: () => removeExcludedTag(slug),
    });
  }

  const editionControls = articles.length > 0 ? (
    <div
      className={`edition-controls${sortedArticles.length > 0 ? '' : ' edition-controls--standalone'}`}
      aria-label="Edition controls"
    >
      <span className="edition-controls-label">Date</span>
      <DateFilterBar
        range={applied.dateRange}
        countFor={countForDateRange}
        onChange={handleDateRangeChange}
      />
      {activeFilterChips.length > 0 && (
        <div className="active-filter-row" aria-label="Active filters">
          <span className="active-filter-row-label">Filtering by</span>
          <div className="active-filter-chips">
            {activeFilterChips.map((chip) => (
              <ActiveFilterChip
                key={chip.key}
                label={chip.label}
                removeLabel={chip.removeLabel}
                onRemove={chip.onRemove}
              />
            ))}
          </div>
          <button type="button" className="active-filter-clear" onClick={handleClearFilters}>
            Clear all
          </button>
        </div>
      )}
    </div>
  ) : null;

  // Anything the edition already showed is dropped rather than repeated lower down
  // the page. The two searches overlap but neither contains the other — the local
  // one matches source names and tags, the server one stems title and summary — so
  // this is a de-duplication, not a subtraction.
  const archiveExtras = useMemo(() => {
    if (archive.status !== 'ready' || archive.query !== applied.query.trim()) {
      return [];
    }

    const shown = new Set(sortedArticles.map((item) => item.url));
    // The date range is the one filter the endpoint could not apply for us, so it
    // is applied here — otherwise a range that narrows the edition to one day
    // would still list the whole archive underneath it.
    return archive.items.filter(
      (item) => !shown.has(item.url) && datePredicate(item, applied.dateRange),
    );
  }, [archive, sortedArticles, applied.query, applied.dateRange]);

  const handleShowMore = () => {
    setVisibleCount((currentCount) => currentCount + pageSize);
  };

  const handlePageSizeChange = (newPageSize) => {
    setPageSize(newPageSize);
    setVisibleCount(newPageSize);
  };

  // Pressing the active chip again is the same as pressing All. Either way the
  // section is a different length now, so paging starts over rather than leaving
  // a count from the previous selection in place.
  const handleDiscoverSelect = (slug) => {
    setDiscoverTag((current) => (current === slug ? null : slug));
    setVisibleCount(pageSize);
  };

  if (loading) {
    return (
      <div className="app app-state">
        <div className="loader-card" aria-live="polite">
          <span className="loader-line" aria-hidden="true"></span>
          <p className="state-kicker">Loading</p>
          <h1>Pulling the latest articles.</h1>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app app-state">
        <div className="message-card">
          <p className="state-kicker">No connection</p>
          <h1>The article list did not load.</h1>
          <p>{error}.</p>
        </div>
      </div>
    );
  }

  // The archive tier. Rendered under the results when the edition had some, and
  // under the empty state when it had none — that second case is the whole point of
  // the endpoint, so it must not be trapped inside the "we found something" branch.
  const archiveQuery = applied.query.trim();
  const archiveSection = isSearching && archive.status !== 'idle' && (
    <section className="everything-else archive-tier" aria-labelledby="archive-title">
      <div className="tier-heading">
        <h3 id="archive-title">More from the archive</h3>
        {archive.status === 'ready' && archive.total > 0 && (
          <span className="tier-count">
            {`${archive.total} brief${archive.total === 1 ? '' : 's'} in the full archive`}
          </span>
        )}
      </div>

      {archive.status === 'loading' && (
        <p className="tier-empty" aria-live="polite">Searching the archive&hellip;</p>
      )}

      {archive.status === 'error' && (
        <p className="tier-empty">The archive could not be reached. Today&rsquo;s briefs are still searchable above.</p>
      )}

      {archive.status === 'ready' && (
        archiveExtras.length > 0 ? (
          <>
            <ul className="small-list">
              {archiveExtras.map((item) => (
                <SmallListRow key={item.url} article={item} />
              ))}
            </ul>
            {archive.total > archiveExtras.length && (
              <p className="article-count">
                Showing the {archiveExtras.length} most relevant of {archive.total}.
              </p>
            )}
          </>
        ) : (
          <p className="tier-empty">
            {archive.total > 0
              ? 'Everything the archive found is already shown above.'
              : `Nothing in the archive mentions “${archiveQuery}” either.`}
          </p>
        )
      )}
    </section>
  );

  return (
    <SearchHighlightContext.Provider value={highlightPattern}>
    <div className="app">
      <header className="site-header" id="top">
        <a className="brand" href="#top" aria-label="Precis home">
          <span>PRÉCIS</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="#top" className="site-nav-link active">Today</a>
          <a href="/trending" className="site-nav-link">Trending</a>
        </nav>
        <div className="site-header-actions">
          <ThemeToggle />
          <label className="header-search">
            <SearchIcon />
            <input
              ref={headerSearchRef}
              type="search"
              // The working set, not the filtered list: a placeholder that counted
              // down as the reader typed would be describing its own effect.
              placeholder={`Search ${articles.length} briefs`}
              value={applied.query}
              maxLength={MAX_QUERY_LENGTH}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck="false"
              aria-label="Search briefs by headline, summary, tag, source or topic"
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && applied.query) {
                  event.preventDefault();
                  clearQuery();
                }
              }}
            />
          </label>
          <div className="filters-anchor">
            <button
              ref={filtersButtonRef}
              type="button"
              id="filters"
              className="filters-button"
              aria-expanded={panelOpen}
              aria-controls="filters-panel"
              onClick={openPanel}
            >
              <SlidersIcon />
              <span>Filters</span>
              {appliedCount > 0 && <span className="filters-button-count">{appliedCount}</span>}
            </button>

            {panelOpen && createPortal(
              <>
                <div className="filter-scrim" onClick={closePanel} aria-hidden="true" />
                <FilterPanel
                  panelRef={panelRef}
                  searchInputRef={searchInputRef}
                  titleId="filters-panel-title"
                  anchorStyle={{ '--filter-panel-top': `${panelAnchor.top}px`, '--filter-panel-right': `${panelAnchor.right}px` }}
                  groups={panelGroups}
                  query={panelQuery}
                  onQueryChange={setPanelQuery}
                  onToggleGroup={toggleGroup}
                  onToggleExpanded={toggleGroupExpanded}
                  onToggleFacet={toggleDraftFacet}
                  onToggleExclude={toggleDraftExclude}
                  onSelectAllTags={selectAllDraftTags}
                  onClearTags={clearDraftTags}
                  onReset={resetDraft}
                  onApply={applyPanel}
                  onCancel={closePanel}
                  applyLabel={applyLabel}
                />
              </>,
              document.body
            )}
          </div>
        </div>
      </header>

      {/* Outside the results branch on purpose: the masthead stays visible even
          when filters empty the list, so readers still know which edition they
          are changing. The date filter itself is rendered with the tag controls
          below, where the filtering controls live. */}
      {articles.length > 0 && (
        <>
          <section className="masthead" aria-labelledby="masthead-title">
            <div className="masthead-head">
              <p className="masthead-kicker">Daily tech brief</p>
              <h1 id="masthead-title" className="masthead-date">{editionDateLabel}</h1>
            </div>
          </section>

          <div className="section-divider" aria-hidden="true"></div>
        </>
      )}

      {sortedArticles.length > 0 ? (
        <>
          <div className="edition-main">
            {leadArticle && (
              <article className="lead-story">
                <div className="lead-media">
                  {leadArticleUrl ? (
                    <a href={leadArticleUrl} target="_blank" rel="noopener noreferrer" className="lead-image-link" aria-label={`Open ${leadArticle.title}`}>
                      {leadImage}
                    </a>
                  ) : (
                    <div className="lead-image-link" aria-hidden="true">{leadImage}</div>
                  )}
                </div>
                <div className="lead-copy">
                  <div className="lead-meta">                   
                    <span className="lead-byline">Source: {formatSiteName(leadArticle.site)} &middot; {formatRelativeTime(leadArticle.published_at)}</span>
                  </div>
                  <h2 className="lead-headline"><SafeArticleTitle article={leadArticle} /></h2>
                  {getLeadSummaryText(leadArticle) && (
                    <p className="lead-summary"><Highlight text={getLeadSummaryText(leadArticle)} /></p>
                  )}
                  <div className="lead-actions">
                    {leadArticleUrl && (
                      <a className="btn-secondary" href={leadArticleUrl} target="_blank" rel="noopener noreferrer">
                        Read at {formatSiteName(leadArticle.site)}
                      </a>
                    )}
                    <SaveAffordance />
                  </div>
                </div>
              </article>
            )}

            {alsoTodayArticles.length > 0 && (
              <section className="also-today" aria-labelledby="also-today-title">
                <div className="tier-heading">
                  <h3 id="also-today-title">Previous stories</h3>
                </div>
                <div className="brief-list">
                  {alsoTodayArticles.map((article, index) => (
                    <BriefRow key={article.url} article={article} index={index} />
                  ))}
                </div>
              </section>
            )}

            <section className="everything-else" aria-labelledby="everything-else-title">
              <div className="tier-heading">
                <h3 id="everything-else-title">{isSearching ? 'Results' : 'Everything else'}</h3>
                <span className="tier-count">
                  {isSearching
                    ? `${everythingElseVisible.length} brief${everythingElseVisible.length === 1 ? ' mentions' : 's mention'} “${applied.query.trim()}”`
                    : `${everythingElseVisible.length} items`}
                </span>
                {everythingElseAll.length > 0 && (
                  <div className="tier-controls">
                    <PageSizeSelect value={pageSize} onChange={handlePageSizeChange} />
                    <ViewModeToggle value={everythingViewMode} onChange={setEverythingViewMode} />
                  </div>
                )}
              </div>
              {everythingElseAll.length > 0 && (
                <DiscoverRail
                  tags={discoverTags}
                  active={activeDiscoverTag}
                  expanded={discoverExpanded}
                  onSelect={handleDiscoverSelect}
                  onToggleExpanded={() => setDiscoverExpanded((current) => !current)}
                />
              )}
              {editionControls}
              {everythingElseAll.length > 0 ? (
                <>
                  {everythingViewMode === 'cards' && (
                    <div className="everything-grid">
                      {visibleEverythingElse.map((article) => (
                        <EverythingCard key={article.url} article={article} />
                      ))}
                    </div>
                  )}
                  {everythingViewMode === 'list' && (
                    <div className="brief-list">
                      {visibleEverythingElse.map((article, index) => (
                        <BriefRow key={article.url} article={article} index={index} />
                      ))}
                    </div>
                  )}
                  {everythingViewMode === 'small-list' && (
                    <ul className="small-list">
                      {visibleEverythingElse.map((article) => (
                        <SmallListRow key={article.url} article={article} />
                      ))}
                    </ul>
                  )}
                  {hasMoreArticles && (
                    <div className="show-more-inline">
                      <button type="button" className="show-more-link" onClick={handleShowMore}>
                        Show {Math.min(pageSize, everythingElseVisible.length - visibleEverythingElse.length)} more &rarr;
                      </button>
                      <p className="article-count">
                        Showing {visibleEverythingElse.length} of {everythingElseVisible.length} items
                        {backgroundLoading ? ' — more loading…' : ''}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="tier-empty">Nothing else yet.</p>
              )}
            </section>

            {archiveSection}
          </div>
        </>
      ) : (
        <>
          {editionControls}
        <section className="empty-state">
          {isSearching ? (
            <>
              {/* Scoped to today's edition, because the archive tier below may well
                  have found the story. Claiming "no briefs mention this" while
                  listing briefs that mention it would be the page arguing with
                  itself. */}
              <p className="state-kicker">No matches</p>
              <h2>Nothing in today&rsquo;s edition mentions &ldquo;{applied.query.trim()}&rdquo;.</h2>
              <p className="empty-state-description">
                Searched {articles.length} brief{articles.length === 1 ? '' : 's'}
                {appliedCount > 0 ? ' within the filters you have applied' : ''}
                {archiveExtras.length > 0 ? '. The archive found more, below' : ''}.
              </p>
              <button type="button" className="empty-state-back" onClick={clearQuery}>
                Clear search
              </button>
            </>
          ) : !isFilterEmpty(applied) ? (
            <>
              {/* Never a blank region: the combination is what came up empty, and
                  the panel still opens and still lists every facet, most at 0. */}
              <p className="state-kicker">No matches</p>
              <h2>
                {appliedCount > 0
                  ? 'Nothing matches this combination.'
                  : 'No briefs were published in that range.'}
              </h2>
              <button type="button" className="empty-state-back" onClick={handleClearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="state-kicker">Nothing here yet</p>
              <h2>No captured articles.</h2>
              <p className="empty-state-description">Run the scraper and refresh this page.</p>
            </>
          )}
        </section>
        {archiveSection && <div className="edition-main">{archiveSection}</div>}
        </>
      )}
      <SiteFooter />
    </div>
    </SearchHighlightContext.Provider>
  );
}

export default App;
