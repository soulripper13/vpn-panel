/**
 * services/panel-updater.js
 * Checks GitHub for panel updates, downloads latest release/commit code,
 * safely backs up current databases/settings, updates backend/frontend files,
 * updates dependencies, and restarts the vpn-panel service with live progress streaming.
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
   * Get current panel version and commit hash
   */
  static getCurrentVersion() {
    let version = '1.0.0';
    let commit = '4b7c11b';
    let shortCommit = '4b7c11b';
    let buildDate = new Date().toISOString().split('T')[0];

    // Try reading package.json
    try {
      const pkgPath = path.join(__dirname, '../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) version = pkg.version;
      }
    } catch {}

    // Try reading version.json
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

    // If git is available in panelDir, read current git commit
    try {
      const panelDir = PanelUpdaterService.getPanelDir();
      if (fs.existsSync(path.join(panelDir, '.git'))) {
        const { stdout } = execSync('git rev-parse HEAD', { cwd: panelDir, stdio: ['pipe', 'pipe', 'ignore'] });
        const gitSha = stdout.toString().trim();
        if (gitSha) {
          commit = gitSha;
          shortCommit = gitSha.substring(0, 7);
        }
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
   * Check latest release or commit from GitHub
   */
  static async checkPanelRelease(force = false) {
    const now = Date.now();
    if (!force && releaseCache.data && (now - releaseCache.timestamp < CACHE_TTL_MS)) {
      return releaseCache.data;
    }

    const repoOwner = 'soulripper13';
    const repoName = 'vpn-panel';
    const commitsUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/commits/main`;
    const releasesUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;

    let latestCommit = null;
    let latestRelease = null;

    try {
      latestCommit = await fetchJson(commitsUrl);
    } catch (e) {
      // Fallback via curl
      try {
        const { stdout } = await execAsync(`curl -sL --connect-timeout 5 -H "User-Agent: vpn-panel" "${commitsUrl}"`);
        latestCommit = JSON.parse(stdout);
      } catch {}
    }

    try {
      latestRelease = await fetchJson(releasesUrl);
    } catch {}

    const sha = latestCommit?.sha || '';
    const shortSha = sha ? sha.substring(0, 7) : '';
    const commitMsg = latestCommit?.commit?.message
      ? latestCommit.commit.message.split('\n')[0]
      : 'Latest updates';
    const commitDate = latestCommit?.commit?.committer?.date || latestCommit?.commit?.author?.date || '';
    const author = latestCommit?.commit?.author?.name || 'soulripper13';

    const latestVer = latestRelease?.tag_name
      ? latestRelease.tag_name.replace(/^v/, '')
      : '1.1.0';

    const result = {
      latestVersion: latestVer,
      latestCommit: sha,
      shortCommit: shortSha,
      commitMessage: commitMsg,
      commitDate,
      author,
      releaseUrl: `https://github.com/${repoOwner}/${repoName}`,
      htmlUrl: latestCommit?.html_url || `https://github.com/${repoOwner}/${repoName}`,
    };

    releaseCache = { data: result, timestamp: now };
    return result;
  }

  /**
   * Get updates status for the panel
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

    let hasUpdate = false;
    if (release && release.shortCommit && current.shortCommit) {
      hasUpdate = release.shortCommit !== current.shortCommit;
    }

    return {
      currentVersion: current.version,
      currentCommit: current.commit,
      currentShortCommit: current.shortCommit,
      latestVersion: release?.latestVersion || current.version,
      latestCommit: release?.latestCommit || '',
      latestShortCommit: release?.shortCommit || '',
      latestCommitMessage: release?.commitMessage || '',
      latestCommitDate: release?.commitDate || '',
      hasUpdate,
      releaseUrl: release?.releaseUrl || 'https://github.com/soulripper13/vpn-panel',
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
   * Initiate panel self-update
   */
  static async updatePanel() {
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
    PanelUpdaterService._executePipeline().catch((err) => {
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
  static async _executePipeline() {
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
      const archiveUrl = 'https://github.com/soulripper13/vpn-panel/archive/refs/heads/main.tar.gz';
      addLog(`Downloading latest release archive from GitHub (${archiveUrl})...`);

      await execAsync(`curl -fsSL --connect-timeout 15 -o "${tarballPath}" "${archiveUrl}"`);
      if (!fs.existsSync(tarballPath) || fs.statSync(tarballPath).size < 1024) {
        throw new Error('Downloaded archive is missing or corrupted.');
      }
      addLog(`Archive downloaded successfully (${Math.round(fs.statSync(tarballPath).size / 1024)} KB).`);

      // ── Step 3: Extract archive (progress: 50%) ───────────────────────────
      updateState.step = 'extract';
      updateState.progress = 50;
      addLog('Extracting update package...');
      await execAsync(`mkdir -p "${tempDir}" && tar -xzf "${tarballPath}" -C "${tempDir}"`);

      const extractedRoot = path.join(tempDir, 'vpn-panel-main');
      if (!fs.existsSync(path.join(extractedRoot, 'backend'))) {
        throw new Error('Invalid archive structure: backend directory not found in release.');
      }
      addLog('Archive extracted and verified.');

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

      // Record latest commit into version.json
      let latestCommitSha = '';
      try {
        const release = await PanelUpdaterService.checkPanelRelease(true);
        latestCommitSha = release?.latestCommit || '';
        const versionJson = {
          version: release?.latestVersion || '1.1.0',
          commit: latestCommitSha,
          shortCommit: latestCommitSha.slice(0, 7),
          buildDate: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(targetBackend, 'version.json'), JSON.stringify(versionJson, null, 2));
      } catch {}

      addLog('All updated application files deployed.');

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
      addLog('Panel updated successfully!');
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
