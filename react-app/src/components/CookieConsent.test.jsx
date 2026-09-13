import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';

import { COOKIE_CONSENT_STORAGE_KEY } from '../analytics';
import CookieConsent from './CookieConsent.jsx';

beforeEach(() => {
  window.localStorage.clear();
});

describe('CookieConsent', () => {
  test('does not show the cookie banner on first page load without stored consent', () => {
    render(<CookieConsent />);

    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBeNull();
  });
});
