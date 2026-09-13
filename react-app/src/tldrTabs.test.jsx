import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import TldrPage from './pages/TldrPage.jsx';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const digestItem = (n, topic) => ({
  article_url: `https://example.com/${topic}-${n}`,
  title: `${topic} headline ${n}`,
  site: 'nvidia',
  tldr_text: `${topic} summary ${n}.`,
});

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <TldrPage />
  </MemoryRouter>,
);

const tab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  axios.get.mockResolvedValue({
    data: {
      digests: {
        AI: { topic: 'AI', generated_at: new Date().toISOString(), items: [digestItem(1, 'AI'), digestItem(2, 'AI')] },
        'Cyber Security': {
          topic: 'Cyber Security', generated_at: new Date().toISOString(), items: [digestItem(1, 'Cyber')],
        },
      },
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TLDR tabs', () => {
  test('offers AI and Cyber Security only, opening on AI', async () => {
    renderAt('/tldr');

    expect(await screen.findByText('AI summary 1.')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Digest topic' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual(['AI2', 'Cyber Security1']);
    expect(tab('AI')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tldr-tab-ai');
    expect(screen.queryByText('Cyber summary 1.')).not.toBeInTheDocument();
  });

  test('clicking a tab switches the digest shown', async () => {
    const user = userEvent.setup();
    renderAt('/tldr');
    await screen.findByText('AI summary 1.');

    await user.click(tab('Cyber Security'));

    expect(tab('Cyber Security')).toHaveAttribute('aria-selected', 'true');
    expect(tab('AI')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Cyber summary 1.')).toBeInTheDocument();
    expect(screen.queryByText('AI summary 1.')).not.toBeInTheDocument();
  });

  test('arrow keys move between tabs, wrap, and take focus with them', async () => {
    const user = userEvent.setup();
    renderAt('/tldr');
    await screen.findByText('AI summary 1.');

    tab('AI').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Cyber Security')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Cyber Security')).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(tab('AI')).toHaveFocus();
    expect(tab('AI')).toHaveAttribute('aria-selected', 'true');
  });

  test('a ?topic link opens straight onto that tab', async () => {
    renderAt('/tldr?topic=cyber-security');

    expect(await screen.findByText('Cyber summary 1.')).toBeInTheDocument();
    expect(tab('Cyber Security')).toHaveAttribute('aria-selected', 'true');
  });

  test('a topic with no digest says so', async () => {
    axios.get.mockResolvedValue({ data: { digests: { AI: null, 'Cyber Security': null } } });
    renderAt('/tldr?topic=cyber-security');

    expect(await screen.findByText('No digest has been generated for Cyber Security yet.')).toBeInTheDocument();
  });
});
