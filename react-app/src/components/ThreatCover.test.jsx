import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import ThreatCover, { githubPreviewUrl, threatHeadline } from './ThreatCover.jsx';

const article = (threat, extra = {}) => ({
  site: 'sploitus', url: 'https://sploitus.com/exploit?id=1', title: 'Exploit for reversemap', tags: [], threat, ...extra,
});

describe('ThreatCover', () => {
  test('leads with the CVE, then the tool name, then the title', () => {
    expect(threatHeadline(article({ cves: ['CVE-2024-3094'], subject: 'xz' }))).toBe('CVE-2024-3094');
    expect(threatHeadline(article({ cves: [], subject: 'reversemap' }))).toBe('reversemap');
    expect(threatHeadline(article(null))).toBe('Exploit for reversemap');
  });

  test('only builds a GitHub preview URL for a well-formed owner/repo', () => {
    expect(githubPreviewUrl('apache/roller')).toBe('https://opengraph.githubassets.com/1/apache/roller');
    for (const bad of [null, '', 'apache', '../etc/passwd', 'a/b/c', 'owner/repo?x=1']) {
      expect(githubPreviewUrl(bad)).toBe('');
    }
  });

  test('uses the GitHub card when there is one and falls back to the drawn card if it fails', () => {
    const { container } = render(<ThreatCover article={article({ kind: 'exploit', cves: ['CVE-2024-3094'], github: 'tukaani-project/xz' })} />);
    const photo = container.querySelector('img.threat-cover-photo');
    expect(photo.getAttribute('src')).toContain(encodeURIComponent('https://opengraph.githubassets.com/1/tukaani-project/xz'));
    expect(container.querySelector('.threat-headline')).toBeNull();

    fireEvent.error(photo);
    expect(container.querySelector('img.threat-cover-photo')).toBeNull();
    expect(container.querySelector('.threat-headline')).toHaveTextContent('CVE-2024-3094');
  });

  test('shows kind, severity and score, and more-CVEs count', () => {
    const { container } = render(<ThreatCover article={article({
      kind: 'advisory', cves: ['CVE-2026-1', 'CVE-2026-2', 'CVE-2026-3'], cvss: 7.7, cvss_source: 'nvd',
      severity: 'high', products: ['Apache Roller'],
    })} />);
    expect(container.querySelector('.threat-kind')).toHaveTextContent('Advisory');
    expect(container.querySelector('.threat-pill--high')).toHaveTextContent('high7.7');
    expect(container.querySelector('.threat-sub')).toHaveTextContent('Apache Roller · +2 more CVEs');
  });
});
