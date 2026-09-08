import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import App from './App.jsx';

// A Wednesday, so "this week" has days on both sides of it and the fixtures below
// land in known buckets. The clock is frozen because the presets are relative to
// it: without this the suite would mean something different every day it ran.
const WEDNESDAY = '2026-09-09T12:00:00.000Z';

const item = (n, published_at, tags = ['AI']) => ({
  url: `https://example.com/${n}`,
  site: 'nvidia',
  topic: 'AI',
  topics: ['AI'],
  title: `Story ${n}`,
  author: 'Precis',
  published_at,
  image_url: '',
  summary: `Summary ${n}.`,
  excerpt: `Summary ${n}.`,
  fetched_at: published_at,
  tags,
});

const TODAY = item('today', '2026-09-09T09:00:00Z');
const MONDAY = item('monday', '2026-09-07T09:00:00Z');
const LAST_WEEK = item('last-week', '2026-09-02T09:00:00Z');
const LAST_MONTH = item('last-month', '2026-08-20T09:00:00Z');
const OLDER = item('older', '2026-08-19T09:00:00Z');
const OLDEST = item('oldest', '2026-08-18T09:00:00Z');
const ANCIENT = item('ancient', '2026-08-17T09:00:00Z');
const ARCHAIC = item('archaic', '2026-08-16T09:00:00Z', ['Security']);

const ITEMS = [TODAY, MONDAY, LAST_WEEK, LAST_MONTH];

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const dateBar = () => screen.getByRole('group', { name: 'Filter briefs by date' });
const chip = (name) => within(dateBar()).getByRole('button', { name: new RegExp(`^${name}`) });
const storyTitles = () => screen.queryAllByText(/^Story /).map((node) => node.textContent);

const openPicker = async (user) => {
  await user.click(within(dateBar()).getByRole('button', { name: 'Pick a custom date range' }));
  return screen.getByRole('dialog', { name: 'Custom date range' });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(WEDNESDAY) });
  window.history.replaceState(null, '', '/');
  axios.get.mockImplementation(() => Promise.resolve({ data: { items: ITEMS } }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('date filter bar', () => {
  test('renders below the tag filter on its own controls row', async () => {
    axios.get.mockImplementationOnce(() => Promise.resolve({ data: { items: [...ITEMS, OLDER, OLDEST, ANCIENT, ARCHAIC] } }));
    render(<App />);

    const dateFilter = await screen.findByRole('group', { name: 'Filter briefs by date' });
    const dateControls = dateFilter.closest('.edition-controls');
    const masthead = document.querySelector('.masthead');
    const tagFilter = screen.getByRole('group', { name: 'Discover by tag' });
    const results = document.querySelector('.edition-main');
    const cards = document.querySelector('.everything-grid');

    expect(dateFilter).toBeInTheDocument();
    expect(dateControls).toContainElement(dateFilter);
    expect(dateControls).toContainElement(screen.getByText('Date'));
    expect(screen.queryByText(/briefs? in the working set/)).not.toBeInTheDocument();
    expect(screen.queryByText('Filtering by')).not.toBeInTheDocument();
    expect(masthead).not.toContainElement(dateFilter);
    expect(results).toContainElement(dateFilter);
    expect(tagFilter.compareDocumentPosition(dateControls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dateControls.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/items from .* sources/)).not.toBeInTheDocument();
  });

  test('opens on All, showing date counts without a right-side working-set count', async () => {
    render(<App />);

    const all = await screen.findByRole('button', { name: /^All/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(within(all).queryByText('4')).not.toBeInTheDocument();
    expect(within(chip('Today')).getByText('1')).toBeInTheDocument();
    expect(within(chip('This week')).getByText('2')).toBeInTheDocument();
    expect(within(chip('This month')).getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/briefs? in the working set/)).not.toBeInTheDocument();
    expect(storyTitles()).toHaveLength(4);
  });

  test('each preset narrows the edition to the days it names', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    await user.click(chip('Today'));
    expect(storyTitles()).toEqual(['Story today']);

    // The Monday-to-Sunday week the frozen Wednesday sits in.
    await user.click(chip('This week'));
    expect(storyTitles().sort()).toEqual(['Story monday', 'Story today']);

    // The calendar month, so August's brief drops out and September's stay.
    await user.click(chip('This month'));
    expect(storyTitles().sort()).toEqual(['Story last-week', 'Story monday', 'Story today']);
  });

  test('date-only filtering renders a removable active chip', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    await user.click(chip('Today'));

    expect(screen.getByText('Filtering by')).toBeInTheDocument();
    const activeDate = screen.getByRole('button', { name: 'Clear date: Today' });
    expect(activeDate).toBeInTheDocument();
    expect(screen.queryByText(/briefs? in Today/)).not.toBeInTheDocument();
    expect(storyTitles()).toEqual(['Story today']);

    await user.click(activeDate);

    expect(storyTitles()).toHaveLength(4);
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  });

  // The number on the chip is what the edition becomes when it is clicked, so it
  // has to be counted through the same predicate as the list even before selection.
  test('each date chip carries the count the list will render before it is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    expect(within(chip('This week')).getByText('2')).toBeInTheDocument();
    await user.click(chip('This week'));
    expect(within(chip('This week')).getByText('2')).toBeInTheDocument();
    expect(storyTitles()).toHaveLength(2);
  });

  test('clearing the date range from the date row returns the All chip to active', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    await user.click(chip('Today'));
    await user.click(screen.getByRole('button', { name: /^All/ }));

    expect(storyTitles()).toHaveLength(4);
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a preset travels in the URL by name, so the link keeps meaning "this week"', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    await user.click(chip('This week'));
    expect(new URLSearchParams(window.location.search).get('date')).toBe('week');
  });

  test('a range in the URL is applied on load', async () => {
    window.history.replaceState(null, '', '/?from=2026-09-02&to=2026-09-07');
    render(<App />);

    await screen.findByRole('group', { name: 'Filter briefs by date' });
    expect(storyTitles().sort()).toEqual(['Story last-week', 'Story monday']);
    expect(screen.getByRole('button', { name: /^Sep 2 – Sep 7/ })).toBeInTheDocument();
  });

  // The bar is the control that can empty the list, so it has to survive doing so.
  test('the masthead and the bar stay available when a range matches nothing', async () => {
    window.history.replaceState(null, '', '/?from=2020-01-01&to=2020-01-02');
    render(<App />);

    expect(await screen.findByText('No briefs were published in that range.')).toBeInTheDocument();
    const dateFilter = screen.getByRole('group', { name: 'Filter briefs by date' });
    const masthead = document.querySelector('.masthead');
    const emptyState = document.querySelector('.empty-state');

    expect(masthead).not.toContainElement(dateFilter);
    expect(dateFilter.closest('.edition-controls').compareDocumentPosition(emptyState) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(storyTitles()).toHaveLength(0);
  });

  test('the masthead names the range rather than always claiming today', async () => {
    window.history.replaceState(null, '', '/?from=2026-09-02&to=2026-09-07');
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('September 2 – September 7');
  });
});

