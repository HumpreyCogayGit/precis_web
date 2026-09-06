const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildFacets,
  buildFetchArticlesQuery,
  slugifyTag,
  WORKING_SET_LIMIT,
  MAX_LIMIT,
  MAX_MULTI_VALUES,
  MAX_OFFSET,
  MAX_SITE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TOPIC_LENGTH,
  PUBLIC_ARTICLES_RELATION,
  QueryValidationError,
  MAX_QUERY_LENGTH,
  buildSearchArticlesQuery,
  normalizeFilter,
  normalizeMultiFilter,
  normalizePagination,
  normalizeQuery,
  searchArticles,
} = require('../lib/articles');
const { createCorsOptions, getAllowedCorsOrigins } = require('../lib/cors');
const {
  DATABASE_URL_ENV_VARS,
  LOCAL_FALLBACK_DATABASE_URL,
  getDatabaseCa,
  getDatabaseUrl,
  shouldUseSsl,
} = require('../lib/db');
const { SECURITY_HEADERS } = require('../lib/securityHeaders');
const articlesHandler = require('../api/articles');
const { isHostAllowed, isIpAllowed, proxyImage, validateUrlTarget } = require('../lib/imageProxy');

const DB_ENV_VARS = [
  ...DATABASE_URL_ENV_VARS,
  'POSTGRES_HOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'PGSSLMODE',
  'PG_SSL_CA',
  'POSTGRES_CA_CERT',
  'PG_SSL_ALLOW_UNAUTHORIZED',
  'NODE_ENV',
  'IMAGE_PROXY_ALLOWED_HOSTS',
  'IMAGE_PROXY_MAX_BYTES',
  'IMAGE_PROXY_TIMEOUT_MS',
];

function withEnv(overrides, fn) {
  const originalEnv = {};

  for (const key of DB_ENV_VARS.concat(['CORS_ALLOWED_ORIGINS'])) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }

  Object.assign(process.env, overrides);

  let result;
  try {
    result = fn();

    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        for (const key of DB_ENV_VARS.concat(['CORS_ALLOWED_ORIGINS'])) {
          delete process.env[key];
          if (originalEnv[key] !== undefined) {
            process.env[key] = originalEnv[key];
          }
        }
      });
    }

    return result;
  } finally {
    if (!result || typeof result.then !== 'function') {
      for (const key of DB_ENV_VARS.concat(['CORS_ALLOWED_ORIGINS'])) {
        delete process.env[key];
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        }
      }
    }
  }
}

function assertValidationError(fn, field) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof QueryValidationError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.field, field);
    return true;
  });
}

