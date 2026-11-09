/**
 * api/settings.js
 * Panel settings API (ports, IPs, certificates, paths).
 */

'use strict';

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const Settings = require('../models/Settings');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);

const allowedSettingsSchema = Joi.object({
  panel_port: Joi.string().regex(/^\d+$/).custom((val, helpers) => {
    const num = parseInt(val, 10);
    if (num < 1 || num > 65535) return helpers.error('any.invalid');
    return val;
  }).optional(),
  web_base_path: Joi.string().max(64).allow('').optional(),
  server_ip: Joi.string().max(255).allow('').optional(),
  cert_fullchain: Joi.string().max(512).allow('').optional(),
  cert_privkey: Joi.string().max(512).allow('').optional(),
  singbox_bin: Joi.string().max(255).optional(),
  singbox_config: Joi.string().max(255).optional(),
  xray_bin: Joi.string().max(255).optional(),
  xray_config: Joi.string().max(255).optional(),
  xray_api_port: Joi.string().regex(/^\d+$/).custom((val, helpers) => {
    const num = parseInt(val, 10);
    if (num < 1 || num > 65535) return helpers.error('any.invalid');
    return val;
  }).optional(),
  traffic_reset_day: Joi.string().regex(/^([1-9]|[12]\d|3[01])$/).optional(),
  panel_ssl: Joi.string().valid('auto', '1', '0', 'http', 'false', 'true').optional(),
}).unknown(false); // Reject arbitrary unknown keys (H3)

/**
 * GET /api/settings
 */
router.get('/', (req, res) => {
  try {
    const all = Settings.getAll();
    if (!all.server_ip) {
      all.server_ip = req.hostname || '';
    }
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
router.put('/', requireAdmin, validateBody(allowedSettingsSchema), (req, res) => {
  try {
    const updates = req.body;
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

    Settings.setMany(updates);

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip,
      action: 'update_settings',
      target: 'settings',
      details: Object.keys(updates).join(', '),
      status: 'success',
    });

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
