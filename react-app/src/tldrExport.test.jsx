import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  afterEach, describe, expect, test, vi,
} from 'vitest';
import TldrPage from './pages/TldrPage.jsx';
import {
  SITE_URL, buildFacebookPost, exportFileName, toUnicodeBold,
} from './tldrExport.js';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;

const digest = {
  generated_at: '2026-09-21T08:00:00Z',
  items: [
    {
      article_url: 'https://example.com/a', title: 'GPU news', site: 'nvidia', tldr_text: 'Chips got\nfaster.',
    },
    {
      article_url: 'javascript:alert(1)', title: 'Bad link', site: 'blog', tldr_text: 'Unsafe.',
    },
  ],
};

const safeUrl = (url) => (url.startsWith('https://') ? url : '');

afterEach(() => {
  vi.clearAllMocks();
});

describe('Facebook post export', () => {
  test('bolds letters and digits, keeps punctuation and accents', () => {
    expect(toUnicodeBold('Ab 1!')).toBe('𝗔𝗯 𝟭!');
    expect(toUnicodeBold('É').normalize('NFD')).toBe('𝗘́');
  });

  test('uses no Markdown syntax Facebook would show literally, and ends with the site link', () => {
    const post = buildFacebookPost({ title: 'Cyber Security', digest, safeUrl });

    expect(post).not.toMatch(/\*\*|\]\(|^#{1,6} /m);
    expect(post).toContain(toUnicodeBold('1. GPU news'));
    expect(post).toContain('Chips got faster.');
    expect(post).toContain('Source: NVIDIA\nhttps://example.com/a');
    expect(post).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(post).not.toMatch(/[━─—-]{3,}/);
    expect(post).not.toContain('javascript:');
    expect(post.trimEnd().split('\n').slice(-3)).toEqual([SITE_URL, '', '#CyberSecurity #TLDR #PrecisNews']);
  });

  test('names the file after the topic and digest date', () => {
    expect(exportFileName('ai', digest.generated_at)).toBe('precis-tldr-ai-2026-09-21.md');
  });

  test('the TLDR page previews the open tab in a popup and saves it as a .md file', async () => {
    axios.get.mockResolvedValue({ data: { digests: { AI: digest } } });
    const createObjectURL = vi.fn(() => 'blob:x');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<MemoryRouter initialEntries={['/tldr']}><TldrPage /></MemoryRouter>);
    const button = await screen.findByRole('button', { name: 'Preview MD' });
    await userEvent.click(button);

    // Opening the preview does not download anything yet.
    const dialog = screen.getByRole('dialog');
    expect(click).not.toHaveBeenCalled();
    expect(within(dialog).getByText('precis-tldr-ai-2026-09-21.md')).toBeInTheDocument();
    const preview = within(dialog).getByRole('textbox', { name: 'Exported Markdown' });
    expect(preview.value).toContain(SITE_URL);
    expect(preview.value).toContain('Chips got faster.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save .md' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0].download).toBe('precis-tldr-ai-2026-09-21.md');
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(createObjectURL.mock.calls[0][0]);
    });
    expect(text).toBe(preview.value);
    click.mockRestore();
  });

  test('the export popup closes with Close and with Escape', async () => {
    axios.get.mockResolvedValue({ data: { digests: { AI: digest } } });
    render(<MemoryRouter initialEntries={['/tldr']}><TldrPage /></MemoryRouter>);
    const button = await screen.findByRole('button', { name: 'Preview MD' });

    await userEvent.click(button);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('export is disabled when the open tab has no items', async () => {
    axios.get.mockResolvedValue({ data: { digests: {} } });
    render(<MemoryRouter initialEntries={['/tldr']}><TldrPage /></MemoryRouter>);
    await screen.findByText(/No digest has been generated/);
    expect(screen.getByRole('button', { name: 'Preview MD' })).toBeDisabled();
  });
});
