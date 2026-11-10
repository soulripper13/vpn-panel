/**
 * services/singbox.js
 * Service manager for sing-box core: process lifecycle, configuration generation,
 * validation, and log retrieval.
 */

'use strict';

const { execFile, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const cfg = require('../config/app-config');
const Inbound = require('../models/Inbound');
const Client = require('../models/Client');
const Settings = require('../models/Settings');
const { generateSingboxInbound } = require('../utils/config-generator');
const privileged = require('./privileged-client');

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

class SingboxService {
  /**
   * Get sing-box running status, PID, memory, and version
   */
  static async getStatus() {
    let running = false;
    let pid = null;
    let uptime = null;
    let memory = null;
    let version = 'unknown';

    // 1. Try systemctl is-active
    try {
      const { stdout } = await execFileAsync('systemctl', ['is-active', cfg.SINGBOX_SERVICE]);
      if (stdout.trim() === 'active') {
        running = true;
      }
    } catch {
      // not running via systemd or not debian
    }

    // 2. Check via pidof or pgrep if not active via systemctl
    if (!running) {
      try {
        const { stdout } = await execFileAsync('pgrep', ['-f', 'sing-box']);
        const pids = stdout.trim().split('\n').filter(Boolean);
        if (pids.length > 0) {
          running = true;
          pid = parseInt(pids[0], 10);
        }
      } catch {
        // ignore
      }
    }

    // 3. If running, get PID via systemctl show if needed
    if (running && !pid) {
      try {
        const { stdout } = await execFileAsync('systemctl', ['show', '--property', 'MainPID', cfg.SINGBOX_SERVICE]);
        const m = stdout.match(/MainPID=(\d+)/);
        if (m && parseInt(m[1], 10) > 0) {
          pid = parseInt(m[1], 10);
        }
      } catch {
        // ignore
      }
    }

    // 4. Read memory and uptime from /proc if PID is found
    if (pid) {
      try {
        const statmPath = `/proc/${pid}/statm`;
        if (fs.existsSync(statmPath)) {
          const statm = fs.readFileSync(statmPath, 'utf8').split(' ');
          const pageSize = 4096;
          const rssPages = parseInt(statm[1], 10) || 0;
          memory = rssPages * pageSize;
        }
      } catch {
        // ignore
      }
    }

    // 5. Version
    if (fs.existsSync(cfg.SINGBOX_BIN)) {
      try {
        const { stdout } = await execFileAsync(cfg.SINGBOX_BIN, ['version']);
        const match = stdout.match(/version\s+([^\s]+)/i);
        if (match) {
          version = match[1];
        } else {
          version = stdout.trim().split('\n')[0];
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
      service: cfg.SINGBOX_SERVICE,
      configPath: cfg.SINGBOX_CONFIG,
      binaryPath: cfg.SINGBOX_BIN,
    };
  }

  /**
   * Start sing-box service
   */
  static async start() {
    const delegated = await privileged.callRequired('service_action', { engine: 'singbox', action: 'start' });
    if (delegated) return { success: true, message: 'sing-box service started' };
    try {
      await execFileAsync('systemctl', ['start', cfg.SINGBOX_SERVICE]);
      return { success: true, message: 'sing-box service started' };
    } catch (err) {
      throw new Error(`Failed to start sing-box: ${err.message}`);
    }
  }

  /**
   * Stop sing-box service
   */
  static async stop() {
    const delegated = await privileged.callRequired('service_action', { engine: 'singbox', action: 'stop' });
    if (delegated) return { success: true, message: 'sing-box service stopped' };
    try {
      await execFileAsync('systemctl', ['stop', cfg.SINGBOX_SERVICE]);
      return { success: true, message: 'sing-box service stopped' };
    } catch (err) {
      throw new Error(`Failed to stop sing-box: ${err.message}`);
    }
  }

  /**
   * Restart sing-box service
   */
  static async restart() {
    const delegated = await privileged.callRequired('service_action', { engine: 'singbox', action: 'restart' });
    if (delegated) return { success: true, message: 'sing-box service restarted' };
    try {
      await execFileAsync('systemctl', ['restart', cfg.SINGBOX_SERVICE]);
      return { success: true, message: 'sing-box service restarted' };
    } catch (err) {
      throw new Error(`Failed to restart sing-box: ${err.message}`);
    }
  }

  /**
   * Read raw config from disk
   */
  static getConfig() {
    try {
      if (!fs.existsSync(cfg.SINGBOX_CONFIG)) {
        return null;
      }
      const raw = fs.readFileSync(cfg.SINGBOX_CONFIG, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to read sing-box config: ${err.message}`);
    }
  }

  /**
   * Validate and write config to disk with restricted permissions (0600)
   */
  static async writeConfig(configObject) {
    const delegated = await privileged.callRequired('write_engine_config', { engine: 'singbox', config: configObject });
    if (delegated) return true;
    const jsonStr = JSON.stringify(configObject, null, 2);
    const dir = path.dirname(cfg.SINGBOX_CONFIG);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tempPath = path.join(dir, 'config.tmp.json');

    // Write temp file with restricted mode (0600)
    fs.writeFileSync(tempPath, jsonStr, { encoding: 'utf8', mode: 0o600 });

    // Validate using sing-box check
    try {
      if (fs.existsSync(cfg.SINGBOX_BIN)) {
        await execFileAsync(cfg.SINGBOX_BIN, ['check', '-c', tempPath]);
      }
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      const errMsg = err.stderr || err.stdout || err.message;
      throw new Error(`sing-box config validation failed: ${errMsg}`);
    }

    // Atomic overwrite and permission guarantee
    fs.renameSync(tempPath, cfg.SINGBOX_CONFIG);
    try { fs.chmodSync(cfg.SINGBOX_CONFIG, 0o600); } catch {}
    return true;
  }

  /**
   * Generate complete sing-box config.json from database inbounds and clients
   * Enforces quotas, expiry, and blocks private/loopback/metadata destinations (C6, H6)
   */
  static async generateAndApplyConfig() {
    const inbounds = Inbound.findAll({ engine: 'singbox' }).filter((i) => Boolean(i.enabled));
    const singboxInbounds = [];

    for (const inb of inbounds) {
      // Strictly include only active, unexpired, and under-limit clients (C6)
      const clients = Client.findByInbound(inb.id).filter(isClientActive);
      const settings = inb.settings || (typeof inb.settings_json === 'string' ? JSON.parse(inb.settings_json || '{}') : inb.settings_json) || {};
      const streamSettings = inb.stream_settings || (typeof inb.stream_settings_json === 'string' ? JSON.parse(inb.stream_settings_json || '{}') : inb.stream_settings_json) || {};

      const combinedOpts = {
        ...settings,
        ...streamSettings,
        tag: inb.tag,
        listen: inb.listen,
        port: inb.port,
        users: clients.map((c) => ({
          name: c.email || c.remark || '',
          uuid: c.uuid,
          password: c.password || settings.shadowtlsPassword || settings.password,
          flow: c.flow,
        })),
      };

      const generated = generateSingboxInbound(inb.type, combinedOpts);
      if (Array.isArray(generated)) {
        singboxInbounds.push(...generated);
      } else if (generated) {
        singboxInbounds.push(generated);
      }
    }

    // Build complete sing-box config object with hardened routing rules (H6)
    const config = {
      log: {
        level: 'info',
        timestamp: true,
      },
      experimental: {
        clash_api: {
          external_controller: '127.0.0.1:9090',
        },
      },
      inbounds: singboxInbounds,
      outbounds: [
        {
          type: 'direct',
          tag: 'direct',
        },
        {
          type: 'block',
          tag: 'block',
        },
      ],
      route: {
        rules: [
          // Block all RFC1918, link-local, loopback, and cloud metadata access by default (H6)
          {
            ip_is_private: true,
            outbound: 'block',
          },
          {
            ip_cidr: [
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
            outbound: 'block',
          },
        ],
      },
    };

    // Save and restart
    await SingboxService.writeConfig(config);
    await SingboxService.restart();
    return config;
  }

  /**
   * Get recent log lines from journalctl with bounded line counts (M1)
   */
  static async getLogs(lines = 100) {
    const safeLines = Math.min(Math.max(parseInt(lines, 10) || 100, 1), 500);
    try {
      const privilegedLogs = await privileged.call('read_service_logs', { engine: 'singbox', lines: safeLines });
      if (privilegedLogs && typeof privilegedLogs.logs === 'string') return privilegedLogs.logs;
      const { stdout } = await execFileAsync('journalctl', [
        '-u', cfg.SINGBOX_SERVICE,
        '-n', String(safeLines),
        '--no-pager',
        '--output=short-iso',
      ]);
      return stdout;
    } catch (err) {
      return `Unable to fetch sing-box logs: ${err.message}. The panel account needs the restricted privileged log reader or journal access.`;
    }
  }
}

module.exports = SingboxService;
