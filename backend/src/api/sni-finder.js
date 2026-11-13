/**
 * api/sni-finder.js
 * API routes for Anti-Censorship SNI diagnostic finder and benchmarking.
 */

'use strict';

const express = require('express');
const router = express.Router();
const Joi = require('joi');
const Settings = require('../models/Settings');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const {
  CANDIDATE_SNIS,
  lookupIp,
  lookupServerIp,
  testSingleSni,
  getCandidates,
  runBatchBenchmark,
} = require('../services/sni-tester');

// Require authentication for all SNI finder routes
router.use(requireAuth);

const DOMAIN_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const benchmarkSchema = Joi.object({
  region: Joi.string().valid('AUTO', 'RU', 'IR', 'CN', 'GLOBAL', 'ALL').default('AUTO'),
  clientCountry: Joi.string().max(10).default('GLOBAL'),
  domains: Joi.array().items(
    Joi.alternatives().try(
      Joi.string().regex(DOMAIN_REGEX),
      Joi.object({
        domain: Joi.string().regex(DOMAIN_REGEX).required(),
        port: Joi.number().integer().min(1).max(65535).default(443),
        label: Joi.string().max(100).optional(),
        category: Joi.string().max(50).optional(),
        desc: Joi.string().max(255).optional(),
      })
    )
  ).max(30).optional(),
  concurrency: Joi.number().integer().min(1).max(8).default(4),
});

const testCustomSchema = Joi.object({
  domain: Joi.string().regex(DOMAIN_REGEX).required(),
  port: Joi.number().integer().min(1).max(65535).default(443),
});

/**
 * GET /api/sni-finder/locations
 * Returns geolocation & ISP info for both client and VPN server
 */
router.get('/locations', async (req, res) => {
  try {
    const rawClientIp = (
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.headers['x-real-ip'] ||
      req.socket.remoteAddress ||
      ''
    ).trim();

    const clientGeo = await lookupIp(rawClientIp);
    const serverGeo = await lookupServerIp(Settings.get('server_ip'));

    let suggestedRegion = 'GLOBAL';
    const cCode = clientGeo?.countryCode?.toUpperCase();
    if (['RU', 'BY', 'KZ'].includes(cCode)) {
      suggestedRegion = 'RU';
    } else if (['IR'].includes(cCode)) {
      suggestedRegion = 'IR';
    } else if (['CN', 'HK'].includes(cCode)) {
      suggestedRegion = 'CN';
    }

    return res.json({
      success: true,
      data: {
        client: clientGeo || { ip: rawClientIp, country: 'Unknown', countryCode: 'XX', isp: 'Unknown', isLocal: false },
        server: serverGeo || { ip: 'Unknown', country: 'Server', countryCode: 'XX', isp: 'Host', isLocal: false },
        suggestedRegion,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/sni-finder/candidates
 * Returns curated candidate SNIs filtered by target censorship region
 */
router.get('/candidates', (req, res) => {
  try {
    const region = (req.query.region || 'AUTO').toString().toUpperCase();
    const clientCountry = (req.query.clientCountry || 'GLOBAL').toString().toUpperCase();
    const candidates = getCandidates(region, clientCountry);

    return res.json({
      success: true,
      data: {
        region,
        clientCountry,
        count: candidates.length,
        candidates,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/sni-finder/benchmark
 * Runs parallel diagnostic tests across candidate or custom SNIs
 */
router.post('/benchmark', validateBody(benchmarkSchema), async (req, res) => {
  try {
    const { region, clientCountry, domains, concurrency } = req.body;

    let targets = domains;
    if (!targets || targets.length === 0) {
      targets = getCandidates(region, clientCountry);
    }

    if (!targets || targets.length === 0) {
      return res.status(400).json({ success: false, message: 'No SNI candidates available to benchmark' });
    }

    const results = await runBatchBenchmark(targets, concurrency);

    return res.json({
      success: true,
      data: {
        total: results.length,
        idealCount: results.filter((r) => r.rating === 'IDEAL').length,
        results,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/sni-finder/test-custom
 * Performs deep TLS 1.3 / ALPN / SAN diagnostic probe on a single user domain
 */
router.post('/test-custom', validateBody(testCustomSchema), async (req, res) => {
  try {
    const { domain, port } = req.body;
    const result = await testSingleSni(domain, port || 443);

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
