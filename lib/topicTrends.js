const { query } = require('./db');
const { slugifyTag } = require('./articles');
const { normalizeIntegerParam } = require('./trending');

// The home page's "Rising Now" panel: which subject TAGS are gaining share, per topic
// and across all topics, over 24h / 7d / 30d.
//
// WHY NOT trend_leaderboard. That view ranks named entities over one fixed 7-day
// window with a unitless lift. These sections rank taxonomy tags within a topic, over
// three windows, with a % change a reader can read — a different question, so it is
// answered here from the articles themselves.
//
// WHY published_at AND NOT fetched_at. The archive was backfilled: on 2026-09-15 every
// fetched_at fell between Aug 31 and Sep 14, so a fetched_at window says when the
// scraper ran, not when anything happened. published_at is TEXT in mixed formats
// (ISO, "July 15, 2026", "Sep 11, 2026"), so it is parsed here in JS — the same reason
// sortArticlesNewestFirst exists.
//
// WHY SHARE AND NOT COUNT. Archive coverage thins with age (849 articles in the last
// 30 days, 215 in the 30 before), so raw counts would show nearly every tag rising.
// Growth compares a tag's share of each window's articles instead — the same
// share-over-share idea as the scorer's lift (scoring/trend_score/entities.py).
//
// WHY SMOOTH TOWARD THE BASELINE. A 24h window holds ~30 articles, so a raw share
// swings wildly on one article. Both windows' shares are pulled toward the tag's own
// share over the whole 60-day span by PRIOR_WEIGHT pseudo-articles. A tag whose share
// has not moved reads exactly 0% however thin either window is, and a small window is
// pulled harder than a large one. (The first version added +1 per tag to the previous
// window instead; with 41 tags against a 35-article previous day, that inflated every
// 24h figure ~2.2x and tied unrelated tags at the same +181%.)
//
// WHY RANK BY SCORE AND NOT %. 3 articles against 2 and 60 against 40 are the same
// +50%, but only one of them is news. Rows are ordered by log growth weighted by
// sqrt(article count), so a rise has to be both real and backed by volume to lead.
//
// WHY ALL THREE WINDOWS IN ONE RESPONSE. The same working-set reasoning as
// lib/trending.js: the toggle switches instantly and a section never shows a spinner.

const TREND_TOPICS = ['AI', 'Cyber Security'];
// The combined ranking across every topic, which the home page shows when no single
// topic is selected. Each tag appears once, so "AI Security" is not listed twice.
const ALL_TOPICS_KEY = 'All';

const DAY_MS = 24 * 60 * 60 * 1000;
// minMentions keeps a tag with one or two articles from topping a list on noise; the
// 24h window is small enough (~30 articles) that its floor has to be lower.
const TREND_WINDOWS = [
  { key: '24h', ms: DAY_MS, minMentions: 2 },
  { key: '7d', ms: 7 * DAY_MS, minMentions: 3 },
  { key: '30d', ms: 30 * DAY_MS, minMentions: 5 },
];
// The baseline spans every window and the one before it: 2 x the widest window.
const BASELINE_MS = 2 * Math.max(...TREND_WINDOWS.map((window) => window.ms));

const DEFAULT_TREND_LIMIT = 5;
// High enough to return every subject tag (41 today), so the home page's "Show all"
// needs no second request.
const MAX_TREND_LIMIT = 50;
// How many pseudo-articles at the baseline share each window's share is blended with.
const PRIOR_WEIGHT = 10;
// A parsed date before this is a template default or a misread, not a publication.
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
// Matches the endpoint's s-maxage: nothing here is staler than the edge cache allows.
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;

// Only the three columns the aggregation needs, so the view's excerpt expression is
// never evaluated. The whole tagged archive is a few thousand rows.
const ARTICLE_TAGS_SQL = `
  SELECT tags, published_at, fetched_at
  FROM public.public_articles
  WHERE cardinality(tags) > 0
`;

// Format tags (Podcast, Advisory) and the General fallback have no row here, so reading
// the map is also what keeps them out of the rankings.
const TAG_TOPICS_SQL = `
  SELECT tag, topic
  FROM public.tag_topics
`;

function normalizeTrendLimit(value) {
  return normalizeIntegerParam(value, { field: 'limit', defaultValue: DEFAULT_TREND_LIMIT, max: MAX_TREND_LIMIT });
}

// Ported from parse_published_at in scoring/trend_score/repository.py, with one
// deliberate difference: an unparseable date is null, not fetched_at. Falling back to
// the fetch time would put every undated backfilled article in "the last 7 days".
function parsePublishedAt(raw, fetchedAt) {
  if (raw === undefined || raw === null) {
    return null;
  }

  const text = String(raw).trim();
  const parsed = text ? Date.parse(text) : NaN;
  if (!Number.isFinite(parsed) || parsed < EARLIEST_PLAUSIBLE_MS) {
    return null;
  }

  // A date after the fetch (timezone bugs, templated "updated" fields) is clamped to
  // the fetch, as the scorer does, so it cannot sit in the newest window forever.
  const fetchedMs = fetchedAt ? new Date(fetchedAt).getTime() : NaN;
  return Number.isFinite(fetchedMs) && parsed > fetchedMs ? fetchedMs : parsed;
}

const tallyTags = (tally, tags, bucket) => {
  for (const tag of tags) {
    const count = tally.counts.get(tag) || { now: 0, prev: 0 };
    count[bucket] += 1;
    tally.counts.set(tag, count);
  }
};

