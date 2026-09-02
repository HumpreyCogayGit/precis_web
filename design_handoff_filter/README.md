# Handoff: Precis — scalable filter (open on demand, close on apply)

## Overview

Precis (https://precisnews.vercel.app/) currently renders its source and topic
taxonomy as a row of filter buttons in the page header. As sources and topics
are added the row wraps, grows in height, and visibly distorts on mobile.

This handoff replaces that with a **fixed-width header control plus an on-demand
filter panel**:

- The header holds one `Filters` button whose width never changes.
- The taxonomy lives in a panel that is **only mounted while open**.
- Selections inside the panel are a **draft**; `Apply` commits them and closes
  the panel.
- Applied filters then appear **below** the header as removable chips — output,
  not control.

Result: header height is constant at 5 sources or 500, and the mobile reflow bug
disappears because the header no longer contains variable-length content.

Scope note: the X/Twitter stream discussed separately is **out of scope here**.
No post/X facet appears in this design. The facet groups are deliberately open-
ended (`Topics`, `Sources`) so a future "X / posts" source drops in as one more
row without any layout change.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes
that show intended look and behaviour. They are not production code to copy.

The task is to **recreate these designs in the Precis codebase** using its
existing environment (React on Vercel, per the live site), its component
conventions and its styling approach. Where this document gives exact values,
match them; where the codebase already has an equivalent primitive (a button, a
checkbox row, a sheet), use that primitive rather than introducing a new one.

## Fidelity

**High fidelity.** Colors, typography, spacing, states and interaction rules
below are final and should be matched. The one thing intentionally left open is
the target framework's own component library — reuse it.

The article list rendered inside the prototype is filler to demonstrate
filtering; the real list is whatever Precis already renders. **Do not restyle the
article list as part of this work** unless asked.

## Screens / Views

### 1. Default state — desktop

**Purpose:** read the brief; see at a glance whether any filter is active.

**Layout**
- Page frame: 1px solid `#b7b7ba`, square corners, background `#f2f2f3`.
- Header row: `display:flex; align-items:center; gap:16px; padding:14px 20px`,
  bottom border 1px `#b7b7ba`. Fixed height — never wraps.
- Order: brand wordmark → kicker → spacer → `Filters` button (`margin-left:auto`).

**Components**
- **Brand** "Precis" — Barlow Condensed 600, 24px, line-height 1, `#1d1f20`.
- **Kicker** "Daily Tech Brief" — Barlow Condensed, 12px, letter-spacing .12em,
  uppercase, `#7a7a7d`. Hidden below 640px.
- **Filters button** — Barlow Condensed, 15px, letter-spacing .04em, `#ffffff` on
  `#5980a6`, padding 8px 14px, square corners, no border.
  - hover `#597ea3`
  - `:focus-visible` → `outline: 2px solid #5980a6; outline-offset: 2px`
  - When filters are applied it carries a count pill: background
    `rgba(255,255,255,.28)`, padding 0 6px, square. The pill is the *only* part
    that changes width, and it is bounded (1–2 digits).

### 2. Active-filter bar (conditional)

Rendered only when `applied.length > 0`, directly under the header.

- `display:flex; align-items:center; gap:8px; padding:11px 20px; flex-wrap:wrap`,
  bottom border 1px `#d4d4d7`.
- Label "Filtering by" — Barlow Condensed 11px, letter-spacing .12em, uppercase,
  `#7a7a7d`.
- Chips — accent tag style, each with a trailing ✕ at `opacity:.7`. Clicking a
  chip removes that filter **immediately** (no panel, no Apply).
- "Clear all" — text button, 13px, `#416180`, hover `#1d2d3d`.

This bar is the only element allowed to wrap, and it wraps in proportion to how
many filters the *user* chose — not to how large the taxonomy is.

### 3. Filter panel — desktop

**Purpose:** browse and search the full taxonomy without permanently occupying
header space.

**Layout**
- Scrim: absolute, fills the app frame, `rgba(29,31,32,.28)`. Click = cancel.
- Panel: anchored below the button — `position:absolute; top:62px; right:20px;
  width:360px; max-height: calc(100% - 84px)`, `display:flex; flex-direction:column`.
- Border 1px `#98989b`, background `#f2f2f3`, shadow
  `0 12px 32px color-mix(in srgb, #2b2b2d 22%, transparent)`, square corners,
  four `+` registration marks (Industry `.blueprint` treatment).

**Three regions, top to bottom**

1. **Head** — padding 14px 18px, bottom border 1px `#b7b7ba`.
   - Title "Filters" — Barlow Condensed 600, 19px.
   - "Reset" text button, right-aligned, 13px `#416180` — clears the *draft* only.
   - Search input, full width: 1px `#b7b7ba`, transparent fill, padding 7px 10px,
     Barlow 14px, placeholder "Find a source or topic". Focus ring as above.
     Typing filters **both** groups simultaneously and auto-expands them.

2. **Body** — `flex:1; overflow:auto`. Per group:
   - Group head: padding 14px 18px 6px, Barlow Condensed 12px, letter-spacing
     .12em, uppercase, `#7a7a7d`, with the total, e.g. `Topics · 12`.
   - Facet row: `display:flex; justify-content:space-between; padding:8px 18px`,
     Barlow 14px, `cursor:pointer`, hover background `#eef6ff`.
     - Checkbox: 13×13px square. Unchecked = 1px `#98989b`, transparent.
       Checked = 1px `#5980a6`, fill `#5980a6`. Never rounded.
     - Count, right-aligned, 12px `#7a7a7d`.
   - **Cap at 5 rows per group**, sorted by descending count then alphabetically,
     followed by "Show all N" / "Show fewer" — 13px `#416180`, padding 7px 18px 14px.
   - Sources group head carries a 1px `#d4d4d7` top border.
   - If a search matches nothing in either group: "No source or topic matches
     that." — 13px `#7a7a7d`, padding 20px 18px.

3. **Footer** — padding 14px 18px, top border 1px `#b7b7ba`, `display:flex; gap:10px`.
   - Primary: full-flex accent button. Label is **live and predictive**:
     `Show N results` computed from the *draft*, or `Show all 12` when the draft
     is empty. This is what tells the user their combination is empty before they
     commit to it.
   - "Cancel" text button, 13px `#416180`.

### 4. Filter sheet — mobile (< 640px)

Same state machine, different surface.

- Bottom sheet: `position:fixed; left:0; right:0; bottom:0; max-height:88%`,
  background `#f2f2f3`, top border 1px `#98989b`, same large shadow. Scrim
  `rgba(29,31,32,.35)`.
- Grab handle: 36×3px, `#98989b`, centred, 8px padding.
- Title row: "Filters" Barlow Condensed 600 21px + "Reset".
- Facet rows are **list rows, not chips**: `min-height:44px`, padding 12px 18px,
  15px text, 15×15px checkbox, 1px `#d4d4d7` bottom rule. No wrapping, no
  stretching — this is the direct fix for the reported distortion.
- Footer: full-width accent button, padding 13px, same predictive label.
- Body scrolls; the footer button stays pinned and must clear the iOS home
  indicator (`padding-bottom: max(18px, env(safe-area-inset-bottom))`).

### 5. Empty result state

When an applied combination matches nothing: centred, padding 28px 0, 14px
`#7a7a7d` — "Nothing matches this combination today." followed by an inline
"Clear filters" text button. Never a blank list region.

## Interactions & Behavior

| Trigger | Result |
| --- | --- |
| Click `Filters` | Panel opens. `draft` is seeded as a **copy of** `applied`. Search query resets to "". |
| Click a facet row | Toggles that facet **in the draft only**. Results behind the panel do not change. |
| Click `Apply` | `applied = draft`; panel closes. |
| Click `Cancel` | Panel closes; draft discarded. |
| Click scrim | Same as Cancel. |
| Press `Escape` | Same as Cancel. |
| Click a chip in the active bar | Removes that facet from **both** `applied` and `draft`, applies immediately. |
| Click `Clear all` | Empties both `applied` and `draft`. |
| Click `Reset` (in panel) | Empties `draft` and the search query; `applied` untouched until Apply. |
| Type in panel search | Filters both groups; groups auto-expand while a query is present. |

**Filter semantics:** OR within a group, AND across groups. An empty group means
"no constraint from this group" — not "match nothing".

**Transitions:** desktop panel fades/translates in over 120ms ease-out (8px
upward). Mobile sheet slides from the bottom over 220ms
`cubic-bezier(.32,.72,0,1)`. Scrim fades 120ms. Respect
`prefers-reduced-motion: reduce` by dropping to opacity-only.

**Accessibility**
- `Filters` button: `aria-expanded`, `aria-controls` pointing at the panel.
- Panel: `role="dialog" aria-modal="true" aria-label="Filters"`, focus moved to
  the search input on open, focus trapped inside, focus returned to the `Filters`
  button on close.
- Facet rows: real `<input type="checkbox">` visually replaced by the square, or
  `role="checkbox"` with `aria-checked` — keyboard operable either way.
- Chips: `<button>` with `aria-label="Remove filter: Semiconductors"`.
- Never rely on the browser default focus ring; use the 2px accent ring.

**Responsive**
- ≥ 640px: anchored panel.
- < 640px: bottom sheet, and the header kicker is hidden.
- The header itself never changes height at any width.

**URL state (recommended):** serialize applied filters to the query string, e.g.
`?topic=ai-models,funding&source=reuters`, so a filtered view is shareable and
survives reload. Read on mount, write on Apply and on chip removal.

## State Management

```
mode          "desktop" | "mobile"        // prototype only; use a media query in production
open          boolean                     // panel visibility
applied       { topics: string[], sources: string[] }   // committed — drives the article list
draft         { topics: string[], sources: string[] }   // uncommitted — drives the panel
q             string                      // panel search query
allTopics     boolean                     // "show all" expansion, topics group
allSources    boolean                     // "show all" expansion, sources group
```

The **draft/applied split is the core of the design** — it is what makes "close
on apply" meaningful. Do not collapse them into one list.

**Derived, not stored:**
- facet counts — computed from today's items, so a facet that would return zero
  reads `0` before it is clicked;
- `appliedCount` — the header pill;
- predictive Apply label — count of items matching the *draft*.

**Data:** facet lists should come from the items actually loaded for the current
day, not from a static config, so a source with nothing today still sorts to the
bottom with an honest `0`. If facets must come from an API, cache them with the
item payload so counts and rows can never disagree.

## Design Tokens

Industry design system. All values below are already in the linked stylesheet as
CSS custom properties — reference the variables, not the hex codes, wherever the
codebase supports it.

**Color**
| Token | Hex | Used for |
| --- | --- | --- |
| `--color-bg` | `#f2f2f3` | page and panel ground |
| `--color-text` | `#1d1f20` | body and headings |
| `--color-accent` | `#5980a6` | primary button, checked box, focus ring |
| `--color-accent-600` | `#597ea3` | primary button hover |
| `--color-accent-700` | `#416180` | text links / ghost buttons on light ground |
| `--color-accent-900` | `#1d2d3d` | ghost button hover |
| `--color-accent-100` | `#eef6ff` | facet row hover |
| `--color-neutral-300` | `#d4d4d7` | light rules (row separators) |
| `--color-neutral-400` | `#b7b7ba` | structural borders |
| `--color-neutral-500` | `#98989b` | panel border, unchecked box, grab handle |
| `--color-neutral-600` | `#7a7a7d` | secondary text, counts, group heads |
| scrim (desktop) | `rgba(29,31,32,.28)` | — |
| scrim (mobile) | `rgba(29,31,32,.35)` | — |

Accent-on-ground contrast is ~3:1 — fine for chrome and large text, **not** for
paragraph copy. Use `--color-accent-700` for accent-colored body text.

**Typography** — Barlow Condensed (headings, 600) over Barlow (body, 400/500/700),
Google Fonts.
| Role | Font | Size | Weight | Tracking | Case |
| --- | --- | --- | --- | --- | --- |
| Brand | Condensed | 24px | 600 | — | — |
| Panel title | Condensed | 19px | 600 | — | — |
| Sheet title | Condensed | 21px | 600 | — | — |
| Button label | Condensed | 15px | 600 | .04em | — |
| Group head | Condensed | 12px | 600 | .12em | uppercase |
| Kicker / chip label | Condensed | 11px | 600 | .12em | uppercase |
| Facet row (desktop) | Barlow | 14px | 400 | — | — |
| Facet row (mobile) | Barlow | 15px | 400 | — | — |
| Count | Barlow | 12px | 400 | — | — |
| Ghost button | Barlow | 13px | 400 | — | — |
| Body copy | Barlow | 14–15px / 1.55 | 400 | — | — |

**Spacing** — `--space-1..8`: 3.4 / 6.8 / 10.2 / 13.6 / 20.4 / 27.2px (a 0.85×
density scale). Panel paddings in this design: 14px 18px (head, footer),
8px 18px (desktop row), 12px 18px (mobile row), 14px 20px (header).

**Radius** — `0` on every element in this design. Industry is square-cornered;
`--radius-md: 4px` exists but is not used here.

**Shadow** — panel and sheet only: `--shadow-lg`
`0 12px 32px color-mix(in srgb, #2b2b2d 22%, transparent)`. Nothing else is
elevated.

**Frame treatment** — the panel is a `.blueprint` object: 1px hairline border,
square corners, four `+` registration marks at the corners. Cards and frames are
line drawings with **no surface fill**; the accent-filled primary button is the
one deliberate exception.

## Assets

None. No images, and no icon files: the prototype uses two text glyphs (`⌕`
search, `✕` remove) as stand-ins. In production substitute **Lucide** icons at
`stroke-width: 1.5` — `search`, `x`, and optionally `sliders-horizontal` on the
Filters button. Fonts load from Google Fonts via the stylesheet's `@import`.

## Files

| File | What it is |
| --- | --- |
| `Precis Filter.dc.html` | **The prototype.** Fully interactive: open, search, toggle, apply, cancel, Escape, chip removal, empty state. Toggle Desktop / Mobile at the top right to see both surfaces. Open in any browser. |
| `Precis X Stream Options.dc.html` | Context only. Turn 2 holds the three filter approaches that were considered (facet panel, curated-six, token search) and why the facet panel won; turn 1 covers the X/Twitter stream, which is out of scope for this handoff. |
| `styles.css` | The Industry design system stylesheet — the source of truth for every token above. |
| `support.js` | Runtime for the prototype files. Not part of the implementation. |

### Reading the prototype source

Both HTML files are single self-contained documents. Inside each, markup sits in
the `<x-dc>` element and behaviour in the `class Component` script below it.
`renderVals()` returns everything the markup binds to — it is the clearest place
to read the state logic. `sc-if` / `sc-for` are conditional and repeat blocks.

## Implementation order

1. Header: replace the chip row with the fixed `Filters` button. Header height is
   now constant — the reported mobile distortion should be gone at this point.
2. Applied-chip bar + `applied` state + article filtering.
3. Panel shell with draft/applied split, Apply / Cancel / Escape / scrim.
4. Facet groups with counts, 5-row cap, Show all.
5. Panel search.
6. Mobile bottom sheet.
7. URL serialization.
8. Accessibility pass: focus trap, focus return, aria, keyboard toggle.
