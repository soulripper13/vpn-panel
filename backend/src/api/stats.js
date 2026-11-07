/**
 * api/stats.js
 * Traffic statistics and server monitoring endpoints.
 */

'use strict';

const express = require('express');
const router = express.Router();
const TrafficService = require('../services/traffic');
const Inbound = require('../models/Inbound');
const Client = require('../models/Client');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

/**
 * GET /api/stats/overview
 * Real-time snapshot of system, engine health, and totals
 */
router.get('/overview', async (req, res) => {
  try {
    const data = await TrafficService.getSystemOverview();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/stats/inbounds
 * Per-inbound traffic usage list
 */
router.get('/inbounds', (req, res) => {
  try {
    const inbounds = Inbound.findAll();
    const stats = inbounds.map((inb) => ({
      id: inb.id,
      tag: inb.tag,
      engine: inb.engine,
      type: inb.type,
      port: inb.port,
      enabled: inb.enabled,
      up_bytes: inb.up_bytes,
      down_bytes: inb.down_bytes,
      total_bytes: (inb.up_bytes || 0) + (inb.down_bytes || 0),
      limit: inb.total_bytes_limit,
    }));
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/stats/clients
 * Per-client traffic usage list
 */
router.get('/clients', (req, res) => {
  try {
    const clients = Client.findAll();
    const stats = clients.map((c) => ({
      id: c.id,
      inbound_id: c.inbound_id,
      email: c.email,
      up_bytes: c.up_bytes,
      down_bytes: c.down_bytes,
      total_bytes: (c.up_bytes || 0) + (c.down_bytes || 0),
      limit: c.total_bytes_limit,
      enable: c.enable,
      remark: c.remark,
    }));
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/stats/chart
 * Returns hourly aggregated traffic data for the last 24 hours
 */
router.get('/chart', (req, res) => {
  try {
    // Generate past 24 hours data points
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 24 * 3600;

    const rows = db.prepare(`
      SELECT 
        (logged_at / 3600) * 3600 as time_bucket,
        SUM(up_bytes) as total_up,
        SUM(down_bytes) as total_down
      FROM traffic_logs
      WHERE logged_at >= ?
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `).all(dayAgo);

    // If empty, generate friendly fallback points
    if (rows.length === 0) {
      const fallback = [];
      for (let i = 23; i >= 0; i--) {
        const time = new Date(Date.now() - i * 3600 * 1000);
        const timeLabel = time.getHours().toString().padStart(2, '0') + ':00';
        fallback.push({
          time: timeLabel,
          upload: 0,
          download: 0,
        });
      }
      return res.json({ success: true, data: fallback });
    }

    const data = rows.map((r) => {
      const d = new Date(r.time_bucket * 1000);
      return {
        time: d.getHours().toString().padStart(2, '0') + ':00',
        upload: r.total_up || 0,
        download: r.total_down || 0,
      };
    });

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
