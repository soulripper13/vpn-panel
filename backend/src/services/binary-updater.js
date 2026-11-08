/**
 * services/binary-updater.js
 * Checks GitHub for the latest core releases and performs in-place binary updates
 * for sing-box and Xray-core with safety verification and service restarts.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');
const util = require('util');
const https = require('https');
const cfg = require('../config/app-config');
const SingboxService = require('./singbox');
const XrayService = require('./xray');

const execAsync = util.promisify(exec);

// Cache release info for 5 minutes
const cache = {
  singbox: { data: null, timestamp: 0 },
  xray: { data: null, timestamp: 0 },
};
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch JSON from URL using HTTPS with redirect support
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'vpn-panel-updater',
        Accept: 'application/vnd.github.v3+json',
      },
    };

    const req = https.get(url, opts, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout fetching release info'));
    });
  });
}

/**
 * Download file to target destination
 */
async function downloadFile(url, destPath) {
  // Use curl with redirect support
  const cmd = `curl -sSL --connect-timeout 15 -o "${destPath}" "${url}"`;
  await execAsync(cmd);
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) {
    throw new Error('Downloaded file is missing or too small');
  }
}

/**
 * Detect normalized CPU architecture
 */
function getNormalizedArch() {
  const arch = os.arch();
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
  if (arch === 'arm') return 'armv7';
  return 'amd64';
}

class BinaryUpdaterService {
  /**
   * Check latest release for sing-box from SagerNet/sing-box
   */
  static async checkSingboxRelease() {
    const now = Date.now();
    if (cache.singbox.data && (now - cache.singbox.timestamp < CACHE_TTL_MS)) {
      return cache.singbox.data;
    }

    try {
      const release = await fetchJson('https://api.github.com/repos/SagerNet/sing-box/releases/latest');
      const tag = release.tag_name || '';
      const version = tag.replace(/^v/, '');

      const result = {
        version,
        tagName: tag,
        name: release.name || tag,
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        assets: (release.assets || []).map((a) => ({
          name: a.name,
          url: a.browser_download_url,
          size: a.size,
        })),
      };

      cache.singbox = { data: result, timestamp: now };
      return result;
    } catch (err) {
      // Fallback: curl github api
      try {
        const { stdout } = await execAsync('curl -sL --connect-timeout 5 https://api.github.com/repos/SagerNet/sing-box/releases/latest');
        const release = JSON.parse(stdout);
        const tag = release.tag_name || '';
        const version = tag.replace(/^v/, '');
        const result = {
          version,
          tagName: tag,
          name: release.name || tag,
          publishedAt: release.published_at,
          htmlUrl: release.html_url,
          assets: (release.assets || []).map((a) => ({
            name: a.name,
            url: a.browser_download_url,
            size: a.size,
          })),
        };
        cache.singbox = { data: result, timestamp: now };
        return result;
      } catch (fallbackErr) {
        throw new Error(`Failed to check sing-box releases: ${err.message}`);
      }
    }
  }

  /**
   * Check latest release for Xray-core from XTLS/Xray-core
   */
  static async checkXrayRelease() {
    const now = Date.now();
    if (cache.xray.data && (now - cache.xray.timestamp < CACHE_TTL_MS)) {
      return cache.xray.data;
    }

    try {
      const release = await fetchJson('https://api.github.com/repos/XTLS/Xray-core/releases/latest');
      const tag = release.tag_name || '';
      const version = tag.replace(/^v/, '');

      const result = {
        version,
        tagName: tag,
        name: release.name || tag,
        publishedAt: release.published_at,
        htmlUrl: release.html_url,
        assets: (release.assets || []).map((a) => ({
          name: a.name,
          url: a.browser_download_url,
          size: a.size,
        })),
      };

      cache.xray = { data: result, timestamp: now };
      return result;
    } catch (err) {
      try {
        const { stdout } = await execAsync('curl -sL --connect-timeout 5 https://api.github.com/repos/XTLS/Xray-core/releases/latest');
        const release = JSON.parse(stdout);
        const tag = release.tag_name || '';
        const version = tag.replace(/^v/, '');
        const result = {
          version,
          tagName: tag,
          name: release.name || tag,
          publishedAt: release.published_at,
          htmlUrl: release.html_url,
          assets: (release.assets || []).map((a) => ({
            name: a.name,
            url: a.browser_download_url,
            size: a.size,
          })),
        };
        cache.xray = { data: result, timestamp: now };
        return result;
      } catch (fallbackErr) {
        throw new Error(`Failed to check Xray releases: ${err.message}`);
      }
    }
  }

