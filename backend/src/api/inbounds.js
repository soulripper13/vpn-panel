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
const Joi = require('joi');
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
const { requireAuth, requireAdminForMutations, requireAdmin } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);
router.use(requireAdminForMutations);

// ─── Validation Schemas (H3) ──────────────────────────────────────────────────

const createInboundSchema = Joi.object({
  engine: Joi.string().valid('singbox', 'xray').required(),
  tag: Joi.string().trim().max(64).allow('').optional(),
  type: Joi.string().trim().max(32).required(),
  listen: Joi.string().trim().max(64).default('0.0.0.0'),
  port: Joi.number().integer().min(1).max(65535).required(),
  protocol: Joi.string().trim().max(32).allow('').optional(),
  settings: Joi.object().optional(),
  stream_settings: Joi.object().optional(),
  enabled: Joi.boolean().default(true),
  total_bytes_limit: Joi.number().integer().min(0).default(0),
  expiry_time: Joi.number().integer().min(0).default(0),
  remark: Joi.string().trim().max(128).allow('').default(''),
  clients: Joi.array().items(Joi.object()).optional(),
});

const updateInboundSchema = Joi.object({
  tag: Joi.string().trim().max(64).optional(),
  type: Joi.string().trim().max(32).optional(),
  listen: Joi.string().trim().max(64).optional(),
  port: Joi.number().integer().min(1).max(65535).optional(),
  protocol: Joi.string().trim().max(32).allow('').optional(),
  settings: Joi.object().optional(),
  stream_settings: Joi.object().optional(),
  enabled: Joi.boolean().optional(),
  total_bytes_limit: Joi.number().integer().min(0).optional(),
  expiry_time: Joi.number().integer().min(0).optional(),
  remark: Joi.string().trim().max(128).allow('').optional(),
});

const clientSchema = Joi.object({
  email: Joi.string().trim().max(128).allow('').optional(),
  uuid: Joi.string().trim().max(64).allow('').optional(),
  password: Joi.string().trim().max(128).allow('').optional(),
  flow: Joi.string().trim().max(64).allow('').optional(),
  total_bytes_limit: Joi.number().integer().min(0).default(0),
  expiry_time: Joi.number().integer().min(0).default(0),
  enable: Joi.boolean().default(true),
  remark: Joi.string().trim().max(128).allow('').default(''),
});

