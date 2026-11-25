/**
 * utils/tls-certs.js
 * TLS certificate resolution and self-signed X.509 certificate generator
 * for TLS-requiring VPN protocols (Hysteria 2, TUIC, Trojan, VLESS/VMess TLS).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const cfg = require('../config/app-config');
const Settings = require('../models/Settings');
const privileged = require('../services/privileged-client');

/**
 * Validate a domain, hostname, or IP string for safe use as CN / SAN.
 * Rejects spaces, slashes, quotes, shell metacharacters, and empty values.
 */
function isValidSniHost(value) {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 253) return false;
  if (net.isIP(trimmed)) return true;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(trimmed);
}

/**
 * Sanitize SNI into a safe filesystem slug.
 */
function sanitizeCertSlug(sni) {
  const clean = String(sni || 'localhost')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
    .replace(/\.{2,}/g, '.');
  return clean || 'localhost';
}

/**
 * Read live certificate paths from Settings DB, falling back to boot-time app-config.
 */
function getLiveCertSettings() {
  let certPath = '';
  let keyPath = '';
  try {
    certPath = (Settings.get('cert_fullchain', '') || '').trim();
    keyPath = (Settings.get('cert_privkey', '') || '').trim();
  } catch {
    // Settings DB may not be initialized in isolated unit tests
  }
  return {
    certPath: certPath || cfg.CERT_FULLCHAIN || '',
    keyPath: keyPath || cfg.CERT_PRIVKEY || '',
  };
}

/**
 * Directory where panel-managed self-signed certificates are stored.
 * Placed inside the panel data directory so the panel user can write and root-owned
 * sing-box / xray processes can read them.
 */
function getCertStorageDir() {
  const baseDir = path.dirname(cfg.DB_PATH || path.join(__dirname, '../../data/panel.db'));
  return path.join(baseDir, 'certs');
}

/**
 * Check if a path is directly readable by the current process.
 */
