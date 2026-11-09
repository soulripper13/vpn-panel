/**
 * api/auth.js
 * Authentication routes: login, logout, me, change password, csrf token.
 */

'use strict';

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { ensureCsrfToken } = require('../middleware/csrf');
const { defaultStore: sessionStore } = require('../utils/session-store');
const { logAudit } = require('../utils/audit');

// Precomputed bcrypt dummy hash for constant-time comparisons when username does not exist
const DUMMY_HASH = '$2b$12$e8q4lV2Fh1/qLgD62Vp6ce5y6GszgS48bC9K6rI.J6h.Nsq1M2c7.';

const loginSchema = Joi.object({
  username: Joi.string().required().trim().max(64),
  password: Joi.string().required().max(128),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().max(128),
  newPassword: Joi.string()
    .min(10)
    .max(128)
    .regex(/^(?=.*[a-zA-Z])(?=.*[0-9])/)
    .message('New password must be at least 10 characters long and contain both letters and numbers.')
    .required(),
});

/**
 * GET /api/auth/csrf
 * Returns the CSRF token for the active session (C4)
 */
router.get('/csrf', (req, res) => {
  const token = ensureCsrfToken(req);
  return res.json({
    success: true,
    data: { csrfToken: token },
  });
});

/**
 * POST /api/auth/login
 */
router.post('/login', validateBody(loginSchema), (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const user = User.findByUsername(username);

  let isValid = false;
  if (!user) {
    // Constant-time dummy comparison to prevent username enumeration (H2)
    bcrypt.compareSync(password, DUMMY_HASH);
  } else {
    isValid = User.verifyPassword(password, user.password_hash);
  }

  if (!user || !isValid) {
    logAudit({
      username: username || 'unknown',
      ip,
      action: 'login',
      target: 'auth',
      details: 'Failed login attempt',
      status: 'failed',
    });

    return res.status(401).json({
      success: false,
      message: 'Invalid username or password',
      data: null,
    });
  }

  // Prevent session fixation by regenerating session on login (C4)
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Could not initialize session' });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    };

    const csrfToken = ensureCsrfToken(req);

    logAudit({
      userId: user.id,
      username: user.username,
      ip,
      action: 'login',
      target: 'auth',
      details: 'Successful login',
      status: 'success',
    });

    return res.json({
      success: true,
      message: 'Logged in successfully',
      data: {
        user: req.session.user,
        csrfToken,
      },
    });
  });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', requireAuth, (req, res) => {
  const user = req.session.user;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  logAudit({
    userId: user?.id,
    username: user?.username || 'user',
    ip,
    action: 'logout',
    target: 'auth',
    details: 'User logged out',
    status: 'success',
  });

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Could not log out',
        data: null,
      });
    }
    const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' };
    res.clearCookie('vpn_sid', cookieOptions);
    // Remove cookies issued by older panel versions as well.
    res.clearCookie('connect.sid', cookieOptions);
    res.clearCookie('__Secure-vpn_sid', { ...cookieOptions, secure: true });
    return res.json({
      success: true,
      message: 'Logged out successfully',
      data: null,
    });
  });
});

/**
 * GET /api/auth/me
 */
router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    const csrfToken = ensureCsrfToken(req);
    const currentUser = User.findByUsername(req.session.user.username);
    const isDefaultPassword = currentUser ? User.verifyPassword('admin123', currentUser.password_hash) : false;

    return res.json({
      success: true,
      message: 'Authenticated',
      data: {
        user: req.session.user,
        csrfToken,
        default_password_in_use: isDefaultPassword,
      },
    });
  }
  return res.status(401).json({
    success: false,
    message: 'Not logged in',
    data: null,
  });
});

/**
 * PUT /api/auth/change-password
 */
router.put('/change-password', requireAuth, validateBody(changePasswordSchema), (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const currentUser = User.findByUsername(req.session.user.username);
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  if (!currentUser || !User.verifyPassword(currentPassword, currentUser.password_hash)) {
    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip,
      action: 'change_password',
      target: 'auth',
      details: 'Failed: incorrect current password',
      status: 'failed',
    });

    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect',
      data: null,
    });
  }

  // Reject default password
  if (newPassword === 'admin123' || newPassword === 'password123') {
    return res.status(400).json({
      success: false,
      message: 'New password cannot be a common default password.',
      data: null,
    });
  }

  User.updatePassword(currentUser.id, newPassword);

  logAudit({
    userId: currentUser.id,
    username: currentUser.username,
    ip,
    action: 'change_password',
    target: 'auth',
    details: 'Password updated successfully. Other sessions revoked.',
    status: 'success',
  });

  // Revoke all sessions for this user across all devices (C4)
  sessionStore.destroyAllForUser(currentUser.id);

  // Restore current session for the user performing the change
  req.session.user = {
    id: currentUser.id,
    username: currentUser.username,
    role: currentUser.role,
  };

  return res.json({
    success: true,
    message: 'Password updated successfully. Other active sessions have been revoked.',
    data: null,
  });
});

module.exports = router;
