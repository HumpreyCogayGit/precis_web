import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheckIcon, CalendarIcon, ChevronLeftIcon, ChevronRightIcon, TuneIcon,
} from './icons.jsx';
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  EMPTY_DATE_RANGE,
  isDateKey,
  presetRange,
  todayKey,
} from './filters';

// The masthead's date control. It replaces the old "N items from M sources" line,
// which described the payload rather than offering anything to do with it.
//
// The chips are presets, the sliders button opens a two-ended calendar. Both write
// the same `dateRange` object into the filter model, so a range narrows the edition
// through exactly the same predicate as a tag or a source — see filters.js.
//
// Presentational, like FilterPanel: App owns the applied range and hands the
// already-counted chips down. Only the picker's own draft lives here, because it
// is discarded on Cancel and never reaches the filter model until Apply.

// Day keys are UTC (see filters.js), so every label formatted from one has to be
// read back in UTC or it can print the day before.
const UTC = { timeZone: 'UTC' };

const fullDateFormat = new Intl.DateTimeFormat('en', {
  month: 'short', day: 'numeric', year: 'numeric', ...UTC,
});
const shortDateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', ...UTC });
const weekdayFormat = new Intl.DateTimeFormat('en', { weekday: 'long', ...UTC });
const monthFormat = new Intl.DateTimeFormat('en', { month: 'long', ...UTC });

const asDate = (key) => new Date(`${key}T00:00:00.000Z`);

const formatFullDate = (key) => (isDateKey(key) ? fullDateFormat.format(asDate(key)) : null);
const formatShortDay = (key) => (isDateKey(key) ? shortDateFormat.format(asDate(key)) : null);
const formatWeekday = (key) => (isDateKey(key) ? weekdayFormat.format(asDate(key)) : null);

// The site publishes one edition a day, so a chosen day is named the way the
// masthead names it rather than as a bare weekday.
const editionLabel = (key) => (isDateKey(key) ? `${formatWeekday(key)} edition` : 'Pick a day');

// Mo-first, matching the calendar grid and the Monday-to-Sunday week the
// "This week" preset resolves to.
const WEEKDAY_HEADS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// Always six rows. A month that fits in five would otherwise resize the popover
// as the reader pages through the year.
const CALENDAR_ROWS = 6;

/**
 * The 42 day cells of one month view, leading and trailing days included.
 *
 * Cells carry `outside` rather than being blanked out: the days either side of a
 * month boundary are real days with real briefs, and a range that spans one is the
 * normal case, not the exception.
 */
const buildMonthGrid = (year, monthIndex) => {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(year, monthIndex, 1 - leading);

  return Array.from({ length: CALENDAR_ROWS * 7 }, (_, index) => {
    const date = new Date(start + index * 86_400_000);
    return {
      key: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      outside: date.getUTCMonth() !== ((monthIndex % 12) + 12) % 12,
    };
  });
};

// The month the picker opens on: the range being edited, else the current month.
const monthCursorFor = (from, to) => {
  const anchor = from || to || todayKey();
  const date = asDate(anchor);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
};

const rangeChipLabel = (range) => {
  if (range.preset === 'custom') {
    const from = formatShortDay(range.from);
    const to = formatShortDay(range.to);
    return from === to ? from : `${from} – ${to}`;
  }
  return DATE_PRESET_LABELS[range.preset] ?? DATE_PRESET_LABELS.all;
};

const PresetChip = ({ label, count, active, onClick }) => (
  <button
    type="button"
    className={`date-chip${active ? ' date-chip--active' : ''}`}
    aria-pressed={active}
    onClick={onClick}
  >
    <span className="date-chip-label">{label}</span>
    {/* Only the selected chip carries its number. On every other chip it would be
        a count for a list the reader is not looking at. */}
    {active && Number.isFinite(count) && <span className="date-chip-count">{count}</span>}
  </button>
);