function createMockResponse() {
  return {
    headers: {},
    statusCode: undefined,
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function withMockedDns(recordsByHost, fn) {
  const originalLookup = dns.lookup;
  dns.lookup = async (hostname) => {
    const records = recordsByHost[hostname];
    if (!records) {
      const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      error.code = 'ENOTFOUND';
      throw error;
    }

    return records;
  };

  try {
    await fn();
  } finally {
    dns.lookup = originalLookup;
  }
}

async function withMockedFetch(mockFetch, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

function createImageProxyRequest(url) {
  return {
    method: 'GET',
    query: { url },
    headers: {},
    requestId: 'test-request-id',
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function pngResponse(body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': String(body.length) },
  });
}

test('strict pagination accepts valid values and defaults missing values', () => {
  assert.deepEqual(normalizePagination({}), { limit: 50, offset: 0 });
  assert.deepEqual(normalizePagination({ limit: '25', offset: '10' }), { limit: 25, offset: 10 });
  assert.deepEqual(normalizePagination({ limit: MAX_LIMIT, offset: MAX_OFFSET }), {
    limit: MAX_LIMIT,
    offset: MAX_OFFSET,
  });
});

test('strict pagination rejects invalid limit and offset values', () => {
  assertValidationError(() => normalizePagination({ limit: '10abc' }), 'limit');
  assertValidationError(() => normalizePagination({ limit: '0' }), 'limit');
  assertValidationError(() => normalizePagination({ limit: String(MAX_LIMIT + 1) }), 'limit');
  assertValidationError(() => normalizePagination({ offset: '-1' }), 'offset');
  assertValidationError(() => normalizePagination({ offset: '1.5' }), 'offset');
  assertValidationError(() => normalizePagination({ offset: String(MAX_OFFSET + 1) }), 'offset');
  assertValidationError(() => normalizePagination({ limit: ['10', '20'] }), 'limit');
});

test('site and topic filters are trimmed and length-limited', () => {
  assert.equal(normalizeFilter(' nvidia ', 'site', MAX_SITE_LENGTH), 'nvidia');
  assert.equal(normalizeFilter('', 'topic', MAX_TOPIC_LENGTH), undefined);
  assertValidationError(() => normalizeFilter('x'.repeat(MAX_SITE_LENGTH + 1), 'site', MAX_SITE_LENGTH), 'site');
  assertValidationError(() => normalizeFilter('x'.repeat(MAX_TOPIC_LENGTH + 1), 'topic', MAX_TOPIC_LENGTH), 'topic');
  assertValidationError(() => normalizeFilter(['AI', 'Security'], 'topic', MAX_TOPIC_LENGTH), 'topic');
});

test('multi-value filters split, trim, and dedupe a comma-separated value', () => {
  assert.deepEqual(normalizeMultiFilter('nvidia, openai ,nvidia', 'site', MAX_SITE_LENGTH), ['nvidia', 'openai']);
  assert.equal(normalizeMultiFilter('', 'topic', MAX_TOPIC_LENGTH), undefined);
  assert.equal(normalizeMultiFilter(',, ,', 'topic', MAX_TOPIC_LENGTH), undefined);
  assertValidationError(() => normalizeMultiFilter('x'.repeat(MAX_SITE_LENGTH + 1), 'site', MAX_SITE_LENGTH), 'site');
  assertValidationError(() => normalizeMultiFilter(['a', 'b'], 'topic', MAX_TOPIC_LENGTH), 'topic');
  assertValidationError(
    () => normalizeMultiFilter(Array.from({ length: 3 }, (_, i) => `t${i}`).join(','), 'topic', MAX_TOPIC_LENGTH, 2),
    'topic',
  );
  assert.equal(MAX_MULTI_VALUES > 0, true);
});

test('article list queries use the public view and expose only public fields', () => {
  const built = buildFetchArticlesQuery({ site: 'nvidia', topic: 'AI' });

  assert.match(built.text, new RegExp(`FROM\\s+${PUBLIC_ARTICLES_RELATION.replace('.', '\\.')}`, 'i'));
  assert.doesNotMatch(built.text, /FROM\s+(?:public\.)?articles\b/i);
  assert.doesNotMatch(built.text, /body_text|content_hash|matched_strategy|flag_reason|raw_html_path|needs_review/i);
  assert.match(built.text, /\bexcerpt\b/i);
  assert.deepEqual(built.params, ['nvidia', 'AI', WORKING_SET_LIMIT]);
});

test('multi-value site/topic filters build an ANY() clause with one array param', () => {
  const built = buildFetchArticlesQuery({ site: 'nvidia,openai', topic: 'AI' });

  assert.match(built.text, /site = ANY\(\$1::text\[\]\)/);
  assert.match(built.text, /topic = \$2\b/);
  assert.deepEqual(built.params, [['nvidia', 'openai'], 'AI', WORKING_SET_LIMIT]);
});

test('tag slugs never carry a display label into the query string', () => {
  assert.equal(slugifyTag('Zero-Day / Exploit'), 'zero-day-exploit');
  assert.equal(slugifyTag('Identity & Access (IAM)'), 'identity-access-iam');
  assert.equal(slugifyTag('  LLM Release  '), 'llm-release');
});

test('tag filters resolve slugs in SQL and never interpolate a value into the text', () => {
  const built = buildFetchArticlesQuery({ tags: 'llm-release,agentic-ai' });

  assert.match(built.text, /EXISTS \(SELECT 1 FROM unnest\(COALESCE\(tags/);
  assert.doesNotMatch(built.text, /llm-release|agentic-ai/);
  assert.deepEqual(built.params, [['llm-release', 'agentic-ai'], WORKING_SET_LIMIT]);
});

test('included tags are always OR\'d — there is no intersection mode to reach', () => {
  const built = buildFetchArticlesQuery({ tags: 'llm-release,agentic-ai' });

  // An overlap test, not a superset test: two tags widen the result.
  assert.doesNotMatch(built.text, /COUNT\(DISTINCT|cardinality/);

  // A stale tags_mode from an older link is inert rather than an error.
  assert.deepEqual(buildFetchArticlesQuery({ tags: 'llm-release', tagsMode: 'all' }).text,
    buildFetchArticlesQuery({ tags: 'llm-release' }).text);
});

test('excluded tags are ANDed as NOT and win over the same slug in the include list', () => {
  const excludeOnly = buildFetchArticlesQuery({ notTags: 'advisory' });
  assert.match(excludeOnly.text, /NOT EXISTS \(SELECT 1 FROM unnest/);
  assert.deepEqual(excludeOnly.params, [['advisory'], WORKING_SET_LIMIT]);

  // not_tags wins: 'advisory' is dropped from the include list, leaving one slug.
  const both = buildFetchArticlesQuery({ tags: 'advisory,ransomware', notTags: 'advisory' });
  assert.deepEqual(both.params, [['advisory'], ['ransomware'], WORKING_SET_LIMIT]);

  // A tag filter that is entirely cancelled out adds no include clause at all.
  const cancelled = buildFetchArticlesQuery({ tags: 'advisory', notTags: 'advisory' });
  assert.deepEqual(cancelled.params, [['advisory'], WORKING_SET_LIMIT]);
  assert.equal((cancelled.text.match(/NOT EXISTS/g) || []).length, 1);
  assert.equal((cancelled.text.match(/EXISTS/g) || []).length, 1);
});

test('an empty tag filter constrains nothing, and tag length and mode are validated', () => {
  assert.deepEqual(buildFetchArticlesQuery({}).params, [WORKING_SET_LIMIT]);
  assert.doesNotMatch(buildFetchArticlesQuery({}).text, /unnest/);

  assertValidationError(() => buildFetchArticlesQuery({ tags: 'x'.repeat(MAX_TAG_LENGTH + 1) }), 'tags');
  assertValidationError(() => buildFetchArticlesQuery({ notTags: ['a', 'b'] }), 'not_tags');
});

test('facets are tallied from the returned items so a count cannot outrun its rows', () => {
  const facets = buildFacets([
    { site: 'nvidia', topic: 'AI', tags: ['LLM Release', 'Agentic AI'] },
    { site: 'nvidia', topic: 'AI', tags: ['LLM Release'] },
    { site: 'open_ai', topic: 'AI', tags: [] },
  ]);

  assert.deepEqual(facets.tags, [
    { slug: 'llm-release', label: 'LLM Release', count: 2 },
    { slug: 'agentic-ai', label: 'Agentic AI', count: 1 },
  ]);
  assert.deepEqual(facets.topics, [{ slug: 'AI', label: 'AI', count: 3 }]);
  assert.equal(facets.sources[0].slug, 'nvidia');
});

test('public articles view withholds review-held records and truncates body text in SQL', () => {
  const viewSql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'create-public-articles-view.sql'),
    'utf8',
  );

  assert.match(viewSql, /CREATE OR REPLACE VIEW public\.public_articles/i);
  assert.match(viewSql, /WHERE\s+COALESCE\(needs_review,\s*FALSE\)\s*=\s*FALSE/i);
  assert.match(viewSql, /left\(regexp_replace\(body_text, '\\s\+', ' ', 'g'\), 360\) \|\| '…'/i);
  assert.doesNotMatch(viewSql, /\bcontent_hash\b|\bmatched_strategy\b|\bflag_reason\b|\braw_html_path\b/i);
  assert.match(viewSql, /^\s*tags\b/im);
});

test('search validates the query the same way every other filter is validated', () => {
  assert.equal(normalizeQuery('  openai codex  '), 'openai codex');
  assert.equal(normalizeQuery(''), undefined);
  assert.equal(normalizeQuery('   '), undefined);
  assert.equal(normalizeQuery(undefined), undefined);

  assertValidationError(() => normalizeQuery('x'.repeat(MAX_QUERY_LENGTH + 1)), 'q');
  // A repeated ?q= arrives as an array and is rejected, like every other filter.
  assertValidationError(() => normalizeQuery(['a', 'b']), 'q');
});

test('search refuses a blank query rather than returning the whole archive', async () => {
  await assert.rejects(() => searchArticles({}), QueryValidationError);
  await assert.rejects(() => searchArticles({ q: '   ' }), QueryValidationError);
});

test('search goes through the SECURITY DEFINER function, never the barrier view', () => {
  // public.public_articles is security_barrier, so the planner cannot push the
  // match below it and the tsvector filter runs above the view's excerpt
  // expression -- measured at 1675 ms against 3,361 rows, versus 0.78 ms on the
  // base table. The function is what keeps the index reachable.
  const built = buildSearchArticlesQuery({ q: 'codex', limit: 20, offset: 0 });

  assert.match(built.text, /public\.search_public_articles/);
  assert.doesNotMatch(built.text, new RegExp(PUBLIC_ARTICLES_RELATION.replace('.', '\\.')));
  assert.doesNotMatch(built.text, /to_tsvector|websearch_to_tsquery/);
});

test('search passes every reader-supplied value as a bound parameter', () => {
  const built = buildSearchArticlesQuery({
    q: "robert'); drop table articles;--",
    site: 'nvidia,open_ai',
    topic: 'AI',
    tags: 'llm-release',
    notTags: 'advisory',
    limit: 20,
    offset: 40,
  });

  // Seven placeholders, seven params, and not one value in the query text.
  assert.doesNotMatch(built.text, /drop table|nvidia|open_ai|llm-release|advisory/i);
  assert.deepEqual(built.params, [
    "robert'); drop table articles;--",
    ['nvidia', 'open_ai'],
    ['AI'],
    ['llm-release'],
    ['advisory'],
    20,
    40,
  ]);
});

test('search leaves a group unconstrained as NULL rather than as an empty array', () => {
  // An empty array would match nothing; NULL is what the function reads as "no
  // constraint on this group", matching the empty-group rule in the panel.
  const built = buildSearchArticlesQuery({ q: 'codex', limit: 50, offset: 0 });

  assert.deepEqual(built.params, ['codex', null, null, null, null, 50, 0]);
});

test('search applies not_tags over tags for a slug named in both, as the list does', () => {
  const both = buildSearchArticlesQuery({
    q: 'codex', tags: 'advisory,ransomware', notTags: 'advisory', limit: 50, offset: 0,
  });
  assert.deepEqual(both.params[3], ['ransomware']);
  assert.deepEqual(both.params[4], ['advisory']);

  // Entirely cancelled out: no include constraint survives.
  const cancelled = buildSearchArticlesQuery({
    q: 'codex', tags: 'advisory', notTags: 'advisory', limit: 50, offset: 0,
  });
  assert.equal(cancelled.params[3], null);
});

test('search enforces the same pagination bounds as the article list', async () => {
  await assert.rejects(() => searchArticles({ q: 'codex', limit: MAX_LIMIT + 1 }), QueryValidationError);
  await assert.rejects(() => searchArticles({ q: 'codex', offset: MAX_OFFSET + 1 }), QueryValidationError);
  await assert.rejects(() => searchArticles({ q: 'codex', limit: 'abc' }), QueryValidationError);
});

test('the search function reproduces every guarantee the public view makes', () => {
  const functionSql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'create-search-articles-function.sql'),
    'utf8',
  );

  assert.match(functionSql, /SECURITY DEFINER/);
  // Mandatory on any SECURITY DEFINER function: without it a caller can shadow a
  // referenced object by putting their own schema ahead of public.
  assert.match(functionSql, /SET search_path = public, pg_temp/);
  // Granted to PUBLIC by default, so the revoke has to be explicit.
  assert.match(functionSql, /REVOKE ALL ON FUNCTION public\.search_public_articles/);

  // Same row filter and same excerpt truncation as the view it stands in for.
  assert.match(functionSql, /COALESCE\(a\.needs_review, FALSE\) = FALSE/i);
  assert.match(functionSql, /left\(regexp_replace\(a\.body_text, '\\s\+', ' ', 'g'\), 360\) \|\| '…'/i);
  // And the same withheld columns.
  assert.doesNotMatch(functionSql, /\bcontent_hash\b|\bmatched_strategy\b|\bflag_reason\b|\braw_html_path\b/i);
});

test('the indexed expression matches the one the search function filters on', () => {
  // If these drift the planner silently stops using idx_articles_search and every
  // search becomes a sequential scan, with no visible failure to catch it.
  const vector = /to_tsvector\('english', coalesce\((?:a\.)?title, ''\) \|\| ' ' \|\| coalesce\((?:a\.)?summary, ''\)\)/;

  const functionSql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', 'create-search-articles-function.sql'), 'utf8',
  );
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scraper', 'migrations', '2026-09-06_articles_search_index.sql'), 'utf8',
  );
  const schemaPy = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scraper', 'blogscraper', 'storage.py'), 'utf8',
  );

  assert.match(functionSql, vector);
  assert.match(migrationSql, vector);
  assert.match(schemaPy, vector);
});

test('production database configuration fails closed when env vars are missing', () => {
  withEnv({ NODE_ENV: 'production' }, () => {
    assert.throws(() => getDatabaseUrl(), /Production database configuration is missing/);
  });
});

test('development database configuration keeps the local fallback', () => {
  withEnv({ NODE_ENV: 'development' }, () => {
    assert.equal(getDatabaseUrl(), LOCAL_FALLBACK_DATABASE_URL);
  });
});

test('database TLS verifies certificates by default and supports CA configuration', () => {
  withEnv({ NODE_ENV: 'production', PG_SSL_CA: '-----BEGIN CERTIFICATE-----\\nTEST\\n-----END CERTIFICATE-----' }, () => {
    assert.match(getDatabaseCa(), /\nTEST\n/);
    const ssl = shouldUseSsl('postgresql://user:pass@example.com/db?sslmode=require');
    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(ssl.ca, /BEGIN CERTIFICATE/);
    assert.match(ssl.ca, /\nTEST\n/);
  });
});

test('database TLS insecure mode requires explicit opt-in and disable is rejected in production', () => {
  withEnv({ NODE_ENV: 'production', PG_SSL_ALLOW_UNAUTHORIZED: 'true' }, () => {
    const ssl = shouldUseSsl('postgresql://user:pass@example.com/db?sslmode=require');
    assert.equal(ssl.rejectUnauthorized, false);
  });

  withEnv({ NODE_ENV: 'production', PGSSLMODE: 'disable' }, () => {
    assert.throws(() => shouldUseSsl('postgresql://user:pass@example.com/db'), /not allowed in production/);
  });
});

test('development CORS allows Vite and production rejects unconfigured origins', () => {
  withEnv({ NODE_ENV: 'development' }, () => {
    assert.ok(getAllowedCorsOrigins().includes('http://localhost:5173'));
  });

  withEnv({ NODE_ENV: 'production' }, () => {
    assert.deepEqual(getAllowedCorsOrigins(), []);
  });

  withEnv({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://precis.example, https://preview.example' }, () => {
    assert.deepEqual(getAllowedCorsOrigins(), ['https://precis.example', 'https://preview.example']);
  });
});

test('CORS origin callback rejects unapproved browser origins', async () => {
  await new Promise((resolve, reject) => {
    withEnv({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://precis.example' }, () => {
      createCorsOptions().origin('https://evil.example', (err) => {
        try {
          assert.equal(err.message, 'CORS origin is not allowed');
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
  });
});

test('the Express and Vercel CSPs stay identical and admit analytics without unsafe-inline', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const vercelCsp = vercelConfig.headers
    .flatMap((entry) => entry.headers)
    .find((header) => header.key === 'Content-Security-Policy');

  // Production serves the vercel.json copy and local dev serves this one; a
  // silent drift between them means a policy that was only ever tested locally.
  assert.equal(vercelCsp.value, csp);

  const directive = (name) => csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

  // GA4 (react-app/src/analytics.js) loads the tag, opens a beacon, and may fall
  // back to a pixel — one blocked directive collects nothing but a console error.
  assert.match(directive('script-src'), /https:\/\/www\.googletagmanager\.com/);
  assert.match(directive('connect-src'), /https:\/\/\*\.google-analytics\.com/);
  assert.match(directive('img-src'), /https:\/\/\*\.google-analytics\.com/);

  // Loading gtag from a bundled module rather than an inline snippet is what buys
  // us this; adding 'unsafe-inline' here would give the payoff away.
  assert.doesNotMatch(directive('script-src'), /unsafe-inline/);
});

test('articles API returns 400 for invalid query parameters before querying the database', async () => {
  const req = {
    method: 'GET',
    query: { limit: 'not-an-int' },
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = createMockResponse();

  await articlesHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /limit/);
  assert.ok(res.body.requestId);
  assert.equal(res.headers['x-request-id'], res.body.requestId);
});

test('image proxy rejects unsupported URL protocols before fetching', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    await assert.rejects(
      () => validateUrlTarget(new URL('file:///etc/passwd')),
      /Unsupported image URL protocol/,
    );
  });
});

test('image proxy rejects private hosts and private resolved IPs', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    assert.equal(isHostAllowed('localhost'), false);
    assert.equal(isHostAllowed('127.0.0.1'), false);
    assert.equal(isIpAllowed('10.0.0.5'), false);
    assert.equal(isIpAllowed('192.168.1.10'), false);
    assert.equal(isIpAllowed('172.16.0.10'), false);
    assert.equal(isIpAllowed('8.8.8.8'), true);

    await withMockedDns({
      'cdn.example.com': [{ address: '10.0.0.5', family: 4 }],
    }, async () => {
      await assert.rejects(
        () => validateUrlTarget(new URL('https://cdn.example.com/image.png')),
        /private or unsupported address/,
      );
    });
  });
});

