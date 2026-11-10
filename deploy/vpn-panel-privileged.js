#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);
const PANEL_DIR = path.resolve(process.env.PANEL_DIR || '/opt/vpn-panel');
const SOCKET_PATH = process.env.PRIVILEGED_SOCKET || '/run/vpn-panel/privileged.sock';
const STAGING_DIR = path.resolve(process.env.PRIVILEGED_STAGING_DIR || path.join(PANEL_DIR, '.privileged-staging'));
const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, 'panel-release-public-key.pem'), 'utf8');
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const ALLOWED_ENGINES = {
  singbox: {
    service: 'sing-box',
    binary: process.env.SINGBOX_BIN || '/usr/bin/sing-box',
    config: process.env.SINGBOX_CONFIG || '/etc/sing-box/config.json',
    service: process.env.SINGBOX_SERVICE || 'sing-box',
  },
  xray: {
    service: 'xray',
    binary: process.env.XRAY_BIN || '/usr/local/bin/xray',
    config: process.env.XRAY_CONFIG || '/etc/xray/config.json',
    service: process.env.XRAY_SERVICE || 'xray',
  },
};

if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
  throw new Error('vpn-panel-privileged must run as root');
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function regularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${filePath}`);
  return stat;
}

function rejectSymlinks(root) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Signed release archive must not contain symbolic links');
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
}

function ensureSafeStagingPath(candidate) {
  const resolved = path.resolve(candidate);
  if (!inside(STAGING_DIR, resolved)) throw new Error('Staging path is outside the privileged staging directory');
  regularFile(resolved);
  return resolved;
}

function ensureEngine(engine) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_ENGINES, engine)) throw new Error('Unsupported engine');
  return ALLOWED_ENGINES[engine];
}

function validateRelease(archivePath, manifestPath, signaturePath, expectedVersion) {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.version !== expectedVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version) ||
      manifest.algorithm !== 'ed25519' || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '') ||
      manifest.archive !== `vpn-panel-v${manifest.version}.tar.gz`) {
    throw new Error('Signed release manifest is invalid');
  }
  const signature = fs.readFileSync(signaturePath);
  if (!crypto.verify(null, manifestBytes, PUBLIC_KEY, signature)) throw new Error('Panel release publisher signature is invalid');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
  if (digest !== manifest.sha256) throw new Error('Panel release archive digest does not match its signed manifest');
  return manifest;
}

function copyVerifiedFile(source, target) {
  regularFile(source);
  const fd = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 512 * 1024 * 1024) throw new Error('Release archive is invalid or too large');
    const output = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try { fs.copyFileSync(fd, output); } finally { fs.closeSync(output); }
  } finally { fs.closeSync(fd); }
}

async function serviceAction(payload) {
  const engine = ensureEngine(payload.engine);
  const action = String(payload.action || '');
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Unsupported service action');
  await execFileAsync('/bin/systemctl', [action, engine.service], { timeout: 30000 });
  return { success: true };
}

async function writeEngineConfig(payload) {
  const engine = ensureEngine(payload.engine);
  if (!payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
    throw new Error('Engine config must be an object');
  }
  const content = `${JSON.stringify(payload.config, null, 2)}\n`;
  if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new Error('Engine config is too large');
  fs.mkdirSync(path.dirname(engine.config), { recursive: true, mode: 0o750 });
  const tempPath = `${engine.config}.vpn-panel-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, { mode: 0o600 });
    if (payload.engine === 'singbox') {
      await execFileAsync(engine.binary, ['check', '-c', tempPath], { timeout: 30000 });
    } else {
      await execFileAsync(engine.binary, ['-test', '-format', 'json', '-config', tempPath], { timeout: 30000 });
    }
    fs.renameSync(tempPath, engine.config);
    fs.chownSync(engine.config, 0, Number(process.env.PRIVILEGED_GROUP_GID || process.getgid()));
    fs.chmodSync(engine.config, 0o640);
    return { success: true };
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

