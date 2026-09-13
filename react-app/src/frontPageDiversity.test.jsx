import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App.jsx';
import { buildVocabulary } from './filters';

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

const item = (n, site) => ({
  url: `https://example.com/${n}`,
  site,
  topic: 'AI',
  title: `Story ${n}`,
  author: 'Precis',
  published_at: hoursAgo(n),
  image_url: '',
  summary: `Summary ${n}.`,
  excerpt: `Summary ${n}.`,
  fetched_at: hoursAgo(n),
  tags: [],
});

// A burst: nvidia owns the eight newest slots. The lead is still whichever item is
// newest overall, and everything else — including the rest of the burst — lands in
// Everything else, since only the lead is pulled above the fold now.
const ITEMS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => item(n, 'nvidia')),
  item(9, 'open_ai'),
  item(10, 'krebs_on_security'),
  item(11, 'anthropic_news'),
  item(12, 'perplexity_blog'),
  item(13, 'alibaba'),
  ...[14, 15, 16].map((n) => item(n, 'nvidia')),
];

const toFacetArray = (map) => [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
const vocabulary = buildVocabulary(ITEMS);

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const everythingElse = () => screen.getByRole('region', { name: 'Everything else' });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  axios.get.mockImplementation((url) => {
    if (url.includes('/api/trending')) {
      return Promise.resolve({ data: [] });
    }

    return Promise.resolve({
      data: {
        items: ITEMS,
        facets: {
          tags: toFacetArray(vocabulary.tags),
          sources: toFacetArray(vocabulary.sources),
          topics: toFacetArray(vocabulary.topics),
        },
      },
    });
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('front page split', () => {
  test('the lead is the newest item, whatever its source', async () => {
    render(<App />);

    expect(await screen.findByText('Daily tech brief')).toBeInTheDocument();

    const lead = document.querySelector('.lead-story');
    expect(within(lead).getByRole('heading', { level: 2 })).toHaveTextContent('Story 1');
    expect(lead.querySelector('.lead-byline').textContent).toContain('NVIDIA');
  });

  test('everything not the lead lands in Everything else, burst included', async () => {
    render(<App />);

    expect(await screen.findByText('Daily tech brief')).toBeInTheDocument();

    const section = everythingElse();
    // Every item but the lead: 16 - 1 = 15.
    expect(within(section).getByText('15 items')).toBeInTheDocument();

    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
      expect(within(section).getByText(`Story ${n}`)).toBeInTheDocument();
    }

    expect(within(section).queryByText('Story 1')).not.toBeInTheDocument();
  });
});
