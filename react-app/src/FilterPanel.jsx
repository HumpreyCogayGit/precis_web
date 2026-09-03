import { MinusIcon, SearchIcon } from './icons.jsx';

// The panel is presentational: App owns `applied`/`draft` and hands the already
// counted, already sorted facet rows down. Every number a row shows is computed
// against the draft (see computeFacetRows in filters.js), so it answers "what
// happens if I click this?" rather than "how big is this facet overall".

const matchesQuery = (row, query) => !query || row.label.toLowerCase().includes(query);

// A count is only ever prefixed with + when it describes rows the click would
// ADD. In ALL mode the number is a remainder, and labelling a shrink as an
// addition is the single easiest way to make this feature lie.
const formatCount = (row) => (row.showPlus ? `+${row.count}` : String(row.count));

const FacetRow = ({ group, row, onToggle, onToggleExclude }) => {
  const isExcluded = row.state === 'excluded';
  const isIncluded = row.state === 'included';
  const isDead = row.state === 'unavailable';

  return (
    <div className={`filter-panel-row filter-panel-row--${row.state}`}>
      <button
        type="button"
        className="filter-panel-row-toggle"
        role="checkbox"
        aria-checked={isIncluded}
        aria-disabled={isDead || undefined}
        onClick={() => (isDead ? undefined : onToggle(group, row.slug))}
      >
        <span className="filter-panel-checkbox" aria-hidden="true">{isExcluded ? '−' : ''}</span>
        <span className="filter-panel-row-label">{row.label}</span>
        <span className="filter-panel-count">{isExcluded ? 'excluded' : formatCount(row)}</span>
      </button>
      {onToggleExclude && (
        <button
          type="button"
          className="filter-panel-exclude"
          aria-label={`${isExcluded ? 'Stop excluding' : 'Exclude'} tag: ${row.label}`}
          aria-pressed={isExcluded}
          aria-disabled={isDead || undefined}
          onClick={() => (isDead ? undefined : onToggleExclude(row.slug))}
        >
          <MinusIcon />
        </button>
      )}
    </div>
  );
};

const TagModeToggle = ({ mode, onChange }) => (
  <span className="filter-panel-mode" role="group" aria-label="Combine selected tags">
    {['any', 'all'].map((option) => (
      <button
        key={option}
        type="button"
        className={`filter-panel-mode-option${mode === option ? ' active' : ''}`}
        aria-pressed={mode === option}
        onClick={() => onChange(option)}
      >
        {option.toUpperCase()}
      </button>
    ))}
  </span>
);

const FacetGroup = ({ group, query, isSearching, onToggleFacet, onToggleExclude, onToggleGroup, onToggleExpanded, onTagModeChange }) => {
  const visible = group.rows.filter((row) => matchesQuery(row, query));

  if (group.rows.length === 0 || (isSearching && visible.length === 0)) {
    return null;
  }

  // A search spans every group, so the groups open themselves and the row cap
  // steps aside while a query is present.
  const open = isSearching || group.open;
  const rows = isSearching || group.expanded ? visible : visible.slice(0, group.cap);
  const hasCap = !isSearching && visible.length > group.cap;

  return (
    <div className="filter-panel-group">
      <div className="filter-panel-group-head">
        <button
          type="button"
          className="filter-panel-group-toggle"
          aria-expanded={open}
          onClick={() => onToggleGroup(group.key)}
        >
          {group.title} &middot; {group.rows.length}
        </button>
        {group.key === 'tags' && <TagModeToggle mode={group.mode} onChange={onTagModeChange} />}
        <span className="filter-panel-group-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div className="filter-panel-group-body">
          {rows.map((row) => (
            <FacetRow
              key={row.slug}
              group={group.key}
              row={row}
              onToggle={onToggleFacet}
              onToggleExclude={group.key === 'tags' ? onToggleExclude : undefined}
            />
          ))}
          {hasCap && (
            <button type="button" className="filter-panel-show-all" onClick={() => onToggleExpanded(group.key)}>
              {group.expanded ? 'Show fewer' : `Show all ${visible.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const FilterPanel = ({
  panelRef,
  searchInputRef,
  titleId,
  anchorStyle,
  groups,
  query,
  onQueryChange,
  onToggleGroup,
  onToggleExpanded,
  onToggleFacet,
  onToggleExclude,
  onTagModeChange,
  onReset,
  onApply,
  onCancel,
  applyLabel,
}) => {
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const hasFacets = groups.some((group) => group.rows.length > 0);
  const noMatches = isSearching && hasFacets
    && !groups.some((group) => group.rows.some((row) => matchesQuery(row, normalizedQuery)));

  return (
    <div
      ref={panelRef}
      id="filters-panel"
      className="filter-panel"
      style={anchorStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <span className="filter-panel-mark filter-panel-mark--tl" aria-hidden="true" />
      <span className="filter-panel-mark filter-panel-mark--tr" aria-hidden="true" />
      <span className="filter-panel-mark filter-panel-mark--bl" aria-hidden="true" />
      <span className="filter-panel-mark filter-panel-mark--br" aria-hidden="true" />
      <span className="filter-panel-grab" aria-hidden="true" />
      <div className="filter-panel-head">
        <div className="filter-panel-head-row">
          <h2 id={titleId} className="filter-panel-title">Filters</h2>
          <button type="button" className="filter-panel-reset" onClick={onReset}>Reset</button>
        </div>
        <label className="filter-panel-search">
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find a source, topic or tag"
            aria-label="Find a source, topic or tag"
          />
        </label>
      </div>

      <div className="filter-panel-body">
        {noMatches ? (
          <p className="filter-panel-no-matches">No source, topic or tag matches that.</p>
        ) : (
          groups.map((group) => (
            <FacetGroup
              key={group.key}
              group={group}
              query={normalizedQuery}
              isSearching={isSearching}
              onToggleFacet={onToggleFacet}
              onToggleExclude={onToggleExclude}
              onToggleGroup={onToggleGroup}
              onToggleExpanded={onToggleExpanded}
              onTagModeChange={onTagModeChange}
            />
          ))
        )}
      </div>

      <div className="filter-panel-footer">
        <button type="button" className="filter-panel-apply" onClick={onApply}>{applyLabel}</button>
        <button type="button" className="filter-panel-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

export default FilterPanel;
