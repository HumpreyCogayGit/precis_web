import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import * as analytics from '../analytics';
import AnalyticsTracker from './AnalyticsTracker.jsx';

const Navigate = () => {
  const navigate = useNavigate();
  window.navigateForAnalyticsTest = navigate;
  return null;
};

beforeEach(() => {
  vi.spyOn(analytics, 'initAnalytics').mockReturnValue(true);
  vi.spyOn(analytics, 'trackPageView').mockReturnValue(true);
});

describe('AnalyticsTracker', () => {
  test('tracks initial and pathname navigations but ignores query-only changes', () => {
    render(
      <MemoryRouter initialEntries={['/?topic=AI']}>
        <AnalyticsTracker />
        <Navigate />
      </MemoryRouter>,
    );

    expect(analytics.trackPageView).toHaveBeenLastCalledWith('/');

    act(() => window.navigateForAnalyticsTest('/?topic=Cyber+Security'));
    expect(analytics.trackPageView).toHaveBeenCalledTimes(1);

    act(() => window.navigateForAnalyticsTest('/trending?topic=AI'));
    expect(analytics.trackPageView).toHaveBeenLastCalledWith('/trending');
    expect(analytics.trackPageView).toHaveBeenCalledTimes(2);
  });
});