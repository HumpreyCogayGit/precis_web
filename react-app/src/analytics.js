// Google Analytics (GA4). Vite reads .env from this directory (react-app/), not
// from precis_web/. Set VITE_GA_ANALYTICS_ENABLED=false or set the measurement ID
// to an empty string to stop GA collection without a code change.
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID ?? 'G-SHZYRCMXJ8';
const LEGACY_CONSENT_STORAGE_KEY = 'precis_cookie_consent_v1';
const GA_SCRIPT_ID = 'precis-google-analytics';

let initialized = false;
let lastTrackedPathname = null;

export function clearLegacyAnalyticsPreference() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(LEGACY_CONSENT_STORAGE_KEY);
  } catch (err) {
    // Analytics must not break the app when browser storage is unavailable.
  }
}

function analyticsEnabled() {
  return Boolean(GA_MEASUREMENT_ID)
    && import.meta.env.PROD
    && import.meta.env.VITE_GA_ANALYTICS_ENABLED !== 'false';
}

function hasGoogleAnalyticsScript() {
  return Array.from(document.scripts).some((script) => (
    script.id === GA_SCRIPT_ID
    || script.src.startsWith('https://www.googletagmanager.com/gtag/js')
  ));
}

// Loaded as a bundled module rather than an inline <script> in index.html, so the
// CSP only has to allowlist the Google hosts — no 'unsafe-inline' in script-src,
// and no inline-script hash to keep in sync with the snippet's whitespace.
export function initAnalytics() {
  clearLegacyAnalyticsPreference();

  if (!analyticsEnabled()) {
    return false;
  }

  if (initialized) {
    return true;
  }

  if (!hasGoogleAnalyticsScript()) {
    const script = document.createElement('script');
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  window.dataLayer = window.dataLayer || [];
  // Must forward `arguments`, not rest args — the loader reads the arguments
  // object off the queue, so an arrow function changes the shape it expects.
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = window.gtag || gtag;

  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
  initialized = true;
  return true;
}

export function trackPageView(pathname) {
  if (!initialized || !window.gtag || pathname === lastTrackedPathname) {
    return false;
  }

  window.gtag('event', 'page_view', {
    page_location: `${window.location.origin}${pathname}`,
    page_path: pathname,
    page_title: document.title,
  });
  lastTrackedPathname = pathname;
  return true;
}

// Test-only state reset. Keeping this here avoids making runtime behavior depend
// on DOM cleanup or module reload order in the Vitest suite.
export function resetAnalyticsForTests() {
  if (import.meta.env.MODE !== 'test') {
    return;
  }

  initialized = false;
  lastTrackedPathname = null;
}
