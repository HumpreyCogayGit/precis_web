import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import SiteFooter from '../components/SiteFooter.jsx';
import HalloweenDecor from '../components/HalloweenDecor.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import ThreatCover from '../components/ThreatCover.jsx';
import {
  ArticleCoverContext, BriefRow, EVERYTHING_VIEW_MODES, EverythingCard, SearchHighlightContext,
  SmallListRow, ViewModeToggle, buildCardLayout, buildHighlightPattern,
} from '../App.jsx';
import { CloseIcon, SearchIcon } from '../icons.jsx';
import { articleTimestamp } from '../filters';
import { formatSiteName } from '../sources';
import useRevealOnScroll from '../useRevealOnScroll.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://localhost:5000' : '');

// Each tab's feeds are fetched as their own set, all tabs at once, and merged in the
// browser, so a tab switch is instant. One set for every feed used to be paged newest
// first, which left the CVE tab empty until the last of ~16 pages arrived (oss-security
// is the oldest feed) and empty for good if any page in between failed.
const PAGE_LIMIT = 250;
const RENDER_STEP = 48;

// `sites: null` is every threat feed. `slug` is the tab's form in the URL
// (?feed=exploits), and the first tab is the absence of the parameter. `noun` is
// what the empty and no-match messages call the tab's items.
const TABS = [
  { slug: 'all', title: 'All', noun: 'threats', sites: null },
  { slug: 'cves', title: 'CVE', noun: 'CVEs', sites: ['oss_security'] },
  { slug: 'exploits', title: 'Exploits', noun: 'exploits', sites: ['sploitus', 'exploit_db'] },
  { slug: 'advisories', title: 'Advisories', noun: 'advisories', sites: ['github_advisories', 'zero_day_initiative', 'full_disclosure'] },
];

const FEED_GROUPS = TABS.filter((tab) => tab.sites).map((tab) => tab.sites);

const buildThreatsUrl = (sites, offset) => (
  `${API_BASE_URL}/api/articles?site=${sites.join(',')}&limit=${PAGE_LIMIT}&offset=${offset}`
);

const articleKey = (article) => `${article.site} ${article.url}`;

// The API sorts each set newest first; the merged All tab is re-sorted by the same
// timestamp the rows print (published_at, falling back to fetched_at).
const newestFirst = (articles) => [...articles].sort((a, b) => articleTimestamp(b) - articleTimestamp(a));

const MAX_QUERY_LENGTH = 200;

// Every word must appear somewhere in the item -- title, summary, tag or source --
// so "linux kernel" narrows rather than widens, as a CVE hunt expects.
const searchTermsOf = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);

// The threat details count too, so "critical" or "ingress-nginx" finds items whose
// headline never says so.
const haystackOf = (article) => {
  const threat = article.threat || {};
  return [
    article.title,
    article.summary || article.excerpt,
    ...(Array.isArray(article.tags) ? article.tags : []),
    formatSiteName(article.site),
    ...(Array.isArray(threat.cves) ? threat.cves : []),
    ...(Array.isArray(threat.products) ? threat.products : []),
    threat.severity,
    threat.github,
  ].filter(Boolean).join(' ').toLowerCase();
};

// Every cover on this page is a threat card; see components/ThreatCover.jsx.
const renderThreatCover = (article, className) => <ThreatCover article={article} className={className} />;

const matchesTerms = (article, terms) => {
  if (terms.length === 0) return true;
  const haystack = haystackOf(article);
  return terms.every((term) => haystack.includes(term));
};

// Sploitus prefixes every summary with its page's "Description" heading. Cleaned
// once on load, so every layout and the search see the same text.
const cleanSummary = (article) => ({
  ...article,
  summary: (article.summary || '').replace(/\s+/g, ' ').replace(/^Description\s+/i, '').trim() || null,
});

// A reading preference rather than a place, so it lives in localStorage like the
// TL;DR page's layout, not in the URL like the tab and search do.
const VIEW_STORAGE_KEY = 'precis:threats-view';
// A list scans faster than cards when hunting through CVEs, so this page opens on it
// (the front page opens on cards).
const DEFAULT_VIEW = 'list';

const readStoredView = () => {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return EVERYTHING_VIEW_MODES.includes(stored) ? stored : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
};

const ThreatsPage = () => {
  const [articles, setArticles] = useState([]);
  const [status, setStatus] = useState('loading');
  const [shown, setShown] = useState(RENDER_STEP);
  const [view, setView] = useState(readStoredView);
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
  const page = visible.slice(0, shown);
  const listRef = useRevealOnScroll([view, activeTab.slug, visible.length, shown, query]);

  const selectView = (nextView) => {
    setView(nextView);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    } catch {
      // Storage blocked (private mode, disabled site data): the choice just won't persist.
    }
  };

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

    const seen = new Set();

    const loadGroup = async (sites) => {
      let offset = 0;
      while (offset !== null && !cancelled) {
        // Sequential within a set: each page is small and the sets together are
        // complete in a few requests, well inside RATE_LIMITS.articles.
        // eslint-disable-next-line no-await-in-loop
        const response = await axios.get(buildThreatsUrl(sites, offset));
        const fresh = (response.data?.items || []).filter((article) => {
          const key = articleKey(article);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(cleanSummary);

        if (cancelled) return;
        setArticles((current) => newestFirst([...current, ...fresh]));
        setStatus('ready');
        offset = response.data?.next_offset ?? null;
      }
    };

    // A page failing leaves what already loaded on screen, from that set and the others.
    Promise.allSettled(FEED_GROUPS.map(loadGroup)).then(() => {
      if (!cancelled && seen.size === 0) {
        setStatus((current) => (current === 'ready' ? current : 'error'));
      }
    });

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

          <ViewModeToggle value={view} onChange={selectView} label="Threats layout" />
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
                  ? `No ${activeTab.noun} match "${query}".`
                  : `No ${activeTab.noun} yet.`}
              </p>
            )}
            {query && visible.length > 0 && (
              <p className="tldr-generated-at" aria-live="polite">
                {visible.length} match{visible.length === 1 ? '' : 'es'} for &ldquo;{query}&rdquo;
              </p>
            )}
            <ArticleCoverContext.Provider value={renderThreatCover}>
              <SearchHighlightContext.Provider value={pattern}>
                {page.length > 0 && view === 'cards' && (
                  <div className="everything-grid" ref={listRef}>
                    {buildCardLayout(page).map(({ article, feature, trioEnd }) => (
                      <EverythingCard key={articleKey(article)} article={article} feature={feature} trioEnd={trioEnd} />
                    ))}
                  </div>
                )}
                {page.length > 0 && view === 'list' && (
                  <div className="brief-list">
                    {page.map((article, index) => (
                      <BriefRow key={articleKey(article)} article={article} index={index} />
                    ))}
                  </div>
                )}
                {page.length > 0 && view === 'small-list' && (
                  <ul className="small-list">
                    {page.map((article) => (
                      <SmallListRow key={articleKey(article)} article={article} />
                    ))}
                  </ul>
                )}
              </SearchHighlightContext.Provider>
            </ArticleCoverContext.Provider>
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
      <HalloweenDecor />
    </div>
  );
};

export default ThreatsPage;
