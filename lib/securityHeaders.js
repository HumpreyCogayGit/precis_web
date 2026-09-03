// Keep this byte-identical to the Content-Security-Policy in vercel.json — that
// copy is the one production serves; this one covers the local Express path.
// The googletagmanager/google-analytics entries are what let GA4 (react-app/src/
// analytics.js) load; script-src deliberately has no 'unsafe-inline'.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
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