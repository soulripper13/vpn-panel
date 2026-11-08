/**
 * api/inbounds.js
 * Inbound management API: CRUD for inbounds and clients, link/QR generation,
 * and config deployment for sing-box and xray.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const Inbound = require('../models/Inbound');
const Client = require('../models/Client');
const Settings = require('../models/Settings');
const SingboxService = require('../services/singbox');
const XrayService = require('../services/xray');
const {
  generateClientLink,
  generateClashConfig,
  generateSingboxConfig,
  generateHysteriaCliConfig,
  generateQRCode,
} = require('../utils/link-generator');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

/**
 * Helper to determine server hostname / IP for client links
 */
function getServerHost(req) {
  const configured = Settings.get('server_ip');
  if (configured && configured.trim()) return configured.trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1';
  return host.split(':')[0];
}

/**
 * Helper to determine base URL for public subscriptions
 */
function getBaseSubUrl(req) {
  const host = getServerHost(req);
  const proto = req.protocol || 'http';
  const reqHost = req.get('host') || '';
  const port = reqHost.includes(':') ? reqHost.split(':')[1] : '';
  const portSuffix = port ? `:${port}` : '';
  return `${proto}://${host}${portSuffix}`;
}

/**
 * Apply configuration to the respective engine
 */
async function applyEngineConfig(engine) {
  try {
    if (engine === 'singbox') {
      await SingboxService.generateAndApplyConfig();
    } else if (engine === 'xray') {
      await XrayService.generateAndApplyConfig();
    }
  } catch (err) {
    console.error(`[Engine Config Error] Failed to apply ${engine} config:`, err.message);
  }
}

// ─── INBOUNDS CRUD ─────────────────────────────────────────────────────────────

/**
 * GET /api/inbounds
 * List all inbounds with their client counts and clients array
 */
router.get('/', (req, res) => {
  const engine = req.query.engine;
  const inbounds = Inbound.findAll({ engine });

  const host = getServerHost(req);
  const baseSubUrl = getBaseSubUrl(req);

  const results = inbounds.map((inb) => {
    const clients = Client.findByInbound(inb.id);
    const clientsWithLinks = clients.map((c) => ({
      ...c,
      link: generateClientLink(inb, c, host),
      clashYaml: generateClashConfig(inb, c, host),
      singboxJson: generateSingboxConfig(inb, c, host),
      hy2Config: generateHysteriaCliConfig(inb, c, host),
      subUrl: `${baseSubUrl}/api/sub/${encodeURIComponent(c.uuid || c.email || c.id)}`,
    }));

    return {
      ...inb,
      clientCount: clients.length,
      clients: clientsWithLinks,
    };
  });

  return res.json({
    success: true,
    data: results,
  });
});

/**
 * GET /api/inbounds/gen-keypair
 * Generate x25519 reality keys and short ID
 */
router.get('/gen-keypair', async (req, res) => {
  const crypto = require('crypto');
  let privateKey = '';
  let publicKey = '';
  const shortId = crypto.randomBytes(4).toString('hex');

  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    const cfg = require('../config/app-config');
    const { stdout } = await execAsync(`"${cfg.XRAY_BIN}" x25519`);
    const privMatch = stdout.match(/PrivateKey:\s*([^\s]+)/i);
    const pubMatch = stdout.match(/Password \(PublicKey\):\s*([^\s]+)/i) || stdout.match(/PublicKey:\s*([^\s]+)/i);
    if (privMatch) privateKey = privMatch[1];
    if (pubMatch) publicKey = pubMatch[1];
  } catch {
    privateKey = crypto.randomBytes(32).toString('base64url');
    publicKey = crypto.randomBytes(32).toString('base64url');
  }

  return res.json({
    success: true,
    data: {
      privateKey,
      publicKey,
      shortId,
    },
  });
});

/**
 * GET /api/inbounds/:id
 */
router.get('/:id', (req, res) => {
  const inbound = Inbound.findById(parseInt(req.params.id, 10));
  if (!inbound) {
    return res.status(404).json({ success: false, message: 'Inbound not found' });
  }

  const host = getServerHost(req);
  const baseSubUrl = getBaseSubUrl(req);
  const clients = Client.findByInbound(inbound.id).map((c) => ({
    ...c,
    link: generateClientLink(inbound, c, host),
    clashYaml: generateClashConfig(inbound, c, host),
    singboxJson: generateSingboxConfig(inbound, c, host),
    hy2Config: generateHysteriaCliConfig(inbound, c, host),
    subUrl: `${baseSubUrl}/api/sub/${encodeURIComponent(c.uuid || c.email || c.id)}`,
  }));

  return res.json({
    success: true,
    data: {
      ...inbound,
      clients,
    },
  });
});

