import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import SiteFooter from '../components/SiteFooter.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { formatRelativeTime, safeHttpUrl } from '../App.jsx';
import { formatSiteName } from '../sources';

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

const TldrItem = ({ item }) => {
  const url = safeHttpUrl(item.article_url);

  return (
    <li className="tldr-item">
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
    </li>
  );
};

const TldrPanel = ({ section, digest }) => {
  const items = itemsOf(digest);

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
        <ol className="tldr-list">
          {items.map((item) => (
            <TldrItem key={item.article_url} item={item} />
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

  const requestedSlug = searchParams.get('topic');
  const activeSection = SECTIONS.find((section) => section.slug === requestedSlug) ?? SECTIONS[0];

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

        {status === 'loading' && <p className="trend-note">Loading digests&hellip;</p>}
        {status === 'error' && (
          <p className="trend-note trend-note--error">
            Could not load the TLDR digests. Is the API running?
          </p>
        )}
        {status === 'ready' && (
          <TldrPanel section={activeSection} digest={digests?.[activeSection.topic]} />
        )}
      </main>
      <SiteFooter />
    </div>
  );
};

export default TldrPage;
