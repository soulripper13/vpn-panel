/**
 * services/panel-updater.js
 * Checks GitHub for panel updates based on official semantic release numbers (tags/releases),
 * downloads release packages, safely backs up databases and settings, updates application files,
 * updates production dependencies, and restarts the vpn-panel service.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
const util = require('util');
const https = require('https');
const cfg = require('../config/app-config');

const execAsync = util.promisify(exec);

// Cache release info for 5 minutes
let releaseCache = { data: null, timestamp: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000;

// Update state machine
let updateState = {
  status: 'idle', // 'idle' | 'running' | 'restarting' | 'completed' | 'failed'
  step: '',
  progress: 0,
  logs: [],
  error: null,
  startedAt: null,
  finishedAt: null,
};

function addLog(msg) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}`;
  updateState.logs.push(line);
  if (updateState.logs.length > 300) {
    updateState.logs.shift();
  }
}

/**
 * Compare two semver strings: v1 > v2 returns 1, v1 < v2 returns -1, equal returns 0
 */
function compareSemver(v1, v2) {
  const parse = (v) => (v || '').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Fetch JSON from URL using HTTPS with redirect support and user-agent
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
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }

      if (res.statusCode === 404) {
        return resolve(null);
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
      reject(new Error('Request timeout fetching GitHub release info'));
    });
  });
}

class PanelUpdaterService {
  /**
   * Determine panel installation root directory
   */
  static getPanelDir() {
    if (process.env.PANEL_DIR && fs.existsSync(process.env.PANEL_DIR)) {
      return process.env.PANEL_DIR;
    }
    if (fs.existsSync('/opt/vpn-panel')) {
      return '/opt/vpn-panel';
    }
    return path.resolve(__dirname, '../../../');
  }

  /**
   * Get current panel version
   */
  static getCurrentVersion() {
    let version = '1.2.0';
    let commit = '';
    let shortCommit = '';
    let buildDate = new Date().toISOString().split('T')[0];

    // Read package.json
    try {
      const pkgPath = path.join(__dirname, '../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) version = pkg.version;
      }
    } catch {}

    // Read version.json
    try {
      const verPath = path.join(__dirname, '../../version.json');
      if (fs.existsSync(verPath)) {
        const ver = JSON.parse(fs.readFileSync(verPath, 'utf8'));
        if (ver.version) version = ver.version;
        if (ver.commit) {
          commit = ver.commit;
          shortCommit = ver.commit.substring(0, 7);
        }
        if (ver.buildDate) buildDate = ver.buildDate;
      }
    } catch {}

    return {
      version,
      commit,
      shortCommit,
      buildDate,
    };
  }

  /**
   * Check latest official release from GitHub (soulripper13/vpn-panel)
   */
  static async checkPanelRelease(force = false) {
    const now = Date.now();
    if (!force && releaseCache.data && (now - releaseCache.timestamp < CACHE_TTL_MS)) {
      return releaseCache.data;
    }

    const repoOwner = 'soulripper13';
    const repoName = 'vpn-panel';
    const releasesLatestUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;
    const releasesListUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases`;
    const tagsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/tags`;

    let release = null;

    // 1. Try releases/latest
    try {
      release = await fetchJson(releasesLatestUrl);
    } catch (e) {
      try {
        const { stdout } = await execAsync(`curl -sL --connect-timeout 5 -H "User-Agent: vpn-panel" "${releasesLatestUrl}"`);
        release = JSON.parse(stdout);
        if (release && release.message && release.message.includes('Not Found')) {
          release = null;
        }
      } catch {}
    }

    // 2. Fallback to releases list
    if (!release || !release.tag_name) {
      try {
        const list = await fetchJson(releasesListUrl);
        if (Array.isArray(list) && list.length > 0) {
          release = list[0];
        }
      } catch {}
    }

    // 3. Fallback to tags list
    let tagItem = null;
    if (!release || !release.tag_name) {
      try {
        const tags = await fetchJson(tagsUrl);
        if (Array.isArray(tags) && tags.length > 0) {
          tagItem = tags[0];
        }
      } catch {}
    }

    const rawTag = release?.tag_name || tagItem?.name || 'v1.2.0';
    const latestVersion = rawTag.replace(/^v/, '');
    const releaseName = release?.name || rawTag;
    const releaseNotes = release?.body || (release ? `Release ${rawTag}` : 'Latest stable release');
    const publishedAt = release?.published_at || (tagItem ? new Date().toISOString() : '');
    const tarballUrl = release?.tarball_url || tagItem?.tarball_url || `https://github.com/${repoOwner}/${repoName}/archive/refs/tags/${rawTag}.tar.gz`;
    const htmlUrl = release?.html_url || `https://github.com/${repoOwner}/${repoName}/releases`;

    const result = {
      latestVersion,
      tagName: rawTag,
      releaseName,
      releaseNotes,
      publishedAt,
      tarballUrl,
      htmlUrl,
      releaseUrl: `https://github.com/${repoOwner}/${repoName}`,
    };

    releaseCache = { data: result, timestamp: now };
    return result;
  }