async function installBinary(payload) {
  const engine = ensureEngine(payload.engine);
  const stagedBinary = ensureSafeStagingPath(payload.stagedBinary);
  const target = engine.binary;
  const targetDir = path.dirname(target);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  const tempTarget = `${target}.vpn-panel-${process.pid}.tmp`;
  fs.copyFileSync(stagedBinary, tempTarget);
  fs.chmodSync(tempTarget, 0o755);
  fs.renameSync(tempTarget, target);

  if (engine === ALLOWED_ENGINES.xray && payload.stagedDataDir) {
    const dataDir = path.resolve(payload.stagedDataDir);
    if (!inside(STAGING_DIR, dataDir)) throw new Error('Xray data staging path is outside the privileged staging directory');
    for (const name of fs.readdirSync(dataDir)) {
      if (!/^[A-Za-z0-9._-]+\.dat$/.test(name)) continue;
      const source = path.join(dataDir, name);
      regularFile(source);
      fs.copyFileSync(source, path.join(targetDir, name));
    }
  }
  await execFileAsync('/bin/systemctl', ['restart', engine.service], { timeout: 30000 });
  return { success: true, target };
}

function copyDir(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
}

function panelTargets(stagingRoot) {
  const targets = [
    ['backend/src', path.join(stagingRoot, 'backend/src')],
    ['backend/public', path.join(stagingRoot, 'backend/public')],
    ['backend/package.json', path.join(stagingRoot, 'backend/package.json')],
    ['backend/package-lock.json', path.join(stagingRoot, 'backend/package-lock.json')],
    ['backend/version.json', path.join(stagingRoot, 'backend/version.json')],
    ['public', path.join(stagingRoot, 'root-public')],
    ['deploy/panel-update-watchdog.js', path.join(stagingRoot, 'deploy/panel-update-watchdog.js')],
  ];
  if (fs.existsSync(path.join(stagingRoot, 'backend/node_modules'))) {
    targets.splice(4, 0, ['backend/node_modules', path.join(stagingRoot, 'backend/node_modules')]);
  }
  return targets;
}

