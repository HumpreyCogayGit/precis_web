const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildFetchArticlesQuery,
  WORKING_SET_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
  MAX_SITE_LENGTH,
  MAX_TOPIC_LENGTH,
  PUBLIC_ARTICLES_RELATION,
  QueryValidationError,
  normalizeFilter,
  normalizePagination,
} = require('../lib/articles');
const { createCorsOptions, getAllowedCorsOrigins } = require('../lib/cors');
const {
  DATABASE_URL_ENV_VARS,
  LOCAL_FALLBACK_DATABASE_URL,
  getDatabaseCa,
  getDatabaseUrl,
  shouldUseSsl,
} = require('../lib/db');
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

test('article list queries use the public view and expose only public fields', () => {
  const built = buildFetchArticlesQuery({ site: 'nvidia', topic: 'AI' });

  assert.match(built.text, new RegExp(`FROM\\s+${PUBLIC_ARTICLES_RELATION.replace('.', '\\.')}`, 'i'));
  assert.doesNotMatch(built.text, /FROM\s+(?:public\.)?articles\b/i);
  assert.doesNotMatch(built.text, /body_text|content_hash|matched_strategy|flag_reason|raw_html_path|needs_review/i);
  assert.match(built.text, /\bexcerpt\b/i);
  assert.deepEqual(built.params, ['nvidia', 'AI', WORKING_SET_LIMIT]);
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
