import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import HalloweenDecor, { isHalloweenSeason } from './HalloweenDecor.jsx';

const setReducedMotion = (matches) => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches }));
};

describe('isHalloweenSeason', () => {
  it('covers October through November 1st only', () => {
    expect(isHalloweenSeason(new Date(2026, 8, 30))).toBe(false);
    expect(isHalloweenSeason(new Date(2026, 9, 1))).toBe(true);
    expect(isHalloweenSeason(new Date(2026, 9, 31))).toBe(true);
    expect(isHalloweenSeason(new Date(2026, 10, 1))).toBe(true);
    expect(isHalloweenSeason(new Date(2026, 10, 2))).toBe(false);
  });
});

describe('HalloweenDecor', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const renderOn = (date) => {
    vi.useFakeTimers({ now: date, toFake: ['Date'] });
    return render(<HalloweenDecor />);
  };

  it('renders nothing out of season', () => {
    setReducedMotion(false);
    const { container } = renderOn(new Date(2026, 5, 15));
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden from assistive technology and has a crawler in season', () => {
    setReducedMotion(false);
    const { container } = renderOn(new Date(2026, 9, 31));
    expect(container.querySelector('.halloween-decor')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.halloween-crawler')).toBeInTheDocument();
  });

  it('keeps the webs but drops the crawler for reduced motion', () => {
    setReducedMotion(true);
    const { container } = renderOn(new Date(2026, 9, 31));
    expect(container.querySelector('.halloween-web')).toBeInTheDocument();
    expect(container.querySelector('.halloween-crawler')).not.toBeInTheDocument();
  });
});
