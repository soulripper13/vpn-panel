/**
 * api/auth.js
 * Authentication routes: login, logout, me, change password.
 */

'use strict';

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');

const loginSchema = Joi.object({
  username: Joi.string().required().trim(),
  password: Joi.string().required(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

/**
 * POST /api/auth/login
 */
router.post('/login', validateBody(loginSchema), (req, res) => {
  const { username, password } = req.body;
  const user = User.findByUsername(username);

  if (!user || !User.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({
      success: false,
      message: 'Invalid username or password',
      data: null,
    });
  }

  // Create session
  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
  };

  return res.json({
    success: true,
    message: 'Logged in successfully',
    data: {
      user: req.session.user,
    },
  });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Could not log out',
        data: null,
      });
    }
    res.clearCookie('connect.sid');
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
    return res.json({
      success: true,
      message: 'Authenticated',
      data: {
        user: req.session.user,
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

  if (!currentUser || !User.verifyPassword(currentPassword, currentUser.password_hash)) {
    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect',
      data: null,
    });
  }

  User.updatePassword(currentUser.id, newPassword);

  return res.json({
    success: true,
    message: 'Password updated successfully',
    data: null,
  });
});

module.exports = router;
