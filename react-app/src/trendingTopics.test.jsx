import {
  render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import App from './App.jsx';
import TrendingSection, { formatGrowth, spokenGrowth } from './components/TrendingSection.jsx';

const row = (rank, tag, growth, { nowN = 6, prevN = 3, isNew = false } = {}) => ({
  rank,
  tag,
  slug: tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  now_n: nowN,
  prev_n: prevN,
  growth_pct: growth,
  is_new: isNew,
});

const WINDOWS = {
  '24h': {
    AI: [row(1, 'LLM Release', 300, { nowN: 3, prevN: 0, isNew: true })],
    'Cyber Security': [row(1, 'Data Breach', 55)],
  },
  '7d': {
    AI: [
      row(1, 'Agentic AI', 42, { nowN: 12 }),
      row(2, 'Open Source Models', 31, { nowN: 6 }),
      row(3, 'AI Coding Agents', -8, { nowN: 3 }),
    ],
    'Cyber Security': [row(1, 'Ransomware', 27), row(2, 'Zero-Day / Exploit', 19)],
  },
  '30d': { AI: [], 'Cyber Security': [row(1, 'Ransomware', 12)] },
};

// The combined ranking the home page shows when no single topic is selected.
WINDOWS['24h'].All = [row(1, 'LLM Release', 300, { nowN: 3, prevN: 0, isNew: true }), row(2, 'Data Breach', 55)];
WINDOWS['7d'].All = [row(1, 'Agentic AI', 42, { nowN: 12 }), row(2, 'Ransomware', 27), row(3, 'Zero-Day / Exploit', 19)];
WINDOWS['30d'].All = [row(1, 'Ransomware', 12)];

const region = (name) => screen.getByRole('region', { name });
const windowTab = (section, label) => within(section).getByRole('button', { name: label });
const trendRow = (section, tag) => within(section).getByRole('button', { name: new RegExp(`^${tag.replace(/[/]/g, '\\/')},`) });

const renderBoth = (props = {}) => render(
  <>
    <TrendingSection topic="AI" title="Rising in AI" storageKey="test.ai" windows={WINDOWS} {...props} />
    <TrendingSection topic="Cyber Security" title="Rising in Cyber Security" storageKey="test.cyber" windows={WINDOWS} {...props} />
  </>,
);

beforeEach(() => {
  window.localStorage.clear();
});

describe('TrendingSection', () => {
  test('renders two separate sections, each with its own heading and 24h | 7d | 30d toggle', () => {
    renderBoth();

    for (const name of ['Rising in AI', 'Rising in Cyber Security']) {
      const section = region(name);
      expect(within(section).getByRole('heading', { name })).toBeInTheDocument();
      const toggle = within(section).getByRole('group', { name: `${name} time window` });
      expect(within(toggle).getAllByRole('button').map((node) => node.textContent)).toEqual(['24h', '7d', '30d']);
      expect(windowTab(section, '7d')).toHaveAttribute('aria-pressed', 'true');
    }

    expect(within(region('Rising in AI')).getAllByRole('listitem')).toHaveLength(3);
    expect(within(region('Rising in Cyber Security')).getAllByRole('listitem')).toHaveLength(2);
    expect(within(region('Rising in AI')).queryByText('Ransomware')).toBeNull();
  });

  test('switching one section\'s window leaves the other section alone', async () => {
    const user = userEvent.setup();
    renderBoth();

    await user.click(windowTab(region('Rising in AI'), '24h'));

    expect(windowTab(region('Rising in AI'), '24h')).toHaveAttribute('aria-pressed', 'true');
    expect(within(region('Rising in AI')).getByText('LLM Release')).toBeInTheDocument();
    expect(within(region('Rising in AI')).queryByText('Agentic AI')).toBeNull();

    expect(windowTab(region('Rising in Cyber Security'), '7d')).toHaveAttribute('aria-pressed', 'true');
    expect(within(region('Rising in Cyber Security')).getByText('Zero-Day / Exploit')).toBeInTheDocument();
  });

  test('remembers each section\'s window separately', async () => {
    const user = userEvent.setup();
    const { unmount } = renderBoth();
    await user.click(windowTab(region('Rising in Cyber Security'), '30d'));
    unmount();

    renderBoth();
    expect(windowTab(region('Rising in Cyber Security'), '30d')).toHaveAttribute('aria-pressed', 'true');
    expect(windowTab(region('Rising in AI'), '7d')).toHaveAttribute('aria-pressed', 'true');
  });

  test('bars scale with article count, not growth, and a falling tag is marked down', () => {
    renderBoth();
    const ai = region('Rising in AI');
    const bar = (tag) => trendRow(ai, tag).querySelector('.topic-trend-bar');

    expect(bar('Agentic AI').firstChild.style.width).toBe('100%');
    expect(bar('Open Source Models').firstChild.style.width).toBe('50%');
    expect(bar('AI Coding Agents').firstChild.style.width).toBe('25%');
    expect(bar('AI Coding Agents')).toHaveClass('topic-trend-bar--down');
    expect(bar('Agentic AI')).toHaveClass('topic-trend-bar--up');
    expect(trendRow(ai, 'Agentic AI').querySelector('.topic-trend-count')).toHaveTextContent('12');
  });

  test('the ? beside each title explains the numbers for the selected window, on click and on hover', async () => {
    const user = userEvent.setup();
    renderBoth();
    const ai = region('Rising in AI');
    const help = within(ai).getByRole('button', { name: 'How Rising in AI is calculated' });
    const panel = document.getElementById(help.getAttribute('aria-controls'));
    const cyberHelp = within(region('Rising in Cyber Security')).getByRole('button', { name: 'How Rising in Cyber Security is calculated' });
    const cyberPanel = document.getElementById(cyberHelp.getAttribute('aria-controls'));

    expect(help).toHaveAttribute('aria-expanded', 'false');
    expect(panel).not.toBeVisible();

    await user.click(windowTab(ai, '24h'));
    await user.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent('share of the news increased or decreased over the last 24 hours compared with the previous 24 hours');
    expect(cyberPanel).not.toBeVisible();

    await user.keyboard('{Escape}');
    expect(panel).not.toBeVisible();

    await user.hover(cyberHelp);
    expect(cyberPanel).toBeVisible();
    expect(cyberPanel).toHaveTextContent('share of the news increased or decreased over the last 7 days compared with the previous 7 days');
    await user.unhover(cyberHelp);
    await waitFor(() => expect(cyberPanel).not.toBeVisible());

    await user.click(help);
    expect(panel).toBeVisible();
    await user.click(document.body);
    expect(panel).not.toBeVisible();
  });

  test('Show all reveals every ranked category and Show top 5 collapses again, per section', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 8 }, (_, n) => row(n + 1, `AI Tag ${n + 1}`, 40 - n * 10, { nowN: 20 - n }));
    const windows = {
      '24h': { AI: [], 'Cyber Security': [] },
      '7d': { AI: many, 'Cyber Security': WINDOWS['7d']['Cyber Security'] },
      '30d': { AI: [], 'Cyber Security': [] },
    };
    render(
      <>
        <TrendingSection topic="AI" title="Rising in AI" storageKey="test.ai" windows={windows} />
        <TrendingSection topic="Cyber Security" title="Rising in Cyber Security" storageKey="test.cyber" windows={windows} />
      </>,
    );

    const ai = region('Rising in AI');
    expect(within(ai).getAllByRole('listitem')).toHaveLength(5);
    const expand = within(ai).getByRole('button', { name: 'Show all 8' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    // Two rows fit without a toggle.
    expect(within(region('Rising in Cyber Security')).queryByRole('button', { name: /^Show/ })).toBeNull();

    await user.click(expand);
    expect(within(ai).getAllByRole('listitem')).toHaveLength(8);
    expect(trendRow(ai, 'AI Tag 8')).toBeInTheDocument();
    // Bars are scaled against every row, so expanding does not change their length.
    expect(trendRow(ai, 'AI Tag 1').querySelector('.topic-trend-bar').firstChild.style.width).toBe('100%');

    const collapse = within(ai).getByRole('button', { name: 'Show top 5' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await user.click(collapse);
    expect(within(ai).getAllByRole('listitem')).toHaveLength(5);
  });

  test('the combined ranking shows no topic suffix, a narrowed one names its topic', () => {
    render(
      <>
        <TrendingSection topic="All" title="Rising Now" storageKey="test.all" windows={WINDOWS} />
        <TrendingSection topic="AI" title="Rising Now" context="in AI" storageKey="test.narrow" windows={WINDOWS} />
      </>,
    );

    const combined = region('Rising Now');
    expect(within(combined).getByText('Agentic AI')).toBeInTheDocument();
    expect(within(combined).getByText('Ransomware')).toBeInTheDocument();

    const narrowed = region('Rising Now in AI');
    expect(within(narrowed).getByText('Open Source Models')).toBeInTheDocument();
    expect(within(narrowed).queryByText('Ransomware')).toBeNull();
  });

  test('an empty window says so instead of vanishing, and a topic with no rows anywhere hides', async () => {
    const user = userEvent.setup();
    renderBoth();
    await user.click(windowTab(region('Rising in AI'), '30d'));
    expect(within(region('Rising in AI')).getByText(/Not enough AI coverage in the last 30 days/)).toBeInTheDocument();

    const empty = { '24h': { AI: [], 'Cyber Security': [] }, '7d': { AI: [], 'Cyber Security': [] }, '30d': { AI: [], 'Cyber Security': [] } };
    render(<TrendingSection topic="AI" title="Quiet AI" storageKey="test.quiet" windows={empty} />);
    expect(screen.queryByRole('region', { name: 'Quiet AI' })).toBeNull();
  });

  test('shows growth with ▲ / ▼ arrows or New, and a row reports its tag slug when pressed', async () => {
    const user = userEvent.setup();
    const onSelectTag = vi.fn();
    renderBoth({ onSelectTag, activeTagSlugs: ['ransomware'] });

    const ai = region('Rising in AI');
    expect(within(trendRow(ai, 'Agentic AI')).getByText('▲ 42%')).toBeInTheDocument();
    expect(within(trendRow(ai, 'AI Coding Agents')).getByText('▼ 8%')).toBeInTheDocument();
    expect(formatGrowth(WINDOWS['24h'].AI[0])).toBe('New');
    expect(formatGrowth({ growth_pct: 0, is_new: false })).toBe('0%');
    // Screen readers get words, not triangle glyphs.
    expect(trendRow(ai, 'Agentic AI')).toHaveAccessibleName(/^Agentic AI, up 42%\./);
    expect(trendRow(ai, 'AI Coding Agents')).toHaveAccessibleName(/^AI Coding Agents, down 8%\./);
    expect(spokenGrowth({ growth_pct: 0, is_new: false })).toBe('no change');

    expect(trendRow(region('Rising in Cyber Security'), 'Ransomware')).toHaveAttribute('aria-pressed', 'true');
    expect(trendRow(ai, 'Agentic AI')).toHaveAttribute('aria-pressed', 'false');

    await user.click(trendRow(region('Rising in Cyber Security'), 'Zero-Day / Exploit'));
    expect(onSelectTag).toHaveBeenCalledWith('zero-day-exploit');
  });
});

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const item = (n, topic, tags) => ({
  url: `https://example.com/${n}`,
  site: 'nvidia',
  topic,
  topics: [topic],
  title: `${topic} story ${n}`,
  author: 'Precis',
  published_at: '2026-09-09T09:00:00Z',
  image_url: '',
  summary: `Summary ${n}.`,
  excerpt: `Summary ${n}.`,
  fetched_at: '2026-09-09T09:00:00Z',
  tags,
});

const ITEMS = [
  item(1, 'AI', ['Agentic AI']),
  item(2, 'Cyber Security', ['Ransomware']),
];

describe('home page trending sections', () => {
  const shows = (title) => screen.queryAllByText(title).length > 0;

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  const mockApi = ({ trendsFail = false } = {}) => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/topic-trends')) {
        return trendsFail ? Promise.reject(new Error('boom')) : Promise.resolve({ data: { windows: WINDOWS } });
      }
      if (url.includes('/api/trending')) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: { items: ITEMS } });
    });
  };

  test('renders one Rising Now panel, and a row filters the edition to its tag', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<App />);

    const ai = await screen.findByRole('region', { name: 'Rising Now' });
    expect(screen.getAllByRole('region', { name: /^Rising/ })).toHaveLength(1);
    expect(axios.get.mock.calls.filter(([url]) => url.includes('/api/topic-trends'))).toHaveLength(1);

    await user.click(trendRow(ai, 'Agentic AI'));
    expect(trendRow(region('Rising Now'), 'Agentic AI')).toHaveAttribute('aria-pressed', 'true');
    expect(shows('AI story 1')).toBe(true);
    expect(shows('Cyber Security story 2')).toBe(false);

    await user.click(trendRow(region('Rising Now'), 'Agentic AI'));
    expect(trendRow(region('Rising Now'), 'Agentic AI')).toHaveAttribute('aria-pressed', 'false');
    expect(shows('Cyber Security story 2')).toBe(true);
  });

  test('Top Stories lists a shared article once, before and after a Rising filter is applied and cleared', async () => {
    // Two trending entities with the same representative article, as the pipeline
    // produced for "Revolut" — plus one other story.
    const story = (n) => ({ ...ITEMS[n], is_representative: true });
    const pool = [
      { entity: 'Revolut', articles: [story(1)] },
      { entity: 'Agents', articles: [story(0)] },
      { entity: 'Revolut', articles: [story(1)] },
    ];
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/topic-trends')) {
        return Promise.resolve({ data: { windows: WINDOWS } });
      }
      if (url.includes('/api/trending')) {
        return Promise.resolve({ data: pool });
      }
      return Promise.resolve({ data: { items: ITEMS } });
    });
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error');
    render(<App />);

    const topStories = await screen.findByRole('region', { name: 'Top Stories' });
    const rows = () => screen.getByRole('region', { name: 'Top Stories' }).querySelectorAll('.brief-row');
    const titles = () => [...rows()].map((node) => node.textContent);
    expect(topStories.querySelectorAll('.brief-row')).toHaveLength(2);

    await user.click(trendRow(region('Rising Now'), 'Agentic AI'));
    expect(titles().some((text) => text.includes('Cyber Security story 2'))).toBe(false);

    await user.click(trendRow(region('Rising Now'), 'Agentic AI'));
    expect(rows()).toHaveLength(2);
    expect(titles().filter((text) => text.includes('Cyber Security story 2'))).toHaveLength(1);
    expect(titles().filter((text) => text.includes('AI story 1'))).toHaveLength(1);

    // No React duplicate-key warning along the way.
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });

  test('Rising Now follows the topic filter: one topic narrows it, clearing it shows everything again', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<App />);

    const panel = await screen.findByRole('region', { name: 'Rising Now' });
    expect(within(panel).getByText('Agentic AI')).toBeInTheDocument();
    expect(within(panel).getByText('Ransomware')).toBeInTheDocument();

    const topicTab = (name) => within(screen.getByRole('group', { name: 'Filter by topic' }))
      .getByRole('button', { name: new RegExp(`^${name}`) });

    await user.click(topicTab('Cyber Security'));
    const cyber = region('Rising Now in Cyber Security');
    expect(within(cyber).getByText('Ransomware')).toBeInTheDocument();
    expect(within(cyber).getByText('Zero-Day / Exploit')).toBeInTheDocument();
    expect(within(cyber).queryByText('Agentic AI')).toBeNull();

    await user.click(topicTab('AI'));
    const ai = region('Rising Now in AI');
    expect(within(ai).getByText('Open Source Models')).toBeInTheDocument();
    expect(within(ai).queryByText('Ransomware')).toBeNull();

    await user.click(topicTab('AI'));
    expect(within(region('Rising Now')).getByText('Ransomware')).toBeInTheDocument();
  });

  test('a failed trends request leaves the panel out without breaking the edition', async () => {
    mockApi({ trendsFail: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);

    await screen.findByRole('group', { name: 'Filter by topic' });
    expect(screen.queryByRole('region', { name: /Rising Now/ })).toBeNull();
    expect(shows('AI story 1')).toBe(true);
  });
});
