// Google Analytics (GA4). The measurement ID lives in the environment so it can
// be rotated, or analytics switched off for an environment, without a code edit.
// Vite reads .env from this directory (react-app/), not from precis_web/.
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? 'G-SHZYRCMXJ8';
export const COOKIE_CONSENT_STORAGE_KEY = 'precis_cookie_consent_v1';
export const COOKIE_CONSENT_ACCEPTED = 'accepted';
export const COOKIE_CONSENT_DECLINED = 'declined';

export function getStoredCookieConsent() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    return [COOKIE_CONSENT_ACCEPTED, COOKIE_CONSENT_DECLINED].includes(value) ? value : null;
  } catch (err) {
    return null;
  }
}

export function storeCookieConsent(value) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, value);
  } catch (err) {
    // If storage is unavailable, keep the choice in-memory for this page only.
  }
}

// Loaded as a bundled module rather than an inline <script> in index.html, so the
// CSP only has to allowlist the Google hosts — no 'unsafe-inline' in script-src,
// and no inline-script hash to keep in sync with the snippet's whitespace.
export function initAnalytics() {
  // An unset var falls back to the default ID above; an explicit empty string
  // disables analytics (?? passes '' through, so this falsy check is the switch).
  // Preview deploys are PROD builds, so set the var empty there to keep preview
  // traffic out of the property.
  if (!GA_MEASUREMENT_ID || !import.meta.env.PROD || getStoredCookieConsent() !== COOKIE_CONSENT_ACCEPTED) {
    return;
  }

  if (window.gtag) {
    return;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  // Must forward `arguments`, not rest args — the loader reads the arguments
  // object off the queue, so an arrow function changes the shape it expects.
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag('js', new Date());
  // One page_view per load. The app rewrites only the query string when filters
  // are applied (App.jsx writeFiltersToUrl), which we deliberately don't count.
  gtag('config', GA_MEASUREMENT_ID);
}
