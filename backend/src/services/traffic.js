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

class TrafficService {
  constructor() {
    this.timer = null;
    this.wsClients = new Set();
    this.isPolling = false;
  }

  /**
   * Register a WebSocket client for real-time broadcasts
   */
  addWsClient(ws) {
    this.wsClients.add(ws);
    // Send immediate stats
    this.getSystemOverview().then((data) => {
      if (ws.readyState === 1) { // OPEN
        ws.send(JSON.stringify({ type: 'overview', data }));
      }
    }).catch(() => {});

    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  broadcast(data) {
    const payload = JSON.stringify(data);
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        ws.send(payload);
      }
    }
  }

  /**
   * Start polling loop
   */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), cfg.WS_PUSH_INTERVAL_MS);
    // Initial run
    setTimeout(() => this.poll(), 1000);
  }

  /**
   * Stop polling loop
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
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

      // 2. Query System metrics and engine status
      const overview = await this.getSystemOverview();

      // 3. Broadcast to all WebSocket listeners
      this.broadcast({
        type: 'stats',
        timestamp: Date.now(),
        data: overview,
      });
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
      // Patterns:
      // user>>><email>>>>traffic>>>uplink
      // user>>><email>>>>traffic>>>downlink
      // inbound>>><tag>>>>traffic>>>uplink
      // inbound>>><tag>>>>traffic>>>downlink
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
   * Gather full overview of system, engines, traffic, and inbounds
   */
  async getSystemOverview() {
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
        singbox: singboxStatus,
        xray: xrayStatus,
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

// Singleton instance
module.exports = new TrafficService();
