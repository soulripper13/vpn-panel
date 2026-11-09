/**
 * middleware/csrf.js
 * CSRF protection and Origin verification for cookie-authenticated mutating requests (C4).
 */

'use strict';

const crypto = require('crypto');

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
  if (!origin) {
    // If neither Origin nor Referer is provided on a browser request, verify CSRF token
    return false;
  }

  try {
    const originUrl = new URL(origin);
    const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
    const originHost = originUrl.hostname.toLowerCase();

    // Allow same hostname or loopback
    if (originHost === hostHeader) return true;
    if (['127.0.0.1', 'localhost', '::1'].includes(originHost) && ['127.0.0.1', 'localhost', '::1'].includes(hostHeader)) {
      return true;
    }
    return false;
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
    if (req.headers.origin && !isValidOrigin(req)) {
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
