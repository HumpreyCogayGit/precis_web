import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import App from './App.jsx';

const item = (n, topic, publishedAt) => ({
  url: `https://example.com/${n}`,
  site: 'nvidia',
  topic,
  topics: [topic],
  title: `${topic} story ${n}`,
  author: 'Precis',
  published_at: publishedAt,
  image_url: '',
  summary: `Summary ${n}.`,
  excerpt: `Summary ${n}.`,
  fetched_at: publishedAt,
  tags: [],
});

const ITEMS = [
  item(1, 'AI', '2026-09-09T09:00:00Z'),
  item(2, 'Cyber Security', '2026-09-09T08:00:00Z'),
  item(3, 'AI', '2026-09-09T07:00:00Z'),
];

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const topicTabs = () => screen.getByRole('group', { name: 'Filter by topic' });
const topicTab = (name) => within(topicTabs()).getByRole('button', { name: new RegExp(`^${name}`) });
const shows = (title) => screen.queryAllByText(title).length > 0;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.includes('/api/trending') ? [] : { items: ITEMS },
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('home topic tabs', () => {
  test('offers All, AI and Cyber Security, with All current and everything shown', async () => {
    render(<App />);

    await screen.findByRole('group', { name: 'Filter by topic' });

    expect(within(topicTabs()).getAllByRole('button').map((node) => node.textContent))
      .toEqual(['All3', 'AI2', 'Cyber Security1']);
    expect(topicTab('All')).toHaveAttribute('aria-pressed', 'true');
    expect(topicTab('AI')).toHaveAttribute('aria-pressed', 'false');
    expect(topicTab('Cyber Security')).toHaveAttribute('aria-pressed', 'false');
    expect(shows('AI story 1')).toBe(true);
    expect(shows('Cyber Security story 2')).toBe(true);
  });

  test('a tab narrows to its topic, another tab switches, and pressing it again clears', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('group', { name: 'Filter by topic' });

    await user.click(topicTab('Cyber Security'));
    expect(topicTab('Cyber Security')).toHaveAttribute('aria-pressed', 'true');
    expect(shows('Cyber Security story 2')).toBe(true);
    expect(shows('AI story 1')).toBe(false);

    await user.click(topicTab('AI'));
    expect(topicTab('AI')).toHaveAttribute('aria-pressed', 'true');
    expect(topicTab('Cyber Security')).toHaveAttribute('aria-pressed', 'false');
    expect(shows('Cyber Security story 2')).toBe(false);

    await user.click(topicTab('AI'));
    expect(topicTab('AI')).toHaveAttribute('aria-pressed', 'false');
    expect(topicTab('All')).toHaveAttribute('aria-pressed', 'true');
    expect(shows('AI story 1')).toBe(true);
    expect(shows('Cyber Security story 2')).toBe(true);
  });

  test('All clears the topic a pill set', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('group', { name: 'Filter by topic' });

    await user.click(topicTab('Cyber Security'));
    expect(shows('AI story 1')).toBe(false);

    await user.click(topicTab('All'));
    expect(topicTab('All')).toHaveAttribute('aria-pressed', 'true');
    expect(topicTab('Cyber Security')).toHaveAttribute('aria-pressed', 'false');
    expect(shows('AI story 1')).toBe(true);
  });
});