function rankTopic(topic, tally, baseline, topicsByTag, { minMentions, limit }) {
  const { nowTotal, prevTotal, counts } = tally;
  const rows = [];

  for (const [tag, { now: nowN, prev: prevN }] of counts) {
    if (nowN === 0 || (topic !== ALL_TOPICS_KEY && !topicsByTag.get(tag).has(topic))) {
      continue;
    }

    // The window sits inside the baseline, so a tag counted here has a non-zero base.
    const baseShare = (baseline.counts.get(tag) || 0) / Math.max(baseline.total, 1);
    const shareNow = (nowN + PRIOR_WEIGHT * baseShare) / (nowTotal + PRIOR_WEIGHT);
    const sharePrev = (prevN + PRIOR_WEIGHT * baseShare) / (prevTotal + PRIOR_WEIGHT);
    const ratio = shareNow / sharePrev;

    rows.push({
      tag,
      slug: slugifyTag(tag),
      now_n: nowN,
      prev_n: prevN,
      // `|| 0` folds -0 (a flat tag) into 0.
      growth_pct: Math.round((ratio - 1) * 100) || 0,
      is_new: prevN === 0,
      score: Math.log(ratio) * Math.sqrt(nowN),
    });
  }

  const byScore = (a, b) => b.score - a.score || b.now_n - a.now_n || a.tag.localeCompare(b.tag);
  const byVolume = (a, b) => b.now_n - a.now_n || b.score - a.score || a.tag.localeCompare(b.tag);

  // Tags under the mention floor never outrank one above it, but still fill a short
  // list (a quiet 24h) so the section does not look broken.
  const eligible = rows.filter((row) => row.now_n >= minMentions).sort(byScore);
  const filler = rows.filter((row) => row.now_n < minMentions).sort(byVolume);

  // The score only orders rows; it is not a number a reader can interpret, so it
  // stays out of the response.
  return [...eligible, ...filler]
    .slice(0, limit)
    .map(({ score, ...row }, index) => ({ rank: index + 1, ...row }));
}

// Pure: every input is passed in, including `now`, so the tests can pin windows.
function aggregateTopicTrends(articleRows, tagTopicRows, { now = Date.now(), limit = DEFAULT_TREND_LIMIT } = {}) {
  const topicsByTag = new Map();
  for (const { tag, topic } of tagTopicRows) {
    if (!TREND_TOPICS.includes(topic)) {
      continue;
    }
    if (!topicsByTag.has(tag)) {
      topicsByTag.set(tag, new Set());
    }
    // "AI Security" maps to both topics, so it is ranked in both sections.
    topicsByTag.get(tag).add(topic);
  }

  const baseline = { total: 0, counts: new Map() };
  const tallies = TREND_WINDOWS.map(() => ({ nowTotal: 0, prevTotal: 0, counts: new Map() }));

  for (const row of articleRows) {
    const publishedMs = parsePublishedAt(row.published_at, row.fetched_at);
    if (publishedMs === null) {
      continue;
    }

    const age = now - publishedMs;
    const subjectTags = [...new Set(Array.isArray(row.tags) ? row.tags : [])]
      .filter((tag) => topicsByTag.has(tag));
    if (age < 0 || age >= BASELINE_MS || subjectTags.length === 0) {
      continue;
    }

    baseline.total += 1;
    for (const tag of subjectTags) {
      baseline.counts.set(tag, (baseline.counts.get(tag) || 0) + 1);
    }

    TREND_WINDOWS.forEach((window, index) => {
      // Half-open windows: (now - W, now] is current, (now - 2W, now - W] is previous.
      const tally = tallies[index];
      if (age < window.ms) {
        tally.nowTotal += 1;
        tallyTags(tally, subjectTags, 'now');
      } else if (age < 2 * window.ms) {
        tally.prevTotal += 1;
        tallyTags(tally, subjectTags, 'prev');
      }
    });
  }

  const windows = {};
  const totals = {};
  TREND_WINDOWS.forEach((window, index) => {
    const tally = tallies[index];
    totals[window.key] = { now: tally.nowTotal, prev: tally.prevTotal };
    windows[window.key] = Object.fromEntries([...TREND_TOPICS, ALL_TOPICS_KEY].map((topic) => [
      topic,
      rankTopic(topic, tally, baseline, topicsByTag, { minMentions: window.minMentions, limit }),
    ]));
  });

  return { generated_at: new Date(now).toISOString(), windows, totals };
}

// The rows are cached rather than the ranking, so every `limit` shares one read.
let sourceCache = null;

async function loadTrendSource() {
  if (sourceCache && sourceCache.expiresAt > Date.now()) {
    return sourceCache.value;
  }

  const [articles, tagTopics] = await Promise.all([
    query(ARTICLE_TAGS_SQL, []),
    query(TAG_TOPICS_SQL, []),
  ]);
  const value = { articles: articles.rows, tagTopics: tagTopics.rows };
  sourceCache = { value, expiresAt: Date.now() + SOURCE_CACHE_TTL_MS };
  return value;
}

async function fetchTopicTrends({ limit } = {}) {
  const normalizedLimit = normalizeTrendLimit(limit);
  const { articles, tagTopics } = await loadTrendSource();
  return aggregateTopicTrends(articles, tagTopics, { limit: normalizedLimit });
}

module.exports = {
  ALL_TOPICS_KEY,
  ARTICLE_TAGS_SQL,
  DEFAULT_TREND_LIMIT,
  MAX_TREND_LIMIT,
  PRIOR_WEIGHT,
  TAG_TOPICS_SQL,
  TREND_TOPICS,
  TREND_WINDOWS,
  aggregateTopicTrends,
  fetchTopicTrends,
  normalizeTrendLimit,
  parsePublishedAt,
};