const updateClientSchema = Joi.object({
  email: Joi.string().trim().max(128).allow('').optional(),
  uuid: Joi.string().trim().max(64).allow('').optional(),
  password: Joi.string().trim().max(128).allow('').optional(),
  flow: Joi.string().trim().max(64).allow('').optional(),
  total_bytes_limit: Joi.number().integer().min(0).optional(),
  expiry_time: Joi.number().integer().min(0).optional(),
  enable: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).optional(),
  remark: Joi.string().trim().max(128).allow('').optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getServerHost(req) {
  const configured = Settings.get('server_ip');
  if (configured && configured.trim()) return configured.trim();
  const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1').split(':')[0].trim();
  if (/^[a-zA-Z0-9.-]+$/.test(rawHost)) return rawHost;
  return '127.0.0.1';
}

function getBaseSubUrl(req) {
  const host = getServerHost(req);
  const proto = req.protocol || 'http';
  const reqHost = req.get('host') || '';
  const port = reqHost.includes(':') ? reqHost.split(':')[1] : '';
  const portSuffix = port ? `:${port}` : '';
  return `${proto}://${host}${portSuffix}`;
}

/**
 * Validates that client belongs to inbound (H3 IDOR protection)
 */
function getInboundAndClient(inboundId, clientId) {
  const inb = Inbound.findById(parseInt(inboundId, 10));
  if (!inb) return null;
  const c = Client.findById(parseInt(clientId, 10));
  if (!c || c.inbound_id !== inb.id) return null;
  return { inbound: inb, client: c };
}

/**
 * Apply configuration to the respective engine with error capture
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
    throw err;
  }
}

// ─── INBOUNDS CRUD ─────────────────────────────────────────────────────────────

/**
 * GET /api/inbounds
 * List all inbounds with redacted client credentials (H1)
 */
router.get('/', (req, res) => {
  const engine = req.query.engine;
  const inbounds = Inbound.findAll({ engine });

  const results = inbounds.map((inb) => {
    const clients = Client.findByInbound(inb.id);
    const safeClients = clients.map((c) => Client.toSafeObject(c, false));

    return {
      ...inb,
      clientCount: clients.length,
      clients: safeClients,
    };
  });

  return res.json({
    success: true,
    data: results,
  });
});

/**
 * GET /api/inbounds/gen-keypair
 * Generate cryptographically valid x25519 reality keys and short ID (M5)
 */
router.get('/gen-keypair', (req, res) => {
  try {
    const keyPair = crypto.generateKeyPairSync('x25519');
    const privDer = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' });
    const rawPrivate = privDer.subarray(-32);

    const pubDer = keyPair.publicKey.export({ type: 'spki', format: 'der' });
    const rawPublic = pubDer.subarray(-32);

    const privateKey = rawPrivate.toString('base64url');
    const publicKey = rawPublic.toString('base64url');
    const shortId = crypto.randomBytes(4).toString('hex');

    return res.json({
      success: true,
      data: {
        privateKey,
        publicKey,
        shortId,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to generate Reality keypair: ' + err.message });
  }
});

/**
 * GET /api/inbounds/:id
 * Get single inbound with redacted client secrets (H1)
 */
router.get('/:id', (req, res) => {
  const inbound = Inbound.findById(parseInt(req.params.id, 10));
  if (!inbound) {
    return res.status(404).json({ success: false, message: 'Inbound not found' });
  }

  const clients = Client.findByInbound(inbound.id).map((c) => Client.toSafeObject(c, false));

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
router.post('/', validateBody(createInboundSchema), async (req, res) => {
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

    const finalTag = tag && tag.trim() ? tag.trim() : `${engine}-${type}-${port}`;

    const existing = Inbound.findByTag(finalTag);
    if (existing) {
      return res.status(400).json({ success: false, message: `Tag "${finalTag}" is already in use` });
    }

    const { id: inboundId } = Inbound.create({
      engine,
      tag: finalTag,
      type,
      listen,
      port,
      protocol: protocol || type,
      settings_json: typeof settings === 'string' ? settings : JSON.stringify(settings),
      stream_settings_json: typeof stream_settings === 'string' ? stream_settings : JSON.stringify(stream_settings),
      enabled: enabled ? 1 : 0,
      total_bytes_limit: parseInt(total_bytes_limit || 0, 10),
      expiry_time: parseInt(expiry_time || 0, 10),
      remark,
    });

    let createdClientInfo = null;
    if (Array.isArray(clients) && clients.length > 0) {
      for (const c of clients) {
        const clientRes = Client.create({
          inbound_id: inboundId,
          uuid: c.uuid || uuidv4(),
          password: c.password || crypto.randomBytes(16).toString('hex'),
          email: c.email || `client_${inboundId}_${Date.now().toString(36)}`,
          flow: c.flow || '',
          total_bytes_limit: c.total_bytes_limit || 0,
          expiry_time: c.expiry_time || 0,
          enable: c.enable !== false ? 1 : 0,
          remark: c.remark || '',
        });
        if (!createdClientInfo) createdClientInfo = clientRes;
      }
    } else {
      createdClientInfo = Client.create({
        inbound_id: inboundId,
        uuid: uuidv4(),
        password: crypto.randomBytes(16).toString('hex'),
        email: `default_${inboundId}`,
        flow: (type === 'vless' && (stream_settings.security === 'reality' || settings.reality)) ? 'xtls-rprx-vision' : '',
        enable: 1,
        remark: 'Default Client',
      });
    }

    await applyEngineConfig(engine);

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'create_inbound',
      target: `inbound:${inboundId}`,
      details: { tag: finalTag, engine, port, type },
      status: 'success',
    });

    const inbound = Inbound.findById(inboundId);
    const createdClients = Client.findByInbound(inboundId).map((c) => Client.toSafeObject(c, false));

    const baseSubUrl = getBaseSubUrl(req);
    return res.status(201).json({
      success: true,
      message: 'Inbound created successfully',
      data: {
        ...inbound,
        clients: createdClients,
        initialSubUrl: createdClientInfo ? `${baseSubUrl}/api/sub/${createdClientInfo.rawSubToken}` : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/inbounds/:id
 */
router.put('/:id', validateBody(updateInboundSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Inbound.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Inbound not found' });
    }

    const updatePayload = { ...req.body };
    if (updatePayload.settings && typeof updatePayload.settings !== 'string') {
      updatePayload.settings_json = JSON.stringify(updatePayload.settings);
      delete updatePayload.settings;
    }
    if (updatePayload.stream_settings && typeof updatePayload.stream_settings !== 'string') {
      updatePayload.stream_settings_json = JSON.stringify(updatePayload.stream_settings);
      delete updatePayload.stream_settings;
    }
    if (updatePayload.enabled !== undefined) {
      updatePayload.enabled = updatePayload.enabled ? 1 : 0;
    }

    Inbound.update(id, updatePayload);
    await applyEngineConfig(existing.engine);

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'update_inbound',
      target: `inbound:${id}`,
      details: Object.keys(req.body).join(', '),
      status: 'success',
    });

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

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'delete_inbound',
      target: `inbound:${id}`,
      details: { tag: existing.tag, port: existing.port },
      status: 'success',
    });

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

    const newEnabled = existing.enabled === 1 ? 0 : 1;
    Inbound.update(id, { enabled: newEnabled });
    await applyEngineConfig(existing.engine);

    return res.json({
      success: true,
      message: `Inbound ${newEnabled ? 'enabled' : 'disabled'}`,
      data: { enabled: newEnabled },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/inbounds/:id/reset-traffic
 */
router.post('/:id/reset-traffic', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = Inbound.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Inbound not found' });
    }

    Inbound.resetTraffic(id);
    const clients = Client.findByInbound(id);
    for (const c of clients) {
      Client.resetTraffic(c.id);
    }

    return res.json({
      success: true,
      message: 'Traffic reset for inbound and all its clients',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CLIENTS CRUD (Scoped with IDOR Protection, H3) ──────────────────────────

/**
 * POST /api/inbounds/:id/clients
 */
router.post('/:id/clients', validateBody(clientSchema), async (req, res) => {
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
    const finalPass = password && password.trim() ? password.trim() : crypto.randomBytes(16).toString('hex');

    const { id: clientId, rawSubToken } = Client.create({
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

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'create_client',
      target: `client:${clientId}`,
      details: { inboundId, email: finalEmail },
      status: 'success',
    });

    const client = Client.findById(clientId);
    const host = getServerHost(req);
    const baseSubUrl = getBaseSubUrl(req);

    return res.status(201).json({
      success: true,
      message: 'Client added successfully',
      data: {
        ...Client.toSafeObject(client, false),
        rawSubToken,
        subUrl: `${baseSubUrl}/api/sub/${rawSubToken}`,
        link: generateClientLink(inbound, client, host),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/inbounds/:id/clients/:clientId
 * Scoped client update with IDOR check (H3)
 */
router.put('/:id/clients/:clientId', validateBody(updateClientSchema), async (req, res) => {
  try {
    const pair = getInboundAndClient(req.params.id, req.params.clientId);
    if (!pair) {
      return res.status(404).json({ success: false, message: 'Inbound or client not found' });
    }

    const { inbound, client } = pair;
    const updateData = { ...req.body };
    if (updateData.enable !== undefined) {
      updateData.enable = Boolean(updateData.enable);
    }

    Client.update(client.id, updateData);
    await applyEngineConfig(inbound.engine);

    const updated = Client.findById(client.id);
    return res.json({
      success: true,
      message: 'Client updated successfully',
      data: Client.toSafeObject(updated, false),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/inbounds/:id/clients/:clientId
 * Scoped client delete with IDOR check (H3)
 */
router.delete('/:id/clients/:clientId', async (req, res) => {
  try {
    const pair = getInboundAndClient(req.params.id, req.params.clientId);
    if (!pair) {
      return res.status(404).json({ success: false, message: 'Inbound or client not found' });
    }

    const { inbound, client } = pair;
    Client.delete(client.id);
    await applyEngineConfig(inbound.engine);

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'delete_client',
      target: `client:${client.id}`,
      details: { inboundId: inbound.id, email: client.email },
      status: 'success',
    });

    return res.json({
      success: true,
      message: 'Client deleted successfully',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/inbounds/:id/clients/:clientId/reveal
 * Reveal unmasked credentials and export links on explicit admin action (H1, H3)
 */
router.post('/:id/clients/:clientId/reveal', requireAdmin, async (req, res) => {
  try {
    const pair = getInboundAndClient(req.params.id, req.params.clientId);
    if (!pair) {
      return res.status(404).json({ success: false, message: 'Inbound or client not found' });
    }

    const { inbound, client } = pair;
    const host = getServerHost(req);

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'reveal_client_credentials',
      target: `client:${client.id}`,
      details: { email: client.email },
      status: 'success',
    });

    return res.json({
      success: true,
      data: {
        ...Client.toSafeObject(client, true),
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
 * POST /api/inbounds/:id/clients/:clientId/rotate-sub-token
 * Rotates subscription token and returns new high-entropy token once (C1, H3)
 */
router.post('/:id/clients/:clientId/rotate-sub-token', requireAdmin, async (req, res) => {
  try {
    const pair = getInboundAndClient(req.params.id, req.params.clientId);
    if (!pair) {
      return res.status(404).json({ success: false, message: 'Inbound or client not found' });
    }

    const { client } = pair;
    const newRawToken = Client.rotateSubToken(client.id);
    const baseSubUrl = getBaseSubUrl(req);

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'rotate_sub_token',
      target: `client:${client.id}`,
      details: { email: client.email },
      status: 'success',
    });

    return res.json({
      success: true,
      message: 'Subscription token rotated successfully',
      data: {
        rawSubToken: newRawToken,
        subUrl: `${baseSubUrl}/api/sub/${newRawToken}`,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/inbounds/:id/clients/:clientId/qr
 * Authenticated QR retrieval with IDOR check
 */
router.get('/:id/clients/:clientId/qr', async (req, res) => {
  try {
    const pair = getInboundAndClient(req.params.id, req.params.clientId);
    if (!pair) {
      return res.status(404).json({ success: false, message: 'Inbound or client not found' });
    }

    const { inbound, client } = pair;
    const host = getServerHost(req);
    const link = generateClientLink(inbound, client, host);
    const qrDataUrl = await generateQRCode(link);

    return res.json({
      success: true,
      data: {
        link,
        qr: qrDataUrl,
        client: Client.toSafeObject(client, false),
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
router.post('/apply', requireAdmin, async (req, res) => {
  try {
    await Promise.all([
      SingboxService.generateAndApplyConfig(),
      XrayService.generateAndApplyConfig(),
    ]);

    logAudit({
      userId: req.session.user.id,
      username: req.session.user.username,
      ip: req.ip || '127.0.0.1',
      action: 'force_apply_configs',
      target: 'engines',
      details: 'Manual apply triggered',
      status: 'success',
    });

    return res.json({
      success: true,
      message: 'Configurations applied to both sing-box and xray',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to apply configuration: ' + err.message });
  }
});

module.exports = router;
