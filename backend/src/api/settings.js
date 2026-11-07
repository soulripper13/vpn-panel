/**
 * api/settings.js
 * Panel settings API (ports, IPs, certificates, paths).
 */

'use strict';

const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);

/**
 * GET /api/settings
 */
router.get('/', (req, res) => {
  try {
    const all = Settings.getAll();
    return res.json({
      success: true,
      data: all,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/settings
 */
router.put('/', requireAdmin, (req, res) => {
  try {
    const updates = req.body;
    if (typeof updates !== 'object' || updates === null) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    Settings.setMany(updates);

    return res.json({
      success: true,
      message: 'Settings updated successfully',
      data: Settings.getAll(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