describe('custom range picker', () => {
  test('two clicks make a range, and Apply says what it will show before it shows it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    const picker = await openPicker(user);
    await user.click(within(picker).getByRole('gridcell', { name: 'Sep 2, 2026' }));
    await user.click(within(picker).getByRole('gridcell', { name: 'Sep 7, 2026' }));

    expect(within(picker).getByText('Sep 2, 2026')).toBeInTheDocument();
    expect(within(picker).getByText('Wednesday edition')).toBeInTheDocument();

    await user.click(within(picker).getByRole('button', { name: 'Show 2 briefs' }));
    expect(storyTitles().sort()).toEqual(['Story last-week', 'Story monday']);
    expect(new URLSearchParams(window.location.search).get('from')).toBe('2026-09-02');
  });

  test('picking the earlier day second reorders the pair instead of refusing it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    const picker = await openPicker(user);
    await user.click(within(picker).getByRole('gridcell', { name: 'Sep 7, 2026' }));
    await user.click(within(picker).getByRole('gridcell', { name: 'Sep 2, 2026' }));

    await user.click(within(picker).getByRole('button', { name: 'Show 2 briefs' }));
    expect(new URLSearchParams(window.location.search).get('from')).toBe('2026-09-02');
    expect(new URLSearchParams(window.location.search).get('to')).toBe('2026-09-07');
  });

  test('nothing is published ahead of today, so tomorrow is not pickable', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    const picker = await openPicker(user);
    expect(within(picker).getByRole('gridcell', { name: 'Sep 10, 2026' })).toBeDisabled();
    expect(within(picker).getByRole('gridcell', { name: 'Sep 9, 2026' })).toBeEnabled();
  });

  test('Cancel commits nothing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    const picker = await openPicker(user);
    await user.click(within(picker).getByRole('gridcell', { name: 'Sep 2, 2026' }));
    await user.click(within(picker).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Custom date range' })).not.toBeInTheDocument();
    expect(storyTitles()).toHaveLength(4);
  });

  // Reset empties the picker while the reader is mid-pick; only once there is
  // nothing left to clear does it drop the applied range.
  test('Reset clears the picked days first, and the applied range second', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    window.history.replaceState(null, '', '/?from=2026-09-02&to=2026-09-07');
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    const picker = await openPicker(user);
    await user.click(within(picker).getByRole('button', { name: 'Reset' }));

    expect(within(picker).getByRole('button', { name: 'Pick a day' })).toBeInTheDocument();
    expect(storyTitles()).toHaveLength(2);

    await user.click(within(picker).getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('dialog', { name: 'Custom date range' })).not.toBeInTheDocument();
    expect(storyTitles()).toHaveLength(4);
  });

  test('the month arrows page the grid without touching the selection', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    const picker = await openPicker(user);
    await user.click(within(picker).getByRole('gridcell', { name: 'Sep 2, 2026' }));
    await user.click(within(picker).getByRole('button', { name: 'Previous month' }));

    expect(within(picker).getByRole('heading', { level: 3 })).toHaveTextContent('August 2026');
    expect(within(picker).getByText('Sep 2, 2026')).toBeInTheDocument();

    // Aug 20 is before the day already picked, so it becomes the start and the
    // range spans the month boundary — which is the ordinary case for a range.
    await user.click(within(picker).getByRole('gridcell', { name: 'Aug 20, 2026' }));
    await user.click(within(picker).getByRole('button', { name: 'Show 2 briefs' }));
    expect(storyTitles().sort()).toEqual(['Story last-month', 'Story last-week']);
  });

  test('Escape closes the picker without committing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole('group', { name: 'Filter briefs by date' });

    await openPicker(user);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Custom date range' })).not.toBeInTheDocument();
    expect(storyTitles()).toHaveLength(4);
  });
});
