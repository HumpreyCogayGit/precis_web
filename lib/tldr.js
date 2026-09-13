const { query } = require('./db');
const { QueryValidationError } = require('./articles');

// Read model for the TLDR digests scripts/tldr_all.py writes (scraper/blogscraper/
// storage.py's tldr_digests table, one topic worth of scraper infra away from this
// web app -- see the TLDR button plan). The digest itself is generated and
// verified offline, on demand for now; this module only ever reads the newest row
// per topic.
//
// Only two topics exist (blogscraper/taxonomy.py TOPICS), so the valid set is
// hardcoded here rather than queried, the same way search.js's topic filter
// already treats the topic vocabulary as closed.
const KNOWN_TOPICS = ['AI', 'Cyber Security'];
const MAX_TOPIC_LENGTH = 120;

function validateTopic(topic) {
  if (Array.isArray(topic)) {
    throw new QueryValidationError('topic must be provided only once', 'topic');
  }

  if (topic === undefined || topic === null || topic === '') {
    return undefined;
  }

  const normalized = String(topic).trim();
  if (normalized.length > MAX_TOPIC_LENGTH) {
    throw new QueryValidationError('topic exceeds the maximum allowed length', 'topic');
  }

  if (!KNOWN_TOPICS.includes(normalized)) {
    throw new QueryValidationError(`topic must be one of: ${KNOWN_TOPICS.join(', ')}`, 'topic');
  }

  return normalized;
}

// Newest row for the topic: tldr_digests is append-only (see storage.py), so a
// stale or failed run never overwrites the last good digest -- this is what always
// surfaces the latest successful one.
// One round trip for any number of topics: DISTINCT ON keeps the first row per topic
// under the ORDER BY, i.e. the newest.
async function fetchLatestDigestRows(topics) {
  const result = await query(
    `
    SELECT DISTINCT ON (topic) topic, generated_at, items, model, prompt_version
    FROM tldr_digests
    WHERE topic = ANY($1::text[])
    ORDER BY topic, generated_at DESC
    `,
    [topics],
  );

  return new Map(result.rows.map((row) => [row.topic, row]));
}

// { topic } -> one digest (or null if none has been generated yet). No topic ->
// every known topic's latest digest, keyed by topic name, so the /tldr page can
// fetch both AI and Cyber Security in one request.
async function fetchTldr({ topic } = {}) {
  const normalizedTopic = validateTopic(topic);

  if (normalizedTopic) {
    const rows = await fetchLatestDigestRows([normalizedTopic]);
    return rows.get(normalizedTopic) || null;
  }

  const rows = await fetchLatestDigestRows(KNOWN_TOPICS);
  const digests = {};
  for (const knownTopic of KNOWN_TOPICS) {
    digests[knownTopic] = rows.get(knownTopic) || null;
  }
  return { digests };
}

module.exports = {
  KNOWN_TOPICS,
  fetchTldr,
};
