/**
 * utils/importer.js
 * Automatically imports existing sing-box and xray configs into the panel database
 * so no existing clients or inbounds are lost.
 */

'use strict';

const fs = require('fs');
const Inbound = require('../models/Inbound');
const Client = require('../models/Client');
const cfg = require('../config/app-config');

function importExistingConfigs() {
  const existingInbounds = Inbound.findAll();
  if (existingInbounds.length > 0) {
    return; // Already initialized
  }

  console.log('[Importer] Scanning for existing configs to import...');

  // 1. Import sing-box config
  try {
    if (fs.existsSync(cfg.SINGBOX_CONFIG)) {
      const sbRaw = fs.readFileSync(cfg.SINGBOX_CONFIG, 'utf8');
      const sbConfig = JSON.parse(sbRaw);

      if (Array.isArray(sbConfig.inbounds)) {
        for (const inb of sbConfig.inbounds) {
          if (inb.type === 'shadowtls') {
            const { id } = Inbound.create({
              engine: 'singbox',
              tag: inb.tag || `singbox-${inb.type}-${inb.listen_port || 2053}`,
              type: 'shadowtls',
              listen: inb.listen || '::',
              port: inb.listen_port || 2053,
              protocol: 'shadowtls',
              settings: {
                serverName: inb.handshake?.server || 'gateway.icloud.com',
                password: inb.users?.[0]?.password || '',
                version: inb.version || 3,
                detour: inb.detour || 'ss-in',
              },
              stream_settings: {},
              enabled: 1,
              remark: 'Imported Sing-box ShadowTLS',
            });

            Client.create({
              inbound_id: id,
              email: 'default-user',
              password: inb.users?.[0]?.password || '',
              remark: 'Imported User',
            });
          } else if (inb.type === 'shadowsocks') {
            const { id } = Inbound.create({
              engine: 'singbox',
              tag: inb.tag || `singbox-${inb.type}-${inb.listen_port || 0}`,
              type: 'shadowsocks',
              listen: inb.listen || '127.0.0.1',
              port: inb.listen_port || 0,
              protocol: 'shadowsocks',
              settings: {
                method: inb.method,
                password: inb.password,
              },
              stream_settings: {},
              enabled: 1,
              remark: 'Imported Sing-box Shadowsocks 2022',
            });

            Client.create({
              inbound_id: id,
              email: 'ss-user',
              password: inb.password,
              remark: 'SS User',
            });
          }
        }
        console.log('[Importer] Successfully imported sing-box inbounds.');
      }
    }
  } catch (err) {
    console.error('[Importer] sing-box import notice:', err.message);
  }

  // 2. Import Xray config
  try {
    if (fs.existsSync(cfg.XRAY_CONFIG)) {
      const xrRaw = fs.readFileSync(cfg.XRAY_CONFIG, 'utf8');
      const xrConfig = JSON.parse(xrRaw);

      if (Array.isArray(xrConfig.inbounds)) {
        for (const inb of xrConfig.inbounds) {
          if (inb.tag === 'api' || inb.protocol === 'tunnel') continue;

          const type = inb.protocol || 'vless';
          const { id } = Inbound.create({
            engine: 'xray',
            tag: inb.tag || `xray-${type}-${inb.port}`,
            type: type,
            listen: inb.listen || '0.0.0.0',
            port: inb.port,
            protocol: type,
            settings: inb.settings || {},
            stream_settings: inb.streamSettings || {},
            enabled: 1,
            remark: `Imported Xray ${type.toUpperCase()}:${inb.port}`,
          });

          // Import clients
          const clients = inb.settings?.clients || [];
          for (const c of clients) {
            Client.create({
              inbound_id: id,
              email: c.email || `client_${c.id || c.auth || 'user'}`,
              uuid: c.id || '',
              password: c.auth || c.password || '',
              flow: c.flow || '',
              remark: c.email || 'Imported User',
            });
          }
        }
        console.log('[Importer] Successfully imported Xray inbounds.');
      }
    }
  } catch (err) {
    console.error('[Importer] Xray import notice:', err.message);
  }
  // 3. Import historical traffic from x-ui.db if available
  try {
    const xuiDbPath = '/etc/x-ui/x-ui.db';
    if (fs.existsSync(xuiDbPath)) {
      const Database = require('better-sqlite3');
      const db = require('../config/database');
      const xdb = new Database(xuiDbPath, { readonly: true });

      const inbRows = xdb.prepare('SELECT port, up, down FROM inbounds').all();
      for (const row of inbRows) {
        db.prepare('UPDATE inbounds SET up_bytes = ?, down_bytes = ? WHERE port = ?').run(row.up || 0, row.down || 0, row.port);
      }

      const clientRows = xdb.prepare('SELECT email, up, down FROM client_traffics').all();
      for (const row of clientRows) {
        db.prepare('UPDATE clients SET up_bytes = ?, down_bytes = ? WHERE email = ?').run(row.up || 0, row.down || 0, row.email);
      }
      xdb.close();
      console.log('[Importer] Successfully imported historical traffic metrics from x-ui.db');
    }
  } catch (err) {
    console.error('[Importer] x-ui traffic stats import notice:', err.message);
  }
}

module.exports = {
  importExistingConfigs,
};
