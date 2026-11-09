/**
 * middleware/csrf.js
 * CSRF protection and Origin verification for cookie-authenticated mutating requests (C4).
 */

'use strict';

const crypto = require('crypto');

const allowedOrigins = new Set(String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((entry) => {
  try {
    const url = new URL(entry.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}).filter(Boolean));

function isLoopbackAddress(address = '') {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

/**
 * Generate and attach CSRF token to session if missing
 */
function ensureCsrfToken(req) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session ? req.session.csrfToken : null;
}

/**
 * Validate that the request Origin / Referer matches the host
 */
function isValidOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    const fromTrustedProxy = isLoopbackAddress(req.socket?.remoteAddress || '');
    const forwardedHost = fromTrustedProxy ? req.headers['x-forwarded-host'] : null;
    const forwardedProto = fromTrustedProxy ? req.headers['x-forwarded-proto'] : null;
    const requestHost = String(forwardedHost || req.headers.host || '').split(',')[0].trim();
    const requestProto = String(forwardedProto || req.protocol || 'http').split(',')[0].trim().toLowerCase();
    if (!requestHost || !['http', 'https'].includes(requestProto)) return false;

    const expectedOrigin = new URL(`${requestProto}://${requestHost}`).origin;
    return originUrl.origin === expectedOrigin || allowedOrigins.has(originUrl.origin);
  } catch {
    return false;
  }
}

/**
 * CSRF middleware
 */
function csrfProtection(req, res, next) {
  // Always ensure token is in session
  const token = ensureCsrfToken(req);
  if (token) {
    res.setHeader('X-CSRF-Token', token);
  }

  const method = req.method.toUpperCase();
  // Safe read-only methods bypass CSRF checks
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  // Exempt public subscription routes and initial login
  if (req.path.startsWith('/api/sub') || req.path.startsWith('/sub') || req.path === '/api/auth/login' || req.path.endsWith('/login')) {
    return next();
  }

  // If user is authenticated via session, enforce CSRF
  if (req.session && req.session.user) {
    const headerToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || req.body?._csrf;

    // 1. Strict Origin check if present
    if ((req.headers.origin || req.headers.referer) && !isValidOrigin(req)) {
      return res.status(403).json({
        success: false,
        message: 'Cross-origin request blocked: Origin mismatch.',
        data: null,
      });
    }

    // 2. Token match check
    if (!headerToken || headerToken !== req.session.csrfToken) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or missing CSRF token.',
        data: null,
      });
    }
  }

  next();
}

module.exports = {
  csrfProtection,
  ensureCsrfToken,
  isValidOrigin,
};
