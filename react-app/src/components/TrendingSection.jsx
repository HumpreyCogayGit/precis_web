import {
  useEffect, useId, useRef, useState,
} from 'react';

export const TREND_WINDOWS = ['24h', '7d', '30d'];
// The API's combined ranking across every topic (lib/topicTrends.js ALL_TOPICS_KEY).
export const ALL_TRENDS_KEY = 'All';
const DEFAULT_WINDOW = '7d';
// Rows shown before "Show all". The payload already carries every ranked category,
// so expanding costs no request.
export const COLLAPSED_ROWS = 5;
const WINDOW_SPOKEN = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
// Leaving the ? for the panel crosses a small gap; a short grace period keeps the
// panel from closing under the pointer on its way there.
const HELP_HOVER_CLOSE_MS = 150;

// Storage can throw (private mode, blocked site data); the section works without it.
const readWindow = (storageKey) => {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return TREND_WINDOWS.includes(stored) ? stored : DEFAULT_WINDOW;
  } catch {
    return DEFAULT_WINDOW;
  }
};

const writeWindow = (storageKey, value) => {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Remembering the choice is a convenience, never a requirement.
  }
};

// Direction is shown with ▲ / ▼ rather than a +/− sign.
export const formatGrowth = (row) => {
  if (row.is_new) {
    return 'New';
  }
  if (row.growth_pct > 0) {
    return `▲ ${row.growth_pct}%`;
  }
  if (row.growth_pct < 0) {
    return `▼ ${Math.abs(row.growth_pct)}%`;
  }
  return '0%';
};

// Screen readers announce ▲ as "black up-pointing triangle", so the row's
// accessible name uses words instead.
export const spokenGrowth = (row) => {
  if (row.is_new) {
    return 'new';
  }
  if (row.growth_pct > 0) {
    return `up ${row.growth_pct}%`;
  }
  if (row.growth_pct < 0) {
    return `down ${Math.abs(row.growth_pct)}%`;
  }
  return 'no change';
};

const growthTone = (row) => {
  if (row.is_new) {
    return 'new';
  }
  return row.growth_pct > 0 ? 'up' : 'down';
};

// Bars show VOLUME — this window's article count relative to the section's busiest
// row — and the % beside them shows direction. Scaling bars by % made every "New" row
// and the top rise look identical at full width, even when they rested on 2 articles.
const barWidths = (rows) => {
  const busiest = Math.max(1, ...rows.map((row) => row.now_n));
  return rows.map((row) => Math.max(4, Math.round((row.now_n / busiest) * 100)));
};

// What the numbers mean, in the reader's selected window. Kept in step with the
// metric in web/lib/topicTrends.js.
function TrendHelp({ span }) {
  return (
    <>
      <p className="topic-trend-help-title">How to read this</p>
      <dl>
        <dt>▲ ▼ %</dt>
        <dd>
          <p>
            How much this category&rsquo;s share of the news increased or decreased over the
            last {span} compared with the previous {span}.
          </p>
          <p>
            Because it measures the share of all news, a category may go down even when there
            is more news about it&mdash;if other categories grew even more.
          </p>
        </dd>
        <dt>Bar</dt>
        <dd>
          Articles tagged with the category in the last {span}, relative to the busiest
          category here. Grey means falling. Hover a row for the exact counts.
        </dd>
        <dt>New</dt>
        <dd>No articles in the previous {span}.</dd>
        <dt>Order</dt>
        <dd>
          Growth weighted by article count, so a jump on a handful of articles doesn&rsquo;t
          automatically lead. Small counts are smoothed toward the category&rsquo;s usual share.
        </dd>
      </dl>
    </>
  );
}

