import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

import SiteFooter from '../components/SiteFooter.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { formatRelativeTime, safeHttpUrl } from '../App.jsx';
import { formatSiteName } from '../sources';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://localhost:5000' : '');

// Matches blogscraper/taxonomy.py TOPICS -- the only two subjects a digest exists
// for. Order here decides the order the sections render in.
const SECTIONS = [
  { topic: 'AI', title: 'AI' },
  { topic: 'Cyber Security', title: 'Cyber Security' },
];

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

const TldrSection = ({ title, digest }) => (
  <section className="tldr-section">
    <div className="tldr-section-head">
      <h2>{title}</h2>
      {digest?.generated_at && (
        <span className="tldr-generated-at">Updated {formatRelativeTime(digest.generated_at)}</span>
      )}
    </div>

    {!digest && (
      <p className="tldr-note">No digest has been generated for {title} yet.</p>
    )}
    {digest && (!Array.isArray(digest.items) || digest.items.length === 0) && (
      <p className="tldr-note">The last run for {title} produced no verified items.</p>
    )}
    {digest && Array.isArray(digest.items) && digest.items.length > 0 && (
      <ol className="tldr-list">
        {digest.items.map((item) => (
          <TldrItem key={item.article_url} item={item} />
        ))}
      </ol>
    )}
  </section>
);

const TldrPage = () => {
  const [digests, setDigests] = useState(null);
  const [status, setStatus] = useState('loading');

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

  return (
    <div className="trending-page tldr-page">
      <header className="site-header" id="top">
        <Link className="brand" to="/" aria-label="Precis home">
          <span>PR&Eacute;CIS</span>
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link to="/" className="site-nav-link">Today</Link>
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

        {status === 'loading' && <p className="trend-note">Loading digests&hellip;</p>}
        {status === 'error' && (
          <p className="trend-note trend-note--error">
            Could not load the TLDR digests. Is the API running?
          </p>
        )}
        {status === 'ready' && SECTIONS.map(({ topic, title }) => (
          <TldrSection key={topic} title={title} digest={digests?.[topic]} />
        ))}
      </main>
      <SiteFooter />
    </div>
  );
};

export default TldrPage;
