/**
 * services/traffic.js
 * Background service for monitoring traffic from sing-box and Xray,
 * updating database records, and broadcasting real-time metrics via WebSocket.
 */

'use strict';

const si = require('systeminformation');
const db = require('../config/database');
const cfg = require('../config/app-config');
const Inbound = require('../models/Inbound');
const Client = require('../models/Client');
const SingboxService = require('./singbox');
const XrayService = require('./xray');

const MAX_WS_CLIENTS = 50;

class TrafficService {
  constructor() {
    this.timer = null;
    this.retentionTimer = null;
    this.quotaTimer = null;
    this.heartbeatTimer = null;
    this.wsClients = new Set();
    this.isPolling = false;
    this.MAX_WS_CLIENTS = MAX_WS_CLIENTS;
  }

  /**
   * Register an authenticated WebSocket client for real-time broadcasts (C2)
   * @param {import('ws').WebSocket} ws
   * @param {object} user
   */
  addWsClient(ws, user = null) {
    if (this.wsClients.size >= MAX_WS_CLIENTS) {
      ws.close(1008, 'Maximum connections exceeded');
      return;
    }

    ws.isAlive = true;
    ws.user = user;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    this.wsClients.add(ws);

    // Send immediate stats
    this.getSystemOverview(user).then((data) => {
      if (ws.readyState === 1) { // OPEN
        ws.send(JSON.stringify({ type: 'overview', data }));
      }
    }).catch(() => {});

    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  /**
   * Broadcast message to all connected WebSocket clients with role-appropriate redaction
   */
  async broadcast() {
    if (this.wsClients.size === 0) return;

    try {
      const adminOverview = await this.getSystemOverview({ role: 'admin' });
      const viewerOverview = await this.getSystemOverview({ role: 'viewer' });

      const adminPayload = JSON.stringify({
        type: 'stats',
        timestamp: Date.now(),
        data: adminOverview,
      });

      const viewerPayload = JSON.stringify({
        type: 'stats',
        timestamp: Date.now(),
        data: viewerOverview,
      });

      for (const ws of this.wsClients) {
        if (ws.readyState === 1) {
          const payload = (ws.user && ws.user.role === 'admin') ? adminPayload : viewerPayload;
          ws.send(payload);
        }
      }
    } catch {}
  }

  /**
   * Start polling, retention, and quota loops
   */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), cfg.WS_PUSH_INTERVAL_MS);

    // Initial run
    setTimeout(() => this.poll(), 1000);

    // Heartbeat ping loop every 30s (C2)
    this.heartbeatTimer = setInterval(() => {
      for (const ws of this.wsClients) {
        if (!ws.isAlive) {
          ws.terminate();
          this.wsClients.delete(ws);
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
      }
    }, 30000);

    // Periodic traffic log retention pruning every 6 hours (M1)
    this.retentionTimer = setInterval(() => this.pruneOldLogs(), 6 * 60 * 60 * 1000);
    setTimeout(() => this.pruneOldLogs(), 60000);

    // Periodic quota & expiry enforcement check every 60s (C6)
    this.quotaTimer = setInterval(() => this.checkQuotasAndExpiry(), 60000);
  }

  /**
   * Stop polling loop
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    if (this.quotaTimer) {
      clearInterval(this.quotaTimer);
      this.quotaTimer = null;
    }
  }

  /**
   * Prune traffic logs older than 30 days (M1)
   */
  pruneOldLogs() {
    try {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
      db.prepare('DELETE FROM traffic_logs WHERE logged_at < ?').run(thirtyDaysAgo);
    } catch (err) {
      console.warn('[Traffic Log Retention] Notice on pruning:', err.message);
    }
  }

  /**
   * Check clients for expiry or traffic quota exceedance and reapply configs if changed (C6)
   */
  async checkQuotasAndExpiry() {
    try {
      const enabledClients = Client.findEnabled();
      const now = Math.floor(Date.now() / 1000);
      let needsSingboxReload = false;
      let needsXrayReload = false;

      for (const c of enabledClients) {
        let isExpired = false;
        let isOverQuota = false;

        if (c.expiry_time && c.expiry_time > 0) {
          const exp = c.expiry_time > 10000000000 ? Math.floor(c.expiry_time / 1000) : c.expiry_time;
          if (now > exp) isExpired = true;
        }

        if (c.total_bytes_limit && c.total_bytes_limit > 0) {
          const used = (c.up_bytes || 0) + (c.down_bytes || 0);
          if (used >= c.total_bytes_limit) isOverQuota = true;
        }

        if (isExpired || isOverQuota) {
          const inb = Inbound.findById(c.inbound_id);
          if (inb) {
            if (inb.engine === 'singbox') needsSingboxReload = true;
            if (inb.engine === 'xray') needsXrayReload = true;
          }
        }
      }

      if (needsSingboxReload) {
        await SingboxService.generateAndApplyConfig().catch(() => {});
      }
      if (needsXrayReload) {
        await XrayService.generateAndApplyConfig().catch(() => {});
      }
    } catch (err) {
      console.warn('[Quota Scheduler] Notice:', err.message);
    }
  }

  /**
   * Single polling execution
   */
  async poll() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      // 1. Query Xray traffic
      const xrayStats = await XrayService.queryTraffic();
      this.processXrayStats(xrayStats);

      // 2. Broadcast to all WebSocket listeners
      await this.broadcast();
    } catch (err) {
      // ignore transient poll error
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Parse and record Xray stats query results
   */
  processXrayStats(stats) {
    if (!Array.isArray(stats) || stats.length === 0) return;

    for (const item of stats) {
      const name = item.name || '';
      const value = parseInt(item.value || 0, 10);
      if (value <= 0) continue;

      const parts = name.split('>>>');
      if (parts[0] === 'user' && parts.length >= 4) {
        const email = parts[1];
        const direction = parts[3]; // 'uplink' or 'downlink'
        const client = Client.findByEmail(email);
        if (client) {
          const up = direction === 'uplink' ? value : 0;
          const down = direction === 'downlink' ? value : 0;
          Client.addTraffic(client.id, up, down);
          try {
            db.prepare('INSERT INTO traffic_logs (inbound_id, client_email, up_bytes, down_bytes) VALUES (?, ?, ?, ?)').run(client.inbound_id, email, up, down);
          } catch {}
        }
      } else if (parts[0] === 'inbound' && parts.length >= 4) {
        const tag = parts[1];
        const direction = parts[3];
        const inbound = Inbound.findByTag(tag);
        if (inbound) {
          const up = direction === 'uplink' ? value : 0;
          const down = direction === 'downlink' ? value : 0;
          Inbound.addTraffic(inbound.id, up, down);
        }
      }
    }
  }

  /**
   * Gather full overview of system, engines, traffic, and inbounds.
   * Redacts sensitive process paths for non-admin viewers (C2).
   */
  async getSystemOverview(user = null) {
    const isAdmin = Boolean(user && user.role === 'admin');

    // 1. System info
    const [cpu, mem, fsSize, currentLoad] = await Promise.all([
      si.cpu().catch(() => ({})),
      si.mem().catch(() => ({})),
      si.fsSize().catch(() => ([])),
      si.currentLoad().catch(() => ({})),
    ]);

    const disk = fsSize[0] || { size: 1, used: 0 };

    // 2. Engine status
    const [singboxStatus, xrayStatus] = await Promise.all([
      SingboxService.getStatus(),
      XrayService.getStatus(),
    ]);

    // Redact internal host filesystem details for viewers (C2)
    const safeSingbox = isAdmin ? singboxStatus : {
      running: singboxStatus.running,
      uptime: singboxStatus.uptime,
      version: singboxStatus.version,
      service: 'sing-box',
    };

    const safeXray = isAdmin ? xrayStatus : {
      running: xrayStatus.running,
      uptime: xrayStatus.uptime,
      version: xrayStatus.version,
      service: 'xray',
    };

    // 3. Totals from database
    const inbounds = Inbound.findAll();
    const clients = Client.findAll();

    let totalUp = 0;
    let totalDown = 0;
    for (const inb of inbounds) {
      totalUp += inb.up_bytes || 0;
      totalDown += inb.down_bytes || 0;
    }

    return {
      system: {
        cpuUsage: Math.round(currentLoad.currentLoad || 0),
        cpuModel: cpu.brand || 'AMD EPYC',
        cpuCores: cpu.cores || 2,
        memTotal: mem.total || 1,
        memUsed: mem.used || 0,
        memPercent: Math.round(((mem.used || 0) / (mem.total || 1)) * 100),
        diskTotal: disk.size || 1,
        diskUsed: disk.used || 0,
        diskPercent: Math.round(((disk.used || 0) / (disk.size || 1)) * 100),
        uptime: osUptime(),
      },
      engines: {
        singbox: safeSingbox,
        xray: safeXray,
      },
      totals: {
        totalUp,
        totalDown,
        inboundCount: inbounds.length,
        activeInbounds: inbounds.filter((i) => Boolean(i.enabled)).length,
        clientCount: clients.length,
        activeClients: clients.filter((c) => Boolean(c.enable)).length,
      },
    };
  }
}

function osUptime() {
  try {
    const uptimeSec = Math.floor(process.uptime());
    const days = Math.floor(uptimeSec / (3600 * 24));
    const hours = Math.floor((uptimeSec % (3600 * 24)) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  } catch {
    return '0m';
  }
}

module.exports = new TrafficService();
