import { useEffect, useRef, useState } from 'react';

import { trackShare } from '../analytics';
import { ShareIcon } from '../icons.jsx';

const COPIED_MS = 2000;

// Shares the link it is given: an article's original URL (never a Precis page that
// wraps it, so the source keeps the click), or a Precis page for the TL;DR and
// threats views. Uses the device share sheet where there is one (phones, Safari),
// and otherwise copies the link and says so.
const ShareButton = ({
  url, title, contentType, iconOnly = false, className = '',
}) => {
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!url) {
    return null;
  }

  const flash = (next) => {
    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), COPIED_MS);
  };

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        trackShare('native', contentType);
      } catch (err) {
        // Closing the sheet rejects with AbortError: the reader changed their mind.
        if (err?.name !== 'AbortError') {
          flash('error');
        }
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      trackShare('copy_link', contentType);
      flash('copied');
    } catch (err) {
      flash('error');
    }
  };

  const label = status === 'copied' ? 'Link copied' : status === 'error' ? 'Could not share' : 'Share';

  return (
    <button
      type="button"
      className={`share-btn${iconOnly ? ' share-btn--icon' : ''}${className ? ` ${className}` : ''}`}
      onClick={share}
      aria-label={title ? `Share: ${title}` : 'Share'}
      title={label}
    >
      <ShareIcon />
      {!iconOnly && <span>{label}</span>}
      {/* Announces the result for screen readers, including the icon-only form. */}
      <span className="sr-only" aria-live="polite">{status === 'idle' ? '' : label}</span>
    </button>
  );
};

export default ShareButton;
