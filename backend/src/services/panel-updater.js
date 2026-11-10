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
const { execFile } = require('child_process');
const util = require('util');
const https = require('https');
const crypto = require('crypto');
const cfg = require('../config/app-config');
const db = require('../config/database');
const privileged = require('./privileged-client');
const PANEL_RELEASE_PUBLIC_KEY = fs.readFileSync(path.join(__dirname, '../../../deploy/panel-release-public-key.pem'), 'utf8');

const execFileAsync = util.promisify(execFile);

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

try {
  const persisted = JSON.parse(fs.readFileSync(path.join(path.dirname(cfg.DB_PATH), 'panel-update-state.json'), 'utf8'));
  if (persisted && ['restarting', 'completed', 'failed'].includes(persisted.status)) {
    updateState = { ...updateState, ...persisted };
  }
} catch {}

function addLog(msg) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}`;
  updateState.logs.push(line);
  if (updateState.logs.length > 300) {
    updateState.logs.shift();
  }
  persistUpdateState();
}

function getUpdateStatePath() {
  return path.join(path.dirname(cfg.DB_PATH), 'panel-update-state.json');
}

function persistUpdateState() {
  try {
    const statePath = getUpdateStatePath();
    const tempPath = `${statePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tempPath, JSON.stringify(updateState), { mode: 0o600 });
    fs.renameSync(tempPath, statePath);
  } catch {}
}

function pathExists(filePath) {
  try { fs.lstatSync(filePath); return true; } catch { return false; }
}

function removePath(filePath) {
  fs.rmSync(filePath, { recursive: true, force: true });
}

function restoreTransaction(panelDir, backupDir, targets) {
  for (const entry of [...targets].reverse()) {
    const livePath = path.resolve(panelDir, entry.target);
    const savedPath = path.resolve(backupDir, entry.backup);
    if (!livePath.startsWith(`${path.resolve(panelDir)}${path.sep}`) || !savedPath.startsWith(`${path.resolve(backupDir)}${path.sep}`)) {
      throw new Error('Unsafe path in update transaction');
    }
    const needsRestore = entry.state === 'backed_up' || entry.state === 'installed' ||
      (entry.existed && pathExists(savedPath) && !pathExists(livePath));
    if (!needsRestore) continue;
    if (entry.existed && !pathExists(savedPath)) {
      throw new Error(`Rollback copy is missing for ${entry.target}; kept the current path in place.`);
    }
    removePath(livePath);
    if (entry.existed && pathExists(savedPath)) {
      fs.mkdirSync(path.dirname(livePath), { recursive: true });
      fs.renameSync(savedPath, livePath);
    }
  }
}

function writeTransaction(backupDir, transaction) {
  const filePath = path.join(backupDir, 'transaction.json');
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(transaction, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function getStagingIdentity() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
    throw new Error('A root-managed panel update must stage package scripts as an unprivileged account.');
  }
  const passwd = fs.readFileSync('/etc/passwd', 'utf8');
  const entry = passwd.split(/\r?\n/).map((line) => line.split(':'))
    .find((fields) => fields[0] === 'nobody' && Number(fields[2]) > 0);
  if (!entry) throw new Error('Could not find the unprivileged nobody account for safe update staging.');
  return { uid: Number(entry[2]), gid: Number(entry[3]) };
}

