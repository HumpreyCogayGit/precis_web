import { useCallback, useEffect, useRef, useState } from 'react';

// How long each lead story stays up before the carousel moves on by itself.
export const LEAD_ROTATE_MS = 7000;
// A horizontal drag at least this long (px) counts as a swipe.
const SWIPE_PX = 48;

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const isFocusVisible = (element) => {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
};

/**
 * Rotates through the edition's lead stories. "Next" slides the current story out to
 * the left and the new one in from the right; "previous" runs the other way, wrap-around
 * included, so the motion always matches the button pressed. It advances on its own
 * every `interval` ms, and holds while the reader hovers, focuses inside it, paused it,
 * or the tab is hidden. A single item renders as-is, with no controls.
 */
export default function LeadCarousel({
  items, renderItem, getKey, interval = LEAD_ROTATE_MS, label = 'Lead stories',
}) {
  const count = items.length;
  // Tracked by key, not position: when more leads arrive the story on screen stays
  // put. `dir` is null until the first move, so first paint shows the lead at rest.
  const [state, setState] = useState({ activeKey: null, leavingKey: null, dir: null });
  const [paused, setPaused] = useState(() => prefersReducedMotion());
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  const touchStart = useRef(null);

  const keys = items.map((item, i) => getKey(item, i));
  const found = keys.indexOf(state.activeKey);
  const index = found === -1 ? 0 : found;
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const go = useCallback((dir, target) => {
    setState((prev) => {
      const current = keysRef.current;
      const total = current.length;
      const at = Math.max(current.indexOf(prev.activeKey), 0);
      const next = target ?? (dir === 'next' ? (at + 1) % total : (at - 1 + total) % total);
      if (next === at) return prev;
      return { activeKey: current[next], leavingKey: current[at], dir };
    });
  }, []);

  const next = useCallback(() => go('next'), [go]);
  const previous = useCallback(() => go('prev'), [go]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const holding = paused || hovered || focused || hidden;

  // Keyed on the story on screen, so a manual move restarts the full interval while
  // leads arriving late do not (the progress bar would no longer match the timer).
  const rotates = count > 1;
  const activeKey = keys[index];
  useEffect(() => {
    if (!rotates || holding) return undefined;
    const timer = window.setTimeout(next, interval);
    return () => window.clearTimeout(timer);
  }, [rotates, holding, interval, next, activeKey]);

  if (count === 0) return null;
  if (count === 1) return renderItem(items[0], 0);

  const onKeyDown = (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    }
  };

  const onTouchStart = (event) => {
    touchStart.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event) => {
    const start = touchStart.current;
    touchStart.current = null;
    const end = event.changedTouches[0]?.clientX;
    if (start == null || end == null) return;
    if (end - start <= -SWIPE_PX) next();
    else if (end - start >= SWIPE_PX) previous();
  };

  const leavingFound = state.leavingKey == null ? -1 : keys.indexOf(state.leavingKey);
  const leaving = leavingFound !== -1 && leavingFound !== index ? leavingFound : null;
  const animation = state.dir ? ` lead-slide--${state.dir}` : '';

  return (
    <section
      className={`lead-carousel${holding ? ' is-holding' : ''}`}
      aria-roledescription="carousel"
      aria-label={label}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Keyboard focus holds the rotation; a mouse click on an arrow should not freeze it.
      onFocus={(event) => setFocused(isFocusVisible(event.target))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="lead-carousel-viewport" aria-live={holding ? 'polite' : 'off'}>
        {/* The active slide comes first in the DOM so it is the one queried and read. */}
        <div
          key={keys[index]}
          className={`lead-slide is-active${animation}`}
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} of ${count}`}
        >
          {renderItem(items[index], index)}
        </div>
        {leaving != null && (
          <div
            key={`leaving-${keys[leaving]}`}
            className={`lead-slide is-leaving${animation}`}
            aria-hidden="true"
            inert
            onAnimationEnd={() => setState((prev) => (
              prev.leavingKey === keys[leaving] ? { ...prev, leavingKey: null } : prev
            ))}
          >
            {renderItem(items[leaving], leaving)}
          </div>
        )}
      </div>

      <div className="lead-carousel-controls">
        <button type="button" className="lead-carousel-arrow" onClick={previous} aria-label="Previous lead story">
          <span aria-hidden="true">&larr;</span>
        </button>
        <div className="lead-carousel-dots">
          {items.map((item, i) => (
            <button
              key={keys[i]}
              type="button"
              className={`lead-carousel-dot${i === index ? ' is-active' : ''}`}
              aria-label={`Show lead story ${i + 1} of ${count}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => go(i > index ? 'next' : 'prev', i)}
            >
              {i === index && (
                <span
                  key={`${index}-${holding}`}
                  className="lead-carousel-progress"
                  style={{ animationDuration: `${interval}ms` }}
                />
              )}
            </button>
          ))}
        </div>
        <button type="button" className="lead-carousel-arrow" onClick={next} aria-label="Next lead story">
          <span aria-hidden="true">&rarr;</span>
        </button>
        <button
          type="button"
          className="lead-carousel-pause"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
        >
          {paused ? 'Play' : 'Pause'}
        </button>
      </div>
    </section>
  );
}
