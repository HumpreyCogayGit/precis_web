import { useEffect, useRef } from 'react';

// Items that enter the viewport together are staggered by this much, capped so a
// tall screen full of cards never leaves the last one waiting.
const STAGGER_MS = 80;
const MAX_STAGGER_STEPS = 4;

// Fades each direct child of the returned ref's element in as it first scrolls into
// view. Hidden state lives in CSS under [data-reveal], which only this hook sets — so
// with no IntersectionObserver (tests, old browsers), reduced motion, or no JS at all,
// every item simply renders visible. Revealed items are marked with a data attribute
// rather than a class, because React owns className and would wipe a class on the
// next render. `deps` re-scan the children, picking up items added by "Show more".
const useRevealOnScroll = (deps) => {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return undefined;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof IntersectionObserver === 'undefined') {
      delete container.dataset.reveal;
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      let step = 0;
      entries.forEach((entry) => {
        // Above the viewport already (a restored scroll position): show it without
        // waiting for the reader to scroll back up to trigger it.
        const passed = entry.boundingClientRect.bottom < 0;
        if (!entry.isIntersecting && !passed) {
          return;
        }

        const item = entry.target;
        item.style.setProperty('--reveal-delay', `${passed ? 0 : Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS}ms`);
        item.dataset.revealed = '';
        observer.unobserve(item);
        step += 1;
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.1 });

    container.dataset.reveal = '';
    Array.from(container.children).forEach((item) => {
      if (!('revealed' in item.dataset)) {
        observer.observe(item);
      }
    });

    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
};

export default useRevealOnScroll;