  /**
   * Get updates status for both engines
   */
  static async getUpdatesStatus() {
    const singboxStatus = await SingboxService.getStatus();
    const xrayStatus = await XrayService.getStatus();

    let singboxRelease = null;
    let xrayRelease = null;
    let singboxError = null;
    let xrayError = null;

    try {
      singboxRelease = await BinaryUpdaterService.checkSingboxRelease();
    } catch (e) {
      singboxError = e.message;
    }

    try {
      xrayRelease = await BinaryUpdaterService.checkXrayRelease();
    } catch (e) {
      xrayError = e.message;
    }

    const curSingboxVer = (singboxStatus.version || '').replace(/^v/, '');
    const latestSingboxVer = singboxRelease?.version || '';
    const hasSingboxUpdate = Boolean(latestSingboxVer && curSingboxVer && latestSingboxVer !== curSingboxVer);

    const curXrayVer = (xrayStatus.version || '').replace(/^v/, '');
    const latestXrayVer = xrayRelease?.version || '';
    const hasXrayUpdate = Boolean(latestXrayVer && curXrayVer && latestXrayVer !== curXrayVer);

    let panelStatus = null;
    try {
      const PanelUpdaterService = require('./panel-updater');
      panelStatus = await PanelUpdaterService.getStatus();
    } catch (e) {
      panelStatus = { error: e.message };
    }

    return {
      panel: panelStatus,
      singbox: {
        currentVersion: singboxStatus.version,
        latestVersion: latestSingboxVer || 'unknown',
        hasUpdate: hasSingboxUpdate,
        releaseUrl: singboxRelease?.htmlUrl || 'https://github.com/SagerNet/sing-box/releases',
        error: singboxError,
      },
      xray: {
        currentVersion: xrayStatus.version,
        latestVersion: latestXrayVer || 'unknown',
        hasUpdate: hasXrayUpdate,
        releaseUrl: xrayRelease?.htmlUrl || 'https://github.com/XTLS/Xray-core/releases',
        error: xrayError,
      },
    };
  }

  /**
   * Update sing-box binary in-place
   */
  static async updateSingbox(targetVersion = null) {
    const release = await BinaryUpdaterService.checkSingboxRelease();
    const version = targetVersion || release.version;
    const arch = getNormalizedArch();

    // Look for matching asset: sing-box-<version>-linux-<arch>.tar.gz
    const asset = release.assets.find((a) => {
      const name = a.name.toLowerCase();
      return name.includes('linux') && name.includes(arch) && name.endsWith('.tar.gz');
    });

    if (!asset) {
      throw new Error(`No matching sing-box asset found for linux-${arch} in release ${release.tagName}`);
    }

    const tmpArchive = `/tmp/sing-box-update-${Date.now()}.tar.gz`;
    const tmpDir = `/tmp/sing-box-update-dir-${Date.now()}`;

    try {
      await downloadFile(asset.url, tmpArchive);
      fs.mkdirSync(tmpDir, { recursive: true });
      await execAsync(`tar -xzf "${tmpArchive}" -C "${tmpDir}"`);

      // Find extracted binary
      const { stdout: findOut } = await execAsync(`find "${tmpDir}" -type f -name "sing-box" | head -1`);
      const extractedBin = findOut.trim();
      if (!extractedBin || !fs.existsSync(extractedBin)) {
        throw new Error('Extracted archive did not contain sing-box binary');
      }

      await execAsync(`chmod +x "${extractedBin}"`);

      // Verify binary execution
      const { stdout: testOut } = await execAsync(`"${extractedBin}" version`);
      const vMatch = testOut.match(/sing-box version ([^\s]+)/i);
      const newVersion = vMatch ? vMatch[1] : version;

      // Find current binary location to overwrite
      let targetBin = cfg.SINGBOX_BIN;
      if (!fs.existsSync(targetBin)) {
        try {
          const { stdout: whichOut } = await execAsync('which sing-box');
          if (whichOut.trim()) targetBin = whichOut.trim();
        } catch {
          targetBin = '/usr/local/bin/sing-box';
        }
      }

      // Backup current binary
      if (fs.existsSync(targetBin)) {
        await execAsync(`cp -f "${targetBin}" "${targetBin}.bak"`);
      }

      // Overwrite target binary
      await execAsync(`cp -f "${extractedBin}" "${targetBin}" && chmod +x "${targetBin}"`);

      // Restart service
      await SingboxService.restart();

      // Clear cache
      cache.singbox.data = null;

      return {
        success: true,
        message: `sing-box successfully updated to v${newVersion}`,
        newVersion,
      };
    } finally {
      // Cleanup
      try {
        if (fs.existsSync(tmpArchive)) fs.unlinkSync(tmpArchive);
        if (fs.existsSync(tmpDir)) await execAsync(`rm -rf "${tmpDir}"`);
      } catch {}
    }
  }

