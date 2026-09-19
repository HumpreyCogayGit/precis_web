import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearLegacyAnalyticsPreference,
  initAnalytics,
  resetAnalyticsForTests,
  trackPageView,
} from './analytics';

const LEGACY_CONSENT_STORAGE_KEY = 'precis_cookie_consent_v1';

beforeEach(() => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_GA_ANALYTICS_ENABLED', 'true');
  resetAnalyticsForTests();
  window.localStorage.clear();
  delete window.gtag;
  delete window.dataLayer;
  document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]').forEach((script) => script.remove());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Google Analytics', () => {
  test('initializes in production and clears a legacy declined preference', () => {
    window.localStorage.setItem(LEGACY_CONSENT_STORAGE_KEY, 'declined');

    expect(initAnalytics()).toBe(true);

    expect(window.localStorage.getItem(LEGACY_CONSENT_STORAGE_KEY)).toBeNull();
    expect(document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]').length).toBe(1);
    expect(window.dataLayer).toHaveLength(2);
    expect(Array.from(window.dataLayer[1])).toEqual([
      'config',
      'G-SHZYRCMXJ8',
      { send_page_view: false },
    ]);
  });

  test('does not add duplicate loader scripts or configuration calls', () => {
    expect(initAnalytics()).toBe(true);
    expect(initAnalytics()).toBe(true);

    expect(document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]').length).toBe(1);
    expect(window.dataLayer).toHaveLength(2);
  });

  test('supports the environment kill switch', () => {
    vi.stubEnv('VITE_GA_ANALYTICS_ENABLED', 'false');

    expect(initAnalytics()).toBe(false);
    expect(document.querySelector('script[src^="https://www.googletagmanager.com/gtag/js"]')).toBeNull();
  });

  test('tracks each consecutive pathname once without query strings', () => {
    initAnalytics();

    expect(trackPageView('/')).toBe(true);
    expect(trackPageView('/')).toBe(false);
    expect(trackPageView('/trending')).toBe(true);

    const pageViews = window.dataLayer
      .map((entry) => Array.from(entry))
      .filter((entry) => entry[0] === 'event' && entry[1] === 'page_view');
    expect(pageViews).toHaveLength(2);
    expect(pageViews.map((entry) => entry[2].page_path)).toEqual(['/', '/trending']);
    expect(pageViews[1][2].page_location).toBe(`${window.location.origin}/trending`);
  });

  test('clears legacy storage even when storage access fails', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => clearLegacyAnalyticsPreference()).not.toThrow();
    removeItem.mockRestore();
  });
});