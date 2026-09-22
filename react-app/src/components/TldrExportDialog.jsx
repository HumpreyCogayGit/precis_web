import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { DownloadIcon } from '../icons.jsx';

// Shows the exported post before it is saved, so it can be read (or copied straight
// out of the box) without downloading a file first. Modal: Escape and a click on
// the scrim close it, Tab stays inside, and focus goes back to the opener on close.
const TldrExportDialog = ({
  kicker, title, fileName, text, onSave, onClose,
}) => {
  const titleId = useId();
  const dialogRef = useRef(null);
  const saveRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    saveRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = dialogRef.current.querySelectorAll('button, textarea');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <>
      <div className="tldr-export-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="tldr-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <div className="tldr-export-dialog-head">
          <p className="masthead-kicker">{kicker}</p>
          <h2 id={titleId} className="tldr-export-dialog-title">{title}</h2>
          <p className="tldr-export-dialog-file">{fileName}</p>
        </div>
        <textarea
          className="tldr-export-dialog-text"
          value={text}
          readOnly
          spellCheck={false}
          aria-label="Exported Markdown"
        />
        <div className="tldr-export-dialog-footer">
          <button ref={saveRef} type="button" className="tldr-export-dialog-save" onClick={onSave}>
            <DownloadIcon />
            <span>Save .md</span>
          </button>
          <button type="button" className="tldr-export-dialog-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default TldrExportDialog;
