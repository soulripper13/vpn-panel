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

/**
 * Enforces admin role for state-mutating HTTP methods (C4)
 */
function requireAdminForMutations(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase())) {
    return requireAdmin(req, res, next);
  }
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireAdminForMutations,
};
