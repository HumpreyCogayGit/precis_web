import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import FilterPanel from '../FilterPanel.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { formatRelativeTime } from '../App.jsx';
import { formatSiteName } from '../sources';
import {
  FACET_ROW_CAP,
  TAG_ROW_CAP,
  filtersToSearchParams,
  readFiltersFromSearch,
  sortFacetRows,
} from '../filters';
import {
  DEFAULT_MIN_SOURCES,
  MAX_MIN_SOURCES,
  buildEntityVocabulary,
  computeEntityFacetRows,
  countTrendFilterValues,
  filterEntities,
  hasExternalScore,
  minSourcesOf,
  readTrendFilterFromSearch,
  trendFilterToSearchParams,
} from '../trendFilters';
// App.jsx's SlidersIcon is module-local; TuneIcon in icons.jsx is the shared one.
import { TuneIcon } from '../icons.jsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://localhost:5000' : '');

const GROUPS = ['topics', 'sources', 'tags'];

// What the reader is told about a score, and what they are deliberately not.
//
// trend_leaderboard's own comment is unambiguous: trending_score is a RANK, not a
// measurement -- the scoring engine marks SCORE_REFERENCE_CEILING as PROVISIONAL and
// states only relative ordering is reliable. So this page shows position, momentum and
// distinct-source count, and never renders the raw 0-100 as if it meant something on
// its own.
const MOMENTUM_LABELS = {
  surging: { text: 'Surging', tone: 'up' },
  rising: { text: 'Rising', tone: 'up' },
  steady: { text: 'Steady', tone: 'flat' },
  fading: { text: 'Fading', tone: 'down' },
  insufficient_data: { text: 'Too early to tell', tone: 'muted' },
  first_observation: { text: 'First sighting', tone: 'muted' },
};

const momentumOf = (entity) => MOMENTUM_LABELS[entity.momentum_label]
  ?? (entity.momentum_label ? { text: entity.momentum_label, tone: 'muted' } : null);

const TrendArticleRow = ({ article }) => (
  <li className="trend-article">
    <a className="trend-article-link" href={article.url} target="_blank" rel="noopener noreferrer">
      {article.title}
    </a>
    <span className="trend-article-meta">
      <span className="trend-article-site">Source: {formatSiteName(article.site)}</span>
      <span aria-hidden="true"> &middot; </span>
      <span>{formatRelativeTime(article.published_at)}</span>
      {article.is_representative && (
        // The headline the extractor turned into the discovery query. Marking it is
        // the cheapest guard against the failure the trend_evidence view exists to
        // catch: a representative drawn from a roundup that mentions the entity once.
        <span className="trend-article-flag" title="This headline became the discovery query">
          lead
        </span>
      )}
    </span>
  </li>
);