  /**
   * Get updates status for the panel based on semantic versioning
   */
  static async getStatus(force = false) {
    const current = PanelUpdaterService.getCurrentVersion();
    let release = null;
    let error = null;

    try {
      release = await PanelUpdaterService.checkPanelRelease(force);
    } catch (e) {
      error = e.message;
    }

    const latestVer = release?.latestVersion || current.version;
    const hasUpdate = Boolean(release && compareSemver(latestVer, current.version) > 0);

    return {
      currentVersion: current.version,
      latestVersion: latestVer,
      tagName: release?.tagName || `v${latestVer}`,
      releaseName: release?.releaseName || `v${latestVer}`,
      releaseNotes: release?.releaseNotes || '',
      publishedAt: release?.publishedAt || '',
      hasUpdate,
      releaseUrl: release?.htmlUrl || 'https://github.com/soulripper13/vpn-panel/releases',
      error,
      updateInProgress: updateState.status === 'running' || updateState.status === 'restarting',
    };
  }

  /**
   * Get live update progress & logs
   */
  static getUpdateProgress() {
    return {
      ...updateState,
      current: PanelUpdaterService.getCurrentVersion(),
    };
  }

  /**
   * Initiate panel self-update to latest release
   */
  static async updatePanel(targetVersion = null) {
    if (updateState.status === 'running' || updateState.status === 'restarting') {
      throw new Error('A panel update is already in progress');
    }

    // Reset state
    updateState = {
      status: 'running',
      step: 'init',
      progress: 5,
      logs: [],
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };

    addLog('Starting VPN Panel self-update pipeline...');

    // Asynchronously execute update without blocking HTTP response
    PanelUpdaterService._executePipeline(targetVersion).catch((err) => {
      updateState.status = 'failed';
      updateState.error = err.message;
      updateState.finishedAt = Date.now();
      addLog(`Update pipeline failed: ${err.message}`);
    });

    return {
      success: true,
      message: 'Panel update initiated successfully',
      status: 'running',
    };
  }

