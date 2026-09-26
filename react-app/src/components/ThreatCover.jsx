// The cover for an exploit or CVE item on /threats. Both feeds publish one logo for every
// post, so the cover is drawn from the item's own details (articles.threat, see
// scraper/blogscraper/threat_meta.py) instead:
//
//   - the repository's GitHub preview image when the item links one, else
//   - generated art (TldrArt, picked by tag and seeded by URL) with the CVE ID or tool
//     name set over it, and the affected products underneath;
//   - either way, an Exploit/Advisory badge and a CVSS severity pill on top.
//
// Sized entirely by its container (the card's image slot or the list thumbnail), with
// container-query units, so one component serves every layout.
import { useState } from 'react';

import TldrArt from './TldrArt.jsx';
import { formatSiteName } from '../sources';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://localhost:5000' : '');

const KIND_LABELS = { exploit: 'Exploit', advisory: 'Advisory' };
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'none'];
// GitHub's generated social card for a repository: name, description, stars, language.
// Goes through the same-origin image proxy as every other image (CSP img-src 'self'), so
// opengraph.githubassets.com must be in IMAGE_PROXY_ALLOWED_HOSTS; until it is, the proxy
// refuses and the cover falls back to the drawn card.
const GITHUB_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export const githubPreviewUrl = (repo) => (
  GITHUB_REPO_RE.test(repo || '') ? `https://opengraph.githubassets.com/1/${repo}` : ''
);

const proxied = (url) => (url ? `${API_BASE_URL}/api/image-proxy?url=${encodeURIComponent(url)}` : '');

export const threatOf = (article) => (
  article?.threat && typeof article.threat === 'object' ? article.threat : {}
);

// What the cover leads with: the CVE, else the tool or product, else the headline.
export const threatHeadline = (article) => {
  const threat = threatOf(article);
  const cves = Array.isArray(threat.cves) ? threat.cves : [];
  return cves[0] || threat.subject || article?.title || '';
};

const SeverityPill = ({ threat }) => {
  if (typeof threat.cvss !== 'number' || !SEVERITIES.includes(threat.severity)) {
    return null;
  }
  const source = threat.cvss_source === 'nvd' ? 'NVD' : 'the advisory';
  return (
    <span
      className={`threat-pill threat-pill--${threat.severity}`}
      title={`CVSS ${threat.cvss.toFixed(1)} (${threat.severity}), from ${source}`}
    >
      <span className="threat-pill-label">{threat.severity}</span>
      <span className="threat-pill-score">{threat.cvss.toFixed(1)}</span>
    </span>
  );
};

const ThreatCover = ({ article, className = '' }) => {
  const threat = threatOf(article);
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoFailed ? '' : proxied(githubPreviewUrl(threat.github));
  const cves = Array.isArray(threat.cves) ? threat.cves : [];
  const products = Array.isArray(threat.products) ? threat.products : [];
  const kind = KIND_LABELS[threat.kind] || formatSiteName(article.site);
  const severity = SEVERITIES.includes(threat.severity) ? threat.severity : 'unscored';

  return (
    <div
      className={['threat-cover', `threat-cover--${severity}`, photo && 'threat-cover--photo', className].filter(Boolean).join(' ')}
      data-severity={severity}
    >
      {photo ? (
        <img
          className="threat-cover-photo"
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <TldrArt item={{ article_url: article.url, title: article.title, tags: article.tags }} topic="Cyber Security" />
      )}

      <div className="threat-cover-top">
        <span className="threat-kind">{kind}</span>
        <SeverityPill threat={threat} />
      </div>

      {/* A GitHub card already names the repository; text over it would collide. */}
      {!photo && (
        <div className="threat-cover-text">
          <span className="threat-headline">{threatHeadline(article)}</span>
          {(products.length > 0 || cves.length > 1) && (
            <span className="threat-sub">
              {products.join(' · ')}
              {cves.length > 1 && `${products.length ? ' · ' : ''}+${cves.length - 1} more CVE${cves.length > 2 ? 's' : ''}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default ThreatCover;
