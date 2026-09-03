import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import App from './App.jsx';
import { buildVocabulary } from './filters';

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

// Six briefs, all on one topic so the default topic filter is not in the way.
const item = (n, site, tags) => ({
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
  tags,
});

const ITEMS = [
  item(1, 'open_ai', ['LLM Release', 'Agentic AI']),
  item(2, 'open_ai', ['LLM Release']),
  item(3, 'nvidia', ['Agentic AI']),
  item(4, 'nvidia', ['Ransomware']),
  item(5, 'krebs_on_security', ['Ransomware']),
  item(6, 'krebs_on_security', []),
];

const toFacetArray = (map) => [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
const vocabulary = buildVocabulary(ITEMS);

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const tagsSection = () => screen.getByRole('button', { name: /^Tags/ }).closest('.filter-panel-group');

const tagRow = (label) => within(tagsSection())
  .getByRole('checkbox', { name: new RegExp(`^${label}`) });

const openPanel = async (user) => {
  await user.click(await screen.findByRole('button', { name: /^Filters/ }));
  // Topics and Sources open collapsed; Tags is the group the panel opens on.
  return screen.getByRole('dialog');
};

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

describe('tag filter', () => {
  test('lists the day\'s tags with the rows each one returns on its own', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    expect(screen.getByRole('button', { name: 'Tags · 3' })).toBeInTheDocument();
    expect(tagRow('LLM Release')).toHaveTextContent('LLM Release2');
    expect(tagRow('Agentic AI')).toHaveTextContent('Agentic AI2');
    expect(tagRow('Ransomware')).toHaveTextContent('Ransomware2');
  });

  test('a selection switches the other rows to what they would ADD, with a +', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(tagRow('LLM Release'));

    // Story 1 already matches LLM Release, so Agentic AI only brings story 3.
    expect(tagRow('Agentic AI')).toHaveTextContent('+1');
    expect(tagRow('Ransomware')).toHaveTextContent('+2');
    expect(tagRow('LLM Release')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Show 2 briefs' })).toBeInTheDocument();
  });

  test('Select all picks up every tag in the group, not just the visible rows', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(within(tagsSection()).getByRole('button', { name: 'Select all' }));

    ['LLM Release', 'Agentic AI', 'Ransomware'].forEach((label) => {
      expect(tagRow(label)).toHaveAttribute('aria-checked', 'true');
    });
    // Tags are OR'd, so this is "anything carrying a tag" — story 6 has none.
    expect(screen.getByRole('button', { name: 'Show 5 briefs' })).toBeInTheDocument();
  });

  test('Select all is spent once everything is selected, and Clear empties the group', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    const selectAll = () => within(tagsSection()).getByRole('button', { name: 'Select all' });
    const clear = () => within(tagsSection()).getByRole('button', { name: 'Clear' });

    expect(clear()).toHaveAttribute('aria-disabled', 'true');

    await user.click(selectAll());
    expect(selectAll()).toHaveAttribute('aria-disabled', 'true');
    expect(clear()).not.toHaveAttribute('aria-disabled');

    await user.click(clear());
    expect(tagRow('LLM Release')).toHaveAttribute('aria-checked', 'false');
    // Back to the six the default topic filter alone returns.
    expect(screen.getByRole('button', { name: 'Show 6 briefs' })).toBeInTheDocument();
  });

  test('Clear also drops exclusions, and Select all leaves them alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(within(tagsSection()).getByRole('button', { name: 'Exclude tag: Ransomware' }));
    await user.click(within(tagsSection()).getByRole('button', { name: 'Select all' }));

    // Excluding is deliberate; selecting everything must not silently undo it.
    expect(tagRow('Ransomware')).toHaveTextContent('excluded');
    expect(tagRow('LLM Release')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Show 3 briefs' })).toBeInTheDocument();

    await user.click(within(tagsSection()).getByRole('button', { name: 'Clear' }));
    expect(tagRow('Ransomware')).not.toHaveTextContent('excluded');
    expect(screen.getByRole('button', { name: 'Show 6 briefs' })).toBeInTheDocument();
  });

  test('Select all under a search selects only what the search matched', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.type(screen.getByLabelText('Find a source, topic or tag'), 'ransom');
    await user.click(within(tagsSection()).getByRole('button', { name: 'Select all' }));
    await user.clear(screen.getByLabelText('Find a source, topic or tag'));

    expect(tagRow('Ransomware')).toHaveAttribute('aria-checked', 'true');
    expect(tagRow('LLM Release')).toHaveAttribute('aria-checked', 'false');
  });

  test('the − control excludes a tag from any state and the row says so', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(within(tagsSection()).getByRole('button', { name: 'Exclude tag: Ransomware' }));

    expect(tagRow('Ransomware')).toHaveTextContent('excluded');
    expect(tagRow('Ransomware')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Show 4 briefs' })).toBeInTheDocument();
  });

  test('exclusion wins over an include that matched the same article', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(tagRow('LLM Release'));
    await user.click(within(tagsSection()).getByRole('button', { name: 'Exclude tag: Agentic AI' }));

    // Story 1 carries both, so only story 2 survives.
    expect(screen.getByRole('button', { name: 'Show 1 brief' })).toBeInTheDocument();
  });

  test('Apply commits the draft, filters the list, and writes slugs to the URL', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(tagRow('Ransomware'));
    await user.click(screen.getByRole('button', { name: 'Show 2 briefs' }));

    expect(screen.queryByText('Story 1')).not.toBeInTheDocument();
    expect(screen.getByText('Story 4')).toBeInTheDocument();
    expect(window.location.search).toContain('tags=ransomware');
    expect(window.location.search).not.toContain('tags_mode');
  });

  test('the draft is discarded on Cancel and the list is untouched', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(tagRow('Ransomware'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Story 1')).toBeInTheDocument();
    expect(window.location.search).not.toContain('tags=');
  });

  test('an applied tag appears as a chip that removes itself without an Apply', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(tagRow('Ransomware'));
    await user.click(screen.getByRole('button', { name: 'Show 2 briefs' }));
    await user.click(screen.getByRole('button', { name: 'Remove filter: Ransomware' }));

    expect(screen.getByText('Story 1')).toBeInTheDocument();
    expect(window.location.search).not.toContain('tags=');
  });

  test('an empty combination explains itself instead of blanking the region', async () => {
    // No krebs_on_security story carries LLM Release, so this combination is dead.
    window.history.replaceState(null, '', '/?source=krebs_on_security&tags=llm-release');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Nothing matches this combination today.')).toBeInTheDocument();

    // The panel still opens, and still lists every tag — most of them at 0.
    await openPanel(user);
    expect(tagRow('LLM Release')).toHaveAttribute('aria-checked', 'true');
    // Still ANY mode with a selection, so this reads as an addition of nothing.
    expect(tagRow('Agentic AI')).toHaveTextContent('Agentic AI+0');
  });

  test('a slug named in both URL lists resolves to excluded, and the include is dropped', async () => {
    window.history.replaceState(null, '', '/?tags=llm-release&not_tags=llm-release');
    render(<App />);

    // not_tags wins, so this is an exclusion, not an empty combination.
    expect(await screen.findByText('Story 3')).toBeInTheDocument();
    expect(screen.queryByText('Story 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop excluding: LLM Release' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove filter: LLM Release' })).not.toBeInTheDocument();
  });

  test('a URL tag that is not in today\'s edition is kept, chipped and honest at 0', async () => {
    window.history.replaceState(null, '', '/?topic=&tags=zero-day-exploit');
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText('Nothing matches this combination today.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove filter: Zero Day Exploit' })).toBeInTheDocument();

    await openPanel(user);
    expect(tagRow('Zero Day Exploit')).toHaveTextContent('Zero Day Exploit0');
  });

  test('a tag label with punctuation is rendered verbatim, not re-slugged', async () => {
    const punctuated = [item(1, 'nvidia', ['Zero-Day / Exploit', 'Identity & Access (IAM)'])];
    const vocab = buildVocabulary(punctuated);
    axios.get.mockImplementation(() => Promise.resolve({
      data: { items: punctuated, facets: { tags: toFacetArray(vocab.tags), sources: [], topics: [] } },
    }));

    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    expect(within(tagsSection()).getByRole('checkbox', { name: /Zero-Day \/ Exploit/ })).toBeInTheDocument();
    expect(within(tagsSection()).getByRole('checkbox', { name: /Identity & Access \(IAM\)/ })).toBeInTheDocument();

    // ...but the URL still carries the slug, never the label.
    await user.click(within(tagsSection()).getByRole('checkbox', { name: /Zero-Day \/ Exploit/ }));
    await user.click(screen.getByRole('button', { name: 'Show 1 brief' }));
    expect(window.location.search).toContain('tags=zero-day-exploit');
  });

  test('the panel search spans all three groups and says so when nothing matches', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.type(screen.getByLabelText('Find a source, topic or tag'), 'ransom');
    expect(within(tagsSection()).getByRole('checkbox', { name: /Ransomware/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /LLM Release/ })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Find a source, topic or tag'));
    await user.type(screen.getByLabelText('Find a source, topic or tag'), 'zzz');
    expect(screen.getByText('No source, topic or tag matches that.')).toBeInTheDocument();
  });

  test('row order is frozen while the panel is open so rows do not move under the cursor', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    // Compare labels, not whole rows: the counts and the state glyphs are meant
    // to change under a draft edit — only the ordering must hold still.
    const order = () => within(tagsSection()).getAllByRole('checkbox')
      .map((row) => row.querySelector('.filter-panel-row-label').textContent);
    const before = order();

    await user.click(tagRow('LLM Release'));
    await user.click(within(tagsSection()).getByRole('button', { name: 'Exclude tag: Ransomware' }));

    expect(order()).toEqual(before);
  });

  test('sources and topics are counted against the same draft as tags', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openPanel(user);

    await user.click(tagRow('Ransomware'));
    await user.click(screen.getByRole('button', { name: /^Sources/ }));

    const sources = screen.getByRole('button', { name: /^Sources/ }).closest('.filter-panel-group');
    expect(within(sources).getByRole('checkbox', { name: /NVIDIA/ })).toHaveTextContent('NVIDIA1');
    expect(within(sources).getByRole('checkbox', { name: /OpenAI/ })).toHaveTextContent('OpenAI0');
  });
});
