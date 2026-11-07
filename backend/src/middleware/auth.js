/**
 * middleware/auth.js
 * Session-based authentication middleware.
 */

'use strict';

/**
 * Require logged in user session
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.status(401).json({
    success: false,
    message: 'Authentication required. Please log in.',
    data: null,
  });
}

/**
 * Require admin role
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Admin privileges required.',
    data: null,
  });
}

module.exports = {
  requireAuth,
  requireAdmin,
};
