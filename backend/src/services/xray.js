/**
 * services/xray.js
 * Service manager for Xray core: process lifecycle, configuration generation,
 * validation, and log retrieval.
 */

'use strict';

const { exec, execFile, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const cfg = require('../config/app-config');
const Inbound = require('../models/Inbound');
const Client = require('../models/Client');
const Settings = require('../models/Settings');
const { generateXrayInbound } = require('../utils/config-generator');
const privileged = require('./privileged-client');

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

/**
 * Filter client eligibility by quota and expiry (C6)
 */
function isClientActive(client) {
  if (!client.enable) return false;
  const now = Math.floor(Date.now() / 1000);
  if (client.expiry_time && client.expiry_time > 0) {
    const exp = client.expiry_time > 10000000000 ? Math.floor(client.expiry_time / 1000) : client.expiry_time;
    if (now > exp) return false;
  }
  if (client.total_bytes_limit && client.total_bytes_limit > 0) {
    const used = (client.up_bytes || 0) + (client.down_bytes || 0);
    if (used >= client.total_bytes_limit) return false;
  }
  return true;
}

class XrayService {
  /**
   * Get xray running status, PID, memory, and version
   */
  static async getStatus() {
    let running = false;
    let pid = null;
    let uptime = null;
    let memory = null;
    let version = 'unknown';

    // 1. Version check
    try {
      if (fs.existsSync(cfg.XRAY_BIN)) {
        const vOut = execSync(`"${cfg.XRAY_BIN}" version`, { timeout: 3000 }).toString();
        const match = vOut.match(/Xray\s+([\d\.]+)/i);
        if (match) version = match[1];
      }
    } catch {
      // ignore
    }

    // 2. Check systemctl status or running process
    try {
      const { stdout } = await execAsync(`systemctl is-active ${cfg.XRAY_SERVICE}`);
      if (stdout.trim() === 'active') {
        running = true;
      }
    } catch {
      try {
        const { stdout } = await execAsync(`pgrep -f "${cfg.XRAY_PROCESS_NAME}.*-c"`);
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
          running = true;
          pid = parseInt(lines[0], 10);
        }
      } catch {
        running = false;
      }
    }

    if (running && !pid) {
      try {
        const { stdout } = await execAsync(`systemctl show ${cfg.XRAY_SERVICE} --property=MainPID`);
        const match = stdout.match(/MainPID=(\d+)/);
        if (match && match[1] !== '0') {
          pid = parseInt(match[1], 10);
        }
      } catch {}
    }

    // 3. Process details
    if (pid) {
      try {
        const { stdout } = await execAsync(`ps -p ${pid} -o etime=,rss=`);
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 2) {
          uptime = parts[0];
          memory = Math.round(parseInt(parts[1], 10) / 1024) + ' MB';
        }
      } catch {
        // ignore
      }
    }

    return {
      running,
      pid,
      uptime,
      memory,
      version,
      service: cfg.XRAY_SERVICE,
      configPath: cfg.XRAY_CONFIG,
      binaryPath: cfg.XRAY_BIN,
    };
  }

  /**
   * Start xray service / process
   */
  static async start() {
    const delegated = await privileged.callRequired('service_action', { engine: 'xray', action: 'start' });
    if (delegated) return { success: true, message: 'Xray service started' };
    const status = await XrayService.getStatus();
    if (status.running) {
      return { success: true, message: 'Xray is already running' };
    }

    // Try systemd unit if exists
    try {
      await execAsync(`systemctl start ${cfg.XRAY_SERVICE}`);
      return { success: true, message: 'Xray systemd service started' };
    } catch {
      // Direct launch fallback
      const binDir = path.dirname(cfg.XRAY_BIN);
      const child = spawn(cfg.XRAY_BIN, ['-c', cfg.XRAY_CONFIG], {
        cwd: binDir,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { success: true, message: 'Xray process launched' };
    }
  }

  /**
   * Stop xray service / process
   */
  static async stop() {
    const delegated = await privileged.callRequired('service_action', { engine: 'xray', action: 'stop' });
    if (delegated) return { success: true, message: 'Xray stopped' };
    try {
      await execAsync(`systemctl stop ${cfg.XRAY_SERVICE} 2>/dev/null || pkill -f "${cfg.XRAY_PROCESS_NAME}"`);
      return { success: true, message: 'Xray stopped' };
    } catch (err) {
      // If already stopped, ignore error
      return { success: true, message: 'Xray stopped' };
    }
  }

  /**
   * Restart xray
   */
  static async restart() {
    const delegated = await privileged.callRequired('service_action', { engine: 'xray', action: 'restart' });
    if (delegated) return { success: true, message: 'Xray service restarted' };
    try {
      await execAsync(`systemctl restart ${cfg.XRAY_SERVICE}`);
      return { success: true, message: 'Xray service restarted' };
    } catch (err) {
      throw new Error(`Failed to restart xray: ${err.message}`);
    }
  }

  /**
   * Read raw config from disk
   */
  static getConfig() {
    try {
      if (!fs.existsSync(cfg.XRAY_CONFIG)) {
        return null;
      }
      const raw = fs.readFileSync(cfg.XRAY_CONFIG, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to read xray config: ${err.message}`);
    }
  }

  /**
   * Validate and write config to disk with restricted permissions (0600)
   */
  static async writeConfig(configObject) {
    const delegated = await privileged.callRequired('write_engine_config', { engine: 'xray', config: configObject });
    if (delegated) return true;
    const jsonStr = JSON.stringify(configObject, null, 2);
    const dir = path.dirname(cfg.XRAY_CONFIG);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tempPath = path.join(dir, 'config.tmp.json');

    fs.writeFileSync(tempPath, jsonStr, { encoding: 'utf8', mode: 0o600 });

    // Test with xray -test
    try {
      if (fs.existsSync(cfg.XRAY_BIN)) {
        await execAsync(`"${cfg.XRAY_BIN}" -test -format json -config "${tempPath}"`);
      }
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      const errMsg = err.stdout || err.stderr || err.message;
      throw new Error(`Xray config validation failed: ${errMsg}`);
    }

    fs.renameSync(tempPath, cfg.XRAY_CONFIG);
    try { fs.chmodSync(cfg.XRAY_CONFIG, 0o600); } catch {}
    return true;
  }

  /**
   * Generate complete xray config.json from database inbounds and clients
   * Enforces quotas, expiry, and blocks private/loopback/metadata destinations (C6, H6)
   */
  static async generateAndApplyConfig() {
    const inbounds = Inbound.findAll({ engine: 'xray' }).filter((i) => Boolean(i.enabled));
    const xrayInbounds = [];

    // Always include API inbound for stats / management
    xrayInbounds.push({
      listen: '127.0.0.1',
      port: cfg.XRAY_API_PORT,
      protocol: 'dokodemo-door',
      settings: {
        address: '127.0.0.1',
      },
      tag: 'api',
    });

    for (const inb of inbounds) {
      // Strictly include only active, unexpired, and under-limit clients (C6)
      const clients = Client.findByInbound(inb.id).filter(isClientActive);
      const settings = inb.settings || (typeof inb.settings_json === 'string' ? JSON.parse(inb.settings_json || '{}') : inb.settings_json) || {};
      const streamSettings = inb.stream_settings || (typeof inb.stream_settings_json === 'string' ? JSON.parse(inb.stream_settings_json || '{}') : inb.stream_settings_json) || {};

      const combinedOpts = {
        ...settings,
        ...streamSettings,
        streamSettings,
        stream_settings: streamSettings,
        tag: inb.tag,
        listen: inb.listen,
        port: inb.port,
        clients: clients.map((c) => ({
          email: c.email,
          uuid: c.uuid,
          password: c.password,
          auth: c.password || c.uuid,
          flow: c.flow,
        })),
        users: clients.map((c) => ({
          email: c.email,
          uuid: c.uuid,
          password: c.password,
          auth: c.password || c.uuid,
          flow: c.flow,
        })),
      };

      const generated = generateXrayInbound(inb.type, combinedOpts);
      if (generated) {
        xrayInbounds.push(generated);
      }
    }

    const config = {
      log: {
        access: 'none',
        dnsLog: false,
        loglevel: 'warning',
        maskAddress: '',
      },
      api: {
        tag: 'api',
        services: [
          'HandlerService',
          'LoggerService',
          'StatsService',
        ],
      },
      stats: {},
      policy: {
        levels: {
          '0': {
            statsUserUplink: true,
            statsUserDownlink: true,
          },
        },
        system: {
          statsInboundUplink: true,
          statsInboundDownlink: true,
          statsOutboundUplink: true,
          statsOutboundDownlink: true,
        },
      },
      inbounds: xrayInbounds,
      outbounds: [
        {
          tag: 'direct',
          protocol: 'freedom',
          settings: {},
        },
        {
          tag: 'blocked',
          protocol: 'blackhole',
          settings: {},
        },
      ],
      routing: {
        domainStrategy: 'AsIs',
        rules: [
          {
            type: 'field',
            inboundTag: ['api'],
            outboundTag: 'api',
          },
          {
            type: 'field',
            ip: [
              'geoip:private',
              '127.0.0.0/8',
              '10.0.0.0/8',
              '172.16.0.0/12',
              '192.168.0.0/16',
              '169.254.0.0/16',
              '100.64.0.0/10',
              '::1/128',
              'fc00::/7',
              'fe80::/10',
            ],
            outboundTag: 'blocked',
          },
        ],
      },
    };

    await XrayService.writeConfig(config);
    await XrayService.restart();
    return config;
  }

  /**
   * Get recent log lines with bounded line count (M1)
   */
  static async getLogs(lines = 100) {
    const safeLines = Math.min(Math.max(parseInt(lines, 10) || 100, 1), 500);
    if (privileged.isConfigured()) {
      try {
        const privilegedLogs = await privileged.call('read_service_logs', { engine: 'xray', lines: safeLines });
        if (privilegedLogs && typeof privilegedLogs.logs === 'string') return privilegedLogs.logs;
      } catch (_) {
        // Fall back to direct journalctl if privileged helper fails or is reloading
      }
    }
    try {
      const { stdout } = await execFileAsync('journalctl', [
        '-u', cfg.XRAY_SERVICE, '-n', String(safeLines), '--no-pager', '--output=short-iso',
      ]);
      return stdout;
    } catch (err) {
      return `Unable to fetch Xray logs: ${err.message}. The panel account needs the restricted privileged log reader or journal access.`;
    }
  }

  /**
   * Query traffic stats from Xray API
   */
  static async queryTraffic() {
    try {
      // Query stats via xray api cli with -reset to retrieve delta increments
      const { stdout } = await execAsync(`"${cfg.XRAY_BIN}" api statsquery --server=127.0.0.1:${cfg.XRAY_API_PORT} -reset 2>/dev/null`);
      const data = JSON.parse(stdout);
      return data.stat || [];
    } catch {
      return [];
    }
  }
}

module.exports = XrayService;