  /**
   * Asynchronous pipeline execution
   * @private
   */
  static async _executePipeline(targetVersion = null) {
    const panelDir = PanelUpdaterService.getPanelDir();
    const backupBaseDir = '/opt/vpn-panel-backups';
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const backupDir = path.join(backupBaseDir, `panel-update-${timestamp}`);
    const tempDir = path.join(os.tmpdir(), `vpn-panel-update-${timestamp}`);
    const tarballPath = path.join(os.tmpdir(), `vpn-panel-${timestamp}.tar.gz`);

    try {
      // ── Step 1: Backup current panel state (progress: 15%) ───────────────
      updateState.step = 'backup';
      updateState.progress = 15;
      addLog(`Creating safe pre-update backup at ${backupDir}...`);

      if (fs.existsSync('/opt/vpn-panel')) {
        await execAsync(`mkdir -p "${backupDir}"`);
        if (fs.existsSync(path.join(panelDir, 'data/panel.db'))) {
          await execAsync(`cp -a "${path.join(panelDir, 'data/panel.db')}" "${backupDir}/panel.db" 2>/dev/null || true`);
          addLog('Backed up SQLite database (panel.db).');
        }
        if (fs.existsSync(path.join(panelDir, '.env'))) {
          await execAsync(`cp -a "${path.join(panelDir, '.env')}" "${backupDir}/.env" 2>/dev/null || true`);
          addLog('Backed up environment config (.env).');
        }
      } else {
        addLog('Local development directory detected — skipped system backup.');
      }

      // ── Step 2: Download latest release archive from GitHub (progress: 35%) ─
      updateState.step = 'download';
      updateState.progress = 35;

      const releaseInfo = await PanelUpdaterService.checkPanelRelease(true);
      const tagToDownload = targetVersion ? `v${targetVersion.replace(/^v/, '')}` : (releaseInfo?.tagName || 'main');
      let archiveUrl = releaseInfo?.tarballUrl;
      if (!archiveUrl || targetVersion) {
        archiveUrl = `https://github.com/soulripper13/vpn-panel/archive/refs/tags/${tagToDownload}.tar.gz`;
      }

      addLog(`Downloading release package ${tagToDownload} from GitHub (${archiveUrl})...`);

      // Try tag download, fallback to main branch if tag not ready yet
      let downloadOk = false;
      try {
        await execAsync(`curl -fsSL --connect-timeout 15 -o "${tarballPath}" "${archiveUrl}"`);
        if (fs.existsSync(tarballPath) && fs.statSync(tarballPath).size > 1024) {
          downloadOk = true;
        }
      } catch {}

      if (!downloadOk) {
        archiveUrl = 'https://github.com/soulripper13/vpn-panel/archive/refs/heads/main.tar.gz';
        addLog(`Tag archive unavailable, falling back to main release branch (${archiveUrl})...`);
        await execAsync(`curl -fsSL --connect-timeout 15 -o "${tarballPath}" "${archiveUrl}"`);
      }

      if (!fs.existsSync(tarballPath) || fs.statSync(tarballPath).size < 1024) {
        throw new Error('Downloaded archive is missing or corrupted.');
      }
      addLog(`Archive downloaded successfully (${Math.round(fs.statSync(tarballPath).size / 1024)} KB).`);

      // ── Step 3: Extract archive (progress: 50%) ───────────────────────────
      updateState.step = 'extract';
      updateState.progress = 50;
      addLog('Extracting update package...');
      await execAsync(`mkdir -p "${tempDir}" && tar -xzf "${tarballPath}" -C "${tempDir}"`);

      // Find extracted root directory dynamically (e.g. vpn-panel-1.2.0 or vpn-panel-main)
      const extractedEntries = fs.readdirSync(tempDir);
      const extractedDirName = extractedEntries.find((d) => d.startsWith('vpn-panel') && fs.statSync(path.join(tempDir, d)).isDirectory());
      if (!extractedDirName) {
        throw new Error('Invalid archive structure: root directory not found.');
      }
      const extractedRoot = path.join(tempDir, extractedDirName);

      if (!fs.existsSync(path.join(extractedRoot, 'backend'))) {
        throw new Error('Invalid archive structure: backend directory not found in release.');
      }
      addLog(`Archive extracted and verified (${extractedDirName}).`);

      // ── Step 4: Deploy files (progress: 70%) ──────────────────────────────
      updateState.step = 'deploy_files';
      updateState.progress = 70;
      addLog('Deploying updated backend, frontend assets, and deploy scripts...');

      const targetBackend = path.join(panelDir, 'backend');
      const targetPublic = path.join(panelDir, 'backend/public');
      const targetRootPublic = path.join(panelDir, 'public');
      const targetDeploy = path.join(panelDir, 'deploy');

      await execAsync(`mkdir -p "${targetBackend}" "${targetPublic}" "${targetRootPublic}" "${targetDeploy}"`);

      // Copy backend files (excluding node_modules and .env)
      if (fs.existsSync(path.join(extractedRoot, 'backend/src'))) {
        await execAsync(`cp -rf "${path.join(extractedRoot, 'backend/src')}" "${targetBackend}/"`);
      }
      if (fs.existsSync(path.join(extractedRoot, 'backend/package.json'))) {
        await execAsync(`cp -f "${path.join(extractedRoot, 'backend/package.json')}" "${targetBackend}/package.json"`);
      }

      // Copy pre-built frontend dist/public assets
      if (fs.existsSync(path.join(extractedRoot, 'backend/public'))) {
        await execAsync(`cp -rf "${path.join(extractedRoot, 'backend/public')}"/* "${targetPublic}/"`);
        await execAsync(`cp -rf "${path.join(extractedRoot, 'backend/public')}"/* "${targetRootPublic}/"`);
        addLog('Frontend web interface updated.');
      }

      // Copy deploy scripts
      if (fs.existsSync(path.join(extractedRoot, 'deploy'))) {
        await execAsync(`cp -rf "${path.join(extractedRoot, 'deploy')}"/* "${targetDeploy}/"`);
        await execAsync(`chmod +x "${targetDeploy}"/*.sh 2>/dev/null || true`);
      }

      // Record updated version into version.json
      const newVersion = releaseInfo?.latestVersion || targetVersion || '1.2.0';
      const versionJson = {
        version: newVersion,
        tagName: `v${newVersion}`,
        buildDate: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(targetBackend, 'version.json'), JSON.stringify(versionJson, null, 2));

      addLog(`All updated application files deployed (v${newVersion}).`);

      // ── Step 5: Install/update backend dependencies (progress: 85%) ────────
      updateState.step = 'dependencies';
      updateState.progress = 85;
      addLog('Updating production npm dependencies (npm install --production)...');

      try {
        await execAsync('npm install --production --silent', {
          cwd: targetBackend,
          timeout: 120000,
        });
        addLog('Dependencies updated successfully.');
      } catch (npmErr) {
        addLog(`Warning: npm install warning (${npmErr.message}) - continuing.`);
      }

      // ── Step 6: Clean up temp files (progress: 92%) ────────────────────────
      updateState.step = 'cleanup';
      updateState.progress = 92;
      addLog('Cleaning up temporary installation files...');
      await execAsync(`rm -rf "${tarballPath}" "${tempDir}" 2>/dev/null || true`);

      // ── Step 7: Restart service (progress: 100%) ───────────────────────────
      updateState.step = 'restarting';
      updateState.progress = 100;
      updateState.status = 'restarting';
      updateState.finishedAt = Date.now();
      addLog(`Panel updated successfully to v${newVersion}!`);
      addLog('Scheduling service restart in 2 seconds...');

      // Schedule restart
      if (os.platform() === 'linux' && fs.existsSync('/etc/systemd/system/vpn-panel.service')) {
        const restartCmd = 'sleep 2 && systemctl daemon-reload && systemctl restart vpn-panel';
        try {
          await execAsync(`systemd-run bash -c "${restartCmd}"`);
        } catch {
          const child = spawn('bash', ['-c', restartCmd], { detached: true, stdio: 'ignore' });
          child.unref();
        }
      } else {
        addLog('Non-systemd / development environment detected — service restart simulated.');
      }
    } catch (err) {
      updateState.status = 'failed';
      updateState.error = err.message;
      updateState.finishedAt = Date.now();
      addLog(`ERROR: ${err.message}`);

      // Rollback DB if needed
      if (fs.existsSync(path.join(backupDir, 'panel.db'))) {
        addLog('Restoring database from backup...');
        await execAsync(`cp -a "${backupDir}/panel.db" "${path.join(panelDir, 'data/panel.db')}" 2>/dev/null || true`);
        addLog('Database restored.');
      }
      throw err;
    }
  }
}

module.exports = PanelUpdaterService;
