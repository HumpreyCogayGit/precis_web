const dns = require('node:dns').promises;
const net = require('node:net');

const { logMetric } = require('./http');

const IMAGE_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_RESPONSE_CSP = "default-src 'none'; img-src 'self'; sandbox";
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[::1\]$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

const PRIVATE_IPV6_PATTERNS = [
  /^::1$/,
  /^::$/,
  /^::ffff:(127|10|192\.168|172\.(1[6-9]|2\d|3[0-1])|169\.254)\./i,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

const IMAGE_SIGNATURES = [
  { contentType: 'image/svg+xml', matches: (bytes) => /<svg[\s>]/i.test(bytes.slice(0, 1024).toString('utf8')) },
  { contentType: 'image/png', matches: (bytes) => bytes.length >= 8 && bytes[0] === 0x89 && bytes.slice(1, 4).toString('ascii') === 'PNG' },
  { contentType: 'image/jpeg', matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { contentType: 'image/gif', matches: (bytes) => bytes.length >= 6 && (bytes.slice(0, 6).toString('ascii') === 'GIF87a' || bytes.slice(0, 6).toString('ascii') === 'GIF89a') },
  { contentType: 'image/webp', matches: (bytes) => bytes.length >= 12 && bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP' },
];

function detectImageContentType(buffer, fallbackContentType = '') {
  const normalized = fallbackContentType.split(';')[0].trim().toLowerCase();
  const signature = IMAGE_SIGNATURES.find(({ matches }) => matches(buffer));

  if (signature) {
    return signature.contentType;
  }

  if (normalized.startsWith('image/')) {
    return normalized;
  }

  return 'application/octet-stream';
}

function getAllowedHosts() {
  return (process.env.IMAGE_PROXY_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function requiresAllowedHosts() {
  return process.env.NODE_ENV === 'production';
}

function isHostAllowed(hostname) {
  const normalizedHostname = hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(normalizedHostname))) {
    return false;
  }

  const allowedHosts = getAllowedHosts();
  if (!allowedHosts.length) {
    return !requiresAllowedHosts();
  }

  return allowedHosts.some((allowedHost) => (
    normalizedHostname === allowedHost || normalizedHostname.endsWith(`.${allowedHost}`)
  ));
}

function isIpAllowed(address) {
  if (net.isIPv4(address)) {
    return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(address));
  }

  if (net.isIPv6(address)) {
    return !PRIVATE_IPV6_PATTERNS.some((pattern) => pattern.test(address));
  }

  return false;
}

async function validateUrlTarget(url) {
  if (!['http:', 'https:'].includes(url.protocol)) {
    const error = new Error('Unsupported image URL protocol');
    error.statusCode = 400;
    throw error;
  }

  if (!isHostAllowed(url.hostname)) {
    const error = new Error('Image URL host is not allowed');
    error.statusCode = 400;
    throw error;
  }

  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch (err) {
    const error = new Error('Image URL host could not be resolved');
    error.statusCode = 400;
    throw error;
  }
  if (!addresses.length || addresses.some(({ address }) => !isIpAllowed(address))) {
    const error = new Error('Image URL resolved to a private or unsupported address');
    error.statusCode = 400;
    throw error;
  }
}

function applyImageProxyHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', IMAGE_RESPONSE_CSP);
  res.setHeader('X-Frame-Options', 'DENY');
}

function getImageProxyErrorReason(err) {
  return String(err?.message || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

async function fetchWithValidatedRedirects(url, options, redirectCount = 0) {
  await validateUrlTarget(url);

  const response = await fetch(url, {
    ...options,
    redirect: 'manual',
  });

  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return response;
  }

  if (redirectCount >= MAX_REDIRECTS) {
    const error = new Error('Too many image redirects');
    error.statusCode = 508;
    throw error;
  }

  const location = response.headers.get('location');
  if (!location) {
    const error = new Error('Image redirect did not include a location');
    error.statusCode = 502;
    throw error;
  }

  const redirectUrl = new URL(location, url);
  return fetchWithValidatedRedirects(redirectUrl, options, redirectCount + 1);
}

async function readResponseWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error('Image is too large');
    error.statusCode = 413;
    throw error;
  }

  if (!response.body) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      const error = new Error('Image is too large');
      error.statusCode = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function proxyImage(req, res) {
  applyImageProxyHeaders(res);
  logMetric('image_proxy.request', 1, {
    requestId: req.requestId,
  });

  if (requiresAllowedHosts() && !getAllowedHosts().length) {
    logMetric('image_proxy.error', 1, { reason: 'allowlist_missing', requestId: req.requestId });
    return res.status(503).json({ error: 'Image proxy host allowlist is not configured' });
  }

  const imageUrl = req.query.url;
  if (!imageUrl) {
    logMetric('image_proxy.error', 1, { reason: 'missing_url', requestId: req.requestId });
    return res.status(400).json({ error: 'Missing image URL' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch (err) {
    logMetric('image_proxy.error', 1, { reason: 'invalid_url', requestId: req.requestId });
    return res.status(400).json({ error: 'Invalid image URL' });
  }

  logMetric('image_proxy.upstream_host', 1, {
    host: parsedUrl.hostname.toLowerCase(),
    requestId: req.requestId,
  });

  const timeoutMs = Number(process.env.IMAGE_PROXY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const maxBytes = Number(process.env.IMAGE_PROXY_MAX_BYTES || DEFAULT_MAX_BYTES);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let upstreamResponse;
  try {
    upstreamResponse = await fetchWithValidatedRedirects(parsedUrl, {
      headers: IMAGE_FETCH_HEADERS,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      logMetric('image_proxy.error', 1, { reason: 'timeout', requestId: req.requestId });
      return res.status(504).json({ error: 'Image fetch timed out' });
    }

    if (err.statusCode) {
      logMetric('image_proxy.error', 1, { reason: getImageProxyErrorReason(err), requestId: req.requestId });
      return res.status(err.statusCode).json({ error: err.message });
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstreamResponse.ok) {
    logMetric('image_proxy.error', 1, { reason: `upstream_${upstreamResponse.status}`, requestId: req.requestId });
    return res.status(502).json({ error: `Image fetch failed with status ${upstreamResponse.status}` });
  }

  let buffer;
  try {
    buffer = await readResponseWithLimit(upstreamResponse, maxBytes);
  } catch (err) {
    if (err.statusCode === 413) {
      logMetric('image_proxy.error', 1, { reason: 'too_large', requestId: req.requestId });
      return res.status(413).json({ error: 'Image is too large' });
    }

    throw err;
  }

  const contentType = detectImageContentType(buffer, upstreamResponse.headers.get('content-type') || '');

  if (!contentType.startsWith('image/')) {
    logMetric('image_proxy.error', 1, { reason: 'not_image', requestId: req.requestId });
    return res.status(415).json({ error: 'URL did not return an image' });
  }

  if (contentType === 'image/svg+xml') {
    logMetric('image_proxy.error', 1, { reason: 'svg_blocked', requestId: req.requestId });
    return res.status(415).json({ error: 'SVG images are not supported by the image proxy' });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.setHeader('Content-Length', buffer.length);
  logMetric('image_proxy.response.bytes', buffer.length, {
    contentType,
    host: parsedUrl.hostname.toLowerCase(),
    requestId: req.requestId,
  });
  return res.send(buffer);
}

module.exports = {
  getAllowedHosts,
  isHostAllowed,
  isIpAllowed,
  proxyImage,
  validateUrlTarget,
};