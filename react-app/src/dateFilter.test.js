import { describe, expect, test } from 'vitest';
import {
  DATE_PRESETS,
  EMPTY_DATE_RANGE,
  EMPTY_FILTER,
  datePredicate,
  filterArticles,
  filtersToSearchParams,
  isFilterEmpty,
  presetRange,
  readFiltersFromSearch,
  resolveDateRange,
} from './filters';

// Every boundary in the date filter is UTC (see filters.js), so the fixtures are
// too — a local-time fixture would pass or fail depending on where the suite ran.
const at = (iso) => Date.parse(`${iso}Z`);

// A Wednesday, so the week preset has days on both sides of it and a Monday-start
// week is distinguishable from a Sunday-start one.
const WEDNESDAY = at('2026-09-09T12:00:00.000');

const article = (published_at) => ({ url: `https://example.com/${published_at}`, published_at });

describe('date presets', () => {
  test('the week is the Monday-to-Sunday one the day falls in', () => {
    expect(presetRange('week', WEDNESDAY)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  test('a Monday belongs to the week it starts, not the one before it', () => {
    expect(presetRange('week', at('2026-09-07T00:30:00.000'))).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  test('a Sunday belongs to the week it ends', () => {
    expect(presetRange('week', at('2026-09-13T23:30:00.000'))).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  test('the month runs to its real last day, February included', () => {
    expect(presetRange('month', WEDNESDAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('month', at('2024-02-10T00:00:00.000'))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  test('today is a single day', () => {
    expect(presetRange('today', WEDNESDAY)).toEqual({ from: '2026-09-09', to: '2026-09-09' });
  });
});

describe('resolveDateRange', () => {
  test('no range at all is no constraint', () => {
    expect(resolveDateRange(EMPTY_DATE_RANGE)).toBeNull();
    expect(resolveDateRange(undefined)).toBeNull();
  });

  test('a custom range brackets whole days, first midnight to last midnight-less-a-ms', () => {
    const resolved = resolveDateRange({ preset: 'custom', from: '2024-10-14', to: '2024-10-20' });

    expect(resolved.start).toBe(at('2024-10-14T00:00:00.000'));
    expect(resolved.end).toBe(at('2024-10-20T23:59:59.999'));
  });

  // Reachable by hand-editing a link, and by picking the earlier day second.
  test('a backwards pair is read in the order that makes sense', () => {
    expect(resolveDateRange({ preset: 'custom', from: '2024-10-20', to: '2024-10-14' }))
      .toMatchObject({ from: '2024-10-14', to: '2024-10-20' });
  });

  // Half a range would silently truncate the edition to "everything since a date"
  // while the bar showed no filter at all.
  test('a custom range missing or malforming an end filters nothing', () => {
    expect(resolveDateRange({ preset: 'custom', from: '2024-10-14', to: null })).toBeNull();
    expect(resolveDateRange({ preset: 'custom', from: '2024-10-14', to: '14/10/2024' })).toBeNull();
    expect(resolveDateRange({ preset: 'custom', from: '2024-10-14', to: '2024-13-45' })).toBeNull();
  });
});

describe('datePredicate', () => {
  const range = { preset: 'custom', from: '2026-09-07', to: '2026-09-09' };

  test('keeps both endpoints and everything between', () => {
    expect(datePredicate(article('2026-09-07T00:00:00Z'), range)).toBe(true);
    expect(datePredicate(article('2026-09-08T14:47:00Z'), range)).toBe(true);
    expect(datePredicate(article('2026-09-09T23:59:00Z'), range)).toBe(true);
  });

  test('drops the days either side of it', () => {
    expect(datePredicate(article('2026-09-06T23:59:59Z'), range)).toBe(false);
    expect(datePredicate(article('2026-09-10T00:00:01Z'), range)).toBe(false);
  });

  // A date-only string is pinned to UTC midnight, so it must land on its own day
  // rather than drifting into the neighbouring one.
  test('a date-only string lands on the day it names', () => {
    expect(datePredicate(article('September 7, 2026'), range)).toBe(true);
    expect(datePredicate(article('September 6, 2026'), range)).toBe(false);
  });

  // Zero Day Initiative dates its advisories this way; the sort already handles it.
  test('an ordinal suffix still parses', () => {
    expect(datePredicate(article('September 8th, 2026'), range)).toBe(true);
  });

  test('an article with no usable date is in no range, but survives an unfiltered list', () => {
    expect(datePredicate(article(''), range)).toBe(false);
    expect(datePredicate(article('some time last week'), range)).toBe(false);
    expect(datePredicate(article(''), EMPTY_DATE_RANGE)).toBe(true);
  });
});

describe('the date range as part of the filter', () => {
  const articles = [
    article('2026-09-09T09:00:00Z'),
    article('2026-09-08T09:00:00Z'),
    article('2026-09-01T09:00:00Z'),
  ];

  test('narrows the list like any other group', () => {
    const filtered = filterArticles(articles, {
      ...EMPTY_FILTER,
      dateRange: { preset: 'custom', from: '2026-09-08', to: '2026-09-09' },
    });

    expect(filtered).toHaveLength(2);
  });

  // Reset and "Clear all" have to see it, or they leave a live filter behind.
  test('a filter carrying only a range is not empty', () => {
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
    expect(isFilterEmpty({ ...EMPTY_FILTER, dateRange: { preset: 'today', from: null, to: null } })).toBe(false);
  });

  test('a filter with no range behaves exactly as it did before there was one', () => {
    const legacy = {
      sources: [], topics: [], tags: { in: [], not: [] }, query: '',
    };

    expect(filterArticles(articles, legacy)).toHaveLength(3);
  });
});

describe('date range URL round trip', () => {
  const roundTrip = (filter) => readFiltersFromSearch(
    `?${filtersToSearchParams(filter).toString()}`,
  ).dateRange;

  test('a preset travels as its name, so the link still means "this week" next month', () => {
    for (const preset of DATE_PRESETS) {
      const range = { preset, from: null, to: null };
      expect(filtersToSearchParams({ ...EMPTY_FILTER, dateRange: range }).get('date')).toBe(preset);
      expect(roundTrip({ ...EMPTY_FILTER, dateRange: range })).toEqual(range);
    }
  });

  test('a custom range travels as the exact days it was picked as', () => {
    const range = { preset: 'custom', from: '2024-10-14', to: '2024-10-20' };
    const params = filtersToSearchParams({ ...EMPTY_FILTER, dateRange: range });

    expect(params.get('from')).toBe('2024-10-14');
    expect(params.get('to')).toBe('2024-10-20');
    expect(params.get('date')).toBeNull();
    expect(roundTrip({ ...EMPTY_FILTER, dateRange: range })).toEqual(range);
  });

  test('no range writes no date keys, and clears any the previous one left', () => {
    const params = filtersToSearchParams(EMPTY_FILTER, '?date=week&from=2024-10-14&to=2024-10-20');

    expect(params.get('date')).toBeNull();
    expect(params.get('from')).toBeNull();
    expect(params.get('to')).toBeNull();
  });

  test('a preset and a stale custom pair cannot both survive in one link', () => {
    const params = filtersToSearchParams(
      { ...EMPTY_FILTER, dateRange: { preset: 'week', from: null, to: null } },
      '?from=2024-10-14&to=2024-10-20',
    );

    expect(params.get('date')).toBe('week');
    expect(params.get('from')).toBeNull();
  });

  test('a hand-edited link is read charitably, or not at all', () => {
    expect(readFiltersFromSearch('?from=2024-10-20&to=2024-10-14').dateRange)
      .toEqual({ preset: 'custom', from: '2024-10-14', to: '2024-10-20' });
    expect(readFiltersFromSearch('?date=fortnight').dateRange).toEqual(EMPTY_DATE_RANGE);
    expect(readFiltersFromSearch('?from=2024-10-14').dateRange).toEqual(EMPTY_DATE_RANGE);
  });
});
