import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App.jsx';
import { buildVocabulary } from './filters';

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

const item = (n, tags) => ({
  url: `https://example.com/${n}`,
  site: 'open_ai',
  topic: 'AI',
  title: `Story ${n}`,
  author: 'Precis',
  published_at: hoursAgo(n),
  image_url: '',
  summary: `Summary ${n}.`,
  excerpt: `Summary ${n}.`,
  fetched_at: hoursAgo(n),
  tags,
});

// Newest first, so story 1 is the lead, 2-6 are "Previous stories", and 7-20 are
// the fourteen that land in Everything else — enough to page, so the paging line
// has to track the rail too.
//
// Story 1 carries LLM Release and stories 2-6 carry Ransomware on purpose: both
// tags exist above the section, and the rail must count only what is inside it.
const ITEMS = [
  item(1, ['LLM Release']),
  ...[2, 3, 4, 5, 6].map((n) => item(n, ['Ransomware'])),
  ...[7, 8, 9, 10, 11, 12, 13, 14].map((n) => item(n, ['Agentic AI'])),
  ...[15, 16, 17, 18].map((n) => item(n, ['Ransomware'])),
  item(19, ['LLM Release']),
  item(20, []),
];

const toFacetArray = (map) => [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

const respondWith = (items) => {
  const vocabulary = buildVocabulary(items);
  axios.get.mockImplementation(() => Promise.resolve({
    data: {
      items,
      facets: {
        tags: toFacetArray(vocabulary.tags),
        sources: toFacetArray(vocabulary.sources),
        topics: toFacetArray(vocabulary.topics),
      },
    },
  }));
};

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const rail = () => screen.getByRole('group', { name: 'Discover by tag' });
const chip = (label) => within(rail()).getByRole('button', { name: new RegExp(`^${label}`) });
const cards = () => document.querySelectorAll('.everything-grid .everything-card');
const tierCount = () => document.querySelector('.everything-else .tier-count').textContent;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  respondWith(ITEMS);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('discover rail', () => {
  test('chips come from Everything else alone, ordered by how many they return', async () => {
    render(<App />);
    await screen.findByText('Story 1');

    const labels = [...rail().querySelectorAll('.discover-chip')].map((node) => node.textContent);
    // LLM Release reads 1, not 2: story 1 is the lead and is not in this section.
    expect(labels).toEqual(['All', 'Agentic AI8', 'Ransomware4', 'LLM Release1']);
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a chip narrows Everything else and leaves the rest of the edition alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Story 1');

    await user.click(chip('Ransomware'));

    expect(cards()).toHaveLength(4);
    expect(tierCount()).toBe('4 items');
    expect(screen.getByText('Story 15')).toBeInTheDocument();
    expect(screen.queryByText('Story 7')).not.toBeInTheDocument();

    // The lead and the briefs above the section do not move.
    expect(screen.getByText('Story 1')).toBeInTheDocument();
    expect(screen.getByText('Story 3')).toBeInTheDocument();
    expect(chip('Ransomware')).toHaveAttribute('aria-pressed', 'true');
  });

  test('All, and re-pressing the active chip, both restore the section', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Story 1');

    await user.click(chip('Agentic AI'));
    expect(cards()).toHaveLength(8);

    await user.click(chip('Agentic AI'));
    expect(tierCount()).toBe('14 items');
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');

    await user.click(chip('Agentic AI'));
    await user.click(chip('All'));
    expect(tierCount()).toBe('14 items');
  });

  test('paging tracks the selection and starts over on each chip', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Story 1');

    // Fourteen items, twelve to a page.
    expect(screen.getByText('Showing 12 of 14 items')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show 2 more/ }));
    expect(cards()).toHaveLength(14);

    await user.click(chip('Agentic AI'));
    expect(cards()).toHaveLength(8);
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  });

  test('the rail is not a second filter: no URL, no filter chip', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Story 1');

    await user.click(chip('Agentic AI'));

    expect(window.location.search).not.toContain('tags=');
    expect(screen.queryByRole('button', { name: 'Remove filter: Agentic AI' })).not.toBeInTheDocument();
  });

  test('a selection the page filter removes falls back to All, never a blank section', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Story 1');

    await user.click(chip('Ransomware'));
    expect(cards()).toHaveLength(4);

    // Exclude the tag from the edition entirely, out from under the rail.
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    const tags = screen.getByRole('button', { name: /^Tags/ }).closest('.filter-panel-group');
    await user.click(within(tags).getByRole('button', { name: 'Exclude tag: Ransomware' }));
    await user.click(screen.getByRole('button', { name: /^Show \d+ brief/ }));

    expect(within(rail()).queryByRole('button', { name: /^Ransomware/ })).not.toBeInTheDocument();
    expect(chip('All')).toHaveAttribute('aria-pressed', 'true');
    // Nine ransomware stories leave the edition, so eleven remain: a lead, five
    // briefs, and five in the section. The point is that it re-forms full rather
    // than holding a selection nothing can satisfy.
    expect(tierCount()).toBe('5 items');
    expect(cards()).toHaveLength(5);
  });

  test('See all unwraps the rail in place and See fewer collapses it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Story 1');

    const track = () => rail().querySelector('.discover-track');
    expect(track()).not.toHaveClass('expanded');

    await user.click(screen.getByRole('button', { name: 'See all' }));
    expect(track()).toHaveClass('expanded');

    await user.click(screen.getByRole('button', { name: 'See fewer' }));
    expect(track()).not.toHaveClass('expanded');
  });

  test('a section with one tag to offer gets no rail at all', async () => {
    respondWith([...Array(10)].map((_, index) => item(index + 1, ['Agentic AI'])));
    render(<App />);
    await screen.findByText('Story 1');

    expect(screen.queryByRole('group', { name: 'Discover by tag' })).not.toBeInTheDocument();
  });
});
