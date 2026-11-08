/**
 * api/engine.js
 * Engine control routes for managing sing-box and xray services.
 */

'use strict';

const express = require('express');
const router = express.Router();
const SingboxService = require('../services/singbox');
const XrayService = require('../services/xray');
const BinaryUpdaterService = require('../services/binary-updater');
const PanelUpdaterService = require('../services/panel-updater');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── SING-BOX ─────────────────────────────────────────────────────────────────

/**
 * GET /api/engine/singbox/status
 */
router.get('/singbox/status', async (req, res) => {
  try {
    const status = await SingboxService.getStatus();
    return res.json({ success: true, data: status });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/singbox/start
 */
router.post('/singbox/start', async (req, res) => {
  try {
    const result = await SingboxService.start();
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/singbox/stop
 */
router.post('/singbox/stop', async (req, res) => {
  try {
    const result = await SingboxService.stop();
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/singbox/restart
 */
router.post('/singbox/restart', async (req, res) => {
  try {
    const result = await SingboxService.restart();
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/engine/singbox/logs
 */
router.get('/singbox/logs', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines || '100', 10);
    const logs = await SingboxService.getLogs(lines);
    return res.json({ success: true, data: { logs } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── XRAY ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/engine/xray/status
 */
router.get('/xray/status', async (req, res) => {
  try {
    const status = await XrayService.getStatus();
    return res.json({ success: true, data: status });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/xray/start
 */
router.post('/xray/start', async (req, res) => {
  try {
    const result = await XrayService.start();
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/xray/stop
 */
router.post('/xray/stop', async (req, res) => {
  try {
    const result = await XrayService.stop();
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/xray/restart
 */
router.post('/xray/restart', async (req, res) => {
  try {
    const result = await XrayService.restart();
    return res.json({ success: true, message: result.message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/engine/xray/logs
 */
router.get('/xray/logs', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines || '100', 10);
    const logs = await XrayService.getLogs(lines);
    return res.json({ success: true, data: { logs } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── UPDATES & BINARY MANAGEMENT ─────────────────────────────────────────────

/**
 * GET /api/engine/updates
 * Check for updates for both sing-box and Xray
 */
router.get('/updates', async (req, res) => {
  try {
    const data = await BinaryUpdaterService.getUpdatesStatus();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/singbox/update
 * Update sing-box binary
 */
router.post('/singbox/update', async (req, res) => {
  try {
    const result = await BinaryUpdaterService.updateSingbox(req.body.version);
    return res.json({ success: true, message: result.message, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/xray/update
 * Update Xray binary
 */
router.post('/xray/update', async (req, res) => {
  try {
    const result = await BinaryUpdaterService.updateXray(req.body.version);
    return res.json({ success: true, message: result.message, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PANEL SELF-UPDATE ────────────────────────────────────────────────────────

/**
 * GET /api/engine/panel/updates
 * Check GitHub for latest VPN Panel release/commits
 */
router.get('/panel/updates', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const data = await PanelUpdaterService.getStatus(force);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/engine/panel/update/status
 * Get real-time panel self-update logs and progress
 */
router.get('/panel/update/status', (req, res) => {
  try {
    const data = PanelUpdaterService.getUpdateProgress();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/engine/panel/update
 * Trigger VPN Panel self-update pipeline
 */
router.post('/panel/update', async (req, res) => {
  try {
    const result = await PanelUpdaterService.updatePanel();
    return res.json({ success: true, message: result.message, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
