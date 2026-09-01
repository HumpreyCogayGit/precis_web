const { log } = require('./http');

const WINDOW_BUCKETS = new Map();

function getHeader(req, name) {
  const lowerName = name.toLowerCase();
  if (typeof req.get === 'function') {
    return req.get(name);
  }

  return req.headers?.[lowerName];
}

function getClientIp(req) {
  const forwardedFor = getHeader(req, 'x-forwarded-for');
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = getHeader(req, 'x-real-ip');
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function cleanupExpiredBuckets(now) {
  for (const [key, bucket] of WINDOW_BUCKETS.entries()) {
    if (bucket.resetAt <= now) {
      WINDOW_BUCKETS.delete(key);
    }
  }
}

function checkRateLimit(req, res, { name, windowMs, max }) {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const clientIp = getClientIp(req);
  const key = `${name}:${clientIp}`;
  let bucket = WINDOW_BUCKETS.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    WINDOW_BUCKETS.set(key, bucket);
  }

  bucket.count += 1;

  const remaining = Math.max(max - bucket.count, 0);
  const resetSeconds = Math.ceil(bucket.resetAt / 1000);
  res.setHeader('RateLimit-Limit', String(max));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(resetSeconds));

  if (bucket.count <= max) {
    return true;
  }

  const retryAfterSeconds = Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1);
  res.setHeader('Retry-After', String(retryAfterSeconds));
  log('warn', 'rate_limit_exceeded', { name, clientIp, max, windowMs });
  res.status(429).json({ error: 'Too many requests' });
  return false;
}

function rateLimitMiddleware(options) {
  return (req, res, next) => {
    if (!checkRateLimit(req, res, options)) {
      return;
    }

    next();
  };
}

const RATE_LIMITS = {
  health: { name: 'health', windowMs: 60 * 1000, max: 20 },
  articles: { name: 'articles', windowMs: 60 * 1000, max: 120 },
  imageProxy: { name: 'image-proxy', windowMs: 60 * 1000, max: 45 },
};

module.exports = {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitMiddleware,
};