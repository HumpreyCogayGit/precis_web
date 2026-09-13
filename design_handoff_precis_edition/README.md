# Handoff: Precis — the dated edition

## Overview

Precis (`precisnews.vercel.app`, repo `HumpreyCogayGit/precis_web`) currently renders every scraped article as an equal-weight card. This handoff restructures it into a **dated daily edition**: one lead story, five ranked briefs, then a dense headline-only list — plus story clusters, search, saved items, a phone layout, and a 7am email.

The work is driven by seven findings, each grounded in the current source. Fix 01 is a prerequisite for everything else.

## About the design files

`reference/Precis Review.dc.html` is a **design reference created in HTML** — a prototype board showing intended structure, hierarchy and behaviour. It is not production code to copy. The task is to recreate these layouts inside the existing Vite + React app (`react-app/`), using its own patterns: function components in `App.jsx`, plain CSS in `App.css`, `axios` against the `/api/*` routes.

Open it in a browser to view. It is a single self-contained file plus `reference/styles.css`.

## Fidelity

**Structurally hi-fi, visually a reference.** Layout, hierarchy, type scale, spacing rhythm and copy are exact and should be followed closely.

**The colour and type treatment is not your brand.** The board is drawn in a wireframe design system (steel blue `#5980a6`, Barlow Condensed / Barlow, square corners, hairline borders, `+` registration marks). Your live site is a different identity — electric blue `#2563eb`, heavy black display type, filled dark cards. **Keep your identity.** Take the structure, the hierarchy and the copy; re-skin with your existing `App.css` variables. If you *do* want the wireframe look, `reference/styles.css` is the complete token sheet and can be dropped in as-is.

---

## The seven findings

| # | Finding | Where it lives now |
| --- | --- | --- |
| 01 | The excerpt is not a summary — the view does `left(regexp_replace(body_text,'\s+',' ','g'), 360) \|\| '…'`, so cards open with the headline repeated, cut mid-word | `sql/create-public-articles-view.sql` |
| 02 | Every item weighs the same — Featured, Editors Picks and Browse All are near-identical cards | `App.jsx` hero / `top-stories` / `latest-section` |
| 03 | "Editors Picks" is `sortedArticles.slice(1, 5)` — items 2–5 by date, labelled as curation and popularity | `App.jsx` `topStories` |
| 04 | Two filter systems for one job — hero `<select>`s and a scrolling chip strip, same state, 900px apart | `App.jsx` `hero-filters` + `source-panel` |
| 05 | Scraper telemetry on the page — `Captured {fetched_at}` on every card; no edition date anywhere | `App.jsx` `ArticleCard` footer |
| 06 | No clustering — one story from three sources is three cards; `open_ai` and `open_ai_releases` both render "OpenAI" | `App.jsx` `SOURCE_DISPLAY_NAMES` |
| 07 | Nothing brings anyone back — no search, save, read state, email or permalink; `visibleCount` resets to 12 on every filter change | `App.jsx` `getInitialVisibleCount` |

---

## Build order

| # | Change | Files | Size |
| --- | --- | --- | --- |
| 1 | `summary` column, written at scrape time; exposed on the view | scraper, `sql/create-public-articles-view.sql` | ½ day |
| 2 | Dated masthead, three tiers, drop `fetched_at` from cards | `App.jsx`, `App.css` | 1 day |
| 3 | One sticky filter bar; delete hero selects + chip scroller | `App.jsx` | ½ day |
| 4 | Rename Editors Picks, or rank by source count | `App.jsx`, `lib/articles.js` | ½ day |
| 5 | Saved + read state in localStorage | `App.jsx` | 1 day |
| 6 | Search endpoint over title + summary | new `api/search.js` | 1 day |
| 7 | Story clustering and the cluster page | scraper, new route | 1 week |
| 8 | The 7am email | cron + template | 2 days |

---

## Step 1 — the summary column (do this first)

Everything else assumes a real summary exists.

**Scraper side.** After capturing `body_text`, generate one sentence, max 25 words, stating what happened. Store it as `articles.summary`. Never fall back to the first N characters of the body — if summarisation fails, store `NULL` and let the UI show headline only.

**View side.** In `sql/create-public-articles-view.sql`, add `summary` to the select list. Keep `excerpt` for now so nothing breaks, and delete it once the UI stops reading it:

```sql
CREATE OR REPLACE VIEW public.public_articles
WITH (security_barrier = true)
AS
SELECT
  url, site, topic, title, author, published_at, image_url,
  summary,                          -- new: one sentence, written at scrape time
  CASE ... END AS excerpt,          -- unchanged for now; remove after the UI migrates
  fetched_at
FROM public.articles
WHERE COALESCE(needs_review, FALSE) = FALSE;
```

**API side.** Add `summary` to the select in `buildFetchArticlesQuery` in `lib/articles.js`.

