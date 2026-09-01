const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  'X-Frame-Options': 'DENY',
};

function shouldSendHsts(req) {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  return typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https';
}

function applySecurityHeaders(req, res) {
  Object.entries(SECURITY_HEADERS).forEach(([header, value]) => {
    res.setHeader(header, value);
  });

  if (shouldSendHsts(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
}

function securityHeadersMiddleware(req, res, next) {
  applySecurityHeaders(req, res);
  next();
}

module.exports = {
  SECURITY_HEADERS,
  applySecurityHeaders,
  securityHeadersMiddleware,
};