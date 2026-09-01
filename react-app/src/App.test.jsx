import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from './App.jsx';

const articles = [
  {
    url: 'https://example.com/article',
    site: 'nvidia',
    topic: 'AI',
    title: 'A deployable Precis story',
    author: 'Precis',
    published_at: '2026-08-31',
    image_url: '',
    excerpt: 'A concise article summary for the deployment smoke test.',
    fetched_at: '2026-08-31T00:00:00Z',
  },
  {
    url: 'javascript:alert(1)',
    site: 'nvidia',
    topic: 'AI',
    title: 'Unsafe URL story',
    author: 'Precis',
    published_at: '2026-08-30',
    image_url: '',
    excerpt: 'This story has an unsafe URL and should not be clickable.',
    fetched_at: '2026-08-30T00:00:00Z',
  },
  {
    url: 'http://example.com/http-article',
    site: 'nvidia',
    topic: 'AI',
    title: 'HTTP URL story',
    author: 'Precis',
    published_at: '2026-08-29',
    image_url: '',
    excerpt: 'This story uses a plain HTTP URL.',
    fetched_at: '2026-08-29T00:00:00Z',
  },
  {
    url: 'data:text/html,<script>alert(1)</script>',
    site: 'nvidia',
    topic: 'AI',
    title: 'Data URL story',
    author: 'Precis',
    published_at: '2026-08-28',
    image_url: '',
    excerpt: 'This story has a data URL and should not be clickable.',
    fetched_at: '2026-08-28T00:00:00Z',
  },
  {
    url: 'https://[malformed-url',
    site: 'nvidia',
    topic: 'AI',
    title: 'Malformed URL story',
    author: 'Precis',
    published_at: '2026-08-27',
    image_url: '',
    excerpt: 'This story has a malformed URL and should not crash the app.',
    fetched_at: '2026-08-27T00:00:00Z',
  },
];

vi.mock('axios', () => ({
  default: {
    get: vi.fn((url) => {
      if (url.endsWith('/api/sites')) {
        return Promise.resolve({ data: ['nvidia'] });
      }

      if (url.endsWith('/api/topics')) {
        return Promise.resolve({ data: ['AI'] });
      }

      return Promise.resolve({ data: articles });
    }),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('App', () => {
  test('renders safe HTTP and HTTPS article links with noopener protections', async () => {
    render(<App />);

    expect(await screen.findByText('Daily Tech Brief')).toBeInTheDocument();
    expect(await screen.findByText('A deployable Precis story')).toBeInTheDocument();

    const httpsLink = screen.getByRole('link', { name: 'A deployable Precis story' });
    expect(httpsLink).toHaveAttribute('href', 'https://example.com/article');
    expect(httpsLink).toHaveAttribute('target', '_blank');
    expect(httpsLink).toHaveAttribute('rel', 'noopener noreferrer');

    expect(screen.getByRole('link', { name: 'HTTP URL story' })).toHaveAttribute('href', 'http://example.com/http-article');
  });

  test('does not render javascript article URLs as clickable links', async () => {
    render(<App />);

    expect(await screen.findAllByText('Unsafe URL story')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Unsafe URL story' })).not.toBeInTheDocument();
  });

  test('malformed and other unsafe URLs do not crash rendering or become clickable', async () => {
    render(<App />);

    expect(await screen.findAllByText('Malformed URL story')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Data URL story' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Malformed URL story' })).not.toBeInTheDocument();
  });

  test('renders the API excerpt field instead of body text', async () => {
    render(<App />);

    expect(await screen.findByText('A concise article summary for the deployment smoke test.')).toBeInTheDocument();
    expect(screen.getByText('This story has an unsafe URL and should not be clickable.')).toBeInTheDocument();
  });

  test('renders source-labeled fallback news images when articles have no captured image', async () => {
    render(<App />);

    expect(await screen.findByText('Daily Tech Brief')).toBeInTheDocument();
    expect(screen.getAllByText('NVIDIA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('News Brief').length).toBeGreaterThan(0);
  });
});
