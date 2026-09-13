const { applySecurityHeaders } = require('./securityHeaders');

const REDACTED = '[redacted]';

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getRequestId(req) {
  if (!req.requestId) {
    req.requestId = req.headers['x-request-id'] || req.headers['x-vercel-id'] || createRequestId();
  }

  return req.requestId;
}

function redact(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, REDACTED)
    .replace(/(password|passwd|pwd|token|secret|key)=([^\s&]+)/gi, `$1=${REDACTED}`);
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function log(level, event, details = {}) {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...details,
  };

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      payload[key] = redact(value);
    }
  }

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function logMetric(name, value = 1, tags = {}) {
  log('info', 'metric', {
    metric: name,
    value,
    ...tags,
  });
}

function logRequest(req, res, next) {
  const requestId = getRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  log('info', 'request', {
    requestId,
    method: req.method,
    path: req.path || req.url?.split('?')[0],
    ip: getClientIp(req),
  });

  if (typeof next === 'function') {
    next();
  }
}

function allowMethods(req, res, methods = ['GET']) {
  applySecurityHeaders(req, res);
  const requestId = getRequestId(req);
  res.setHeader('X-Request-Id', requestId);

  if (methods.includes(req.method)) {
    return true;
  }

  res.setHeader('Allow', methods.join(', '));
  res.status(405).json({ error: 'Method not allowed', requestId });
  return false;
}

function sendBadRequest(res, message, err, req) {
  const requestId = req ? getRequestId(req) : undefined;
  log('warn', 'bad_request', {
    requestId,
    error: err?.message || message,
    field: err?.field,
  });
  res.status(400).json({ error: message, requestId });
}

function sendServerError(res, message, err, req) {
  const requestId = req ? getRequestId(req) : (res.req ? getRequestId(res.req) : undefined);
  log('error', 'server_error', {
    requestId,
    message,
    error: err?.message,
    name: err?.name,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
  });
  res.status(500).json({ error: message, requestId });
}

function sendError(res, message, err, req) {
  if (err?.statusCode === 400) {
    return sendBadRequest(res, err.message || 'Invalid request parameters', err, req);
  }

  return sendServerError(res, message, err, req);
}

module.exports = {
  allowMethods,
  getRequestId,
  logMetric,
  log,
  logRequest,
  redact,
  sendBadRequest,
  sendError,
  sendServerError,
};