import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import SiteFooter from '../components/SiteFooter.jsx';
import TldrArt from '../components/TldrArt.jsx';
import TldrExportDialog from '../components/TldrExportDialog.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { buildCardLayout, formatRelativeTime, safeHttpUrl } from '../App.jsx';
import { formatSiteName } from '../sources';
import {
  DocumentIcon, GridIcon, ListIcon, RowsIcon,
} from '../icons.jsx';
import { buildFacebookPost, downloadTextFile, exportFileName } from '../tldrExport.js';
import useRevealOnScroll from '../useRevealOnScroll.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://localhost:5000' : '');

// Matches blogscraper/taxonomy.py TOPICS -- the only two subjects a digest exists
// for. Order here decides the order the tabs render in, and the first is the
// default. `slug` is the tab's form in the URL (?topic=cyber-security), so a link
// to one tab survives a share or a refresh.
const SECTIONS = [
  { topic: 'AI', title: 'AI', slug: 'ai' },
  { topic: 'Cyber Security', title: 'Cyber Security', slug: 'cyber-security' },
];

const itemsOf = (digest) => (Array.isArray(digest?.items) ? digest.items : []);

// Layout of the digest list. A reading preference rather than a place, so it lives
// in localStorage and not in the URL like the tab does -- a shared ?topic link opens
// in the recipient's own layout. Array order is button order only; the default is
// named separately.
const VIEWS = [
  { id: 'grid', label: 'Grid view', Icon: GridIcon },
  { id: 'list', label: 'List view', Icon: ListIcon },
  { id: 'compact', label: 'Compact view', Icon: RowsIcon },
];
const DEFAULT_VIEW = 'list';
const VIEW_STORAGE_KEY = 'precis:tldr-view';

const readStoredView = () => {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEWS.some((view) => view.id === stored) ? stored : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
};

// The source's own image goes through the same-origin proxy, as on the front page:
// the CSP only allows img-src 'self'.
const proxiedImageUrl = (imageUrl) => {
  const safe = safeHttpUrl(imageUrl);
  return safe ? `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(safe)}` : '';
};

// The article's real image when it has one; generated art when it has none or the
// image fails to load (dead link, host not on the proxy allowlist).
const TldrCover = ({ item, topic }) => {
  const [failed, setFailed] = useState(false);
  const src = proxiedImageUrl(item.image_url);

  if (!src || failed) {
    return <TldrArt item={item} topic={topic} />;
  }

  return (
    <div className="tldr-art tldr-art--photo">
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </div>
  );
};

const TldrItem = ({ item, topic, showArt, feature = null, trioEnd = false }) => {
  const url = safeHttpUrl(item.article_url);
  const art = showArt && <TldrCover item={item} topic={topic} />;
  const className = [
    'tldr-item',
    feature && `tldr-item--feature tldr-item--image-${feature}`,
    trioEnd && 'tldr-item--trio-end',
  ].filter(Boolean).join(' ');

  return (
    <li className={className}>
      {/* The art duplicates the title link, so it stays out of the tab order and the
          accessibility tree rather than announcing the same link twice. */}
      {art && (url ? (
        <a className="tldr-item-art" href={url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
          {art}
        </a>
      ) : (
        <div className="tldr-item-art" aria-hidden="true">{art}</div>
      ))}
      <div className="tldr-item-body">
        <p className="tldr-item-text">{item.tldr_text}</p>
        <p className="tldr-item-meta">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">{item.title}</a>
          ) : (
            <span>{item.title}</span>
          )}
          <span aria-hidden="true"> &middot; </span>
          <span>Source: {formatSiteName(item.site)}</span>
        </p>
      </div>
    </li>
  );
};

const TldrPanel = ({ section, digest, view }) => {
  const items = itemsOf(digest);
  const listRef = useRevealOnScroll([view, section.slug, items.map((item) => item.article_url).join('\n')]);

  return (
    <section
      className="tldr-section"
      role="tabpanel"
      id={`tldr-panel-${section.slug}`}
      aria-labelledby={`tldr-tab-${section.slug}`}
    >
      {digest?.generated_at && (
        <p className="tldr-generated-at">Updated {formatRelativeTime(digest.generated_at)}</p>
      )}

      {!digest && (
        <p className="tldr-note">No digest has been generated for {section.title} yet.</p>
      )}
      {digest && items.length === 0 && (
        <p className="tldr-note">The last run for {section.title} produced no verified items.</p>
      )}
      {items.length > 0 && (
        <ol className={`tldr-list tldr-list--${view}`} ref={listRef}>
          {view === 'grid'
            ? buildCardLayout(items, (item) => item.article_url || item.title).map(({ article: item, feature, trioEnd }) => (
              <TldrItem key={item.article_url} item={item} topic={section.topic} showArt feature={feature} trioEnd={trioEnd} />
            ))
            : items.map((item) => (
              <TldrItem key={item.article_url} item={item} topic={section.topic} showArt={view !== 'compact'} />
            ))}
        </ol>
      )}
    </section>
  );
};

