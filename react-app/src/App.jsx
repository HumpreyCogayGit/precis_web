import './App.css';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');
const INITIAL_ARTICLE_COUNT = 12;
const API_ARTICLE_LIMIT = 100;
const BRIEF_COUNT = 5;
const DEFAULT_TOPIC = 'AI';
const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];
const EVERYTHING_VIEW_MODES = ['cards', 'list', 'small-list'];

const proxiedImageUrl = (imageUrl) => (
  imageUrl ? `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}` : ''
);

const SOURCE_DISPLAY_NAMES = {
  alibaba: 'Alibaba Cloud',
  anthropic_news: 'Anthropic',
  google_innovation_ai: 'Google AI',
  krebs_on_security: 'KrebsOnSecurity',
  microsoft_ai_blog: 'Microsoft AI',
  nvidia: 'NVIDIA',
  open_ai: 'OpenAI',
  open_ai_releases: 'OpenAI',
  perplexity_blog: 'Perplexity',
  together_ai_blog: 'Together AI',
  x_ai_news: 'xAI',
};

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

// Matches an explicit time-of-day (e.g. "14:47" or "T09:00"). Date-only strings
// (no time component) are ambiguous: JS parses them as the viewer's local time,
// which makes ordering depend on each visitor's timezone rather than the
// article's actual date. Pin those to UTC midnight so sorting is deterministic.
const HAS_TIME_COMPONENT = /\d{1,2}:\d{2}/;

const parseDateTimestamp = (dateValue) => {
  if (!dateValue) {
    return 0;
  }

  const normalizedDate = String(dateValue).trim().replace(/^Published\s+/i, '');
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

const getArticleTimestamp = (article) => {
  return parseDateTimestamp(article.published_at);
};

const sortArticlesNewestFirst = (articles) => (
  [...articles].sort((a, b) => {
    const timestampDelta = getArticleTimestamp(b) - getArticleTimestamp(a);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return parseDateTimestamp(b.fetched_at) - parseDateTimestamp(a.fetched_at);
  })
);

const formatSiteName = (site = '') => {
  const normalizedSite = String(site).trim().toLowerCase();

  if (SOURCE_DISPLAY_NAMES[normalizedSite]) {
    return SOURCE_DISPLAY_NAMES[normalizedSite];
  }

  return String(site)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAi\b/g, 'AI');
};

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

const formatRelativeTime = (dateValue) => {
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

const EMPTY_FILTERS = { topics: [], sources: [] };

const parseCommaList = (value) => (
  value ? [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))] : []
);

const readFiltersFromUrl = () => {
  if (typeof window === 'undefined') {
    return { topics: [DEFAULT_TOPIC], sources: [] };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    topics: params.has('topic') ? parseCommaList(params.get('topic')) : [DEFAULT_TOPIC],
    sources: parseCommaList(params.get('source')),
  };
};