// One endpoint of the range. Selecting a card is what decides which end the next
// click on the grid sets, so the cards are buttons rather than read-outs.
const RangeField = ({ side, label, dateKey, active, onSelect }) => (
  <button
    type="button"
    className={`date-range-field${active ? ' date-range-field--active' : ''}`}
    aria-pressed={active}
    onClick={onSelect}
  >
    <span className="date-range-field-head">
      <span className="date-range-field-side">{side}</span>
      {active ? <CalendarCheckIcon /> : <CalendarIcon />}
    </span>
    <span className="date-range-field-value">{dateKey ? formatFullDate(dateKey) : label}</span>
    <span className="date-range-field-edition">{editionLabel(dateKey)}</span>
  </button>
);

const RangePicker = ({ popoverRef, applied, countFor, onApply, onReset, onClose }) => {
  // The picker opens on whatever is applied — including a preset, which resolves
  // to the days it covers so the grid shows the reader what "this week" meant
  // before they start editing it.
  const initial = useMemo(() => {
    if (applied.preset === 'custom') {
      return { from: applied.from, to: applied.to };
    }
    const resolved = presetRange(applied.preset);
    return resolved ? { from: resolved.from, to: resolved.to } : { from: null, to: null };
  }, [applied.preset, applied.from, applied.to]);

  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState('from');
  const [cursor, setCursor] = useState(() => monthCursorFor(initial.from, initial.to));

  const today = todayKey();
  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const monthDate = new Date(Date.UTC(cursor.year, cursor.month, 1));

  const shiftMonth = (delta) => setCursor(({ year, month }) => {
    const shifted = new Date(Date.UTC(year, month + delta, 1));
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
  });

  /**
   * One click sets one end.
   *
   * Setting `from` moves the cursor to `to`, so picking a range is two clicks and
   * no mode-switching. A `to` before the `from` is not an error state to scold the
   * reader for — the pair is simply reordered, which is the same thing
   * resolveDateRange does to a hand-edited URL.
   */
  const pickDay = (key) => {
    setDraft((current) => {
      if (editing === 'from') {
        setEditing('to');
        return { from: key, to: current.to && current.to < key ? null : current.to };
      }
      if (current.from && key < current.from) {
        return { from: key, to: current.from };
      }
      return { ...current, to: key };
    });
  };

  const clearDraft = () => {
    setDraft({ from: null, to: null });
    setEditing('from');
  };

  // A single day is a legitimate range, so one end is enough to apply; the other
  // end simply repeats it.
  const canApply = Boolean(draft.from || draft.to);
  const pendingRange = useMemo(() => ({
    preset: 'custom', from: draft.from || draft.to, to: draft.to || draft.from,
  }), [draft.from, draft.to]);

  // The same predictive contract as the filter panel's Apply: the number is
  // counted through the predicate the list itself will use, so committing can
  // never be a surprise.
  const pendingCount = canApply ? countFor(pendingRange) : 0;
  const applyLabel = canApply
    ? `Show ${pendingCount} brief${pendingCount === 1 ? '' : 's'}`
    : 'Pick a day';

  const dayState = (cell) => {
    const from = draft.from;
    const to = draft.to;
    if (from && to) {
      if (cell.key === from || cell.key === to) {
        return 'edge';
      }
      return cell.key > from && cell.key < to ? 'inside' : 'none';
    }
    return cell.key === (from || to) ? 'edge' : 'none';
  };

  return (
    <div
      ref={popoverRef}
      className="date-range-popover"
      role="dialog"
      aria-modal="false"
      aria-label="Custom date range"
    >
      <div className="date-range-fields">
        <RangeField
          side="From"
          label="Pick a start"
          dateKey={draft.from}
          active={editing === 'from'}
          onSelect={() => setEditing('from')}
        />
        <RangeField
          side="To"
          label="Pick an end"
          dateKey={draft.to}
          active={editing === 'to'}
          onSelect={() => setEditing('to')}
        />
      </div>

      <div className="date-range-calendar">
        <div className="date-range-calendar-head">
          <h3 className="date-range-month">
            {monthFormat.format(monthDate)} <span>{cursor.year}</span>
          </h3>
          <div className="date-range-nav">
            <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <ChevronLeftIcon />
            </button>
            <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <ChevronRightIcon />
            </button>
          </div>
        </div>

        <div className="date-range-weekdays" aria-hidden="true">
          {WEEKDAY_HEADS.map((head) => <span key={head}>{head}</span>)}
        </div>

        <div className="date-range-grid" role="grid" aria-label="Choose a day">
          {grid.map((cell) => {
            // Nothing is published ahead of today, so a future day is a dead pick
            // rather than an empty result to leave the reader puzzling over.
            const disabled = cell.key > today;
            const state = dayState(cell);

            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                className={[
                  'date-range-day',
                  `date-range-day--${state}`,
                  cell.outside ? 'date-range-day--outside' : '',
                  cell.key === today ? 'date-range-day--today' : '',
                ].filter(Boolean).join(' ')}
                aria-label={formatFullDate(cell.key)}
                aria-selected={state !== 'none'}
                disabled={disabled}
                onClick={() => pickDay(cell.key)}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>

      <div className="date-range-footer">
        <button
          type="button"
          className="date-range-apply"
          aria-disabled={canApply ? undefined : true}
          onClick={() => (canApply ? onApply(pendingRange) : undefined)}
        >
          {applyLabel}
        </button>
        {/* Reset empties the picker rather than closing it: the reader is mid-pick,
            and a control that both discarded the selection and vanished would be
            indistinguishable from Cancel. Clearing the applied range is what the
            All chip is for, and what Reset falls back to once the draft is empty. */}
        <button
          type="button"
          className="date-range-reset"
          onClick={() => (canApply ? clearDraft() : onReset())}
        >
          Reset
        </button>
        <button type="button" className="date-range-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
};

const DateFilterBar = ({ range, countFor, onChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const anchorRef = useRef(null);
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);

  const applied = range ?? EMPTY_DATE_RANGE;
  const isCustom = applied.preset === 'custom';

  // Only the selected chip renders its count, but all four are computed: the
  // selection moves on a click and a number that arrived a render late would show
  // the previous chip's total under the new one's label.
  const counts = useMemo(() => ({
    all: countFor(EMPTY_DATE_RANGE),
    today: countFor({ preset: 'today', from: null, to: null }),
    week: countFor({ preset: 'week', from: null, to: null }),
    month: countFor({ preset: 'month', from: null, to: null }),
    custom: isCustom ? countFor(applied) : undefined,
  }), [countFor, isCustom, applied]);

  const closePicker = () => {
    setPickerOpen(false);
    triggerRef.current?.focus();
  };

  // Escape and a click outside close the picker without committing — the same
  // contract the filter panel's scrim provides. No scrim here: the popover is
  // small and the page behind it stays legible and usable.
  useEffect(() => {
    if (!pickerOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPickerOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handlePointerDown = (event) => {
      if (!anchorRef.current?.contains(event.target)) {
        setPickerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [pickerOpen]);

  const select = (preset) => onChange(
    preset === 'all' ? EMPTY_DATE_RANGE : { preset, from: null, to: null },
  );

  return (
    <div className="date-filter" ref={anchorRef}>
      <div className="date-filter-chips" role="group" aria-label="Filter briefs by date">
        <PresetChip
          label={DATE_PRESET_LABELS.all}
          count={counts.all}
          active={applied.preset === 'all'}
          onClick={() => select('all')}
        />
        {DATE_PRESETS.map((preset) => (
          <PresetChip
            key={preset}
            label={DATE_PRESET_LABELS[preset]}
            count={counts[preset]}
            active={applied.preset === preset}
            onClick={() => select(preset)}
          />
        ))}
        {/* The custom range gets a chip only once one is applied, so the bar does
            not carry an empty slot for a range nobody picked. */}
        {isCustom && (
          <PresetChip
            label={rangeChipLabel(applied)}
            count={counts.custom}
            active
            onClick={() => setPickerOpen(true)}
          />
        )}

        <button
          ref={triggerRef}
          type="button"
          className={`date-filter-tune${pickerOpen ? ' date-filter-tune--open' : ''}`}
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          aria-label="Pick a custom date range"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <TuneIcon />
        </button>
      </div>

      {pickerOpen && (
        <RangePicker
          popoverRef={popoverRef}
          applied={applied}
          countFor={countFor}
          onApply={(next) => {
            onChange(next);
            closePicker();
          }}
          onReset={() => {
            onChange(EMPTY_DATE_RANGE);
            closePicker();
          }}
          onClose={closePicker}
        />
      )}
    </div>
  );
};

export { buildMonthGrid, rangeChipLabel };
export default DateFilterBar;