function isLocallyReadable(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate (or reuse if valid and non-expired) a self-signed ECDSA P-256 certificate
 * for the given SNI hostname or IP address.
 *
 * @param {string} [sni='localhost']
 * @returns {{ certificateFile: string, keyFile: string, sni: string }}
 */
function ensureSelfSignedCert(sni = 'localhost') {
  const rawHost = isValidSniHost(sni) ? sni.trim() : 'localhost';
  const slug = sanitizeCertSlug(rawHost);
  const certDir = getCertStorageDir();
  fs.mkdirSync(certDir, { recursive: true, mode: 0o750 });

  const certPath = path.join(certDir, `${slug}.crt`);
  const keyPath = path.join(certDir, `${slug}.key`);

  // Reuse existing certificate if both files exist and are non-empty
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const certStat = fs.statSync(certPath);
      const keyStat = fs.statSync(keyPath);
      // Regenerate if older than 300 days or empty
      const ageMs = Date.now() - certStat.mtimeMs;
      if (certStat.size > 100 && keyStat.size > 50 && ageMs < 300 * 24 * 60 * 60 * 1000) {
        return { certificateFile: certPath, keyFile: keyPath, sni: rawHost };
      }
    } catch {
      // Regenerate on stat error
    }
  }

  const sanType = net.isIP(rawHost) ? 'IP' : 'DNS';
  const tempCert = `${certPath}.${process.pid}.tmp`;
  const tempKey = `${keyPath}.${process.pid}.tmp`;

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey', 'ec',
        '-pkeyopt', 'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days', '3650',
        '-keyout', tempKey,
        '-out', tempCert,
        '-subj', `/CN=${rawHost}`,
        '-addext', `subjectAltName=${sanType}:${rawHost}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }
    );

    fs.chmodSync(tempKey, 0o640);
    fs.chmodSync(tempCert, 0o644);
    fs.renameSync(tempKey, keyPath);
    fs.renameSync(tempCert, certPath);
  } catch (err) {
    try { fs.unlinkSync(tempKey); } catch {}
    try { fs.unlinkSync(tempCert); } catch {}
    throw new Error(`Failed to generate self-signed TLS certificate for "${rawHost}": ${err.message}`);
  }

  return { certificateFile: certPath, keyFile: keyPath, sni: rawHost };
}

/**
 * Resolve a pair of TLS certificate and key paths for sing-box or Xray.
 *
 * Resolution order:
 * 1. If certMode === 'selfsigned', generate/reuse a self-signed cert matching serverName.
 * 2. Check explicit candidate paths (certificate_path / certificateFile / tlsSettings).
 *    - If locally readable, use them.
 *    - If privileged helper is active and path is an absolute path, pass it through so root-owned
 *      sing-box/xray validation checks it directly (handles /etc/letsencrypt/live/...).
 * 3. Check live Panel Settings (cert_fullchain / cert_privkey) and boot-time cfg.CERT_*.
 * 4. If allowSelfSignedFallback is true (default) and no cert exists anywhere,
 *    automatically generate a self-signed certificate for serverName so TLS protocols
 *    like Hysteria 2 / TUIC work out of the box without domain certs.
 *
 * @param {object} opts
 * @returns {{ certificateFile: string, keyFile: string, isSelfSigned: boolean }}
 */
function resolveTlsPair(opts = {}) {
  const {
    certificateFile = '',
    keyFile = '',
    certificate_path = '',
    key_path = '',
    tlsSettings = null,
    serverName = '',
    certMode = '',
    allowSelfSignedFallback = true,
  } = opts;

  const sni = isValidSniHost(serverName) ? serverName.trim() : 'localhost';

  if (certMode === 'selfsigned') {
    const generated = ensureSelfSignedCert(sni);
    return { ...generated, isSelfSigned: true };
  }

  const rawCert = (certificate_path || certificateFile || tlsSettings?.certificates?.[0]?.certificateFile || '').trim();
  const rawKey = (key_path || keyFile || tlsSettings?.certificates?.[0]?.keyFile || '').trim();

  const hasPrivileged = privileged.isConfigured();

  if (rawCert && rawKey) {
    if (isLocallyReadable(rawCert) && isLocallyReadable(rawKey)) {
      const isSelfSigned = rawCert.startsWith(getCertStorageDir());
      return { certificateFile: rawCert, keyFile: rawKey, isSelfSigned };
    }
    if (hasPrivileged && path.isAbsolute(rawCert) && path.isAbsolute(rawKey)) {
      return { certificateFile: rawCert, keyFile: rawKey, isSelfSigned: false };
    }
    if (certMode === 'letsencrypt' || certMode === 'custom') {
      throw new Error(`TLS certificate or key file not found or unreadable: "${rawCert}" / "${rawKey}"`);
    }
  } else if (certMode === 'letsencrypt' || certMode === 'custom') {
    throw new Error('Both certificate path and private key path are required for custom/Let\'s Encrypt mode');
  }

  // Fallback to live Panel Settings or boot-time defaults
  const live = getLiveCertSettings();
  if (live.certPath && live.keyPath) {
    if (isLocallyReadable(live.certPath) && isLocallyReadable(live.keyPath)) {
      return {
        certificateFile: live.certPath,
        keyFile: live.keyPath,
        isSelfSigned: live.certPath.startsWith(getCertStorageDir()),
      };
    }
    if (hasPrivileged && path.isAbsolute(live.certPath) && path.isAbsolute(live.keyPath)) {
      return { certificateFile: live.certPath, keyFile: live.keyPath, isSelfSigned: false };
    }
  }

  if (allowSelfSignedFallback) {
    const generated = ensureSelfSignedCert(sni);
    return { ...generated, isSelfSigned: true };
  }

  return { certificateFile: '', keyFile: '', isSelfSigned: false };
}

module.exports = {
  isValidSniHost,
  sanitizeCertSlug,
  getLiveCertSettings,
  getCertStorageDir,
  ensureSelfSignedCert,
  resolveTlsPair,
};
