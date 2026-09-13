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
async function fetchLatestDigestRow(topic) {
  const result = await query(
    `
    SELECT topic, generated_at, items, model, prompt_version
    FROM tldr_digests
    WHERE topic = $1
    ORDER BY generated_at DESC
    LIMIT 1
    `,
    [topic],
  );

  return result.rows[0] || null;
}

// { topic } -> one digest (or null if none has been generated yet). No topic ->
// every known topic's latest digest, keyed by topic name, so the /tldr page can
// fetch both AI and Cyber Security in one request.
async function fetchTldr({ topic } = {}) {
  const normalizedTopic = validateTopic(topic);

  if (normalizedTopic) {
    return fetchLatestDigestRow(normalizedTopic);
  }

  const digests = {};
  for (const knownTopic of KNOWN_TOPICS) {
    digests[knownTopic] = await fetchLatestDigestRow(knownTopic);
  }
  return { digests };
}

module.exports = {
  KNOWN_TOPICS,
  fetchTldr,
};