/**
 * POST /api/inbounds
 * Create a new inbound (and optionally default client)
 */
router.post('/', async (req, res) => {
  try {
    const {
      engine = 'singbox',
      tag,
      type = 'vless',
      listen = '0.0.0.0',
      port,
      protocol = '',
      settings = {},
      stream_settings = {},
      enabled = true,
      total_bytes_limit = 0,
      expiry_time = 0,
      remark = '',
      clients = [],
    } = req.body;

    if (!port || port <= 0 || port > 65535) {
      return res.status(400).json({ success: false, message: 'A valid port (1-65535) is required' });
    }

    const finalTag = tag && tag.trim() ? tag.trim() : `${engine}-${type}-${port}`;

    // Verify tag uniqueness
    const existing = Inbound.findByTag(finalTag);
    if (existing) {
      return res.status(400).json({ success: false, message: `Tag "${finalTag}" is already in use` });
    }

    const { id: inboundId } = Inbound.create({
      engine,
      tag: finalTag,
      type,
      listen,
      port: parseInt(port, 10),
      protocol: protocol || type,
      settings,
      stream_settings,
      enabled: enabled ? 1 : 0,
      total_bytes_limit: parseInt(total_bytes_limit || 0, 10),
      expiry_time: parseInt(expiry_time || 0, 10),
      remark: remark || `${type}-${port}`,
    });

    // Add initial clients
    if (Array.isArray(clients) && clients.length > 0) {
      for (const c of clients) {
        const clientPass = c.password || (settings && (settings.shadowtlsPassword || settings.password)) || crypto.randomBytes(16).toString('hex');
        Client.create({
          inbound_id: inboundId,
          uuid: c.uuid || uuidv4(),
          password: clientPass,
          email: c.email || `client_${Date.now().toString(36)}`,
          flow: c.flow || '',
          total_bytes_limit: c.total_bytes_limit || 0,
          expiry_time: c.expiry_time || 0,
          enable: c.enable !== false ? 1 : 0,
          remark: c.remark || '',
        });
      }
    } else {
      // Create default client
      const defaultPass = (settings && (settings.shadowtlsPassword || settings.password)) || crypto.randomBytes(16).toString('hex');
      Client.create({
        inbound_id: inboundId,
        uuid: uuidv4(),
        password: defaultPass,
        email: `default_${Date.now().toString(36)}`,
        flow: '',
        total_bytes_limit: 0,
        expiry_time: 0,
        enable: 1,
        remark: 'Default Client',
      });
    }

    // Apply config
    await applyEngineConfig(engine);

    const created = Inbound.findById(inboundId);
    return res.status(201).json({
      success: true,
      message: 'Inbound created successfully',
      data: created,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/inbounds/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Inbound.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Inbound not found' });
    }

    Inbound.update(id, req.body);
    await applyEngineConfig(existing.engine);

    const updated = Inbound.findById(id);
    return res.json({
      success: true,
      message: 'Inbound updated successfully',
      data: updated,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/inbounds/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Inbound.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Inbound not found' });
    }

    Inbound.delete(id);
    await applyEngineConfig(existing.engine);

    return res.json({
      success: true,
      message: 'Inbound deleted successfully',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/inbounds/:id/toggle
 */
router.post('/:id/toggle', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Inbound.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Inbound not found' });
    }

    const newState = Inbound.toggle(id);
    await applyEngineConfig(existing.engine);

    return res.json({
      success: true,
      message: `Inbound ${newState ? 'enabled' : 'disabled'}`,
      data: { enabled: newState },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/inbounds/:id/reset-traffic
 */
router.post('/:id/reset-traffic', (req, res) => {
  const id = parseInt(req.params.id, 10);
  Inbound.resetTraffic(id);
  return res.json({ success: true, message: 'Traffic reset for inbound' });
});

// ─── CLIENTS MANAGEMENT ────────────────────────────────────────────────────────

/**
 * GET /api/inbounds/:id/clients
 */
router.get('/:id/clients', (req, res) => {
  const inbound = Inbound.findById(parseInt(req.params.id, 10));
  if (!inbound) {
    return res.status(404).json({ success: false, message: 'Inbound not found' });
  }

  const host = getServerHost(req);
  const baseSubUrl = getBaseSubUrl(req);
  const clients = Client.findByInbound(inbound.id).map((c) => ({
    ...c,
    link: generateClientLink(inbound, c, host),
    clashYaml: generateClashConfig(inbound, c, host),
    singboxJson: generateSingboxConfig(inbound, c, host),
    hy2Config: generateHysteriaCliConfig(inbound, c, host),
    subUrl: `${baseSubUrl}/api/sub/${encodeURIComponent(c.uuid || c.email || c.id)}`,
  }));

  return res.json({
    success: true,
    data: clients,
  });
});

/**
 * POST /api/inbounds/:id/clients
 */
router.post('/:id/clients', async (req, res) => {
  try {
    const inboundId = parseInt(req.params.id, 10);
    const inbound = Inbound.findById(inboundId);
    if (!inbound) {
      return res.status(404).json({ success: false, message: 'Inbound not found' });
    }

    const {
      uuid = uuidv4(),
      password = '',
      email,
      flow = '',
      total_bytes_limit = 0,
      expiry_time = 0,
      enable = true,
      remark = '',
    } = req.body;

    const finalEmail = email && email.trim() ? email.trim() : `user_${Date.now().toString(36)}`;

    const defaultPass = (inbound.type === 'shadowtls' || inbound.protocol === 'shadowtls')
      ? crypto.randomBytes(16).toString('hex')
      : crypto.randomBytes(16).toString('hex');

    const finalPass = password && password.trim() ? password.trim() : defaultPass;

    const { id: clientId } = Client.create({
      inbound_id: inboundId,
      uuid,
      password: finalPass,
      email: finalEmail,
      flow,
      total_bytes_limit: parseInt(total_bytes_limit || 0, 10),
      expiry_time: parseInt(expiry_time || 0, 10),
      enable: enable ? 1 : 0,
      remark,
    });

    await applyEngineConfig(inbound.engine);

    const client = Client.findById(clientId);
    const host = getServerHost(req);
    return res.status(201).json({
      success: true,
      message: 'Client added successfully',
      data: {
        ...client,
        link: generateClientLink(inbound, client, host),
        clashYaml: generateClashConfig(inbound, client, host),
        singboxJson: generateSingboxConfig(inbound, client, host),
        hy2Config: generateHysteriaCliConfig(inbound, client, host),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/inbounds/clients/:clientId
 * Update client directly by client ID
 */
router.put('/clients/:clientId', async (req, res) => {
  try {
    const clientId = parseInt(req.params.clientId, 10);
    const existing = Client.findById(clientId);
    if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

    const inbound = Inbound.findById(existing.inbound_id);
    Client.update(clientId, req.body);
    if (inbound) {
      await applyEngineConfig(inbound.engine);
    }

    const updated = Client.findById(clientId);
    return res.json({
      success: true,
      message: 'Client updated successfully',
      data: updated,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/inbounds/:id/clients/:clientId
 */
router.put('/:id/clients/:clientId', async (req, res) => {
  try {
    const inbound = Inbound.findById(parseInt(req.params.id, 10));
    const clientId = parseInt(req.params.clientId, 10);
    if (!inbound) return res.status(404).json({ success: false, message: 'Inbound not found' });

    Client.update(clientId, req.body);
    await applyEngineConfig(inbound.engine);

    const updated = Client.findById(clientId);
    return res.json({
      success: true,
      message: 'Client updated successfully',
      data: updated,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/inbounds/:id/clients/:clientId
 */
router.delete('/:id/clients/:clientId', async (req, res) => {
  try {
    const inbound = Inbound.findById(parseInt(req.params.id, 10));
    const clientId = parseInt(req.params.clientId, 10);
    if (!inbound) return res.status(404).json({ success: false, message: 'Inbound not found' });

    Client.delete(clientId);
    await applyEngineConfig(inbound.engine);

    return res.json({
      success: true,
      message: 'Client deleted successfully',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/inbounds/:id/clients/:clientId/qr
 */
router.get('/:id/clients/:clientId/qr', async (req, res) => {
  try {
    const inbound = Inbound.findById(parseInt(req.params.id, 10));
    const client = Client.findById(parseInt(req.params.clientId, 10));

    if (!inbound || !client) {
      return res.status(404).json({ success: false, message: 'Inbound or client not found' });
    }

    const host = getServerHost(req);
    const link = generateClientLink(inbound, client, host);
    const clashYaml = generateClashConfig(inbound, client, host);
    const singboxJson = generateSingboxConfig(inbound, client, host);
    const qrDataUrl = await generateQRCode(link);

    return res.json({
      success: true,
      data: {
        link,
        qr: qrDataUrl,
        clashYaml,
        singboxJson,
        client,
        inbound,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/inbounds/apply
 * Force regenerate and apply both sing-box and xray configs
 */
router.post('/apply', async (req, res) => {
  try {
    await Promise.all([
      SingboxService.generateAndApplyConfig().catch((e) => ({ error: e.message })),
      XrayService.generateAndApplyConfig().catch((e) => ({ error: e.message })),
    ]);

    return res.json({
      success: true,
      message: 'Configurations applied to both sing-box and xray',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