// The home page's "Rising Now" panel: ranked categories with a 24h | 7d | 30d toggle and
// a ? explaining the numbers. `topic` picks which ranking of the /api/topic-trends
// payload's `windows` to show — "AI", "Cyber Security", or ALL_TRENDS_KEY for the
// combined one — and `context` ("in AI") is shown beside the title when it narrows.
export default function TrendingSection({
  topic, title, context, storageKey, windows, activeTagSlugs = [], onSelectTag,
}) {
  const headingId = useId();
  const helpId = useId();
  const listId = useId();
  const [selectedWindow, setSelectedWindow] = useState(() => readWindow(storageKey));
  const [showAll, setShowAll] = useState(false);
  // Hover previews the explanation; a click pins it open for touch and keyboard.
  const [helpPinned, setHelpPinned] = useState(false);
  const [helpHovered, setHelpHovered] = useState(false);
  const helpRef = useRef(null);
  const hoverCloseTimer = useRef(null);
  const helpOpen = helpPinned || helpHovered;

  useEffect(() => {
    if (!helpOpen) {
      return undefined;
    }

    const close = () => {
      setHelpPinned(false);
      setHelpHovered(false);
    };
    const onPointerDown = (event) => {
      if (!helpRef.current?.contains(event.target)) {
        close();
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [helpOpen]);

  useEffect(() => () => clearTimeout(hoverCloseTimer.current), []);

  // A different topic is a different list; start it collapsed rather than carrying
  // "Show all" over from the previous one.
  useEffect(() => {
    setShowAll(false);
  }, [topic]);

  const hasAnyRows = TREND_WINDOWS.some((key) => (windows?.[key]?.[topic] || []).length > 0);
  if (!hasAnyRows) {
    return null;
  }

  const rows = windows?.[selectedWindow]?.[topic] || [];
  // Widths come from every row, not just the visible ones, so bars keep their length
  // when the list expands or collapses.
  const widths = barWidths(rows);
  const visibleRows = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);
  const span = WINDOW_SPOKEN[selectedWindow];

  const chooseWindow = (value) => {
    setSelectedWindow(value);
    writeWindow(storageKey, value);
  };

  const onHelpEnter = () => {
    clearTimeout(hoverCloseTimer.current);
    setHelpHovered(true);
  };

  const onHelpLeave = () => {
    clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = setTimeout(() => setHelpHovered(false), HELP_HOVER_CLOSE_MS);
  };

  return (
    <section className="topic-trend" aria-labelledby={headingId}>
      <div className="topic-trend-head">
        <div className="topic-trend-title">
          <h2 id={headingId}>
            {title}
            {/* The space sits outside the span: a leading space inside it is dropped from
                the accessible name, which then reads "Rising Nowin AI". */}
            {context && (
              <>
                {' '}
                <span className="topic-trend-context">{context}</span>
              </>
            )}
          </h2>
          <span
            ref={helpRef}
            className="topic-trend-help-anchor"
            onMouseEnter={onHelpEnter}
            onMouseLeave={onHelpLeave}
          >
            <button
              type="button"
              className="topic-trend-help"
              aria-label={`How ${title} is calculated`}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpPinned((pinned) => !pinned)}
            >
              ?
            </button>
            <div id={helpId} className="topic-trend-help-panel" hidden={!helpOpen}>
              <TrendHelp span={span} />
            </div>
          </span>
        </div>
        <div className="segmented-tabs topic-trend-windows" role="group" aria-label={`${title} time window`}>
          {TREND_WINDOWS.map((key) => (
            <button
              key={key}
              type="button"
              className="segmented-tab"
              aria-pressed={key === selectedWindow}
              onClick={() => chooseWindow(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 ? (
        <ol id={listId} className="topic-trend-list">
          {visibleRows.map((row, index) => {
            const growth = formatGrowth(row);
            const detail = `${row.now_n} article${row.now_n === 1 ? '' : 's'} in the last ${span}, ${row.prev_n} in the ${span} before`;
            return (
              <li key={row.slug}>
                <button
                  type="button"
                  className="topic-trend-row"
                  aria-pressed={activeTagSlugs.includes(row.slug)}
                  aria-label={`${row.tag}, ${spokenGrowth(row)}. ${detail}`}
                  title={detail}
                  onClick={() => onSelectTag?.(row.slug)}
                >
                  <span className="brief-rank topic-trend-rank" aria-hidden="true">{row.rank}</span>
                  <span className="topic-trend-label">{row.tag}</span>
                  <span className={`topic-trend-bar topic-trend-bar--${growthTone(row)}`} aria-hidden="true">
                    <span style={{ width: `${widths[index]}%` }} />
                  </span>
                  <span className="topic-trend-count" aria-hidden="true">{row.now_n}</span>
                  <span className={`topic-trend-growth topic-trend-growth--${growthTone(row)}`}>{growth}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="topic-trend-empty">
          Not enough {topic === ALL_TRENDS_KEY ? '' : `${topic} `}coverage in the last {span} yet.
        </p>
      )}

      {rows.length > COLLAPSED_ROWS && (
        <button
          type="button"
          className="topic-trend-more"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((expanded) => !expanded)}
        >
          {showAll ? `Show top ${COLLAPSED_ROWS}` : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
