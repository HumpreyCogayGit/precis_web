import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import App from './App.jsx';
import { buildVocabulary } from './filters';

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

const item = (n, site, title, summary, tags = []) => ({
  url: `https://example.com/${n}`,
  site,
  topic: site === 'krebs_on_security' ? 'Cyber Security' : 'AI',
  title,
  author: 'Precis',
  published_at: hoursAgo(n),
  image_url: '',
  summary,
  excerpt: `Body text for ${title}, which mentions kubernetes.`,
  fetched_at: hoursAgo(n),
  tags,
});

// Enough spread to tell a headline match from a summary match from a source match.
const ITEMS = [
  item(1, 'open_ai', 'Introducing Codex', 'A coding agent for developers.', ['LLM Release']),
  item(2, 'nvidia', 'New Blackwell chips ship', 'Codex runs faster on them.', ['AI Hardware & Chips']),
  item(3, 'krebs_on_security', 'Hospital hit by ransomware', 'Attackers demanded bitcoin.', ['Ransomware']),
  item(4, 'x_ai_news', 'Grok gains vision', 'Multimodal input arrives.', []),
];

const toFacetArray = (map) => [...map.values()]
  .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
const vocabulary = buildVocabulary(ITEMS);

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
const axios = (await import('axios')).default;

const searchBox = () => screen.getByRole('searchbox', { name: /^Search briefs/ });

const headlines = () => screen.queryAllByRole('heading', { level: 4 }).map((node) => node.textContent);

// The lead story is an h2; under a search there should not be one.
const leadHeadline = () => screen.queryByRole('heading', { level: 2, name: /Codex|chips|ransomware|Grok/ });

const renderApp = async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('searchbox', { name: /^Search briefs/ });
  return user;
};

// Older briefs that exist only in the archive — never in the working set — which is
// the whole reason /api/search exists.
const ARCHIVE_ONLY = [
  item(90, 'open_ai', 'Codex ships to the API', 'An older release note.'),
  item(91, 'anthropic_news', 'Codex compared', 'A retrospective.'),
];

// Set per test to control what /api/search answers. Defaults to "nothing found",
// so a test that says nothing about the archive gets no archive rows.
let archiveResponse;

