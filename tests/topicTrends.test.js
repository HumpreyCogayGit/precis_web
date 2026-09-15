const assert = require('node:assert/strict');
const test = require('node:test');
const { QueryValidationError } = require('../lib/articles');
const {
  ARTICLE_TAGS_SQL,
  TAG_TOPICS_SQL,
  aggregateTopicTrends,
  normalizeTrendLimit,
  parsePublishedAt,
} = require('../lib/topicTrends');

const NOW = Date.parse('2026-09-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const FETCHED = '2026-09-15T11:00:00Z';

const TAG_TOPICS = [
  { tag: 'Agentic AI', topic: 'AI' },
  { tag: 'LLM Release', topic: 'AI' },
  { tag: 'Ransomware', topic: 'Cyber Security' },
  { tag: 'AI Security', topic: 'Cyber Security' },
  { tag: 'AI Security', topic: 'AI' },
];

const article = (tags, ageMs) => ({
  tags,
  published_at: new Date(NOW - ageMs).toISOString(),
  fetched_at: FETCHED,
});
const repeat = (count, make) => Array.from({ length: count }, make);
const find = (rows, tag) => rows.find((row) => row.tag === tag);

test('published dates parse from every format the archive holds, and junk is excluded', () => {
  assert.equal(parsePublishedAt('2026-09-11T10:10:56.124Z', FETCHED), Date.parse('2026-09-11T10:10:56.124Z'));
  assert.ok(Number.isFinite(parsePublishedAt('July 15, 2026', FETCHED)));
  assert.ok(Number.isFinite(parsePublishedAt('Sep 11, 2026', FETCHED)));
  assert.ok(Number.isFinite(parsePublishedAt('2026-01-28T14:30:00+00:00', FETCHED)));

  for (const junk of [null, undefined, '', '   ', 'yesterday', '1970-01-01T00:00:00Z']) {
    assert.equal(parsePublishedAt(junk, FETCHED), null, `expected ${junk} to be excluded`);
  }
});

test('a published date after the fetch is clamped to the fetch', () => {
  assert.equal(parsePublishedAt('2027-01-01T00:00:00Z', FETCHED), Date.parse(FETCHED));
});

test('undated articles are left out of the windows rather than counted at fetch time', () => {
  const rows = [{ tags: ['Agentic AI'], published_at: 'not a date', fetched_at: FETCHED }];
  const result = aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW });
  assert.deepEqual(result.totals['7d'], { now: 0, prev: 0 });
  assert.deepEqual(result.windows['7d'].AI, []);
});

test('windows are half-open: exactly one window old belongs to the previous window', () => {
  const rows = [
    article(['Agentic AI'], DAY - 1),
    article(['Agentic AI'], DAY),
  ];
  const result = aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW });
  assert.deepEqual(result.totals['24h'], { now: 1, prev: 1 });
  assert.deepEqual(result.totals['7d'], { now: 2, prev: 0 });
});

test('growth compares share of the window, so a thinner past does not make everything rise', () => {
  // Current 7d: Agentic AI is half of 20 articles. Previous 7d: half of 10.
  // Raw counts say +100%; its share has not moved.
  const rows = [
    ...repeat(10, () => article(['Agentic AI'], 2 * DAY)),
    ...repeat(10, () => article(['LLM Release'], 2 * DAY)),
    ...repeat(5, () => article(['Agentic AI'], 9 * DAY)),
    ...repeat(5, () => article(['LLM Release'], 9 * DAY)),
  ];
  const agentic = find(aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW }).windows['7d'].AI, 'Agentic AI');

  assert.equal(agentic.now_n, 10);
  assert.equal(agentic.prev_n, 5);
  assert.equal(agentic.growth_pct, 0);
});

test('a flat tag reads 0% even when both windows are tiny, instead of every row inflating', () => {
  // The 24h shape that tied three tags at +181%: ~30 articles now, ~35 before, one
  // tag holding the same share in both. The smoothing must not manufacture a rise.
  const rows = [
    ...repeat(3, () => article(['Agentic AI'], 2 * 60 * 60 * 1000)),
    ...repeat(27, () => article(['LLM Release'], 2 * 60 * 60 * 1000)),
    ...repeat(4, () => article(['Agentic AI'], 30 * 60 * 60 * 1000)),
    ...repeat(36, () => article(['LLM Release'], 30 * 60 * 60 * 1000)),
  ];
  const { AI } = aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW }).windows['24h'];

  assert.equal(find(AI, 'Agentic AI').growth_pct, 0);
  assert.equal(find(AI, 'LLM Release').growth_pct, 0);
});

test('a thin window is pulled toward the baseline, so tiny counts cannot post huge rises', () => {
  // Agentic AI: 3 of 30 now vs 1 of 30 before — raw share says +200%.
  const rows = [
    ...repeat(3, () => article(['Agentic AI'], 2 * 60 * 60 * 1000)),
    ...repeat(27, () => article(['LLM Release'], 2 * 60 * 60 * 1000)),
    ...repeat(1, () => article(['Agentic AI'], 30 * 60 * 60 * 1000)),
    ...repeat(29, () => article(['LLM Release'], 30 * 60 * 60 * 1000)),
  ];
  const agentic = find(aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW }).windows['24h'].AI, 'Agentic AI');

  assert.ok(agentic.growth_pct > 0);
  assert.ok(agentic.growth_pct < 200, `smoothed growth ${agentic.growth_pct}% should be well under the raw +200%`);
});

