import { describe, expect, test } from 'vitest';
import { formatStoryTime } from './App.jsx';

describe('Top Stories time column', () => {
  const now = new Date(2026, 8, 22, 18, 0);

  test('a story published today shows its clock time', () => {
    const published = new Date(2026, 8, 22, 14, 20);
    expect(formatStoryTime({ published_at: published.toISOString(), fetched_at: now.toISOString() }, now))
      .toBe('14:20');
  });

  test('an older story shows its day', () => {
    const published = new Date(2026, 8, 20, 9, 5);
    expect(formatStoryTime({ published_at: published.toISOString(), fetched_at: now.toISOString() }, now))
      .toBe('20 Sep');
  });

  test('a date-only published_at shows that UTC day, never a made-up time', () => {
    expect(formatStoryTime({ published_at: '2026-09-22', fetched_at: now.toISOString() }, now))
      .toBe('22 Sep');
  });

  test('no usable timestamp shows nothing', () => {
    expect(formatStoryTime({}, now)).toBe('');
  });
});