const writeFiltersToUrl = ({ topics, sources }) => {
  if (typeof window === 'undefined') {
    return;
  }

  const params = new URLSearchParams(window.location.search);

  if (sources.length > 0) {
    params.set('source', sources.join(','));
  } else {
    params.delete('source');
  }

  if (topics.length > 0) {
    params.set('topic', topics.join(','));
  } else {
    params.delete('topic');
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', nextUrl);
};

const buildFilterParams = ({ topics, sources }) => {
  const params = new URLSearchParams();

  if (sources.length > 0) {
    params.set('site', sources.join(','));
  }

  if (topics.length > 0) {
    params.set('topic', topics.join(','));
  }

  return params;
};

const buildArticleUrl = (filters) => {
  const params = buildFilterParams(filters);
  params.set('limit', String(API_ARTICLE_LIMIT));
  params.set('offset', '0');

  return `${API_BASE_URL}/api/articles?${params.toString()}`;
};

const buildArticleCountUrl = (filters) => (
  `${API_BASE_URL}/api/article-count?${buildFilterParams(filters).toString()}`
);

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

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

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
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

const FallbackNewsImage = ({ site, className = '' }) => {
  const sourceName = formatSiteName(site) || 'Precis';

  return (
    <span className={`fallback-news-image${className ? ` ${className}` : ''}`} aria-hidden="true">
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
    return <FallbackNewsImage site={article?.site} className={className} />;
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

const SafeArticleTitle = ({ article }) => {
  const articleUrl = safeHttpUrl(article.url);

  if (!articleUrl) {
    return <span>{article.title}</span>;
  }

  return <a href={articleUrl} target="_blank" rel="noopener noreferrer">{article.title}</a>;
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
        {summaryText && <p>{summaryText}</p>}
        <div className="brief-meta">
          <span>{formatSiteName(article.site)}</span>
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
          <span className="everything-card-site">{formatSiteName(article.site)}</span>
          {article.topic && <span className="everything-card-topic">{article.topic}</span>}
          <span className="everything-card-date">{formatShortDate(article.published_at)}</span>
        </div>
        <h4><SafeArticleTitle article={article} /></h4>
        {summaryText && <p>{summaryText}</p>}
      </div>
    </article>
  );
};

const SmallListRow = ({ article }) => (
  <li className="small-list-row">
    <h4><SafeArticleTitle article={article} /></h4>
    <span className="small-list-meta">
      <span>{formatSiteName(article.site)}</span>
      <span aria-hidden="true">&middot;</span>
      <span>{formatRelativeTime(article.published_at)}</span>
    </span>
  </li>
);

const FACET_ROW_CAP = 5;

const filterFacetsByQuery = (facets, q) => {
  if (!q) {
    return facets;
  }

  const lowerQuery = q.toLowerCase();
  return facets.filter((facet) => facet.name.toLowerCase().includes(lowerQuery));
};

const formatFacetLabel = (group, name) => (group === 'sources' ? formatSiteName(name) : name);

const FilterChip = ({ label, onRemove, removeLabel }) => (
  <button type="button" className="filter-active-chip" onClick={onRemove} aria-label={removeLabel}>
    <span>{label}</span>
    <span className="filter-active-chip-remove" aria-hidden="true"><CloseIcon /></span>
  </button>
);

const FacetGroupRows = ({ group, title, facets, query, expanded, onToggleExpanded, selected, onToggleFacet, topBorder }) => {
  if (facets.length === 0) {
    return null;
  }

  const visible = filterFacetsByQuery(facets, query);
  const isSearching = query.trim().length > 0;
  const rows = isSearching || expanded ? visible : visible.slice(0, FACET_ROW_CAP);
  const hasCap = !isSearching && visible.length > FACET_ROW_CAP;

  return (
    <div className={`filter-panel-group${topBorder ? ' filter-panel-group--rule' : ''}`}>
      <div className="filter-panel-group-head">{title} &middot; {facets.length}</div>
      {rows.map((facet) => {
        const checked = selected.includes(facet.name);
        return (
          <label key={facet.name} className="filter-panel-row">
            <span className="filter-panel-row-main">
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => onToggleFacet(group, facet.name)}
              />
              <span className={`filter-panel-checkbox${checked ? ' checked' : ''}`} aria-hidden="true" />
              <span>{formatFacetLabel(group, facet.name)}</span>
            </span>
            <span className="filter-panel-count">{facet.count}</span>
          </label>
        );
      })}
      {hasCap && (
        <button type="button" className="filter-panel-show-all" onClick={onToggleExpanded}>
          {expanded ? 'Show fewer' : `Show all ${visible.length}`}
        </button>
      )}
    </div>
  );
};

const FilterPanel = ({
  panelRef,
  searchInputRef,
  titleId,
  anchorStyle,
  draft,
  topicFacets,
  sourceFacets,
  query,
  onQueryChange,
  topicsExpanded,
  sourcesExpanded,
  onToggleTopicsExpanded,
  onToggleSourcesExpanded,
  onToggleFacet,
  onReset,
  onApply,
  onCancel,
  applyLabel,
}) => {
  const isSearching = query.trim().length > 0;
  const visibleTopics = filterFacetsByQuery(topicFacets, query);
  const visibleSources = filterFacetsByQuery(sourceFacets, query);
  const noMatches = isSearching && visibleTopics.length === 0 && visibleSources.length === 0
    && (topicFacets.length > 0 || sourceFacets.length > 0);

  return (
    <div
      ref={panelRef}
      id="filters-panel"
      className="filter-panel"
      style={anchorStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
      aria-labelledby={titleId}
    >
      <span className="filter-panel-mark filter-panel-mark--tl" aria-hidden="true" />
      <span className="filter-panel-mark filter-panel-mark--tr" aria-hidden="true" />
      <span className="filter-panel-mark filter-panel-mark--bl" aria-hidden="true" />
      <span className="filter-panel-mark filter-panel-mark--br" aria-hidden="true" />
      <span className="filter-panel-grab" aria-hidden="true" />
      <div className="filter-panel-head">
        <div className="filter-panel-head-row">
          <h2 id={titleId} className="filter-panel-title">Filters</h2>
          <button type="button" className="filter-panel-reset" onClick={onReset}>Reset</button>
        </div>
        <label className="filter-panel-search">
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find a source or topic"
            aria-label="Find a source or topic"
          />
        </label>
      </div>

      <div className="filter-panel-body">
        {noMatches ? (
          <p className="filter-panel-no-matches">No source or topic matches that.</p>
        ) : (
          <>
            <FacetGroupRows
              group="topics"
              title="Topics"
              facets={topicFacets}
              query={query}
              expanded={topicsExpanded}
              onToggleExpanded={onToggleTopicsExpanded}
              selected={draft.topics}
              onToggleFacet={onToggleFacet}
            />
            <FacetGroupRows
              group="sources"
              title="Sources"
              facets={sourceFacets}
              query={query}
              expanded={sourcesExpanded}
              onToggleExpanded={onToggleSourcesExpanded}
              selected={draft.sources}
              onToggleFacet={onToggleFacet}
              topBorder
            />
          </>
        )}
      </div>

      <div className="filter-panel-footer">
        <button type="button" className="filter-panel-apply" onClick={onApply}>{applyLabel}</button>
        <button type="button" className="filter-panel-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

function App() {
  const [articles, setArticles] = useState([]);
  const [topicFacets, setTopicFacets] = useState([]);
  const [sourceFacets, setSourceFacets] = useState([]);
  const [applied, setApplied] = useState(() => readFiltersFromUrl());
  const [draft, setDraft] = useState(applied);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [draftResultCount, setDraftResultCount] = useState(null);
  const [panelAnchor, setPanelAnchor] = useState({ top: 70, right: 20 });
  const [pageSize, setPageSize] = useState(INITIAL_ARTICLE_COUNT);
  const [visibleCount, setVisibleCount] = useState(INITIAL_ARTICLE_COUNT);
  const [everythingViewMode, setEverythingViewMode] = useState(EVERYTHING_VIEW_MODES[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const filtersButtonRef = useRef(null);
  const panelRef = useRef(null);
  const searchInputRef = useRef(null);

  const appliedTopicsKey = applied.topics.join(',');
  const appliedSourcesKey = applied.sources.join(',');
  const draftTopicsKey = draft.topics.join(',');
  const draftSourcesKey = draft.sources.join(',');

  const fetchArticles = useCallback(async (filters) => {
    try {
      setLoading(true);
      const response = await axios.get(buildArticleUrl(filters));

      setArticles(response.data);
      setVisibleCount(pageSize);
      setError(null);
    } catch (err) {
      setError(import.meta.env.DEV
        ? 'Failed to fetch articles. Start the Precis web server, then refresh this page'
        : 'Failed to fetch articles. Check the deployment environment variables and database connection');
      console.error('Error fetching articles:', err);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  // Sources available for the applied topic filter (independent of the source
  // filter itself, so picking topics narrows the source list to only the
  // sources that actually cover them). Counts come from the server so they
  // reflect the full table, not just the currently loaded page of articles.
  const fetchSourceFacets = useCallback(async (topics) => {
    try {
      const params = topics.length ? `?topic=${encodeURIComponent(topics.join(','))}` : '';
      const response = await axios.get(`${API_BASE_URL}/api/sites${params}`);
      setSourceFacets(response.data);
      return response.data;
    } catch (err) {
      console.error('Error fetching sites:', err);
      return [];
    }
  }, []);

  // Topics available for the applied source filter, mirroring the above.
  const fetchTopicFacets = useCallback(async (sources) => {
    try {
      const params = sources.length ? `?site=${encodeURIComponent(sources.join(','))}` : '';
      const response = await axios.get(`${API_BASE_URL}/api/topics${params}`);
      setTopicFacets(response.data);
      return response.data;
    } catch (err) {
      console.error('Error fetching topics:', err);
      return [];
    }
  }, []);

  // Single source of truth for actually fetching the edition: reacts to the
  // applied filters, so it also "self-heals" a moment later if the validity
  // effects below prune an incompatible selection.
  useEffect(() => {
    fetchArticles(applied);
    writeFiltersToUrl(applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedTopicsKey, appliedSourcesKey]);

  useEffect(() => {
    fetchSourceFacets(applied.topics).then((availableSources) => {
      const availableNames = new Set(availableSources.map((facet) => facet.name));
      setApplied((current) => {
        const pruned = current.sources.filter((source) => availableNames.has(source));
        return pruned.length === current.sources.length ? current : { ...current, sources: pruned };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedTopicsKey, fetchSourceFacets]);

  useEffect(() => {
    fetchTopicFacets(applied.sources).then((availableTopics) => {
      const availableNames = new Set(availableTopics.map((facet) => facet.name));
      setApplied((current) => {
        const pruned = current.topics.filter((topic) => availableNames.has(topic));
        return pruned.length === current.topics.length ? current : { ...current, topics: pruned };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSourcesKey, fetchTopicFacets]);

  // Live "Show N results" / "Show all N" label on the panel's Apply button —
  // debounced so rapid checkbox clicks don't fire a request per click.
  useEffect(() => {
    if (!panelOpen) {
      return undefined;
    }

    setDraftResultCount(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await axios.get(buildArticleCountUrl(draft));
        if (!cancelled) {
          setDraftResultCount(response.data.count);
        }
      } catch (err) {
        console.error('Error counting articles:', err);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, draftTopicsKey, draftSourcesKey]);

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
    setTopicsExpanded(false);
    setSourcesExpanded(false);
    setPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedTopicsKey, appliedSourcesKey, updatePanelAnchor]);

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

  const toggleDraftFacet = (group, name) => {
    setDraft((current) => {
      const list = current[group];
      const next = list.includes(name) ? list.filter((entry) => entry !== name) : [...list, name];
      return { ...current, [group]: next };
    });
  };

  const resetDraft = () => {
    setDraft({ ...EMPTY_FILTERS });
    setPanelQuery('');
  };

  const removeAppliedFacet = (group, name) => {
    setApplied((current) => ({ ...current, [group]: current[group].filter((entry) => entry !== name) }));
    setDraft((current) => ({ ...current, [group]: current[group].filter((entry) => entry !== name) }));
  };

  const handleClearFilters = () => {
    setApplied({ ...EMPTY_FILTERS });
    setDraft({ ...EMPTY_FILTERS });
  };

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

  const appliedCount = applied.topics.length + applied.sources.length;
  const isDraftEmpty = draft.topics.length === 0 && draft.sources.length === 0;
  const applyLabel = draftResultCount === null
    ? 'Show results'
    : (isDraftEmpty ? `Show all ${draftResultCount}` : `Show ${draftResultCount} results`);

  const sortedArticles = useMemo(
    () => sortArticlesNewestFirst(articles),
    [articles]
  );

  const leadArticle = sortedArticles[0];
  const leadArticleUrl = safeHttpUrl(leadArticle?.url);
  const leadImage = <ArticleImage key={leadArticle?.url} article={leadArticle} />;

  const alsoTodayArticles = sortedArticles.slice(1, 1 + BRIEF_COUNT);
  const everythingElseAll = sortedArticles.slice(1 + BRIEF_COUNT);
  const visibleEverythingElse = Number.isFinite(visibleCount)
    ? everythingElseAll.slice(0, visibleCount)
    : everythingElseAll;
  const hasMoreArticles = visibleCount < everythingElseAll.length;

  const sourceCounts = useMemo(() => {
    const counts = new Map();
    sortedArticles.forEach((article) => {
      const key = article.site || 'unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sortedArticles]);

  const lastScrapeTimestamp = useMemo(
    () => sortedArticles.reduce((max, article) => Math.max(max, parseDateTimestamp(article.fetched_at)), 0),
    [sortedArticles]
  );
  const lastScrapeLabel = lastScrapeTimestamp
    ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(lastScrapeTimestamp))
    : null;

  const editionDateLabel = useMemo(
    () => new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()),
    []
  );

  const sourceCountForMeta = sourceFacets.length || sourceCounts.length;
  const metaLine = [
    `${sortedArticles.length} item${sortedArticles.length === 1 ? '' : 's'} from ${sourceCountForMeta} source${sourceCountForMeta === 1 ? '' : 's'}`,
    lastScrapeLabel ? `last scrape ${lastScrapeLabel}` : null,
  ].filter(Boolean).join(' · ');

  const handleShowMore = () => {
    setVisibleCount((currentCount) => currentCount + pageSize);
  };

  const handlePageSizeChange = (newPageSize) => {
    setPageSize(newPageSize);
    setVisibleCount(newPageSize);
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

  return (
    <div className="app">
      <header className="site-header" id="top">
        <a className="brand" href="#top" aria-label="Precis home">
          <span>PRECIS</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="#top" className="site-nav-link active">Today</a>
          <a
            href="#filters"
            className="site-nav-link"
            onClick={(event) => { event.preventDefault(); openPanel(); }}
          >
            Sources
          </a>
          <span className="site-nav-link site-nav-link--soon" aria-disabled="true">Archive</span>
          <span className="site-nav-link site-nav-link--soon" aria-disabled="true">Saved</span>
        </nav>
        <div className="site-header-actions">
          <label className="header-search">
            <SearchIcon />
            <input
              type="search"
              placeholder={`Search ${sortedArticles.length} briefs`}
              disabled
              aria-label="Search briefs (coming soon)"
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
                  draft={draft}
                  topicFacets={topicFacets}
                  sourceFacets={sourceFacets}
                  query={panelQuery}
                  onQueryChange={setPanelQuery}
                  topicsExpanded={topicsExpanded}
                  sourcesExpanded={sourcesExpanded}
                  onToggleTopicsExpanded={() => setTopicsExpanded((current) => !current)}
                  onToggleSourcesExpanded={() => setSourcesExpanded((current) => !current)}
                  onToggleFacet={toggleDraftFacet}
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

      {appliedCount > 0 && (
        <div className="filter-active-bar">
          <span className="filter-active-label">Filtering by</span>
          {applied.topics.map((topic) => (
            <FilterChip
              key={`topic-${topic}`}
              label={topic}
              removeLabel={`Remove filter: ${topic}`}
              onRemove={() => removeAppliedFacet('topics', topic)}
            />
          ))}
          {applied.sources.map((source) => (
            <FilterChip
              key={`source-${source}`}
              label={formatSiteName(source)}
              removeLabel={`Remove filter: ${formatSiteName(source)}`}
              onRemove={() => removeAppliedFacet('sources', source)}
            />
          ))}
          <button type="button" className="filter-active-clear" onClick={handleClearFilters}>Clear all</button>
        </div>
      )}

      {sortedArticles.length > 0 ? (
        <>
          <section className="masthead" aria-labelledby="masthead-title">
            <div className="masthead-head">
              <p className="masthead-kicker">Daily tech brief</p>
              <h1 id="masthead-title" className="masthead-date">{editionDateLabel}</h1>
              <p className="masthead-meta">{metaLine}</p>
            </div>
          </section>

          <div className="section-divider" aria-hidden="true"></div>

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
                    <span className="lead-byline">{formatSiteName(leadArticle.site)} &middot; {formatRelativeTime(leadArticle.published_at)}</span>
                  </div>
                  <h2 className="lead-headline"><SafeArticleTitle article={leadArticle} /></h2>
                  {getLeadSummaryText(leadArticle) && <p className="lead-summary">{getLeadSummaryText(leadArticle)}</p>}
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
                <h3 id="everything-else-title">Everything else</h3>
                <span className="tier-count">{everythingElseAll.length} items</span>
                {everythingElseAll.length > 0 && (
                  <div className="tier-controls">
                    <PageSizeSelect value={pageSize} onChange={handlePageSizeChange} />
                    <ViewModeToggle value={everythingViewMode} onChange={setEverythingViewMode} />
                  </div>
                )}
              </div>
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
                        Show {Math.min(pageSize, everythingElseAll.length - visibleEverythingElse.length)} more &rarr;
                      </button>
                      <p className="article-count">
                        Showing {visibleEverythingElse.length} of {everythingElseAll.length} items
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="tier-empty">Nothing else yet.</p>
              )}
            </section>
          </div>
        </>
      ) : (
        <section className="empty-state">
          <p className="state-kicker">Nothing here yet</p>
          <h2>No captured articles for this filter.</h2>
          <p className="empty-state-description">Choose another source or topic, or run the scraper and refresh this page.</p>
          {appliedCount > 0 && (
            <button type="button" className="empty-state-back" onClick={handleClearFilters}>
              &larr; Back to all sources
            </button>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