const searchCalls = () => axios.get.mock.calls
  .map(([url]) => url)
  .filter((url) => url.includes('/api/search'));

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  archiveResponse = { query: '', items: [], total: 0 };

  axios.get.mockImplementation((url) => {
    if (url.includes('/api/search')) {
      return Promise.resolve({ data: archiveResponse });
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

describe('header search', () => {
  test('the box is enabled and advertises the whole working set', async () => {
    await renderApp();
    const box = searchBox();

    expect(box).toBeEnabled();
    expect(box).toHaveAttribute('placeholder', 'Search 4 briefs');
  });

  test('typing narrows the list to matching briefs', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    // Both the headline match and the summary match survive; the other two do not.
    expect(headlines()).toEqual(['Introducing Codex', 'New Blackwell chips ship']);
    expect(screen.queryByText('Grok gains vision')).not.toBeInTheDocument();
  });

  test('the placeholder count does not shrink as the reader types', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    expect(searchBox()).toHaveAttribute('placeholder', 'Search 4 briefs');
  });

  test('a search collapses the front page into one flat result list', async () => {
    const user = await renderApp();

    expect(leadHeadline()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Previous stories' })).toBeInTheDocument();

    await user.type(searchBox(), 'codex');

    // No hero, no "Previous stories" — a search is not an edition.
    expect(leadHeadline()).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Previous stories' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
    expect(screen.getByText('2 briefs mention “codex”')).toBeInTheDocument();
  });

  test('a single result is counted in the singular', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'grok');

    expect(screen.getByText('1 brief mentions “grok”')).toBeInTheDocument();
  });

  test('matched terms are highlighted in the headline and the summary', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    const marks = document.querySelectorAll('mark.search-hit');
    expect([...marks].map((node) => node.textContent)).toEqual(['Codex', 'Codex']);
  });

  test('matching is case-insensitive and every term must match', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'CODEX Blackwell');

    expect(headlines()).toEqual(['New Blackwell chips ship']);
  });

  test('the source matches by the name the reader sees, not the stored slug', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'xai');

    expect(headlines()).toEqual(['Grok gains vision']);
  });

  test('the excerpt is not searched — its text never appears on a result row', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'kubernetes');

    expect(screen.getByRole('heading', { name: /Nothing in today’s edition mentions/ }))
      .toBeInTheDocument();
  });

  test('an empty result explains which list came up empty and offers a way out', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'zzzz');

    expect(screen.getByText('Nothing in today’s edition mentions “zzzz”.')).toBeInTheDocument();
    expect(screen.getByText(/Searched 4 briefs/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(searchBox()).toHaveValue('');
    expect(leadHeadline()).toBeInTheDocument();
  });

  test('the query shows as a removable chip', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    const chip = screen.getByRole('button', { name: 'Clear search: codex' });
    await user.click(chip);

    expect(searchBox()).toHaveValue('');
    expect(headlines().length).toBeGreaterThan(2);
  });

  test('Escape in the box clears the search', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');
    await user.keyboard('{Escape}');

    expect(searchBox()).toHaveValue('');
  });

  test('"/" focuses the box from anywhere on the page', async () => {
    const user = await renderApp();
    expect(searchBox()).not.toHaveFocus();

    await user.keyboard('/');

    expect(searchBox()).toHaveFocus();
    // The slash focuses rather than typing itself into the field.
    expect(searchBox()).toHaveValue('');
  });

  test('the query is written to the URL and composes with a facet filter', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    await waitFor(() => expect(window.location.search).toContain('q=codex'));

    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Sources/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^NVIDIA/ }));
    await user.click(within(dialog).getByRole('button', { name: /^Show/ }));

    expect(headlines()).toEqual(['New Blackwell chips ship']);
    expect(window.location.search).toContain('source=nvidia');
    expect(window.location.search).toContain('q=codex');
  });

  test('a shared ?q= link restores the search on load', async () => {
    window.history.replaceState(null, '', '/?q=Codex');
    await renderApp();

    expect(searchBox()).toHaveValue('Codex');
    expect(headlines()).toEqual(['Introducing Codex', 'New Blackwell chips ship']);
  });

  test('the panel counts read within the active search', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');
    await user.click(screen.getByRole('button', { name: /^Filters/ }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Sources/ }));

    // Krebs has one brief in the edition but none that mention "codex", so the row
    // reads 0 and is disabled rather than promising a result it cannot deliver.
    expect(within(dialog).getByRole('checkbox', { name: /^Krebs/ }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByRole('checkbox', { name: /^NVIDIA/ }))
      .not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('archive escalation', () => {
  test('a search asks the server for the rest of the archive, carrying the query', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    await waitFor(() => expect(searchCalls()).not.toHaveLength(0));
    const url = searchCalls().at(-1);

    expect(url).toContain('/api/search');
    expect(url).toContain('q=codex');
    expect(url).toContain('limit=24');
  });

  test('archive-only briefs are listed under their own heading', async () => {
    archiveResponse = { query: 'codex', items: ARCHIVE_ONLY, total: 2 };
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    // findBy, not getBy: the tier renders a loading state first, and the point of
    // the assertion is what arrives after the request resolves. Matched by heading
    // role rather than text because the highlighter splits "Codex" into its own
    // <mark>, which is itself worth knowing reaches archive rows.
    expect(await screen.findByRole('heading', { name: 'Codex ships to the API' }))
      .toBeInTheDocument();
    const tier = screen.getByRole('region', { name: 'More from the archive' });
    expect(within(tier).getByRole('heading', { name: 'Codex compared' })).toBeInTheDocument();
    expect(within(tier).getByText('2 briefs in the full archive')).toBeInTheDocument();
  });

  test('a brief already shown in the edition is not repeated in the archive tier', async () => {
    // The server legitimately returns the same article the working set holds; the
    // page must not print it twice.
    archiveResponse = { query: 'codex', items: [ITEMS[0], ...ARCHIVE_ONLY], total: 3 };
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    expect(await screen.findByRole('heading', { name: 'Codex ships to the API' }))
      .toBeInTheDocument();
    const tier = screen.getByRole('region', { name: 'More from the archive' });
    expect(within(tier).queryByRole('heading', { name: 'Introducing Codex' }))
      .not.toBeInTheDocument();
    // Still shown once, up in the edition's own results.
    expect(screen.getByRole('heading', { name: 'Introducing Codex' })).toBeInTheDocument();
  });

  test('the archive tier still renders when the edition itself found nothing', async () => {
    // The case the endpoint exists for: the story is older than the working set.
    archiveResponse = { query: 'trainium', items: ARCHIVE_ONLY, total: 2 };
    const user = await renderApp();
    await user.type(searchBox(), 'trainium');

    expect(screen.getByRole('heading', { name: /Nothing in today’s edition mentions/ }))
      .toBeInTheDocument();
    expect(await screen.findByText('Codex ships to the API')).toBeInTheDocument();
  });

  test('a truncated result set says so rather than implying it is everything', async () => {
    archiveResponse = { query: 'codex', items: ARCHIVE_ONLY, total: 137 };
    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    expect(await screen.findByText('Showing the 2 most relevant of 137.')).toBeInTheDocument();
  });

  test('a failed archive request degrades to the local results, not to an error page', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/api/search')) {
        return Promise.reject(new Error('network'));
      }

      return Promise.resolve({ data: { items: ITEMS, facets: null } });
    });

    const user = await renderApp();
    await user.type(searchBox(), 'codex');

    expect(await screen.findByText(/The archive could not be reached/)).toBeInTheDocument();
    // The local results are untouched.
    expect(headlines()).toEqual(['Introducing Codex', 'New Blackwell chips ship']);
  });

  test('the archive is not asked about a one-character query', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'c');

    await new Promise((resolve) => { setTimeout(resolve, 600); });
    expect(searchCalls()).toHaveLength(0);
  });

  test('clearing the search stops the archive tier from rendering', async () => {
    archiveResponse = { query: 'codex', items: ARCHIVE_ONLY, total: 2 };
    const user = await renderApp();
    await user.type(searchBox(), 'codex');
    await screen.findByRole('heading', { name: 'Codex ships to the API' });

    await user.clear(searchBox());

    await waitFor(() => expect(
      screen.queryByRole('region', { name: 'More from the archive' }),
    ).not.toBeInTheDocument());
  });

  test('a facet filter narrows the archive request too', async () => {
    const user = await renderApp();
    await user.type(searchBox(), 'codex');
    await waitFor(() => expect(searchCalls()).not.toHaveLength(0));

    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Sources/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^NVIDIA/ }));
    await user.click(within(dialog).getByRole('button', { name: /^Show/ }));

    // `site`, not `source`: the page's own URL calls this facet `source`, but every
    // API route reads `site`. Sending the page's name fails silently — the endpoint
    // ignores the unknown key and answers with unfiltered results.
    await waitFor(() => expect(searchCalls().at(-1)).toContain('site=nvidia'));
    expect(searchCalls().at(-1)).not.toContain('source=');
    expect(searchCalls().at(-1)).toContain('q=codex');
  });
});