  /**
   * Update Xray binary in-place
   */
  static async updateXray(targetVersion = null) {
    const release = await BinaryUpdaterService.checkXrayRelease();
    const version = targetVersion || release.version;
    const arch = getNormalizedArch();

    // Look for matching asset: Xray-linux-64.zip or Xray-linux-arm64-v8a.zip
    const asset = release.assets.find((a) => {
      const name = a.name.toLowerCase();
      if (!name.endsWith('.zip')) return false;
      if (arch === 'amd64') return name.includes('linux-64') || name.includes('linux-amd64');
      if (arch === 'arm64') return name.includes('linux-arm64');
      return false;
    });

    if (!asset) {
      throw new Error(`No matching Xray asset found for linux-${arch} in release ${release.tagName}`);
    }

    const tmpArchive = `/tmp/xray-update-${Date.now()}.zip`;
    const tmpDir = `/tmp/xray-update-dir-${Date.now()}`;

    try {
      await downloadFile(asset.url, tmpArchive);
      fs.mkdirSync(tmpDir, { recursive: true });

      // Unzip archive
      await execAsync(`unzip -o "${tmpArchive}" -d "${tmpDir}"`);

      // Find extracted binary
      const { stdout: findOut } = await execAsync(`find "${tmpDir}" -type f -name "xray" | head -1`);
      const extractedBin = findOut.trim();
      if (!extractedBin || !fs.existsSync(extractedBin)) {
        throw new Error('Extracted archive did not contain xray binary');
      }

      await execAsync(`chmod +x "${extractedBin}"`);

      // Verify binary execution
      const { stdout: testOut } = await execAsync(`"${extractedBin}" version`);
      const vMatch = testOut.match(/Xray\s+([\d\.]+)/i);
      const newVersion = vMatch ? vMatch[1] : version;

      // Find target binary location
      let targetBin = cfg.XRAY_BIN;
      if (!fs.existsSync(targetBin)) {
        try {
          const { stdout: whichOut } = await execAsync('which xray');
          if (whichOut.trim()) targetBin = whichOut.trim();
        } catch {
          targetBin = '/usr/local/bin/xray';
        }
      }

      // Backup current binary
      if (fs.existsSync(targetBin)) {
        await execAsync(`cp -f "${targetBin}" "${targetBin}.bak"`);
      }

      // Overwrite target binary
      await execAsync(`cp -f "${extractedBin}" "${targetBin}" && chmod +x "${targetBin}"`);

      // Also copy geo assets if present
      const targetDir = path.dirname(targetBin);
      await execAsync(`cp -f "${tmpDir}"/*.dat "${targetDir}/" 2>/dev/null || true`);
      await execAsync(`cp -f "${tmpDir}"/*.dat /usr/local/share/xray/ 2>/dev/null || true`);

      // Restart service
      await XrayService.restart();

      // Clear cache
      cache.xray.data = null;

      return {
        success: true,
        message: `Xray-core successfully updated to v${newVersion}`,
        newVersion,
      };
    } finally {
      // Cleanup
      try {
        if (fs.existsSync(tmpArchive)) fs.unlinkSync(tmpArchive);
        if (fs.existsSync(tmpDir)) await execAsync(`rm -rf "${tmpDir}"`);
      } catch {}
    }
  }
}

module.exports = BinaryUpdaterService;