function assertNoSymbolicLinks(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in the release archive: ${fullPath}`);
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
}

function directoryBytes(root) {
  if (!pathExists(root)) return 0;
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(root).reduce((sum, name) => sum + directoryBytes(path.join(root, name)), 0);
}

function assertUpdateDiskSpace(panelDir, archiveBytes) {
  if (typeof fs.statfsSync !== 'function') throw new Error('Cannot safely check available disk space on this Node.js version.');
  const stats = fs.statfsSync(panelDir);
  const available = stats.bavail * stats.bsize;
  const existingModules = directoryBytes(path.join(panelDir, 'backend/node_modules'));
  const databaseBytes = pathExists(cfg.DB_PATH) ? fs.statSync(cfg.DB_PATH).size : 0;
  const required = Math.max(
    512 * 1024 * 1024,
    existingModules * 2 + databaseBytes * 2 + archiveBytes * 2 + 256 * 1024 * 1024,
  );
  if (available < required) {
    throw new Error(`Not enough free disk space for a recoverable update. Need about ${Math.ceil(required / 1024 / 1024)} MB; only ${Math.floor(available / 1024 / 1024)} MB are available.`);
  }
}

async function checkJavaScriptSyntax(rootDir) {
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        await execFileAsync(process.execPath, ['--check', fullPath], { timeout: 15000 });
      }
    }
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
        let redirected;
        try { redirected = new URL(res.headers.location, url); } catch { return reject(new Error('Invalid GitHub API redirect')); }
        if (redirected.protocol !== 'https:' || redirected.hostname !== 'api.github.com') {
          return reject(new Error('Unexpected GitHub API redirect destination'));
        }
        return fetchJson(redirected.href).then(resolve).catch(reject);
      }

      if (res.statusCode === 404) {
        return resolve(null);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
      }

      let data = '';
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > 2 * 1024 * 1024) {
          req.destroy(new Error('GitHub API response is too large'));
          return;
        }
        data += chunk;
      });
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
    let version = '1.4.7';
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

    // 1. Try the latest published release.
    try {
      release = await fetchJson(releasesLatestUrl);
    } catch {}

    // 2. Fallback to releases list
    if (!release || !release.tag_name) {
      try {
        const list = await fetchJson(releasesListUrl);
        if (Array.isArray(list) && list.length > 0) {
          release = list.find((item) => item?.tag_name && !item.draft && !item.prerelease) || null;
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
    const htmlUrl = release?.html_url || `https://github.com/${repoOwner}/${repoName}/releases`;
    const assets = release?.assets || [];
    const bundle = assets.find((asset) => asset.name === `vpn-panel-v${latestVersion}.tar.gz`);
    const manifest = assets.find((asset) => asset.name === `vpn-panel-v${latestVersion}.manifest.json`);
    const signature = assets.find((asset) => asset.name === `vpn-panel-v${latestVersion}.manifest.sig`);

    const result = {
      latestVersion,
      tagName: rawTag,
      releaseName,
      releaseNotes,
      publishedAt,
      tarballUrl: bundle?.browser_download_url || null,
      manifestUrl: manifest?.browser_download_url || null,
      signatureUrl: signature?.browser_download_url || null,
      htmlUrl,
      releaseUrl: `https://github.com/${repoOwner}/${repoName}`,
      isPublishedRelease: Boolean(release?.tag_name && bundle && manifest && signature),
    };

    releaseCache = { data: result, timestamp: now };
    return result;
  }

  static async checkPanelReleaseByTag(tagName) {
    const normalizedTag = String(tagName || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalizedTag)) {
      throw new Error('Invalid panel release version');
    }
    const release = await fetchJson(`https://api.github.com/repos/soulripper13/vpn-panel/releases/tags/v${normalizedTag}`);
    if (!release?.tag_name || release.draft || release.prerelease) {
      throw new Error(`Published release v${normalizedTag} was not found`);
    }
    const assets = release.assets || [];
    const bundle = assets.find((asset) => asset.name === `vpn-panel-v${normalizedTag}.tar.gz`);
    const manifest = assets.find((asset) => asset.name === `vpn-panel-v${normalizedTag}.manifest.json`);
    const signature = assets.find((asset) => asset.name === `vpn-panel-v${normalizedTag}.manifest.sig`);
    if (!bundle || !manifest || !signature) throw new Error('Release is missing its signed panel bundle.');
    return {
      latestVersion: normalizedTag,
      tagName: release.tag_name,
      tarballUrl: bundle.browser_download_url,
      manifestUrl: manifest.browser_download_url,
      signatureUrl: signature.browser_download_url,
      releaseName: release.name || release.tag_name,
      releaseNotes: release.body || '',
      publishedAt: release.published_at || '',
      htmlUrl: release.html_url || 'https://github.com/soulripper13/vpn-panel/releases',
      isPublishedRelease: true,
    };
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
    try {
      const persisted = JSON.parse(fs.readFileSync(getUpdateStatePath(), 'utf8'));
      if (persisted?.startedAt && persisted.startedAt >= (updateState.startedAt || 0)) {
        updateState = { ...updateState, ...persisted };
      }
    } catch {}
    if (updateState.status === 'restarting' && updateState.startedAt && Date.now() - updateState.startedAt > 10 * 60 * 1000) {
      updateState.status = 'failed';
      updateState.step = 'watchdog_timeout';
      updateState.error = 'The update watchdog did not report a result. Check the panel service before retrying.';
      updateState.finishedAt = Date.now();
      addLog(updateState.error);
    }
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
    const updateId = String(Date.now());
    const backupDir = path.join(panelDir, '.panel-update-backups', updateId);
    const tempDir = path.join(cfg.PRIVILEGED_STAGING_DIR, `panel-update-${updateId}`);
    const tarballPath = path.join(cfg.PRIVILEGED_STAGING_DIR, `vpn-panel-${updateId}.tar.gz`);
    const resolvedPanelDir = path.resolve(panelDir);
    const resolvedDbPath = path.resolve(cfg.DB_PATH);
    let transaction = null;
    let restartScheduled = false;
    let watchdogScheduled = false;
    let stagingIdentity;

    try {
      if (os.platform() !== 'linux' || !fs.existsSync('/run/systemd/system') || !fs.existsSync('/etc/systemd/system/vpn-panel.service')) {
        throw new Error('Panel self-update requires the installed systemd service; use deploy/update.sh for other installations.');
      }
      if (!resolvedDbPath.startsWith(`${resolvedPanelDir}${path.sep}`)) {
        throw new Error('Panel self-update requires the database to be inside the panel installation so it can be restored safely.');
      }
      stagingIdentity = typeof process.getuid === 'function' && process.getuid() === 0
        ? getStagingIdentity()
        : { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };

      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
      if (typeof process.getuid !== 'function' || process.getuid() === 0) fs.chownSync(tempDir, stagingIdentity.uid, stagingIdentity.gid);
      updateState.step = 'download';
      updateState.progress = 15;
      addLog('Preparing a staged release; the live installation will remain untouched until checks pass.');

      const releaseInfo = targetVersion
        ? await PanelUpdaterService.checkPanelReleaseByTag(targetVersion)
        : await PanelUpdaterService.checkPanelRelease(true);
      if (!releaseInfo?.isPublishedRelease || !releaseInfo.tarballUrl) {
        throw new Error('Only published, tagged releases can be installed from the panel.');
      }
      const manifestPath = `${tarballPath}.manifest.json`;
      const signaturePath = `${tarballPath}.manifest.sig`;
      const downloadReleaseAsset = async (url, destPath) => {
        const assetUrl = new URL(url);
        if (assetUrl.protocol !== 'https:' || !['github.com', 'objects.githubusercontent.com'].includes(assetUrl.hostname)) {
          throw new Error('Release downloads must use HTTPS GitHub release assets.');
        }
        await execFileAsync('curl', [
          '--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
          '--connect-timeout', '15', '--max-time', '180', '--output', destPath, assetUrl.href,
        ], { timeout: 200000 });
      };
      await Promise.all([
        downloadReleaseAsset(releaseInfo.tarballUrl, tarballPath),
        downloadReleaseAsset(releaseInfo.manifestUrl, manifestPath),
        downloadReleaseAsset(releaseInfo.signatureUrl, signaturePath),
      ]);
      fs.chmodSync(tarballPath, 0o644);
      if (!pathExists(tarballPath) || fs.statSync(tarballPath).size < 1024) {
        throw new Error('Downloaded release archive is missing or too small.');
      }
      const manifestBytes = fs.readFileSync(manifestPath);
      const signedManifest = JSON.parse(manifestBytes.toString('utf8'));
      if (!crypto.verify(null, manifestBytes, PANEL_RELEASE_PUBLIC_KEY, fs.readFileSync(signaturePath))) {
        throw new Error('Panel release publisher signature verification failed.');
      }
      const archiveDigest = crypto.createHash('sha256').update(fs.readFileSync(tarballPath)).digest('hex');
      if (signedManifest.version !== releaseInfo.latestVersion || signedManifest.algorithm !== 'ed25519' ||
          signedManifest.archive !== `vpn-panel-v${signedManifest.version}.tar.gz` || signedManifest.sha256 !== archiveDigest) {
        throw new Error('Panel release bundle does not match its signed manifest.');
      }
      assertUpdateDiskSpace(panelDir, fs.statSync(tarballPath).size);
      addLog(`Downloaded published release ${releaseInfo.tagName}.`);

      updateState.step = 'extract';
      updateState.progress = 30;
      await execFileAsync('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', tarballPath, '-C', tempDir], {
        timeout: 60000, uid: stagingIdentity.uid, gid: stagingIdentity.gid,
      });
      const extractedEntries = fs.readdirSync(tempDir).filter((entry) => entry.startsWith('vpn-panel-'));
      if (extractedEntries.length !== 1) throw new Error('Release archive has an unexpected directory layout.');
      const extractedRoot = path.join(tempDir, extractedEntries[0]);
      const sourceBackend = path.join(extractedRoot, 'backend');
      const sourcePublic = path.join(sourceBackend, 'public');
      const sourcePackagePath = path.join(sourceBackend, 'package.json');
      const sourceLockPath = path.join(sourceBackend, 'package-lock.json');
      const packageJson = JSON.parse(fs.readFileSync(sourcePackagePath, 'utf8'));
      assertNoSymbolicLinks(extractedRoot);
      if (!fs.existsSync(path.join(sourceBackend, 'src')) || !fs.existsSync(path.join(sourcePublic, 'index.html')) || !fs.existsSync(sourceLockPath)) {
        throw new Error('Release is missing backend source, production assets, or its package lockfile.');
      }
      if (packageJson.version !== releaseInfo.latestVersion) {
        throw new Error(`Release tag ${releaseInfo.latestVersion} does not match backend version ${packageJson.version}.`);
      }

      updateState.step = 'preflight';
      updateState.progress = 45;
      await checkJavaScriptSyntax(path.join(sourceBackend, 'src'));
      const stagingEnv = {
        ...process.env,
        HOME: path.join(tempDir, 'home'),
        npm_config_cache: path.join(tempDir, 'npm-cache'),
      };
      fs.mkdirSync(stagingEnv.HOME, { recursive: true, mode: 0o700 });
      fs.mkdirSync(stagingEnv.npm_config_cache, { recursive: true, mode: 0o700 });
      if (typeof process.getuid !== 'function' || process.getuid() === 0) {
        fs.chownSync(stagingEnv.HOME, stagingIdentity.uid, stagingIdentity.gid);
        fs.chownSync(stagingEnv.npm_config_cache, stagingIdentity.uid, stagingIdentity.gid);
      }
      await execFileAsync('npm', ['ci', '--omit=dev', '--silent'], {
        cwd: sourceBackend, timeout: 300000, uid: stagingIdentity.uid, gid: stagingIdentity.gid, env: stagingEnv,
      });
      await execFileAsync('npm', ['test'], {
        cwd: sourceBackend, timeout: 120000, uid: stagingIdentity.uid, gid: stagingIdentity.gid, env: stagingEnv,
      });
      addLog('Staged release passed JavaScript syntax checks, dependency installation, and backend tests.');

      const newVersion = releaseInfo.latestVersion;
      fs.writeFileSync(path.join(sourceBackend, 'version.json'), JSON.stringify({
        version: newVersion,
        tagName: releaseInfo.tagName,
        buildDate: new Date().toISOString(),
      }, null, 2), { mode: 0o644 });
      const stagedRootPublic = path.join(tempDir, 'root-public');
      fs.cpSync(sourcePublic, stagedRootPublic, { recursive: true, errorOnExist: true });
      const watchdogSource = path.join(extractedRoot, 'deploy/panel-update-watchdog.js');
      if (!fs.existsSync(watchdogSource)) throw new Error('Release is missing its rollback watchdog.');
      const watchdogPath = path.join(backupDir, 'watchdog.js');
      fs.copyFileSync(watchdogSource, watchdogPath);
      fs.chmodSync(watchdogPath, 0o600);
      const dbBackupPath = path.join(backupDir, 'panel.db');
      await db.backup(dbBackupPath);
      fs.chmodSync(dbBackupPath, 0o600);

      const replacements = [
        ['backend/src', path.join(sourceBackend, 'src')],
        ['backend/public', sourcePublic],
        ['backend/package.json', sourcePackagePath],
        ['backend/package-lock.json', sourceLockPath],
        ['backend/node_modules', path.join(sourceBackend, 'node_modules')],
        ['backend/version.json', path.join(sourceBackend, 'version.json')],
        ['public', stagedRootPublic],
        ['deploy/panel-update-watchdog.js', watchdogSource],
      ];
      transaction = {
        updateId,
        startedAt: updateState.startedAt,
        promoted: false,
        targets: replacements.map(([target], index) => ({
          target,
          backup: `previous-${index}`,
          existed: pathExists(path.join(panelDir, target)),
          state: 'pending',
        })),
      };
      writeTransaction(backupDir, transaction);

      updateState.step = 'deploy_files';
      updateState.progress = 65;
      addLog(`Promoting v${newVersion}; the prior files and database are retained for automatic rollback.`);
      updateState.step = 'restarting';
      updateState.progress = 92;
      updateState.status = 'restarting';
      updateState.finishedAt = null;
      persistUpdateState();
      const promotion = await privileged.callRequired('promote_panel', {
        archivePath: tarballPath,
        manifestPath,
        signaturePath,
        dbBackupPath,
        updateId,
        version: releaseInfo.latestVersion,
      }, 60000);
      if (!promotion) throw new Error('The privileged update helper is unavailable; use deploy/update.sh with the account that owns this installation.');
      restartScheduled = Boolean(promotion);
      addLog(`Restart scheduled for v${newVersion}; waiting for the independent health check.`);
    } catch (err) {
      if (transaction && !restartScheduled) {
        try {
          restoreTransaction(panelDir, backupDir, transaction.targets);
          addLog('Restored all changed files after the update could not be safely scheduled.');
        } catch (rollbackErr) {
          addLog(`Rollback failed: ${rollbackErr.message}`);
        }
      }
      updateState.status = 'failed';
      updateState.error = err.message;
      updateState.finishedAt = Date.now();
      addLog(`Update stopped: ${err.message}`);
      throw err;
    } finally {
      try { fs.rmSync(tarballPath, { force: true }); } catch {}
      try { fs.rmSync(`${tarballPath}.manifest.json`, { force: true }); } catch {}
      try { fs.rmSync(`${tarballPath}.manifest.sig`, { force: true }); } catch {}
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

module.exports = PanelUpdaterService;
