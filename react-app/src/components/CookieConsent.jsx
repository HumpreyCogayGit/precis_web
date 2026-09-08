import { useEffect, useState } from 'react';

import {
  COOKIE_CONSENT_ACCEPTED,
  COOKIE_CONSENT_DECLINED,
  getStoredCookieConsent,
  initAnalytics,
  storeCookieConsent,
} from '../analytics';

const CookieConsent = () => {
  const [choice, setChoice] = useState(() => getStoredCookieConsent());

  useEffect(() => {
    if (choice === COOKIE_CONSENT_ACCEPTED) {
      initAnalytics();
    }
  }, [choice]);

  if (choice) {
    return null;
  }

  const choose = (value) => {
    storeCookieConsent(value);
    setChoice(value);
  };

  return (
    <section className="cookie-banner" aria-label="Cookie consent">
      <div className="cookie-banner-copy">
        <h2>Analytics cookies</h2>
        <p>
          PR&Eacute;CIS uses Google Analytics cookies to understand aggregate site usage.
          Accept to allow analytics, or decline to keep analytics disabled on this browser.
        </p>
        <a href="/privacy">Read the Privacy Policy</a>
      </div>
      <div className="cookie-banner-actions">
        <button type="button" className="cookie-button cookie-button--secondary" onClick={() => choose(COOKIE_CONSENT_DECLINED)}>
          Decline
        </button>
        <button type="button" className="cookie-button cookie-button--primary" onClick={() => choose(COOKIE_CONSENT_ACCEPTED)}>
          Accept
        </button>
      </div>
    </section>
  );
};

export default CookieConsent;
