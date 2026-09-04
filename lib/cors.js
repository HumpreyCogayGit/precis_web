const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseAllowedOrigins(value) {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isDevLoopbackOrigin(origin) {
  // Vite walks to 5174, 5175, ... when its preferred port is taken, so pinning the
  // dev allowlist to one port turns a port bump into an unexplained fetch failure.
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function getAllowedCorsOrigins() {
  const configuredOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (process.env.NODE_ENV === 'production') {
    return [];
  }

  return DEFAULT_DEV_ORIGINS;
}

function isDevFallbackAllowed() {
  return (
    process.env.NODE_ENV !== 'production'
    && parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS).length === 0
  );
}

function createCorsOptions() {
  const allowedOrigins = getAllowedCorsOrigins();

  return {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (isDevFallbackAllowed() && isDevLoopbackOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS origin is not allowed'));
    },
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    optionsSuccessStatus: 204,
  };
}

module.exports = {
  DEFAULT_DEV_ORIGINS,
  createCorsOptions,
  getAllowedCorsOrigins,
  isDevFallbackAllowed,
  isDevLoopbackOrigin,
  parseAllowedOrigins,
};