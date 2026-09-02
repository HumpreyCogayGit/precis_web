import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
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

      return Promise.resolve({ data: articles });
    }),
  },
}));

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

  test('splits items into a lead story and a "Previous stories" tier instead of duplicating cards', async () => {
    render(<App />);

    expect(await screen.findByText('Previous stories')).toBeInTheDocument();
    expect(screen.queryByText('Editors Picks')).not.toBeInTheDocument();
    expect(screen.queryByText('Also today')).not.toBeInTheDocument();
  });
});
