import { render, screen, waitFor } from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import App from './App.jsx';

const item = (n) => ({
  url: `https://example.com/${n}`,
  site: 'nvidia',
  topic: 'AI',
  topics: ['AI'],
  title: `Story ${n}`,
  author: 'Precis',
  published_at: `2026-09-0${9 - n}T09:00:00Z`,
  image_url: '',
  summary: `Summary ${n}.`,
  excerpt: `Summary ${n}.`,
  fetched_at: `2026-09-0${9 - n}T09:00:00Z`,
  tags: ['AI'],
});

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const articleRequests = () => axios.get.mock.calls
  .map(([url]) => url)
  .filter((url) => url.includes('/api/articles'));

// Scripts /api/articles by offset. `pages` maps an offset to that page's payload.
const serve = (pages) => {
  axios.get.mockImplementation((url) => {
    if (url.includes('/api/trending')) {
      return Promise.resolve({ data: [] });
    }

    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
    return Promise.resolve({ data: pages[offset] ?? { items: [], next_offset: null } });
  });
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('progressive article loading', () => {
  test('paints the first page, then appends every later page in the background', async () => {
    serve({
      0: { items: [item(1), item(2)], facets: null, next_offset: 2 },
      // item 2 shifted across the page boundary: it must not be listed twice.
      2: { items: [item(2), item(3)], facets: null, next_offset: 4 },
      4: { items: [item(4)], facets: null, next_offset: null },
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText('Story 4').length).toBeGreaterThan(0));

    expect(articleRequests()).toEqual([
      expect.stringContaining('/api/articles?limit=48&offset=0'),
      expect.stringContaining('/api/articles?limit=500&offset=2'),
      expect.stringContaining('/api/articles?limit=500&offset=4'),
    ]);
    // Top Stories only needs one article per trending entity.
    expect(axios.get.mock.calls.map(([url]) => url))
      .toContainEqual(expect.stringContaining('/api/trending?limit=60&articles_per_entity=1'));
    await waitFor(() => expect(screen.queryByText(/more loading/)).not.toBeInTheDocument());
  });

  test('stops when a page makes no progress instead of requesting it forever', async () => {
    serve({
      0: { items: [item(1)], facets: null, next_offset: 1 },
      1: { items: [item(2)], facets: null, next_offset: 1 },
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByText('Story 2').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText(/more loading/)).not.toBeInTheDocument());

    expect(articleRequests()).toHaveLength(2);
  });

  test('a response without next_offset is treated as the whole working set', async () => {
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.includes('/api/trending') ? [] : { items: [item(1)] },
    }));

    render(<App />);

    await waitFor(() => expect(screen.getAllByText('Story 1').length).toBeGreaterThan(0));
    expect(articleRequests()).toHaveLength(1);
  });
});