const TldrPage = () => {
  const [digests, setDigests] = useState(null);
  const [status, setStatus] = useState('loading');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef({});
  const [view, setView] = useState(readStoredView);
  // The open export preview, frozen at the moment it was opened: { title, fileName, text }.
  const [exportPreview, setExportPreview] = useState(null);

  const selectView = (nextView) => {
    setView(nextView);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    } catch {
      // Storage blocked (private mode, disabled site data): the choice just won't persist.
    }
  };

  const requestedSlug = searchParams.get('topic');
  const activeSection = SECTIONS.find((section) => section.slug === requestedSlug) ?? SECTIONS[0];
  const activeDigest = digests?.[activeSection.topic];
  const canExport = status === 'ready' && itemsOf(activeDigest).length > 0;

  // Shows the open tab's digest as a post ready to paste into a Facebook Group;
  // the preview's Save button downloads it as a .md file.
  const previewExport = () => {
    setExportPreview({
      kicker: 'Export · Markdown',
      title: `${activeSection.title} TLDR`,
      fileName: exportFileName(activeSection.slug, activeDigest?.generated_at),
      text: buildFacebookPost({ title: activeSection.title, digest: activeDigest, safeUrl: safeHttpUrl }),
    });
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/tldr`);
        if (!cancelled) {
          setDigests(response.data?.digests || {});
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

  // The default tab is the absence of a parameter, so a plain /tldr link stays plain.
  // replace, not push: switching tabs is not navigation the back button should replay.
  const selectTab = (section) => {
    setSearchParams(section === SECTIONS[0] ? {} : { topic: section.slug }, { replace: true });
  };

  // Arrow keys move between tabs and follow focus, per the WAI-ARIA tabs pattern.
  const handleTabKeyDown = (event) => {
    const index = SECTIONS.indexOf(activeSection);
    const nextIndex = {
      ArrowRight: (index + 1) % SECTIONS.length,
      ArrowLeft: (index - 1 + SECTIONS.length) % SECTIONS.length,
      Home: 0,
      End: SECTIONS.length - 1,
    }[event.key];

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    const next = SECTIONS[nextIndex];
    selectTab(next);
    tabRefs.current[next.slug]?.focus();
  };

  return (
    <div className="trending-page tldr-page">
      <header className="site-header" id="top">
        <Link className="brand" to="/" aria-label="Precis home">
          <span>PR&Eacute;CIS</span>
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link to="/" className="site-nav-link">Today</Link>
          <span className="site-nav-link active" aria-current="page">TL;DR</span>
          <Link to="/trending" className="site-nav-link">Trending</Link>
        </nav>
        <div className="site-header-actions">
          <ThemeToggle />
        </div>
      </header>

      <main className="trending-main tldr-main">
        <section className="trend-masthead">
          <p className="masthead-kicker">Skim it in a minute</p>
          <h1 className="trend-title">TLDR</h1>
        </section>

        <div className="tldr-controls">
          <div className="segmented-tabs" role="tablist" aria-label="Digest topic" onKeyDown={handleTabKeyDown}>
            {SECTIONS.map((section) => {
              const selected = section === activeSection;
              const count = itemsOf(digests?.[section.topic]).length;

              return (
                <button
                  key={section.slug}
                  ref={(node) => { tabRefs.current[section.slug] = node; }}
                  type="button"
                  role="tab"
                  id={`tldr-tab-${section.slug}`}
                  className="segmented-tab"
                  aria-selected={selected}
                  aria-controls={`tldr-panel-${section.slug}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(section)}
                >
                  {section.title}
                  {status === 'ready' && count > 0 && (
                    <span className="segmented-tab-count" aria-label={`${count} items`}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="tldr-actions">
            <button
              type="button"
              className="tldr-export-btn"
              onClick={previewExport}
              disabled={!canExport}
              aria-haspopup="dialog"
              title="Preview this digest as Markdown, formatted for a Facebook Group post, and save it"
            >
              <DocumentIcon />
              <span>Preview MD</span>
            </button>

            <div className="view-toggle" role="group" aria-label="Layout">
              {VIEWS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`view-toggle-btn${view === id ? ' active' : ''}`}
                  aria-label={label}
                  aria-pressed={view === id}
                  title={label}
                  onClick={() => selectView(id)}
                >
                  <Icon />
                </button>
              ))}
            </div>
          </div>
        </div>

        {status === 'loading' && <p className="trend-note">Loading digests&hellip;</p>}
        {status === 'error' && (
          <p className="trend-note trend-note--error">
            Could not load the TLDR digests. Is the API running?
          </p>
        )}
        {status === 'ready' && (
          <TldrPanel section={activeSection} digest={activeDigest} view={view} />
        )}
      </main>
      <SiteFooter />

      {exportPreview && (
        <TldrExportDialog
          {...exportPreview}
          onSave={() => downloadTextFile(exportPreview.fileName, exportPreview.text)}
          onClose={() => setExportPreview(null)}
        />
      )}
    </div>
  );
};

export default TldrPage;
