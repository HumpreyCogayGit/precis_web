import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  beforeEach, describe, expect, test, vi,
} from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const axios = (await import('axios')).default;
const { default: ThreatsPage } = await import('./ThreatsPage.jsx');
const { THREAT_SITES } = await import('../sources');

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
  {
    site: 'github_advisories',
    url: 'https://github.com/advisories/GHSA-q986-4x7x-gx39',
    title: 'Unauthenticated Ops API exposes operator email digests',
    summary: 'The AetherBrowser API server exposes an endpoint without authentication.',
    tags: ['Vulnerability Disclosure', 'Advisory'],
    threat: {
      v: 1, kind: 'advisory', cves: ['CVE-2026-57443'], cvss: 7.5, cvss_source: 'page', severity: 'high',
      products: ['scbe-aethermoore'], subject: 'scbe-aethermoore', github: 'issdandavis/SCBE-AETHERMOORE',
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
    // Answers like the API: only the sites the request names.
    axios.get.mockImplementation(async (url) => {
      const sites = new URL(url, 'http://localhost').searchParams.get('site').split(',');
      return { data: { items: ARTICLES.filter((article) => sites.includes(article.site)), next_offset: null } };
    });
  });

  test('asks the API for each tab\'s feeds, covering every threat feed', async () => {
    renderPage();
    await screen.findByText('Linux kernel use-after-free');

    const requested = axios.get.mock.calls.map(([url]) => new URL(url, 'http://localhost').searchParams.get('site'));
    expect(requested).toEqual([
      'oss_security',
      'sploitus,exploit_db',
      'github_advisories,zero_day_initiative,full_disclosure',
    ]);
    expect(requested.join(',').split(',').sort()).toEqual([...THREAT_SITES].sort());
  });

  test('the CVE tab fills even when another feed fails to load', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes('sploitus')) throw new Error('network');
      const sites = new URL(url, 'http://localhost').searchParams.get('site').split(',');
      return { data: { items: ARTICLES.filter((article) => sites.includes(article.site)), next_offset: null } };
    });
    renderPage('/threats?feed=cves');

    expect(await screen.findByText('Linux kernel use-after-free')).toBeInTheDocument();
  });

  test('the All tab merges the feeds newest first', async () => {
    axios.get.mockImplementation(async (url) => {
      const sites = new URL(url, 'http://localhost').searchParams.get('site').split(',');
      const items = [
        { site: 'oss_security', url: 'https://seclists.org/oss-sec/2026/q3/9', title: 'Older CVE', published_at: 'Fri, 26 Sep 2026 04:00:00 +0000' },
        { site: 'zero_day_initiative', url: 'https://www.zerodayinitiative.com/advisories/ZDI-26-1/', title: 'Newer advisory', published_at: 'October 2nd, 2026' },
        { site: 'sploitus', url: 'https://sploitus.com/exploit?id=9', title: 'Undated exploit', fetched_at: '2026-10-30T00:00:00Z' },
      ].filter((article) => sites.includes(article.site));
      return { data: { items, next_offset: null } };
    });
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('.brief-list h4')).toHaveLength(3));

    const titles = [...container.querySelectorAll('.brief-list h4')].map((node) => node.textContent);
    expect(titles).toEqual(['Undated exploit', 'Newer advisory', 'Older CVE']);
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

  test('tabs run All, CVE, Exploits, Advisories and each shows its own feeds', async () => {
    renderPage();
    await screen.findByText('Linux kernel use-after-free');

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent.replace(/\d+$/, ''))).toEqual(['All', 'CVE', 'Exploits', 'Advisories']);

    fireEvent.click(screen.getByRole('tab', { name: /^Advisories/ }));
    expect(screen.getByText('Unauthenticated Ops API exposes operator email digests')).toBeInTheDocument();
    expect(screen.queryByText('Linux kernel use-after-free')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /^CVE/ }));
    expect(screen.getByText('Linux kernel use-after-free')).toBeInTheDocument();
    expect(screen.queryByText('Unauthenticated Ops API exposes operator email digests')).toBeNull();
  });

  test('an Advisories tab link opens on GitHub advisories', async () => {
    renderPage('/threats?feed=advisories&q=nomatch');
    expect(await screen.findByText(/No advisories match "nomatch"/)).toBeInTheDocument();
  });

  test('drops Sploitus\'s "Description" prefix from summaries', async () => {
    renderPage();
    expect(await screen.findByText('Single-file exploit for ingress-nginx.')).toBeInTheDocument();
  });
});
