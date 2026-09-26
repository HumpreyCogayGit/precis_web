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
    threat: {
      v: 1, kind: 'exploit', cves: ['CVE-2025-1974'], cvss: 9.8, cvss_source: 'page', severity: 'critical',
      products: ['Kubernetes', 'Ingress-Nginx'], subject: 'CVE-2025-1974-go', github: null,
    },
  },
  {
    site: 'oss_security', url: 'https://seclists.org/oss-sec/2026/q3/1', title: 'Linux kernel use-after-free',
    summary: 'A flaw in the netfilter subsystem.', tags: ['Vulnerability Disclosure'],
    // No score anywhere yet: the card still draws, without a severity pill.
    threat: {
      v: 1, kind: 'advisory', cves: ['CVE-2026-4242'], cvss: null, severity: null, products: [], subject: null, github: null,
    },
  },
];

const renderPage = (path = '/threats') => render(
  <MemoryRouter initialEntries={[path]}>
    <ThreatsPage />
  </MemoryRouter>,
);

describe('ThreatsPage search', () => {
  beforeEach(() => {
    // The chosen layout persists, so one test's choice must not leak into the next.
    window.localStorage.clear();
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

  test('opens on the list layout and switches to cards and small list', async () => {
    const { container } = renderPage();
    await screen.findByText('Linux kernel use-after-free');
    expect(container.querySelector('.brief-list')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(container.querySelector('.everything-grid')).not.toBeNull();
    expect(container.querySelector('.brief-list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Small list' }));
    expect(container.querySelector('.small-list')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Small list' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('draws a threat card instead of the source logo', async () => {
    const { container } = renderPage();
    await screen.findByText('Linux kernel use-after-free');

    const cover = container.querySelector('.threat-cover--critical');
    expect(cover).not.toBeNull();
    expect(cover).toHaveTextContent('CVE-2025-1974');
    expect(cover).toHaveTextContent('9.8');
    // Unscored items still get a card, just without a severity pill.
    expect(container.querySelector('.threat-cover--unscored')).not.toBeNull();
  });

  test('finds items by severity and product from the threat details', async () => {
    renderPage();
    const search = await screen.findByRole('searchbox', { name: /search threats/i });

    fireEvent.change(search, { target: { value: 'critical kubernetes' } });
    expect(screen.getByText('1 match for', { exact: false })).toBeInTheDocument();
  });

  test('drops Sploitus\'s "Description" prefix from summaries', async () => {
    renderPage();
    expect(await screen.findByText('Single-file exploit for ingress-nginx.')).toBeInTheDocument();
  });
});
