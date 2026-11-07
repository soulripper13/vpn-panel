/**
 * services/singbox.js
 * Service manager for sing-box core: process lifecycle, configuration generation,
 * validation, and log retrieval.
 */

'use strict';

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const cfg = require('../config/app-config');
const Inbound = require('../models/Inbound');
const Client = require('../models/Client');
const Settings = require('../models/Settings');
const { generateSingboxInbound } = require('../utils/config-generator');

const execAsync = util.promisify(exec);

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

    // 1. Check version
    try {
      const vOut = execSync(`${cfg.SINGBOX_BIN} version`, { timeout: 3000 }).toString();
      const match = vOut.match(/sing-box version ([^\s]+)/i);
      if (match) version = match[1];
    } catch {
      // ignore
    }

    // 2. Check systemctl status
    try {
      const { stdout } = await execAsync(`systemctl is-active ${cfg.SINGBOX_SERVICE}`);
      if (stdout.trim() === 'active') {
        running = true;
      }
    } catch {
      // Fallback check ps
      try {
        const { stdout } = await execAsync(`pgrep -f "sing-box.*run"`);
        if (stdout.trim()) {
          running = true;
          pid = parseInt(stdout.trim().split('\n')[0], 10);
        }
      } catch {
        running = false;
      }
    }

    if (running && !pid) {
      try {
        const { stdout } = await execAsync(`systemctl show ${cfg.SINGBOX_SERVICE} --property=MainPID`);
        const match = stdout.match(/MainPID=(\d+)/);
        if (match && match[1] !== '0') {
          pid = parseInt(match[1], 10);
        }
      } catch {
        // ignore
      }
    }

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
      service: cfg.SINGBOX_SERVICE,
      configPath: cfg.SINGBOX_CONFIG,
      binaryPath: cfg.SINGBOX_BIN,
    };
  }

  /**
   * Start sing-box service
   */
  static async start() {
    try {
      await execAsync(`systemctl start ${cfg.SINGBOX_SERVICE}`);
      return { success: true, message: 'sing-box service started' };
    } catch (err) {
      throw new Error(`Failed to start sing-box: ${err.message}`);
    }
  }

  /**
   * Stop sing-box service
   */
  static async stop() {
    try {
      await execAsync(`systemctl stop ${cfg.SINGBOX_SERVICE}`);
      return { success: true, message: 'sing-box service stopped' };
    } catch (err) {
      throw new Error(`Failed to stop sing-box: ${err.message}`);
    }
  }

  /**
   * Restart sing-box service
   */
  static async restart() {
    try {
      await execAsync(`systemctl restart ${cfg.SINGBOX_SERVICE}`);
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
   * Validate and write config to disk
   */
  static async writeConfig(configObject) {
    const jsonStr = JSON.stringify(configObject, null, 2);
    const tempPath = `${cfg.SINGBOX_CONFIG}.tmp`;

    // Ensure directory exists
    const dir = path.dirname(cfg.SINGBOX_CONFIG);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write temp file
    fs.writeFileSync(tempPath, jsonStr, 'utf8');

    // Validate using sing-box check
    try {
      if (fs.existsSync(cfg.SINGBOX_BIN)) {
        await execAsync(`${cfg.SINGBOX_BIN} check -c "${tempPath}"`);
      }
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw new Error(`sing-box config validation failed: ${err.stderr || err.message}`);
    }

    // Atomic overwrite
    fs.renameSync(tempPath, cfg.SINGBOX_CONFIG);
    return true;
  }

  /**
   * Generate complete sing-box config.json from database inbounds and clients
   */
  static async generateAndApplyConfig() {
    const inbounds = Inbound.findAll({ engine: 'singbox' }).filter((i) => Boolean(i.enabled));
    const singboxInbounds = [];

    for (const inb of inbounds) {
      const clients = Client.findByInbound(inb.id).filter((c) => Boolean(c.enable));
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

    // Build complete sing-box config object
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
          {
            ip_is_private: true,
            outbound: 'direct',
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
   * Get recent log lines from journalctl or log file
   */
  static async getLogs(lines = 100) {
    try {
      const { stdout } = await execAsync(`journalctl -u ${cfg.SINGBOX_SERVICE} -n ${lines} --no-pager --output=short-iso`);
      return stdout;
    } catch (err) {
      // Fallback: try reading system logs
      try {
        const { stdout } = await execAsync(`grep -i "sing-box" /var/log/syslog | tail -n ${lines}`);
        return stdout;
      } catch {
        return `Unable to fetch sing-box logs: ${err.message}`;
      }
    }
  }
}

module.exports = SingboxService;