const TrendRow = ({ entity, expanded, onToggle }) => {
  const momentum = momentumOf(entity);
  const panelId = `trend-detail-${entity.candidate_key}`;
  const unscored = !hasExternalScore(entity);

  return (
    <li className="trend-row">
      <button
        type="button"
        className="trend-row-head"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onToggle(entity.candidate_key)}
      >
        <span className="trend-rank" aria-hidden="true">{entity.rank}</span>
        <span className="trend-row-main">
          <span className="trend-entity">{entity.entity || entity.discovery_query}</span>
          {entity.representative_title && (
            <span className="trend-headline">{entity.representative_title}</span>
          )}
          <span className="trend-badges">
            <span className="trend-badge trend-badge--sources">
              {entity.srcs} {entity.srcs === 1 ? 'outlet' : 'outlets'}
            </span>
            {momentum && (
              <span className={`trend-badge trend-badge--${momentum.tone}`}>{momentum.text}</span>
            )}
            {/* An unscored or failed candidate still ranks on lift and source count.
                It must render as itself rather than being hidden or wearing an empty
                badge -- "not scored yet" is information, not an error. */}
            {unscored && <span className="trend-badge trend-badge--muted">Not scored yet</span>}
          </span>
        </span>
        <span className="trend-row-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="trend-detail" id={panelId}>
          <p className="trend-query">
            <span className="trend-query-label">Discovery query</span>
            <span className="trend-query-value">{entity.discovery_query}</span>
          </p>
          <p className="trend-detail-count">
            {entity.articles.length === 0
              ? 'No published articles are attached to this entity.'
              : `${entity.articles.length} ${entity.articles.length === 1 ? 'page' : 'pages'} across ${entity.srcs} ${entity.srcs === 1 ? 'outlet' : 'outlets'}`}
          </p>
          <ul className="trend-articles">
            {entity.articles.map((article) => (
              <TrendArticleRow key={article.url} article={article} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
};

const TrendingPage = () => {
  const [entities, setEntities] = useState([]);
  const [status, setStatus] = useState('loading');
  const [expanded, setExpanded] = useState(() => new Set());
  const [searchParams, setSearchParams] = useSearchParams();

  // The applied/draft split, written a second time rather than shared. Lifting it out
  // of App.jsx into a hook would mean editing the home page, and the whole point of
  // this page is that it costs the home page nothing. PLAN-B calls this cost out and
  // accepts it; if it should be shared, extract useFilterState as its own change with
  // the front-page tests as the guard.
  const [applied, setApplied] = useState(
    () => readTrendFilterFromSearch(window.location.search, readFiltersFromSearch),
  );
  const [draft, setDraft] = useState(applied);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelQuery, setPanelQuery] = useState('');
  const [openGroups, setOpenGroups] = useState({ topics: true, sources: true, tags: false });
  const [expandedGroups, setExpandedGroups] = useState({});
  const [frozenOrder, setFrozenOrder] = useState(null);
  const [panelAnchor, setPanelAnchor] = useState({ top: 96, right: 24 });
  const filtersButtonRef = useRef(null);
  const panelRef = useRef(null);
  const searchInputRef = useRef(null);

  const appliedKey = JSON.stringify(applied);
  const draftKey = JSON.stringify(draft);

  // One fetch, one working set. Everything below filters in the browser, so a facet
  // count and the rows behind it are computed from the same array and cannot disagree.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/trending`);
        if (!cancelled) {
          setEntities(Array.isArray(response.data) ? response.data : []);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSearchParams(trendFilterToSearchParams(applied, filtersToSearchParams), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const visible = useMemo(
    () => filterEntities(entities, applied),
    [entities, appliedKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Built over every loaded entity, not the filtered slice: the panel has to hold
  // every row any draft could reach, or deselecting would have nothing to select back.
  const vocabulary = useMemo(() => buildEntityVocabulary(entities), [entities]);

  const facetRows = useMemo(() => {
    if (!panelOpen) {
      return { topics: [], sources: [], tags: [] };
    }

    return Object.fromEntries(GROUPS.map((group) => [
      group,
      computeEntityFacetRows(entities, draft, group, vocabulary),
    ]));
  }, [panelOpen, entities, draftKey, vocabulary]); // eslint-disable-line react-hooks/exhaustive-deps

  // Order is frozen while the panel is open so a click never shuffles the list the
  // cursor is resting on -- same rule as the home page.
  const orderRows = useCallback((group) => {
    const rows = facetRows[group] ?? [];
    const order = frozenOrder?.[group];

    if (!order) {
      return sortFacetRows(rows);
    }

    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    const placed = new Set(order);

    return [
      ...order.map((slug) => bySlug.get(slug)).filter(Boolean),
      ...rows.filter((row) => !placed.has(row.slug)),
    ];
  }, [facetRows, frozenOrder]);

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
    setFrozenOrder(Object.fromEntries(GROUPS.map((group) => [
      group,
      sortFacetRows(computeEntityFacetRows(entities, applied, group, vocabulary)).map((row) => row.slug),
    ])));
    setPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey, entities, vocabulary, updatePanelAnchor]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    filtersButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!panelOpen) {
      return undefined;
    }

    window.addEventListener('resize', updatePanelAnchor);
    return () => window.removeEventListener('resize', updatePanelAnchor);
  }, [panelOpen, updatePanelAnchor]);

  const withoutSlug = (list, slug) => list.filter((entry) => entry !== slug);

  const toggleDraftFacet = (group, slug) => {
    setDraft((current) => {
      if (group !== 'tags') {
        const list = current[group];
        return { ...current, [group]: list.includes(slug) ? withoutSlug(list, slug) : [...list, slug] };
      }

      const { in: included, not: excluded } = current.tags;
      return {
        ...current,
        tags: {
          in: included.includes(slug) ? withoutSlug(included, slug) : [...included, slug],
          not: withoutSlug(excluded, slug),
        },
      };
    });
  };

  // Exclusion and inclusion are mutually exclusive states of one row, so each drops
  // the slug from the other list.
  const toggleDraftExclude = (slug) => {
    setDraft((current) => {
      const { in: included, not: excluded } = current.tags;
      return {
        ...current,
        tags: {
          in: withoutSlug(included, slug),
          not: excluded.includes(slug) ? withoutSlug(excluded, slug) : [...excluded, slug],
        },
      };
    });
  };

  const selectAllDraftTags = (slugs) => setDraft((current) => ({
    ...current,
    tags: { in: [...new Set([...current.tags.in, ...slugs])], not: current.tags.not.filter((slug) => !slugs.includes(slug)) },
  }));

  const clearDraftTags = () => setDraft((current) => ({ ...current, tags: { in: [], not: [] } }));

  // Reset clears the facets but keeps minSources: it is a standing preference about
  // what counts as a story, not a selection the reader made in this panel.
  const resetDraft = () => setDraft((current) => ({
    ...current, sources: [], topics: [], tags: { in: [], not: [] },
  }));

  const applyPanel = () => {
    setApplied(draft);
    setPanelOpen(false);
    filtersButtonRef.current?.focus();
  };

  const setMinSources = (value) => setApplied((current) => ({ ...current, minSources: value }));

  const clearAll = () => {
    const cleared = {
      ...applied, sources: [], topics: [], tags: { in: [], not: [] }, minSources: DEFAULT_MIN_SOURCES,
    };
    setApplied(cleared);
    setDraft(cleared);
  };

  const toggleExpanded = (key) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(key)) {
      next.add(key);
    }
    return next;
  });

  const appliedCount = countTrendFilterValues(applied);
  const draftCount = countTrendFilterValues(draft);
  const minSources = minSourcesOf(applied);

  const panelGroups = [
    { key: 'topics', title: 'Topics', rows: orderRows('topics'), cap: FACET_ROW_CAP },
    { key: 'sources', title: 'Sources', rows: orderRows('sources'), cap: FACET_ROW_CAP },
    { key: 'tags', title: 'Tags', rows: orderRows('tags'), cap: TAG_ROW_CAP },
  ].map((group) => ({
    ...group,
    open: Boolean(openGroups[group.key]),
    expanded: Boolean(expandedGroups[group.key]),
  }));

  return (
    <div className="trending-page">
      <header className="site-header" id="top">
        <Link className="brand" to="/" aria-label="Precis home">
          <span>PR&Eacute;CIS</span>
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link to="/" className="site-nav-link">Today</Link>
          <span className="site-nav-link active" aria-current="page">Trending</span>
        </nav>
        <div className="site-header-actions">
          <ThemeToggle />
          <button
            type="button"
            ref={filtersButtonRef}
            className="filters-button"
            aria-expanded={panelOpen}
            aria-controls="filters-panel"
            onClick={openPanel}
          >
            <TuneIcon />
            <span>Filters</span>
            {appliedCount > 0 && <span className="filters-button-count">{appliedCount}</span>}
          </button>

          {panelOpen && createPortal(
              <>
                <div className="filter-scrim" onClick={closePanel} aria-hidden="true" />
                <FilterPanel
                  panelRef={panelRef}
                  searchInputRef={searchInputRef}
                  titleId="trending-filters-title"
                  anchorStyle={{
                    '--filter-panel-top': `${panelAnchor.top}px`,
                    '--filter-panel-right': `${panelAnchor.right}px`,
                  }}
                  groups={panelGroups}
                  query={panelQuery}
                  onQueryChange={setPanelQuery}
                  onToggleGroup={(key) => setOpenGroups((c) => ({ ...c, [key]: !c[key] }))}
                  onToggleExpanded={(key) => setExpandedGroups((c) => ({ ...c, [key]: !c[key] }))}
                  onToggleFacet={toggleDraftFacet}
                  onToggleExclude={toggleDraftExclude}
                  onSelectAllTags={selectAllDraftTags}
                  onClearTags={clearDraftTags}
                  onReset={resetDraft}
                  onApply={applyPanel}
                  onCancel={closePanel}
                  applyLabel={draftCount === 0 ? 'Show all' : `Show ${filterEntities(entities, draft).length}`}
                />
              </>,
              document.body,
            )}
        </div>
      </header>

      <main className="trending-main">
        <section className="trend-masthead">
          <p className="masthead-kicker">Most talked about</p>
          <h1 className="trend-title">Trending</h1>
        </section>

        <div className="trend-controls">
          <label className="trend-slider">
            <span className="trend-slider-label">
              Covered by at least <strong>{minSources}</strong> {minSources === 1 ? 'outlet' : 'outlets'}
            </span>
            <input
              type="range"
              min="1"
              max={MAX_MIN_SOURCES}
              step="1"
              value={minSources}
              onChange={(event) => setMinSources(Number(event.target.value))}
            />
          </label>
          <span className="trend-count">
            {visible.length} of {entities.length} shown
          </span>
          {appliedCount > 0 && (
            <button type="button" className="trend-clear" onClick={clearAll}>Clear all</button>
          )}
        </div>

        {status === 'loading' && <p className="trend-note">Loading trending entities&hellip;</p>}
        {status === 'error' && (
          <p className="trend-note trend-note--error">
            Could not load trending entities. Is the API running?
          </p>
        )}
        {status === 'ready' && visible.length === 0 && (
          <p className="trend-note">
            Nothing matches those filters. Try lowering the outlet threshold or clearing a facet.
          </p>
        )}

        <ol className="trend-list">
          {visible.map((entity) => (
            <TrendRow
              key={entity.candidate_key}
              entity={entity}
              expanded={expanded.has(entity.candidate_key)}
              onToggle={toggleExpanded}
            />
          ))}
        </ol>
      </main>
      <SiteFooter />
    </div>
  );
};

export default TrendingPage;
