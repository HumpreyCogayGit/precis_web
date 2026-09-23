import { useLayoutEffect, useRef, useState } from 'react';

/* The loading scene itself lives in public/loader/ as plain CSS and JS, so the
 * same animation can paint from index.html before this bundle has parsed. This
 * component is only the React mount point for it -- keeping one implementation
 * means the boot splash and the in-app loader are the same picture, and the
 * handoff between them is invisible.
 *
 * public/loader/loader.html is a standalone preview of the same three files. */

// Inline rather than a class, deliberately: this is what renders when the
// loader's own assets did not arrive, so it must not depend on them either.
const FALLBACK_STYLE = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeContent: 'center',
  gap: '8px',
  padding: '24px',
  background: 'var(--paper, #f4f5f7)',
  color: 'var(--ink, #14171a)',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  textAlign: 'center',
};

const FALLBACK_KICKER_STYLE = {
  margin: 0,
  color: 'var(--muted, #6b7280)',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

const FALLBACK_HEADLINE_STYLE = {
  margin: 0,
  fontSize: 'clamp(1.35rem, 3.4vw, 2rem)',
  fontWeight: 800,
  letterSpacing: '-0.025em',
};

const NewsLoader = () => {
  const host = useRef(null);
  const [enhanced, setEnhanced] = useState(false);

  // Layout effect, not a passive one: the swap from fallback to scene then
  // happens before the browser paints, so neither state is seen flashing.
  useLayoutEffect(() => {
    const node = host.current;
    const loader = window.PrecisLoader;
    if (!node || !loader) return undefined;

    loader.mount(node);
    setEnhanced(true);
    // `keep` leaves the node itself alone: React owns it and will unmount it,
    // and a loader that removed it first would break that unmount.
    return () => loader.destroy(node, { immediate: true, keep: true });
  }, []);

  return (
    <>
      <div ref={host} />
      {/* loader.js is a plain <script> in index.html, so it has already run by
          the time this mounts -- unless it failed to load at all. If it did,
          this keeps the page readable instead of blank. */}
      {!enhanced && (
        <div style={FALLBACK_STYLE} role="status" aria-live="polite" aria-busy="true">
          <p style={FALLBACK_KICKER_STYLE}>Reading the wires</p>
          <h1 style={FALLBACK_HEADLINE_STYLE}>Assembling today&rsquo;s edition.</h1>
        </div>
      )}
    </>
  );
};

export default NewsLoader;
