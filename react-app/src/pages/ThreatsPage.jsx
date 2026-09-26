import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import SiteFooter from '../components/SiteFooter.jsx';
import TldrArt from '../components/TldrArt.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { buildHighlightPattern, formatRelativeTime, safeHttpUrl } from '../App.jsx';
import { CloseIcon, SearchIcon } from '../icons.jsx';
import { THREAT_SITES, formatSiteName } from '../sources';
import useRevealOnScroll from '../useRevealOnScroll.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://localhost:5000' : '');

// Every threat feed is fetched as one set and split into tabs in the browser, so a
// tab switch is instant and each tab's count is right from first paint. Pages are
// fetched one after another until the set is complete, as on the front page.
const PAGE_LIMIT = 250;
const RENDER_STEP = 48;
const TYPE_TAG = 'Cyber Security';

// `sites: null` is every threat feed. `slug` is the tab's form in the URL
// (?feed=exploits), and the first tab is the absence of the parameter.
const TABS = [
  { slug: 'all', title: 'All', sites: null },
  { slug: 'exploits', title: 'Exploits', sites: ['sploitus'] },
  { slug: 'advisories', title: 'CVE advisories', sites: ['oss_security'] },
];

const buildThreatsUrl = (offset) => (
  `${API_BASE_URL}/api/articles?site=${THREAT_SITES.join(',')}&limit=${PAGE_LIMIT}&offset=${offset}`
);

const articleKey = (article) => `${article.site} ${article.url}`;

const MAX_QUERY_LENGTH = 200;

// Every word must appear somewhere in the item -- title, summary, tag or source --
// so "linux kernel" narrows rather than widens, as a CVE hunt expects.
const searchTermsOf = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);

const haystackOf = (article) => [
  article.title,
  article.summary || article.excerpt,
  ...(Array.isArray(article.tags) ? article.tags : []),
  formatSiteName(article.site),
].filter(Boolean).join(' ').toLowerCase();

const matchesTerms = (article, terms) => {
  if (terms.length === 0) return true;
  const haystack = haystackOf(article);
  return terms.every((term) => haystack.includes(term));
};

// Same markup as the front page's highlight, so .search-hit styles it.
const highlight = (text, pattern) => {
  if (!pattern || !text) return text;
  return text.split(pattern).map((part, index) => (
    index % 2 === 1 ? <mark key={`${index}-${part}`} className="search-hit">{part}</mark> : part
  ));
};

// Sploitus prefixes every summary with its page's "Description" heading.
const summaryOf = (article) => (
  (article.summary || article.excerpt || '').replace(/\s+/g, ' ').replace(/^Description\s+/i, '').trim()
);

const proxiedImageUrl = (imageUrl) => {
  const safe = safeHttpUrl(imageUrl);
  return safe ? `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(safe)}` : '';
};

// The source's image when it has one, generated art otherwise -- the same rule as
// the TL;DR page, so the two lists read as one family.
const ThreatCover = ({ article }) => {
  const [failed, setFailed] = useState(false);
  const src = proxiedImageUrl(article.image_url);
  const item = { article_url: article.url, title: article.title, tags: article.tags };

  if (!src || failed) {
    return <TldrArt item={item} topic={TYPE_TAG} />;
  }

  return (
    <div className="tldr-art tldr-art--photo">
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </div>
  );
};

