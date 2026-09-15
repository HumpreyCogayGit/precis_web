import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import TldrPage from './pages/TldrPage.jsx';
import TldrArt, { leadTag, motifFor } from './components/TldrArt.jsx';

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
  window.localStorage.clear();
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

  test('each item gets generated art led by its topic-matching subject tag', async () => {
    axios.get.mockResolvedValue({
      data: {
        digests: {
          AI: null,
          'Cyber Security': {
            topic: 'Cyber Security',
            generated_at: new Date().toISOString(),
            items: [
              { ...digestItem(1, 'Cyber'), tags: ['Advisory', 'Agentic AI', 'AI Security'] },
              { ...digestItem(2, 'Cyber'), tags: [] },
            ],
          },
        },
      },
    });
    const { container } = renderAt('/tldr?topic=cyber-security');
    await screen.findByText('Cyber summary 1.');

    const arts = [...container.querySelectorAll('.tldr-art')];
    expect(arts.map((node) => node.dataset.motif)).toEqual(['glyphs', 'glyphs']);
    expect(arts.map((node) => node.textContent)).toEqual(['AI Security', 'Cyber Security']);
    // Decorative duplicate of the title link: never a second tab stop.
    expect(container.querySelector('.tldr-item-art')).toHaveAttribute('tabindex', '-1');
  });

  test('a source image is shown through the proxy, falling back to generated art if it fails', async () => {
    const imageUrl = 'https://cdn.example.com/a.png';
    axios.get.mockResolvedValue({
      data: {
        digests: {
          AI: {
            topic: 'AI',
            generated_at: new Date().toISOString(),
            items: [{ ...digestItem(1, 'AI'), image_url: imageUrl, tags: ['LLM Release'] }],
          },
          'Cyber Security': null,
        },
      },
    });
    const { container } = renderAt('/tldr');
    await screen.findByText('AI summary 1.');

    const img = container.querySelector('.tldr-art img');
    expect(img.getAttribute('src')).toContain(`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);

    fireEvent.error(img);
    expect(container.querySelector('.tldr-art img')).toBeNull();
    expect(container.querySelector('.tldr-art')).toHaveAttribute('data-motif', 'particles');
  });

  test('art is stable for the same article', () => {
    const item = { ...digestItem(1, 'AI'), tags: ['AI Hardware & Chips'] };
    const first = render(<TldrArt item={item} topic="AI" />).container.innerHTML;
    const second = render(<TldrArt item={item} topic="AI" />).container.innerHTML;
    expect(first).toBe(second);
    expect(leadTag(['GENERAL', 'Podcast'], 'AI')).toBe('AI');
    expect(motifFor('AI Hardware & Chips', 'AI')).toBe('beams');
  });

  test('the layout toggle switches views, drops art in compact, and is remembered', async () => {
    const user = userEvent.setup();
    const { container, unmount } = renderAt('/tldr');
    await screen.findByText('AI summary 1.');
    const list = () => container.querySelector('.tldr-list');

    expect(screen.getByRole('group', { name: 'Layout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    expect(list()).toHaveClass('tldr-list--list');

    await user.click(screen.getByRole('button', { name: 'Compact view' }));
    expect(screen.getByRole('button', { name: 'Compact view' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'false');
    expect(list()).toHaveClass('tldr-list--compact');
    expect(container.querySelector('.tldr-art')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(list()).toHaveClass('tldr-list--grid');
    expect(container.querySelectorAll('.tldr-art')).toHaveLength(2);
    unmount();

    const again = renderAt('/tldr');
    await screen.findByText('AI summary 1.');
    expect(again.container.querySelector('.tldr-list')).toHaveClass('tldr-list--grid');
  });

  test('a topic with no digest says so', async () => {
    axios.get.mockResolvedValue({ data: { digests: { AI: null, 'Cyber Security': null } } });
    renderAt('/tldr?topic=cyber-security');

    expect(await screen.findByText('No digest has been generated for Cyber Security yet.')).toBeInTheDocument();
  });
});
