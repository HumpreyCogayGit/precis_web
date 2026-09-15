import { describe, expect, it } from 'vitest';
import { buildCardLayout } from './App.jsx';

const makeArticles = (count, prefix = 'a') => Array.from({ length: count }, (_, i) => ({
  url: `https://example.com/${prefix}-${i}`,
  title: `Story ${i}`,
}));

describe('buildCardLayout', () => {
  it('places every article exactly once, in order', () => {
    const articles = makeArticles(48);
    const layout = buildCardLayout(articles);
    expect(layout.map((slot) => slot.article)).toEqual(articles);
  });

  it('mixes full-width features with rows of cards', () => {
    const layout = buildCardLayout(makeArticles(96));
    expect(layout.some((slot) => slot.feature)).toBe(true);
    expect(layout.some((slot) => !slot.feature)).toBe(true);
    expect(new Set(layout.filter((slot) => slot.feature).map((slot) => slot.feature)))
      .toEqual(new Set(['left', 'right']));
  });

  it('never runs more than two features back to back, and zig-zags them', () => {
    const layout = buildCardLayout(makeArticles(200, 'b'));
    let streak = 0;
    layout.forEach((slot, i) => {
      streak = slot.feature ? streak + 1 : 0;
      expect(streak).toBeLessThanOrEqual(2);
      if (slot.feature && layout[i - 1]?.feature) {
        expect(slot.feature).not.toBe(layout[i - 1].feature);
      }
    });
  });

  it('keeps earlier rows stable when more articles are appended', () => {
    const articles = makeArticles(96, 'c');
    const short = buildCardLayout(articles.slice(0, 24));
    const long = buildCardLayout(articles);
    // Only the tail row of the shorter page may differ.
    const stable = short.slice(0, short.length - 3);
    expect(long.slice(0, stable.length)).toEqual(stable);
  });
});