test('image proxy enforces the production host allowlist', async () => {
  await withEnv({ NODE_ENV: 'production', IMAGE_PROXY_ALLOWED_HOSTS: 'images.example.com' }, async () => {
    assert.equal(isHostAllowed('images.example.com'), true);
    assert.equal(isHostAllowed('cdn.images.example.com'), true);
    assert.equal(isHostAllowed('evil.example.com'), false);

    await withMockedDns({
      'evil.example.com': [{ address: '8.8.8.8', family: 4 }],
    }, async () => {
      await assert.rejects(
        () => validateUrlTarget(new URL('https://evil.example.com/image.png')),
        /host is not allowed/,
      );
    });
  });
});

test('image proxy revalidates redirect destinations', async () => {
  await withEnv({ NODE_ENV: 'production', IMAGE_PROXY_ALLOWED_HOSTS: 'images.example.com' }, async () => {
    const res = createMockResponse();
    const requestedUrls = [];

    await withMockedDns({
      'images.example.com': [{ address: '8.8.8.8', family: 4 }],
    }, async () => {
      await withMockedFetch(async (url) => {
        requestedUrls.push(url.toString());
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private.png' },
        });
      }, async () => {
        await proxyImage(createImageProxyRequest('https://images.example.com/redirect.png'), res);
      });
    });

    assert.deepEqual(requestedUrls, ['https://images.example.com/redirect.png']);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /host is not allowed|private/);
  });
});

test('image proxy rejects images larger than configured maximum bytes', async () => {
  await withEnv({ NODE_ENV: 'development', IMAGE_PROXY_MAX_BYTES: '8' }, async () => {
    const oversizedPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('too-large'),
    ]);
    const res = createMockResponse();

    await withMockedDns({
      'images.example.com': [{ address: '8.8.8.8', family: 4 }],
    }, async () => {
      await withMockedFetch(async () => pngResponse(oversizedPng), async () => {
        await proxyImage(createImageProxyRequest('https://images.example.com/large.png'), res);
      });
    });

    assert.equal(res.statusCode, 413);
    assert.match(res.body.error, /too large/);
  });
});

test('image proxy blocks SVG image responses', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const res = createMockResponse();

    await withMockedDns({
      'images.example.com': [{ address: '8.8.8.8', family: 4 }],
    }, async () => {
      await withMockedFetch(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      }), async () => {
        await proxyImage(createImageProxyRequest('https://images.example.com/vector.svg'), res);
      });
    });

    assert.equal(res.statusCode, 415);
    assert.match(res.body.error, /SVG images are not supported/);
  });
});
