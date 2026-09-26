import { Link } from 'react-router-dom';

import SiteFooter from '../components/SiteFooter.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const LEGAL_REVISION_DATE = 'September 19, 2026';

const LegalHeader = ({ current }) => (
  <header className="site-header" id="top">
    <Link className="brand" to="/" aria-label="Precis home">
      <span>PR&Eacute;CIS</span>
    </Link>
    <nav className="site-nav" aria-label="Primary">
      <Link to="/" className="site-nav-link">Today</Link>
      <Link to="/tldr" className="site-nav-link">TL;DR</Link>
      <Link to="/trending" className="site-nav-link">Trending</Link>
      <Link to="/threats" className="site-nav-link">Threats</Link>
      <Link to="/privacy" className={`site-nav-link${current === 'privacy' ? ' active' : ''}`} aria-current={current === 'privacy' ? 'page' : undefined}>Privacy</Link>
      <Link to="/terms" className={`site-nav-link${current === 'terms' ? ' active' : ''}`} aria-current={current === 'terms' ? 'page' : undefined}>Terms</Link>
    </nav>
    <div className="site-header-actions">
      <ThemeToggle />
    </div>
  </header>
);

export const PrivacyPolicyPage = () => (
  <div className="legal-page">
    <LegalHeader current="privacy" />
    <main className="legal-main">
      <p className="masthead-kicker">Legal</p>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated: {LEGAL_REVISION_DATE}</p>

      <section>
        <h2>Overview</h2>
        <p>
          PR&Eacute;CIS is an independent technology news aggregator. We provide links, headlines,
          short excerpts, source labels and related metadata to help readers discover coverage
          from original publishers. We do not require an account to read the site.
        </p>
      </section>

      <section>
        <h2>Google Analytics</h2>
        <p>
          We use Google Analytics to understand aggregate usage of the site, such as pages viewed,
          approximate geography, device/browser information and general traffic patterns. Google
          Analytics may collect and process data using cookies and similar technologies whenever
          the site is used. This includes visits in private or incognito browsing modes unless the
          browser, an extension or a network-level control blocks the analytics request.
        </p>
        <p>
          Google explains how it collects and processes data at{' '}
          <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
            How Google uses information from sites or apps that use our services
          </a>.
        </p>
      </section>

      <section>
        <h2>Vercel Analytics and Speed Insights</h2>
        <p>
          We use Vercel Analytics to measure aggregate page visits and Vercel Speed Insights to
          understand site performance. These services receive technical request information needed
          to provide their reports. Vercel describes its data practices in its{' '}
          <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>.
        </p>
      </section>

      <section>
        <h2>Analytics controls</h2>
        <p>
          PR&Eacute;CIS does not currently provide an on-site analytics opt-out. You can limit or block
          Google Analytics through browser privacy settings, content-blocking extensions, network
          controls, or the{' '}
          <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
            Google Analytics Opt-out Browser Add-on
          </a>. Blocking analytics does not prevent you from reading the site.
        </p>
      </section>

      <section>
        <h2>News content and outbound links</h2>
        <p>
          Article cards link directly to the original publisher. When you follow an outbound link,
          the destination site&rsquo;s privacy policy and cookie practices apply. PR&Eacute;CIS does not
          control those third-party sites.
        </p>
      </section>

      <section>
        <h2>Data we do not collect</h2>
        <p>
          We do not provide user accounts, comment forms or payment processing on the public reader
          site. We do not knowingly collect personal information from children.
        </p>
      </section>
    </main>
    <SiteFooter />
  </div>
);

export const TermsPage = () => (
  <div className="legal-page">
    <LegalHeader current="terms" />
    <main className="legal-main">
      <p className="masthead-kicker">Legal</p>
      <h1>Terms of Use / Disclaimer</h1>
      <p className="legal-updated">Last updated: {LEGAL_REVISION_DATE}</p>

      <section>
        <h2>Independent aggregator</h2>
        <p>
          PR&Eacute;CIS is an independent news aggregation tool. We do not own the news articles,
          images, headlines or opinions published by the original sources. Views expressed in linked
          articles belong to their authors and publishers, not PR&Eacute;CIS.
        </p>
      </section>

      <section>
        <h2>Attribution and snippets</h2>
        <p>
          We aim to show only headline-level information, a short summary or excerpt, optional
          thumbnail imagery where available, and a clear source attribution with a direct outbound
          link to the original article. Readers should use those links to read full stories at the
          publisher&rsquo;s site.
        </p>
      </section>

      <section>
        <h2>No warranties</h2>
        <p>
          The site is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind. We do
          not guarantee that the site will be uninterrupted, error-free, complete, current or
          accurate. News metadata can be delayed, incomplete or changed by upstream sources.
        </p>
      </section>

      <section>
        <h2>Third-party sources and APIs</h2>
        <p>
          PR&Eacute;CIS may use RSS feeds, publisher pages, APIs or other permitted source mechanisms to
          discover public articles. Use of those sources is intended to comply with applicable source
          terms, robots/crawling expectations and attribution requirements. If you are a rights
          holder and believe content should be adjusted or removed, please contact the site operator.
        </p>
      </section>

      <section>
        <h2>Outbound links</h2>
        <p>
          Links to original publishers and other third-party sites are provided for convenience and
          attribution. We are not responsible for the availability, accuracy, policies or practices
          of those external sites.
        </p>
      </section>
    </main>
    <SiteFooter />
  </div>
);