async function promotePanel(payload) {
  const dbBackupPath = path.resolve(payload.dbBackupPath || '');
  const updateId = String(payload.updateId || '');
  const version = String(payload.version || '');
  if (!inside(PANEL_DIR, dbBackupPath) || !/^\d+$/.test(updateId) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Invalid panel promotion parameters');
  }
  regularFile(dbBackupPath);
  const backupDir = path.join(PANEL_DIR, '.panel-update-backups', updateId);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const verifiedDir = fs.mkdtempSync(path.join(STAGING_DIR, `verified-${updateId}-`));
  fs.chownSync(verifiedDir, 0, 0);
  fs.chmodSync(verifiedDir, 0o755);
  const archivePath = path.join(verifiedDir, 'release.tar.gz');
  const manifestPath = path.join(verifiedDir, 'manifest.json');
  const signaturePath = path.join(verifiedDir, 'manifest.sig');
  copyVerifiedFile(ensureSafeStagingPath(payload.archivePath), archivePath);
  copyVerifiedFile(ensureSafeStagingPath(payload.manifestPath), manifestPath);
  copyVerifiedFile(ensureSafeStagingPath(payload.signaturePath), signaturePath);
  validateRelease(archivePath, manifestPath, signaturePath, version);
  fs.chmodSync(archivePath, 0o644);
  const extractedRoot = path.join(verifiedDir, 'extracted');
  const passwd = fs.readFileSync('/etc/passwd', 'utf8').split(/\r?\n/).map((line) => line.split(':')).find((fields) => fields[0] === 'nobody');
  if (!passwd || Number(passwd[2]) < 1) throw new Error('An unprivileged extraction account is required');
  fs.mkdirSync(extractedRoot, { mode: 0o700 });
  fs.chownSync(extractedRoot, Number(passwd[2]), Number(passwd[3]));
  const listing = await execFileAsync('/bin/tar', ['-tzf', archivePath], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.length > 100000 || entries.some((entry) => path.isAbsolute(entry) || entry.split('/').some((part) => part === '..'))) {
    throw new Error('Signed release archive contains unsafe paths');
  }
  await execFileAsync('/bin/tar', ['--no-same-owner', '--no-same-permissions', '-xzf', archivePath, '-C', extractedRoot], {
    timeout: 60000, uid: Number(passwd[2]), gid: Number(passwd[3]),
  });
  const roots = fs.readdirSync(extractedRoot);
  if (roots.length !== 1 || !roots[0].startsWith('vpn-panel-')) throw new Error('Signed release archive layout is invalid');
  const stagingRoot = path.join(extractedRoot, roots[0]);
  rejectSymlinks(stagingRoot);
  if (JSON.parse(fs.readFileSync(path.join(stagingRoot, 'backend/package.json'), 'utf8')).version !== version) {
    throw new Error('Signed release version does not match its package metadata');
  }
  const watchdogSource = path.join(stagingRoot, 'deploy/panel-update-watchdog.js');
  regularFile(watchdogSource);
  const watchdogPath = path.join(backupDir, 'watchdog.js');
  fs.copyFileSync(watchdogSource, watchdogPath);
  fs.chmodSync(watchdogPath, 0o700);
  const dbCopy = path.join(backupDir, 'panel.db');
  fs.copyFileSync(dbBackupPath, dbCopy);
  fs.chmodSync(dbCopy, 0o600);

  const replacements = panelTargets(stagingRoot);
  const transaction = {
    updateId,
    startedAt: Date.now(),
    promoted: false,
    targets: replacements.map(([target], index) => ({
      target,
      backup: `previous-${index}`,
      existed: fs.existsSync(path.join(PANEL_DIR, target)),
      state: 'pending',
    })),
  };
  const transactionPath = path.join(backupDir, 'transaction.json');
  const writeTransaction = () => {
    const temp = `${transactionPath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(transaction, null, 2), { mode: 0o600 });
    fs.renameSync(temp, transactionPath);
  };
  writeTransaction();

  for (let i = 0; i < replacements.length; i += 1) {
    const [targetRelative, stagedPath] = replacements[i];
    const target = path.resolve(PANEL_DIR, targetRelative);
    const backup = path.resolve(backupDir, transaction.targets[i].backup);
    const staged = path.resolve(stagedPath);
    if (!inside(PANEL_DIR, target) || !inside(PANEL_DIR, staged) || !inside(backupDir, backup)) throw new Error('Unsafe panel promotion path');
    const entry = transaction.targets[i];
    if (!fs.existsSync(staged)) throw new Error(`Staged panel file is missing: ${targetRelative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (entry.existed) fs.renameSync(target, backup);
    entry.state = 'backed_up';
    writeTransaction();
    fs.renameSync(staged, target);
    entry.state = 'installed';
    writeTransaction();
  }
  transaction.promoted = true;
  writeTransaction();

  const statePath = path.join(PANEL_DIR, 'data/panel-update-state.json');
  await execFileAsync('/bin/systemd-run', [
    `--unit=vpn-panel-update-watchdog-${updateId}`, '--collect', '--on-active=20s',
    '/usr/bin/node', watchdogPath, statePath, backupDir, PANEL_DIR, path.join(PANEL_DIR, 'data/panel.db'),
    String(process.env.PANEL_PORT || '2096'), version, updateId,
  ], { timeout: 20000 });
  await execFileAsync('/bin/systemd-run', [
    `--unit=vpn-panel-update-restart-${updateId}`, '--collect', '--on-active=2s',
    '/bin/systemctl', 'restart', 'vpn-panel.service',
  ], { timeout: 20000 });
  return { success: true, backupDir, updateId };
}

async function dispatch(operation, payload) {
  switch (operation) {
    case 'service_action': return serviceAction(payload);
    case 'write_engine_config': return writeEngineConfig(payload);
    case 'install_binary': return installBinary(payload);
    case 'promote_panel': return promotePanel(payload);
    default: throw new Error('Unsupported privileged operation');
  }
}

function start() {
  try { fs.unlinkSync(SOCKET_PATH); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true, mode: 0o755 });
  const server = net.createServer((socket) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_REQUEST_BYTES) {
        socket.end(`${JSON.stringify({ ok: false, error: 'Request too large' })}\n`);
        return;
      }
      const newline = data.indexOf('\n');
      if (newline === -1) return;
      const line = data.slice(0, newline);
      data = data.slice(newline + 1);
      let request;
      try { request = JSON.parse(line); } catch {
        socket.end(`${JSON.stringify({ ok: false, error: 'Invalid JSON request' })}\n`);
        return;
      }
      try {
        const result = await dispatch(request.operation, request.payload || {});
        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
      } catch (err) {
        socket.end(`${JSON.stringify({ ok: false, error: err.message })}\n`);
      }
    });
  });
  server.listen(SOCKET_PATH, () => {
    fs.chmodSync(SOCKET_PATH, 0o660);
    try { fs.chownSync(SOCKET_PATH, 0, Number(process.env.PRIVILEGED_GROUP_GID || process.getgid())); } catch {}
    process.stdout.write(`vpn-panel privileged helper listening on ${SOCKET_PATH}\n`);
  });
}

start();
