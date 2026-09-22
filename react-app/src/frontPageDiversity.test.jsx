import { fireEvent, render, screen, within } from '@testing-library/react';
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
// Latest News, since only the lead is pulled above the fold now.
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

const everythingElse = () => screen.getByRole('region', { name: 'Latest News' });

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

    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    const lead = document.querySelector('.lead-story');
    expect(within(lead).getByRole('heading', { level: 2 })).toHaveTextContent('Story 1');
    expect(lead.querySelector('.lead-byline').textContent).toContain('NVIDIA');
  });

  test('everything not the lead lands in Latest News, burst included', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    const section = everythingElse();
    // Every item but the lead: 16 - 1 = 15.
    expect(within(section).getByText('15 items')).toBeInTheDocument();

    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
      expect(within(section).getByText(`Story ${n}`)).toBeInTheDocument();
    }

    expect(within(section).queryByText('Story 1')).not.toBeInTheDocument();
  });

  test('a flagged matching article becomes lead without also appearing in Latest News', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/trending')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: ITEMS.map((article) => ({
        ...article,
        is_lead: article.title === 'Story 9',
        lead_topics: article.title === 'Story 9' ? ['AI'] : [],
      })), facets: { tags: [], sources: [], topics: [] } } });
    });

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    const lead = document.querySelector('.lead-story');
    expect(within(lead).getByRole('heading', { level: 2 })).toHaveTextContent('Story 9');
    expect(within(everythingElse()).queryByText('Story 9')).not.toBeInTheDocument();
    expect(within(everythingElse()).getByText('Story 1')).toBeInTheDocument();
  });

  test('falls back to the newest matching article when the flagged lead is filtered out', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/trending')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: ITEMS.map((article) => ({
        ...article,
        topics: [article.topic],
        is_lead: article.title === 'Story 9',
        lead_topics: article.title === 'Story 9' ? ['AI'] : [],
      })), facets: { tags: [], sources: [], topics: [] } } });
    });
    window.history.replaceState(null, '', '/?source=nvidia');

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    expect(within(document.querySelector('.lead-story')).getByRole('heading', { level: 2 }))
      .toHaveTextContent('Story 1');
  });

  test('uses the Cyber Security lead when that topic is selected', async () => {
    const mixedItems = ITEMS.map((article) => ({
      ...article,
      topic: article.title === 'Story 10' ? 'Cyber Security' : 'AI',
      topics: [article.title === 'Story 10' ? 'Cyber Security' : 'AI'],
      is_lead: ['Story 9', 'Story 10'].includes(article.title),
      lead_topics: article.title === 'Story 9'
        ? ['AI']
        : article.title === 'Story 10' ? ['Cyber Security'] : [],
    }));
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/trending')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: mixedItems, facets: { tags: [], sources: [], topics: [] } } });
    });
    window.history.replaceState(null, '', '/?topic=Cyber%20Security');

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    expect(within(document.querySelector('.lead-story')).getByRole('heading', { level: 2 }))
      .toHaveTextContent('Story 10');
  });

  test('several leads for the topic rotate in a carousel and all leave Latest News', async () => {
    const leads = ['Story 9', 'Story 11', 'Story 13'];
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/trending')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: ITEMS.map((article) => ({
        ...article,
        is_lead: leads.includes(article.title),
        lead_topics: leads.includes(article.title) ? ['AI'] : [],
      })), facets: { tags: [], sources: [], topics: [] } } });
    });

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    const carousel = screen.getByRole('region', { name: 'Lead stories' });
    const activeHeadline = () => within(carousel.querySelector('.lead-slide.is-active'))
      .getByRole('heading', { level: 2 });
    expect(activeHeadline()).toHaveTextContent('Story 9');
    for (const title of leads) {
      expect(within(everythingElse()).queryByText(title)).not.toBeInTheDocument();
    }

    fireEvent.click(within(carousel).getByRole('button', { name: 'Next lead story' }));
    expect(activeHeadline()).toHaveTextContent('Story 11');
    fireEvent.click(within(carousel).getByRole('button', { name: 'Previous lead story' }));
    fireEvent.click(within(carousel).getByRole('button', { name: 'Previous lead story' }));
    expect(activeHeadline()).toHaveTextContent('Story 13');
  });

  test('editorial lead priority decides which story appears first', async () => {
    const leads = ['Story 9', 'Story 11', 'Story 13'];
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/trending')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: ITEMS.map((article) => ({
        ...article,
        is_lead: leads.includes(article.title),
        lead_topics: leads.includes(article.title) ? ['AI'] : [],
        lead_selected_at: leads.includes(article.title) ? {
          AI: article.title === 'Story 13' ? '2026-09-23T03:00:00Z' : '2026-09-22T03:00:00Z',
        } : {},
      })), facets: { tags: [], sources: [], topics: [] } } });
    });

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    const carousel = screen.getByRole('region', { name: 'Lead stories' });
    expect(within(carousel.querySelector('.lead-slide.is-active'))
      .getByRole('heading', { level: 2 })).toHaveTextContent('Story 13');
  });

  test('with no topic selected, AI and Cyber Security leads rotate together', async () => {
    const mixedItems = ITEMS.map((article) => ({
      ...article,
      topic: article.title === 'Story 10' ? 'Cyber Security' : 'AI',
      topics: [article.title === 'Story 10' ? 'Cyber Security' : 'AI'],
      is_lead: ['Story 9', 'Story 10'].includes(article.title),
      lead_topics: article.title === 'Story 9'
        ? ['AI']
        : article.title === 'Story 10' ? ['Cyber Security'] : [],
    }));
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/trending')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: mixedItems, facets: { tags: [], sources: [], topics: [] } } });
    });

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Top Stories' })).toBeInTheDocument();

    const carousel = screen.getByRole('region', { name: 'Lead stories' });
    const activeHeadline = () => within(carousel.querySelector('.lead-slide.is-active'))
      .getByRole('heading', { level: 2 });
    expect(activeHeadline()).toHaveTextContent('Story 9');
    fireEvent.click(within(carousel).getByRole('button', { name: 'Next lead story' }));
    expect(activeHeadline()).toHaveTextContent('Story 10');
    expect(within(everythingElse()).queryByText('Story 10')).not.toBeInTheDocument();
  });
});
