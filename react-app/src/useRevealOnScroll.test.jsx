import { act, render } from '@testing-library/react';
import {
  afterEach, describe, expect, test, vi,
} from 'vitest';
import useRevealOnScroll from './useRevealOnScroll.js';

const List = ({ items }) => {
  const ref = useRevealOnScroll([items.join('\n')]);
  return (
    <ul ref={ref}>
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
};

// A controllable stand-in: tests decide which observed items "enter" the viewport.
let observers = [];
class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    observers.push(this);
  }

  observe(target) { this.targets.add(target); }

  unobserve(target) { this.targets.delete(target); }

  disconnect() { this.targets.clear(); }

  enter(targets, bottom = 100) {
    this.callback(targets.map((target) => ({
      target, isIntersecting: bottom >= 0, boundingClientRect: { bottom },
    })));
  }
}

const latest = () => observers[observers.length - 1];

afterEach(() => {
  observers = [];
  vi.unstubAllGlobals();
});

describe('useRevealOnScroll', () => {
  test('without IntersectionObserver nothing is hidden', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<List items={['a', 'b']} />);
    expect(container.querySelector('ul')).not.toHaveAttribute('data-reveal');
  });

  test('honours prefers-reduced-motion', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { container } = render(<List items={['a']} />);
    expect(container.querySelector('ul')).not.toHaveAttribute('data-reveal');
    expect(observers).toHaveLength(0);
  });

  test('reveals items as they enter, staggering ones that arrive together', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { container } = render(<List items={['a', 'b', 'c']} />);
    const list = container.querySelector('ul');
    const [a, b, c] = list.children;

    expect(list).toHaveAttribute('data-reveal');
    expect(latest().targets.size).toBe(3);

    act(() => latest().enter([a, b]));
    expect(a).toHaveAttribute('data-revealed');
    expect(b).toHaveAttribute('data-revealed');
    expect(c).not.toHaveAttribute('data-revealed');
    expect(a.style.getPropertyValue('--reveal-delay')).toBe('0ms');
    expect(b.style.getPropertyValue('--reveal-delay')).toBe('80ms');
    expect(latest().targets.has(a)).toBe(false);
  });

  test('items already scrolled past are shown at once', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { container } = render(<List items={['a']} />);
    const [a] = container.querySelector('ul').children;

    act(() => latest().enter([a], -20));
    expect(a).toHaveAttribute('data-revealed');
  });

  test('newly added items are observed; revealed ones are not re-hidden', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { container, rerender } = render(<List items={['a']} />);
    const [a] = container.querySelector('ul').children;
    act(() => latest().enter([a]));

    rerender(<List items={['a', 'b']} />);
    const b = container.querySelector('ul').children[1];
    expect(a).toHaveAttribute('data-revealed');
    expect(latest().targets.has(a)).toBe(false);
    expect(latest().targets.has(b)).toBe(true);
  });
});