---

## Screens

### Screen 01 — Today's edition (1280px, `/`)

Replaces the whole current home page.

**Layout.** Full-width header bar. Masthead block. Sticky filter bar. Then a two-column body: main column (fluid) and a 320px right rail, separated by a 1px divider.

**Header bar.** 16px vertical / 32px horizontal padding, 1px bottom border. Left to right: wordmark; nav links `Today · Archive · Sources · Saved` at 14px with a 2px accent underline on the active item; then right-aligned, a 230×34 search field (magnifier + "Search 4,180 briefs" placeholder) and a primary "Get the 7am email" button, 34px tall, 13px.

**Masthead.** 34px top padding. Kicker "Daily tech brief", 12px, uppercase, 0.2em tracking, accent. Headline is the edition date — "Tuesday, September 1" — 56px condensed, line-height 0.95. Sub-line 14px muted: `42 items from 11 sources · last scrape 12:10 PM · 6 new since 8am`. Right-aligned segmented control: `Today | This week | Everything`, "Today" selected.

**Filter bar.** Full-width strip, 12px/32px padding, light neutral fill, 1px top border and a heavier 1px bottom border. Two labelled groups on one line — `TOPIC` (All / AI / Cyber security) and `SOURCE` (All 11 + the eleven names) — separated by an 18px vertical rule. Active chip is a solid accent fill with paper-coloured text; inactive chips are neutral. This bar replaces **both** the hero `<select>`s and the `source-strip` chip scroller. At 1280px eleven source chips fit on one line — no horizontal scroller.

**Lead story.** 400px image + fluid text, 28px gap, 32px bottom padding, heavy 1px bottom rule. Image is 236px tall. Text column: an outlined "Lead" tag and `Source · 3h ago` on one row; headline 38px, line-height 1.02; summary 17px, line-height 1.45, muted; then a secondary "Read at <source>" button and a bookmark "Save" affordance.

**Also today.** Heading 24px condensed, with the qualifier "ranked by how many sources covered it" at 13px beside it. Five rows, `34px | 1fr | auto` grid, 18px gap, 16px vertical padding, 1px top rule per row. Rank number 20px condensed accent (`01`…`05`). Headline 21px. Summary line 15px muted. Meta row 12.5px: `Source · 5h ago · 3 sources`, with the source count in accent — it is a link to the cluster page. Bookmark icon right-aligned.

**Everything else.** Heading 24px, "36 items · headline only". Rows are `1fr | 130px | 62px`, 11px padding, 15.5px headline, 12.5px source and date. Already-opened rows drop to a muted grey. Footer line: "Show 31 more →".

**Right rail (320px).** Light neutral fill, 32px/24px padding, 30px gaps. Three blocks: *Today by source* (name + count, hairline rules, "6 more sources" as the last row); an email signup card (framed, white, headline "The brief, in your inbox at 7am", input, full-width primary button); *Recent editions* (three dated links).

**Copy that must not drift:** the masthead sub-line format, "Also today" (not "Editors Picks" — see finding 03), and "ranked by how many sources covered it".

### Screen 02 — Story cluster (1280px, `/story/:id`)

Opens from "3 sources". Header keeps the wordmark plus a `Tuesday, September 1 / Story` breadcrumb, with "Save" and "Copy link" secondary buttons right-aligned.

Two columns: article (fluid, 40px/44px padding) + 380px rail.

Article column: topic tag and `First reported 5h ago · 3 sources · still developing` at 13px; short headline at 46px capped to ~16ch; a 19px, 60ch standfirst summarising the story across sources.

Then **Coverage**: a `96px | 1fr` grid, one row per source, 18px padding, hairline rules. Left cell is source name (13px semibold), relative time, and — on the originating source only — an outlined "Primary" tag. Right cell is that source's headline (19px), its own summary (15px, 62ch), and a `domain →` link.

Rail: primary-source image, a **Related** list (headline + `source · date`), and a **Follow** block with `+ AI` and `+ OpenAI` outlined tags.

### Screen 03 — Search (616px panel, `/search`)

42px search field with an accent border when focused. Filter chips below: `All time | Last 7 days | OpenAI | Saved only`. Result count line: `14 briefs mention "codex"`. Results are headline (18px) + `source · date` (12.5px), hairline-ruled, with the matched term highlighted in a light accent wash.

Implementation: Postgres full-text over `title` and `summary`. One GIN index on the existing view's base table; a new `api/search.js` mirroring the validation style already in `lib/articles.js` (`normalizeFilter`, `normalizePagination`, a max query length, `QueryValidationError` on bad input).

### Screen 04 — Saved (616px panel, `/saved`)

Heading 34px, sub-line `9 briefs · stored on this device`. Rows: headline 18px, `source · saved today` 12.5px, "Remove" right-aligned in accent.

