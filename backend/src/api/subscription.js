/**
 * api/subscription.js
 * Public subscription endpoint for VPN clients:
 * - Shadowrocket (fetches Clash Meta YAML with full Shadow-TLS plugin parameters)
 * - Clash Meta / Mihomo / Stash
 * - Sing-box / SagerNet
 * - Universal Base64 clients (v2rayN, Streisand, etc.)
 */

'use strict';

const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Inbound = require('../models/Inbound');
const Settings = require('../models/Settings');
const {
  generateClashProxy,
  generateClashSubscription,
  generateSingboxSubscription,
  generateBase64Subscription,
  generateQRCodeBuffer,
} = require('../utils/link-generator');

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
 * Handle subscription feed generation for a given token
 */
async function handleSubscription(req, res, token) {
  const host = getServerHost(req);
  const clients = Client.findByToken(token);

  if (!clients || clients.length === 0) {
    return res.status(404).type('text/plain').send('Subscription not found or has been disabled.');
  }

  // Filter and collect active client + inbound pairs
  const items = [];
  let totalUp = 0;
  let totalDown = 0;
  let maxLimit = 0;
  let minExpire = 0;
  let profileName = 'VPN';

  const now = Date.now();

  for (const c of clients) {
    if (c.enable === 0) continue;
    const inb = Inbound.findById(c.inbound_id);
    if (!inb || inb.enable === 0) continue;

    // Check expiry
    const expiry = parseInt(c.expiry_time || 0, 10);
    if (expiry > 0) {
      const expiryMs = expiry > 10000000000 ? expiry : expiry * 1000;
      if (now > expiryMs) {
        continue; // Expired
      }
      if (minExpire === 0 || expiryMs < minExpire) {
        minExpire = expiryMs;
      }
    }

    // Check traffic limit
    const limit = parseInt(c.total_bytes_limit || 0, 10);
    const used = (c.up_bytes || 0) + (c.down_bytes || 0);
    if (limit > 0 && used >= limit) {
      continue; // Limit reached
    }

    totalUp += (c.up_bytes || 0);
    totalDown += (c.down_bytes || 0);
    if (limit > maxLimit) maxLimit = limit;
    if (c.remark || c.email) profileName = c.remark || c.email;

    items.push({ client: c, inbound: inb });
  }

  if (items.length === 0) {
    return res.status(403).type('text/plain').send('Subscription is expired or data limit exceeded.');
  }

  // Set standard subscription headers for Clash, Shadowrocket, etc.
  const expireSec = minExpire > 0 ? Math.floor(minExpire / 1000) : 0;
  res.setHeader('Subscription-Userinfo', `upload=${totalUp}; download=${totalDown}; total=${maxLimit}; expire=${expireSec}`);
  res.setHeader('Profile-Update-Interval', '24');
  res.setHeader('Profile-Title', encodeURIComponent(profileName));
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Detect requested format
  const formatQuery = (req.query.format || '').toLowerCase();
  const ua = (req.headers['user-agent'] || '').toLowerCase();

  const isClashFormat = formatQuery === 'clash' ||
    formatQuery === 'meta' ||
    formatQuery === 'mihomo' ||
    formatQuery === 'yaml' ||
    /(shadowrocket|clash|mihomo|stash|surge|loon)/i.test(ua);

  const isSingboxFormat = formatQuery === 'singbox' ||
    formatQuery === 'json' ||
    /(sing-box|sagernet|matsuri)/i.test(ua);

  if (isClashFormat) {
    // Generate Clash Meta YAML (Shadowrocket natively parses this format including shadow-tls plugin)
    const proxyList = items.map((item) => generateClashProxy(item.inbound, item.client, host)).filter(Boolean);
    const yamlContent = generateClashSubscription(proxyList, profileName);

    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(profileName)}.yaml"`);
    return res.send(yamlContent);
  }

  if (isSingboxFormat) {
    // Generate Sing-box client JSON
    const jsonContent = generateSingboxSubscription(items, host);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(profileName)}.json"`);
    return res.send(jsonContent);
  }

  // Default: Base64 links (works in v2rayN, Shadowrocket, Streisand, etc.)
  const base64Content = generateBase64Subscription(items, host);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(profileName)}.txt"`);
  return res.send(base64Content);
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

/**
 * GET /api/sub/qr/:token
 * Generates QR code image directly
 */
router.get('/qr/:token', async (req, res) => {
  try {
    const proto = req.protocol || 'http';
    const host = req.get('host') || '127.0.0.1';
    const format = req.query.format ? `?format=${encodeURIComponent(req.query.format)}` : '?format=clash';
    const subUrl = `${proto}://${host}/api/sub/${encodeURIComponent(req.params.token)}${format}`;

    const qrBuffer = await generateQRCodeBuffer(subUrl);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(qrBuffer);
  } catch (err) {
    return res.status(500).type('text/plain').send(`Failed to generate QR code: ${err.message}`);
  }
});

/**
 * GET /api/sub/inbound/:id
 * Subscriptions for an entire inbound
 */
router.get('/inbound/:id', async (req, res) => {
  return handleSubscription(req, res, `inbound:${req.params.id}`);
});

/**
 * GET /api/sub/:token
 * Primary subscription endpoint (UUID, email, or client ID)
 */
router.get('/:token', async (req, res) => {
  return handleSubscription(req, res, req.params.token);
});

module.exports = router;