test('the same % backed by more articles ranks higher', () => {
  // Agentic AI 60 vs 40 and LLM Release 3 vs 2 are both +50% on raw share; the
  // volume-backed rise leads. Computer Vision absorbs the rest so totals match.
  const tagTopics = [...TAG_TOPICS, { tag: 'Computer Vision', topic: 'AI' }];
  const rows = [
    ...repeat(60, () => article(['Agentic AI'], 2 * DAY)),
    ...repeat(3, () => article(['LLM Release'], 2 * DAY)),
    ...repeat(37, () => article(['Computer Vision'], 2 * DAY)),
    ...repeat(40, () => article(['Agentic AI'], 9 * DAY)),
    ...repeat(2, () => article(['LLM Release'], 9 * DAY)),
    ...repeat(58, () => article(['Computer Vision'], 9 * DAY)),
  ];
  const ai = aggregateTopicTrends(rows, tagTopics, { now: NOW }).windows['7d'].AI;

  assert.deepEqual(ai.map((row) => row.tag), ['Agentic AI', 'LLM Release', 'Computer Vision']);
  assert.ok(!('score' in ai[0]), 'the internal ranking score is not part of the response');
});

test('a rising tag outranks a steady one, and ranks are assigned in order', () => {
  const rows = [
    ...repeat(12, () => article(['Agentic AI'], 2 * DAY)),
    ...repeat(4, () => article(['LLM Release'], 2 * DAY)),
    ...repeat(2, () => article(['Agentic AI'], 9 * DAY)),
    ...repeat(8, () => article(['LLM Release'], 9 * DAY)),
  ];
  const ai = aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW }).windows['7d'].AI;

  assert.deepEqual(ai.map((row) => [row.rank, row.tag]), [[1, 'Agentic AI'], [2, 'LLM Release']]);
  assert.ok(ai[0].growth_pct > 0);
  assert.ok(ai[1].growth_pct < 0);
  assert.equal(ai[0].slug, 'agentic-ai');
});

test('tags under the mention floor never outrank eligible ones, and a tag with no past is new', () => {
  const rows = [
    // LLM Release: 2 articles, no history — a huge smoothed rise, but under the 7d floor of 3.
    ...repeat(2, () => article(['LLM Release'], 2 * DAY)),
    ...repeat(3, () => article(['Agentic AI'], 2 * DAY)),
    ...repeat(3, () => article(['Agentic AI'], 9 * DAY)),
  ];
  const ai = aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW }).windows['7d'].AI;

  assert.deepEqual(ai.map((row) => row.tag), ['Agentic AI', 'LLM Release']);
  assert.equal(find(ai, 'LLM Release').is_new, true);
  assert.equal(find(ai, 'Agentic AI').is_new, false);
});

test('AI Security is ranked in both topics; format and fallback tags in neither', () => {
  const rows = repeat(6, () => article(['AI Security', 'Advisory', 'General', 'Podcast'], 2 * DAY));
  const { windows } = aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW });

  assert.deepEqual(windows['7d'].AI.map((row) => row.tag), ['AI Security']);
  assert.deepEqual(windows['7d']['Cyber Security'].map((row) => row.tag), ['AI Security']);
});

test('the combined ranking lists every topic\'s tags once, AI Security included', () => {
  const rows = [
    ...repeat(6, () => article(['AI Security'], 2 * DAY)),
    ...repeat(5, () => article(['Ransomware'], 2 * DAY)),
    ...repeat(4, () => article(['Agentic AI'], 2 * DAY)),
  ];
  const { windows } = aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW });

  assert.deepEqual(Object.keys(windows['7d']), ['AI', 'Cyber Security', 'All']);
  assert.deepEqual(windows['7d'].All.map((row) => row.tag).sort(), ['AI Security', 'Agentic AI', 'Ransomware']);
  assert.deepEqual(windows['7d'].All.map((row) => row.rank), [1, 2, 3]);
});

test('an article carrying only non-subject tags does not count toward window totals', () => {
  const rows = [article(['Advisory'], 2 * DAY), article(['Ransomware'], 2 * DAY)];
  assert.deepEqual(aggregateTopicTrends(rows, TAG_TOPICS, { now: NOW }).totals['7d'], { now: 1, prev: 0 });
});

test('every window is returned for both topics, capped at the limit', () => {
  const tagTopics = repeat(8, (_, n) => ({ tag: `AI Tag ${n}`, topic: 'AI' }));
  const rows = tagTopics.flatMap(({ tag }) => repeat(6, () => article([tag], 3 * 60 * 60 * 1000)));
  const result = aggregateTopicTrends(rows, tagTopics, { now: NOW, limit: 3 });

  assert.deepEqual(Object.keys(result.windows), ['24h', '7d', '30d']);
  for (const key of ['24h', '7d', '30d']) {
    assert.equal(result.windows[key].AI.length, 3);
    assert.deepEqual(result.windows[key]['Cyber Security'], []);
  }
  assert.equal(result.generated_at, new Date(NOW).toISOString());
});

test('limit defaults to 5 and rejects anything outside 1..50', () => {
  assert.equal(normalizeTrendLimit(undefined), 5);
  assert.equal(normalizeTrendLimit('7'), 7);
  assert.equal(normalizeTrendLimit('50'), 50);
  for (const bad of ['0', '51', 'x', '2.5']) {
    assert.throws(() => normalizeTrendLimit(bad), QueryValidationError);
  }
});

test('topic trend queries read only public relations and take no reader input', () => {
  assert.match(ARTICLE_TAGS_SQL, /FROM public\.public_articles/);
  assert.doesNotMatch(ARTICLE_TAGS_SQL, /\bexcerpt\b|\bbody_text\b|\$\{|\$1/);
  assert.match(TAG_TOPICS_SQL, /FROM public\.tag_topics/);
  assert.doesNotMatch(TAG_TOPICS_SQL, /\$\{|\$1/);
});