localStorage-first — no accounts, no auth work. Suggested shape:

```js
// precis:saved  -> { [url]: { title, site, savedAt } }
// precis:read   -> { [url]: readAtISO }
```

`precis:read` is what greys out rows in Everything else. Both are per-device; do not block the redesign on auth (`docs/auth-readiness.md` can stay as-is).

### Screen 05 — Phone (390px)

Header: wordmark + search and bookmark icons. Masthead: kicker, date at 34px on two lines, `42 items · 6 new since 8am`. Three topic chips only — sources move behind a filter sheet.

Then the lead (no image at this width): "Lead" tag, 27px headline, 15.5px summary, `source · 3h ago`. Then Also today at `28px | 1fr`, 18px headlines and 14px summaries. Bottom tab bar: `Today | Archive | Saved`, 14px vertical padding — bump tap targets to 44px minimum in implementation.

The current three-column `articles-container` grid should collapse to this single column, not to forty-two full cards.

### Screen 06 — The 7am email (600px)

Table-based HTML email, 600px. Header: wordmark + edition date, heavy rule under. Lead block: `Lead · Source` kicker, 26px headline, 15px summary. Then four numbered rows (`26px | 1fr`), each a 17px headline plus a single 14px line combining summary and source. Footer: primary "Read the full edition" button and `38 more items on the site`.

Content rule: the lead and the five, nothing else. The email is a teaser for the edition, not a copy of it.

---

## Interactions & behaviour

- **Filter change** — re-render in place; do **not** reset scroll, and do not reset `visibleCount` back to 12 (current `getInitialVisibleCount` behaviour). Persist the active filter in the URL (`?source=open_ai&topic=AI`) so filtered views are linkable.
- **Save** — optimistic toggle, writes `precis:saved`, icon fills.
- **Read state** — mark on click-through, writes `precis:read`, row greys.
- **"3 sources"** — navigates to the cluster page.
- **Show more** — appends 12; keep the existing count line but move it below the button.
- **Loading** — keep the current skeleton card, restyled to the edition layout.
- **Error** — keep the existing message-card copy; it is clear and honest.
- **Empty** — per-filter, e.g. "No Cyber security items today. See yesterday's edition →".
- **Focus** — every interactive element needs a visible keyboard ring; the current chips and selects rely on browser defaults.

## State

```
edition        { date, itemCount, sourceCount, lastScrapeAt }
articles[]     { url, site, topic, title, summary, published_at, image_url, clusterId, sourceCount }
filters        { source, topic, range }   // mirrored into the URL
visibleCount   // does NOT reset on filter change
saved          // localStorage precis:saved
read           // localStorage precis:read
query          // search page only
```

## Design tokens (the reference board)

Use these only if you adopt the wireframe look; otherwise map structure onto your existing `App.css` variables. Full sheet in `reference/styles.css`.

```
--color-bg        #f2f2f3     --color-text      #1d1f20
--color-accent    #5980a6     --color-divider   rgba(29,31,32,.16)
accent ramp   100 #eef6ff · 200 #d6ebff · 700 #416180 · 800 #2c455d · 900 #1d2d3d
neutral ramp  100 #f5f5f8 · 500 #98989b · 600 #7a7a7d · 700 #5d5d60 · 800 #424244

--font-heading  "Barlow Condensed", 600      --font-body  "Barlow", 400
--space  3.4 / 6.8 / 10.2 / 13.6 / 20.4 / 27.2 px
--radius-sm 2px · --radius-md 4px · --radius-lg 7px
```

Type scale used on the board: 76 / 56 / 46 / 38 / 34 / 30 / 27 / 26 / 24 / 21 / 19 / 18 / 17 / 15.5 / 15 / 14 / 13 / 12.5 / 12 / 11 px.

## Assets

- **Icons** — Lucide at stroke-width 1.5 (`bookmark`, `search`). Install `lucide-react` in `react-app/` rather than hand-drawing paths.
- **Images** — every image on the board is a placeholder block. Real images come from `image_url` through the existing `/api/image-proxy`. No new assets are needed.
- **Fonts** — Barlow and Barlow Condensed (Google Fonts), only if you adopt the reference styling.

## Files

- `reference/Precis Review.dc.html` — the full board: seven findings, six screens, build order. Open in a browser.
- `reference/styles.css` — the token sheet and component classes the board is drawn with.
- `screens/01-todays-edition.png` … `screens/06-email.png` — each screen captured at 2×. The HTML board is the source of truth for measurements; the PNGs are for quick reference.

Source files this was written against, at `HumpreyCogayGit/precis_web@main`:
`react-app/src/App.jsx`, `react-app/src/App.css`, `lib/articles.js`, `api/articles.js`, `sql/create-public-articles-view.sql`.