const ThreatItem = ({ article, pattern }) => {
  const url = safeHttpUrl(article.url);
  const summary = summaryOf(article);
  const tag = Array.isArray(article.tags) ? article.tags[0] : null;

  return (
    <li className="tldr-item">
      {url ? (
        <a className="tldr-item-art" href={url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
          <ThreatCover article={article} />
        </a>
      ) : (
        <div className="tldr-item-art" aria-hidden="true"><ThreatCover article={article} /></div>
      )}
      <div className="tldr-item-body">
        <p className="tldr-item-text">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">{highlight(article.title, pattern)}</a>
          ) : highlight(article.title, pattern)}
        </p>
        <p className="tldr-item-meta">
          {summary && <span>{highlight(summary, pattern)}</span>}
        </p>
        <p className="tldr-item-meta">
          <span>{formatSiteName(article.site)}</span>
          <span aria-hidden="true"> &middot; </span>
          <span>{formatRelativeTime(article.published_at || article.fetched_at)}</span>
          {tag && (
            <>
              <span aria-hidden="true"> &middot; </span>
              <span>{tag}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
};

const ThreatsPage = () => {
  const [articles, setArticles] = useState([]);
  const [status, setStatus] = useState('loading');
  const [shown, setShown] = useState(RENDER_STEP);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef({});

  const activeTab = TABS.find((tab) => tab.slug === searchParams.get('feed')) ?? TABS[0];
  const query = searchParams.get('q') ?? '';
  const terms = useMemo(() => searchTermsOf(query), [query]);
  const pattern = useMemo(() => buildHighlightPattern(terms), [terms]);
  const matching = useMemo(
    () => articles.filter((article) => matchesTerms(article, terms)),
    [articles, terms],
  );
  // Tab counts follow the search, so they say where the matches are.
  const inTab = (tab) => (
    tab.sites ? matching.filter((article) => tab.sites.includes(article.site)) : matching
  );
  const visible = inTab(activeTab);
  const listRef = useRevealOnScroll([activeTab.slug, visible.length, shown, query]);

  // Both live in the URL so a filtered view can be shared; replace, not push, so
  // typing and tab switches don't fill the back button's history.
  const updateParams = (changes) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value); else next.delete(key);
    });
    setSearchParams(next, { replace: true });
    setShown(RENDER_STEP);
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const seen = new Set();
      let offset = 0;

      try {
        while (offset !== null && !cancelled) {
          // Sequential by design: each page is small and the set is complete in a
          // few requests, well inside RATE_LIMITS.articles.
          // eslint-disable-next-line no-await-in-loop
          const response = await axios.get(buildThreatsUrl(offset));
          const page = (response.data?.items || []).filter((article) => {
            const key = articleKey(article);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          if (cancelled) return;
          setArticles((current) => [...current, ...page]);
          setStatus('ready');
          offset = response.data?.next_offset ?? null;
        }
      } catch {
        // A later page failing leaves what already loaded on screen.
        if (!cancelled && seen.size === 0) {
          setStatus('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const selectTab = (tab) => updateParams({ feed: tab === TABS[0] ? null : tab.slug });

  // Arrow keys move between tabs and follow focus, per the WAI-ARIA tabs pattern.
  const handleTabKeyDown = (event) => {
    const index = TABS.indexOf(activeTab);
    const nextIndex = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    }[event.key];

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    const next = TABS[nextIndex];
    selectTab(next);
    tabRefs.current[next.slug]?.focus();
  };

  return (
    <div className="trending-page tldr-page threats-page">
      <header className="site-header" id="top">
        <Link className="brand" to="/" aria-label="Precis home">
          <span>PR&Eacute;CIS</span>
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link to="/" className="site-nav-link">Today</Link>
          <Link to="/tldr" className="site-nav-link">TL;DR</Link>
          <Link to="/trending" className="site-nav-link">Trending</Link>
          <span className="site-nav-link active" aria-current="page">Threats</span>
        </nav>
        <div className="site-header-actions">
          <ThemeToggle />
        </div>
      </header>

      <main className="trending-main tldr-main">
        <section className="trend-masthead">
          <p className="masthead-kicker">Exploits and CVE disclosures</p>
          <h1 className="trend-title">Threats</h1>
        </section>

        <div className="tldr-controls">
          <div className="segmented-tabs" role="tablist" aria-label="Threat feed" onKeyDown={handleTabKeyDown}>
            {TABS.map((tab) => {
              const selected = tab === activeTab;
              const count = inTab(tab).length;

              return (
                <button
                  key={tab.slug}
                  ref={(node) => { tabRefs.current[tab.slug] = node; }}
                  type="button"
                  role="tab"
                  id={`threats-tab-${tab.slug}`}
                  className="segmented-tab"
                  aria-selected={selected}
                  aria-controls="threats-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab)}
                >
                  {tab.title}
                  {status === 'ready' && count > 0 && (
                    <span className="segmented-tab-count" aria-label={`${count} items`}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="threats-search" role="search">
            <label className="header-search">
              <SearchIcon />
              <input
                type="search"
                placeholder={status === 'ready' ? `Search ${articles.length} threats` : 'Search threats'}
                value={query}
                maxLength={MAX_QUERY_LENGTH}
                enterKeyHint="search"
                autoComplete="off"
                spellCheck="false"
                aria-label="Search threats by title, summary, tag or source"
                onChange={(event) => updateParams({ q: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') updateParams({ q: null });
                }}
              />
            </label>
            {query && (
              <button type="button" className="header-search-close" aria-label="Clear search" onClick={() => updateParams({ q: null })}>
                <CloseIcon />
              </button>
            )}
          </div>
        </div>

        {status === 'loading' && <p className="trend-note">Loading threats&hellip;</p>}
        {status === 'error' && (
          <p className="trend-note trend-note--error">
            Could not load the threat feeds. Is the API running?
          </p>
        )}
        {status === 'ready' && (
          <section
            className="tldr-section"
            role="tabpanel"
            id="threats-panel"
            aria-labelledby={`threats-tab-${activeTab.slug}`}
          >
            {visible.length === 0 && (
              <p className="tldr-note">
                {query
                  ? `No ${activeTab === TABS[0] ? 'threats' : activeTab.title.toLowerCase()} match "${query}".`
                  : `Nothing from ${activeTab.title.toLowerCase()} yet.`}
              </p>
            )}
            {query && visible.length > 0 && (
              <p className="tldr-generated-at" aria-live="polite">
                {visible.length} match{visible.length === 1 ? '' : 'es'} for &ldquo;{query}&rdquo;
              </p>
            )}
            {visible.length > 0 && (
              <ol className="tldr-list tldr-list--list" ref={listRef}>
                {visible.slice(0, shown).map((article) => (
                  <ThreatItem key={articleKey(article)} article={article} pattern={pattern} />
                ))}
              </ol>
            )}
            {visible.length > shown && (
              <div className="show-more-inline">
                <button type="button" className="show-more-link" onClick={() => setShown((n) => n + RENDER_STEP)}>
                  Show more ({visible.length - shown} left)
                </button>
              </div>
            )}
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
};

export default ThreatsPage;
