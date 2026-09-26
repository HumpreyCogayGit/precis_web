import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  beforeEach, describe, expect, test, vi,
} from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;
const { default: ThreatsPage } = await import('./ThreatsPage.jsx');

const ARTICLES = [
  {
    site: 'sploitus', url: 'https://sploitus.com/exploit?id=1', title: 'Exploit for CVE-2025-1974-go',
    summary: 'Description Single-file exploit for ingress-nginx.', tags: ['Zero-Day / Exploit'],
  },
  {
    site: 'oss_security', url: 'https://seclists.org/oss-sec/2026/q3/1', title: 'Linux kernel use-after-free',
    summary: 'A flaw in the netfilter subsystem.', tags: ['Vulnerability Disclosure'],
  },
];

const renderPage = (path = '/threats') => render(
  <MemoryRouter initialEntries={[path]}>
    <ThreatsPage />
  </MemoryRouter>,
);

describe('ThreatsPage search', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockResolvedValue({ data: { items: ARTICLES, next_offset: null } });
  });

  test('asks the API for the threat feeds only', async () => {
    renderPage();
    await screen.findByText('Linux kernel use-after-free');

    expect(axios.get.mock.calls[0][0]).toContain('site=sploitus,oss_security');
  });

  test('every search word must match, across title, summary and tags', async () => {
    renderPage();
    const search = await screen.findByRole('searchbox', { name: /search threats/i });

    fireEvent.change(search, { target: { value: 'netfilter kernel' } });
    expect(screen.getByText('1 match for', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Exploit for CVE-2025-1974-go')).toBeNull();

    fireEvent.change(search, { target: { value: 'zero-day' } });
    expect(screen.getByText('CVE-2025-1974-go', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Linux kernel use-after-free')).toBeNull();
  });

  test('a query from the URL is applied on load and can be cleared', async () => {
    renderPage('/threats?q=nomatch');

    expect(await screen.findByText(/No threats match "nomatch"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('Linux kernel use-after-free')).toBeInTheDocument();
  });
});
