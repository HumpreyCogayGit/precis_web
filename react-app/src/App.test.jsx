import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App.jsx';

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

const articles = [
  {
    url: 'https://example.com/article',
    site: 'nvidia',
    topic: 'AI',
    title: 'A deployable Precis story',
    author: 'Precis',
    published_at: hoursAgo(1),
    image_url: '',
    summary: 'A concise one-sentence summary for the deployment smoke test.',
    excerpt: 'A concise article summary for the deployment smoke test.',
    fetched_at: hoursAgo(1),
  },
  {
    url: 'javascript:alert(1)',
    site: 'nvidia',
    topic: 'AI',
    title: 'Unsafe URL story',
    author: 'Precis',
    published_at: hoursAgo(2),
    image_url: '',
    summary: 'This story has an unsafe URL and should not be clickable.',
    excerpt: 'This story has an unsafe URL and should not be clickable.',
    fetched_at: hoursAgo(2),
  },
  {
    url: 'http://example.com/http-article',
    site: 'nvidia',
    topic: 'AI',
    title: 'HTTP URL story',
    author: 'Precis',
    published_at: hoursAgo(3),
    image_url: '',
    summary: 'This story uses a plain HTTP URL.',
    excerpt: 'This story uses a plain HTTP URL.',
    fetched_at: hoursAgo(3),
  },
  {
    url: 'data:text/html,<script>alert(1)</script>',
    site: 'nvidia',
    topic: 'AI',
    title: 'Data URL story',
    author: 'Precis',
    published_at: hoursAgo(4),
    image_url: '',
    summary: 'This story has a data URL and should not be clickable.',
    excerpt: 'This story has a data URL and should not be clickable.',
    fetched_at: hoursAgo(4),
  },
  {
    url: 'https://[malformed-url',
    site: 'nvidia',
    topic: 'AI',
    title: 'Malformed URL story',
    author: 'Precis',
    published_at: hoursAgo(5),
    image_url: '',
    summary: 'This story has a malformed URL and should not crash the app.',
    excerpt: 'This story has a malformed URL and should not crash the app.',
    fetched_at: hoursAgo(5),
  },
  {
    url: 'https://example.com/cyber-article',
    site: 'krebs_on_security',
    topic: 'Cyber Security',
    title: 'A Cyber Security Precis story',
    author: 'Precis',
    published_at: hoursAgo(6),
    image_url: '',
    summary: 'A concise summary for a Cyber Security topic article.',
    excerpt: 'A concise summary for a Cyber Security topic article.',
    fetched_at: hoursAgo(6),
  },
];

const trendingEntities = [
  {
    candidate_key: 'top-1',
    entity: 'Top trending entity',
    rank: 1,
    articles: [{
      url: 'https://example.com/trending-story',
      site: 'nvidia',
      topic: 'AI',
      topics: ['AI'],
      title: 'A trending Precis story',
      author: 'Precis',
      published_at: hoursAgo(1),
      image_url: '',
      summary: 'A concise one-sentence summary for the trending smoke test.',
      excerpt: 'A concise article summary for the trending smoke test.',
      fetched_at: hoursAgo(1),
      is_representative: true,
    }],
  },
  {
    candidate_key: 'top-2',
    entity: 'Second trending entity',
    rank: 2,
    articles: [{
      url: 'https://example.com/trending-cyber-story',
      site: 'krebs_on_security',
      topic: 'Cyber Security',
      topics: ['Cyber Security'],
      title: 'A trending Cyber Security story',
      author: 'Precis',
      published_at: hoursAgo(2),
      image_url: '',
      summary: 'A concise summary for the Cyber Security trending smoke test.',
      excerpt: 'A concise summary for the Cyber Security trending smoke test.',
      fetched_at: hoursAgo(2),
      is_representative: true,
    }],
  },
];

vi.mock('axios', () => ({
  default: {
    get: vi.fn((url) => {
      if (url.includes('/api/sites')) {
        return Promise.resolve({ data: [{ name: 'nvidia', count: articles.length }] });
      }

      if (url.includes('/api/topics')) {
        return Promise.resolve({ data: [{ name: 'AI', count: articles.length }] });
      }

      if (url.includes('/api/article-count')) {
        return Promise.resolve({ data: { count: articles.length } });
      }

      if (url.includes('/api/trending')) {
        return Promise.resolve({ data: trendingEntities });
      }

      return Promise.resolve({ data: articles });
    }),
  },
}));

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('App', () => {
  test('renders the dated masthead and safe HTTP/HTTPS article links with noopener protections', async () => {
    render(<App />);

    expect(await screen.findByText('Daily tech brief')).toBeInTheDocument();
    expect(await screen.findByText('A deployable Precis story')).toBeInTheDocument();

    const httpsLink = screen.getByRole('link', { name: 'A deployable Precis story' });
    expect(httpsLink).toHaveAttribute('href', 'https://example.com/article');
    expect(httpsLink).toHaveAttribute('target', '_blank');
    expect(httpsLink).toHaveAttribute('rel', 'noopener noreferrer');

    expect(screen.getByRole('link', { name: 'HTTP URL story' })).toHaveAttribute('href', 'http://example.com/http-article');
  });

  test('does not render javascript article URLs as clickable links', async () => {
    render(<App />);

    expect(await screen.findAllByText('Unsafe URL story')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Unsafe URL story' })).not.toBeInTheDocument();
  });

  test('malformed and other unsafe URLs do not crash rendering or become clickable', async () => {
    render(<App />);

    expect(await screen.findAllByText('Malformed URL story')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Data URL story' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Malformed URL story' })).not.toBeInTheDocument();
  });

  test('renders the API summary field instead of body text, without a "Captured" scraper stamp', async () => {
    render(<App />);

    expect(await screen.findByText('A concise one-sentence summary for the deployment smoke test.')).toBeInTheDocument();
    expect(screen.getByText('This story has an unsafe URL and should not be clickable.')).toBeInTheDocument();
    expect(screen.queryByText(/Captured/)).not.toBeInTheDocument();
  });

  test('renders source-labeled fallback news images when articles have no captured image', async () => {
    render(<App />);

    expect(await screen.findByText('Daily tech brief')).toBeInTheDocument();
    expect(screen.getAllByText('NVIDIA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('News Brief').length).toBeGreaterThan(0);
  });

  test('splits items into a lead story and a "Top Stories" tier fed by the trending entities', async () => {
    render(<App />);

    expect(await screen.findByText('Top Stories')).toBeInTheDocument();
    expect(await screen.findByText('A trending Precis story')).toBeInTheDocument();
    expect(screen.getByText('A trending Cyber Security story')).toBeInTheDocument();
    expect(screen.queryByText('Editors Picks')).not.toBeInTheDocument();
    expect(screen.queryByText('Also today')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous stories')).not.toBeInTheDocument();
  });

  test('Top Stories narrows to match an applied Topics filter, same as the rest of the edition', async () => {
    window.history.replaceState(null, '', '/?topic=Cyber+Security');
    render(<App />);

    expect(await screen.findByText('Top Stories')).toBeInTheDocument();
    expect(screen.getByText('A trending Cyber Security story')).toBeInTheDocument();
    expect(screen.queryByText('A trending Precis story')).not.toBeInTheDocument();
  });
});
