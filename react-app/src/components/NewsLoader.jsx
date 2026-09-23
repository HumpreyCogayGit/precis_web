import { useEffect, useRef } from 'react';

/* The loading scene itself lives in public/loader/ as plain CSS and JS, so the
 * same animation can paint from index.html before this bundle has parsed. This
 * component is only the React mount point for it -- keeping one implementation
 * means the boot splash and the in-app loader are the same picture, and the
 * handoff between them is invisible.
 *
 * public/loader/loader.html is a standalone preview of the same three files. */
const NewsLoader = () => {
  const host = useRef(null);

  useEffect(() => {
    const node = host.current;
    const loader = window.PrecisLoader;
    if (!node || !loader) return undefined;

    loader.mount(node);
    // `keep` leaves the node itself alone: React owns it and will unmount it,
    // and a loader that removed it first would break that unmount.
    return () => loader.destroy(node, { immediate: true, keep: true });
  }, []);

  // Sized by the loader's own fixed positioning once mounted; empty until then.
  return <div ref={host} />;
};

export default NewsLoader;
