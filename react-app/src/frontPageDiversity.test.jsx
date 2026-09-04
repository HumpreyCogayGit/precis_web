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

// A burst: nvidia owns the eight newest slots, so on a straight recency slice the
// lead and all five briefs under it would carry the same byline. The five other
// sources are next, well inside the reach.
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

const previousStories = () => screen.getByRole('region', { name: 'Previous stories' });
const everythingElse = () => screen.getByRole('region', { name: 'Everything else' });

const bylinesIn = (section) => [...section.querySelectorAll('.brief-meta')]
  .map((meta) => meta.firstElementChild.textContent);

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  axios.get.mockImplementation(() => Promise.resolve({
    data: {
      items: ITEMS,
      facets: {
        tags: toFacetArray(vocabulary.tags),
        sources: toFacetArray(vocabulary.sources),
        topics: toFacetArray(vocabulary.topics),
      },
    },
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('front page source diversity', () => {
  test('the lead is still the newest item, and no source repeats across the six above the fold', async () => {
    render(<App />);

    expect(await screen.findByText('Daily tech brief')).toBeInTheDocument();

    const lead = document.querySelector('.lead-story');
    expect(within(lead).getByRole('heading', { level: 2 })).toHaveTextContent('Story 1');
    const leadByline = lead.querySelector('.lead-byline').textContent;
    expect(leadByline).toContain('NVIDIA');

    const briefBylines = bylinesIn(previousStories());
    expect(briefBylines).toHaveLength(5);
    expect(new Set([...briefBylines, leadByline.split(' · ')[0]]).size).toBe(6);
    expect(briefBylines).not.toContain('NVIDIA');
  });

  test('the burst is skipped past for the next fresh source, not for an arbitrary one', async () => {
    render(<App />);

    expect(await screen.findByText('Daily tech brief')).toBeInTheDocument();

    // Stories 9-13 are the newest item from each of the five other sources.
    const titles = [...previousStories().querySelectorAll('.brief-copy h4')].map((h) => h.textContent);
    expect(titles).toEqual(['Story 9', 'Story 10', 'Story 11', 'Story 12', 'Story 13']);
  });

  test('demoted burst items fall into Everything else rather than being dropped', async () => {
    render(<App />);

    expect(await screen.findByText('Daily tech brief')).toBeInTheDocument();

    const section = everythingElse();
    // Every item not on the front page is still on the page: 16 - 6 = 10.
    expect(within(section).getByText('10 items')).toBeInTheDocument();

    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      expect(within(section).getByText(`Story ${n}`)).toBeInTheDocument();
    }

    expect(within(section).queryByText('Story 1')).not.toBeInTheDocument();
    expect(within(section).queryByText('Story 9')).not.toBeInTheDocument();
  });
});
