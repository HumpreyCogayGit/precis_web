import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

describe('analytics mounting', () => {
  test('keeps Vercel Analytics and Speed Insights mounted unconditionally', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/main.jsx'), 'utf8');

    expect(source).toContain('<Analytics />');
    expect(source).toContain('<SpeedInsights />');
    expect(source).toContain('<AnalyticsTracker />');
    expect(source).not.toContain('CookieConsent');
  });
});