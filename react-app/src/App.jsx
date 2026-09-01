import './App.css';
import { useState, useEffect, useMemo, useCallback } from 'react';
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

const readFiltersFromUrl = () => {
  if (typeof window === 'undefined') {
    return { site: '', topic: DEFAULT_TOPIC };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    site: params.get('source') || '',
    topic: params.has('topic') ? params.get('topic') : DEFAULT_TOPIC,
  };
};

const writeFiltersToUrl = (site, topic) => {
  if (typeof window === 'undefined') {
    return;
  }

  const params = new URLSearchParams(window.location.search);

  if (site) {
    params.set('source', site);
  } else {
    params.delete('source');
  }

  if (topic) {
    params.set('topic', topic);
  } else {
    params.delete('topic');
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', nextUrl);
};

const buildArticleUrl = (site = '', topic = '') => {
  const path = site ? `/api/articles/${encodeURIComponent(site)}` : '/api/articles';
  const params = new URLSearchParams();

  if (topic) {
    params.set('topic', topic);
  }

  params.set('limit', String(API_ARTICLE_LIMIT));
  params.set('offset', '0');

  const query = params.toString();
  return `${API_BASE_URL}${path}${query ? `?${query}` : ''}`;
};

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
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

function App() {
  const [articles, setArticles] = useState([]);
  const [sites, setSites] = useState([]);
  const [topics, setTopics] = useState([]);
  const [selectedSite, setSelectedSite] = useState(() => readFiltersFromUrl().site);
  const [selectedTopic, setSelectedTopic] = useState(() => readFiltersFromUrl().topic);
  const [pageSize, setPageSize] = useState(INITIAL_ARTICLE_COUNT);
  const [visibleCount, setVisibleCount] = useState(INITIAL_ARTICLE_COUNT);
  const [everythingViewMode, setEverythingViewMode] = useState(EVERYTHING_VIEW_MODES[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchArticles = useCallback(async (site = '', topic = '') => {
    try {
      setLoading(true);
      const response = await axios.get(buildArticleUrl(site, topic));

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

  // Sites available for the current topic filter (independent of the site
  // filter itself, so picking a topic narrows the source chips to only the
  // sources that actually cover it).
  const fetchSitesForTopic = useCallback(async (topic) => {
    try {
      const params = topic ? `?topic=${encodeURIComponent(topic)}` : '';
      const response = await axios.get(`${API_BASE_URL}/api/sites${params}`);
      setSites(response.data);
      return response.data;
    } catch (err) {
      console.error('Error fetching sites:', err);
      return [];
    }
  }, []);

  // Topics available for the current source filter, mirroring the above.
  const fetchTopicsForSite = useCallback(async (site) => {
    try {
      const params = site ? `?site=${encodeURIComponent(site)}` : '';
      const response = await axios.get(`${API_BASE_URL}/api/topics${params}`);
      setTopics(response.data);
      return response.data;
    } catch (err) {
      console.error('Error fetching topics:', err);
      return [];
    }
  }, []);

  // Single source of truth for actually fetching the edition: reacts to both
  // filters, so it also "self-heals" a moment later if the validity effects
  // below reset an incompatible selection.
  useEffect(() => {
    fetchArticles(selectedSite, selectedTopic);
    writeFiltersToUrl(selectedSite, selectedTopic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, selectedTopic]);

  useEffect(() => {
    fetchSitesForTopic(selectedTopic).then((availableSites) => {
      if (selectedSite && !availableSites.includes(selectedSite)) {
        setSelectedSite('');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic, fetchSitesForTopic]);

  useEffect(() => {
    fetchTopicsForSite(selectedSite).then((availableTopics) => {
      if (selectedTopic && !availableTopics.includes(selectedTopic)) {
        setSelectedTopic('');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, fetchTopicsForSite]);

  const handleSourceFilterClick = (site) => {
    setSelectedSite(site);
  };

  const handleTopicFilterClick = (topic) => {
    setSelectedTopic(topic);
  };

  const handleClearFilters = () => {
    setSelectedSite('');
    setSelectedTopic('');
  };

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

  const sourceCountForMeta = sites.length || sourceCounts.length;
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
          <a href="#filters" className="site-nav-link">Sources</a>
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
        </div>
      </header>

      {sortedArticles.length > 0 ? (
        <>
          <section className="masthead" aria-labelledby="masthead-title">
            <div className="masthead-head">
              <p className="masthead-kicker">Daily tech brief</p>
              <h1 id="masthead-title" className="masthead-date">{editionDateLabel}</h1>
              <p className="masthead-meta">{metaLine}</p>
            </div>
          </section>

          {(sites.length > 0 || topics.length > 0) && (
            <nav id="filters" className="filter-bar" aria-label="Article filters">
              {topics.length > 0 && (
                <div className="filter-group">
                  <span className="filter-group-label">Topic</span>
                  <div className="filter-chip-row">
                    <button
                      type="button"
                      className={`filter-chip${selectedTopic === '' ? ' active' : ''}`}
                      onClick={() => handleTopicFilterClick('')}
                    >
                      All
                    </button>
                    {topics.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        className={`filter-chip${selectedTopic === topic ? ' active' : ''}`}
                        onClick={() => handleTopicFilterClick(topic)}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sites.length > 0 && topics.length > 0 && <span className="filter-divider" aria-hidden="true" />}

              {sites.length > 0 && (
                <div className="filter-group">
                  <span className="filter-group-label">Source</span>
                  <div className="filter-chip-row">
                    <button
                      type="button"
                      className={`filter-chip${selectedSite === '' ? ' active' : ''}`}
                      onClick={() => handleSourceFilterClick('')}
                    >
                      All {sites.length}
                    </button>
                    {sites.map((site) => (
                      <button
                        key={site}
                        type="button"
                        className={`filter-chip${selectedSite === site ? ' active' : ''}`}
                        onClick={() => handleSourceFilterClick(site)}
                      >
                        {formatSiteName(site)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </nav>
          )}

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
                    <span className="tag-outline">Lead</span>
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
          {(selectedSite || selectedTopic) && (
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
