#!/usr/bin/env node
'use strict';

// Runs as a short-lived system service so it survives the panel restart.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const [statePathArg, backupDirArg, panelDirArg, dbPathArg, portArg, versionArg, updateIdArg] = process.argv.slice(2);

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function restoreTransactionFiles(panelDir, backupDir, targets, promoted) {
  const errors = [];
  for (const entry of [...targets].reverse()) {
    const target = path.resolve(panelDir, entry.target);
    const backup = path.resolve(backupDir, entry.backup);
    if (!within(panelDir, target) || !within(backupDir, backup)) {
      errors.push('Unsafe path in update transaction manifest');
      continue;
    }
    const needsRestore = ['backed_up', 'installed'].includes(entry.state) ||
      (entry.existed && fs.existsSync(backup) && !fs.existsSync(target)) ||
      (promoted !== true && !entry.existed && fs.existsSync(target));
    if (!needsRestore) continue;
    if (entry.existed && !fs.existsSync(backup)) {
      errors.push(`Rollback copy is missing for ${entry.target}; kept the current path in place.`);
      continue;
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (entry.existed) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(backup, target);
      }
    } catch (err) { errors.push(`Could not restore ${entry.target}: ${err.message}`); }
  }
  return errors;
}

function safeRoot(root) {
  return path.resolve(root);
}

function healthResponseMatches(statusCode, body, expectedVersion = null) {
  try {
    const payload = JSON.parse(body);
    return statusCode === 200 && payload.success === true && (!expectedVersion || payload.version === expectedVersion);
  } catch {
    return false;
  }
}

function writeState(statePath, update) {
  const temp = `${statePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(temp, JSON.stringify(update, null, 2), { mode: 0o600 });
  fs.renameSync(temp, statePath);
}

function requestHealth(protocol, port, expectedVersion = null) {
  return new Promise((resolve) => {
    const client = protocol === 'https:' ? https : http;
    let body = '';
    const req = client.get({
      protocol,
      hostname: '127.0.0.1',
      port,
      path: '/healthz',
      timeout: 3000,
      ...(protocol === 'https:' ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
        if (body.length > 2048) req.destroy();
      });
      res.on('end', () => {
        resolve(healthResponseMatches(res.statusCode, body, expectedVersion));
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function isHealthy(port, expectedVersion = null) {
  return (await requestHealth('https:', port, expectedVersion)) || requestHealth('http:', port, expectedVersion);
}

async function waitForHealth(port, timeoutMs, expectedVersion = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(port, expectedVersion)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function waitForPromotion(manifestPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.promoted === true) return manifest;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function main() {
  if (!statePathArg || !backupDirArg || !panelDirArg || !dbPathArg || !portArg || !versionArg || !updateIdArg || !/^\d+$/.test(updateIdArg)) {
    throw new Error('Invalid update watchdog arguments');
  }

  const panelDir = safeRoot(panelDirArg);
  const backupDir = safeRoot(backupDirArg);
  const statePath = safeRoot(statePathArg);
  const dbPath = safeRoot(dbPathArg);
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !within(panelDir, backupDir) || !within(panelDir, statePath) || !within(panelDir, dbPath)) {
    throw new Error('Update watchdog paths or port are outside the installation');
  }

  const manifestPath = path.join(backupDir, 'transaction.json');
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.targets) || manifest.updateId !== updateIdArg) {
    throw new Error('Update transaction manifest is invalid');
  }
  let priorState = {};
  try { priorState = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

  writeState(statePath, {
    status: 'restarting',
    step: 'health_check',
    progress: 98,
    logs: [...(priorState.logs || []), `[${new Date().toISOString()}] Waiting for the updated panel health check.`].slice(-300),
    startedAt: manifest.startedAt,
    finishedAt: null,
    version: versionArg,
  });

  if (manifest.promoted !== true) {
    const promotedManifest = await waitForPromotion(manifestPath, 60000);
    if (promotedManifest) manifest = promotedManifest;
  }

  if (manifest.promoted === true && await waitForHealth(port, 90000, versionArg)) {
    writeState(statePath, {
      status: 'completed',
      step: 'completed',
      progress: 100,
      logs: [...(priorState.logs || []), `[${new Date().toISOString()}] Updated panel passed its local health check.`].slice(-300),
      startedAt: manifest.startedAt,
      finishedAt: Date.now(),
      version: versionArg,
    });
    return;
  }

  const errors = [];
  try {
    await execFileAsync('/bin/systemctl', ['stop', 'vpn-panel.service'], { timeout: 30000 });
  } catch (err) { errors.push(`Could not stop the failed panel: ${err.message}`); }

  errors.push(...restoreTransactionFiles(panelDir, backupDir, manifest.targets, manifest.promoted));

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
    const restoredDbPath = `${dbPath}.${updateIdArg}.restore`;
    fs.copyFileSync(path.join(backupDir, 'panel.db'), restoredDbPath);
    fs.chmodSync(restoredDbPath, 0o600);
    fs.renameSync(restoredDbPath, dbPath);
  } catch (err) { errors.push(`Could not restore the database backup: ${err.message}`); }

  try {
    await execFileAsync('/bin/systemctl', ['start', 'vpn-panel.service'], { timeout: 30000 });
  } catch (err) { errors.push(`Could not start the restored panel: ${err.message}`); }

  const restored = await waitForHealth(port, 60000);
  const reason = restored
    ? 'The update did not pass its health check; the previous panel was restored.'
    : 'The update failed and the previous panel did not pass its health check.';
  writeState(statePath, {
    status: 'failed',
    step: 'rolled_back',
    progress: 100,
    logs: [...(priorState.logs || []), `[${new Date().toISOString()}] ${reason}`, ...errors].slice(-300),
    error: errors.length ? `${reason} ${errors.join('; ')}` : reason,
    startedAt: manifest.startedAt,
    finishedAt: Date.now(),
    version: versionArg,
  });

  if (!restored || errors.length) process.exitCode = 1;
}

function reportFailure(err) {
  try {
    const statePath = path.resolve(statePathArg || '/dev/null');
    const panelDir = path.resolve(panelDirArg || '/');
    if (within(panelDir, statePath)) {
      writeState(statePath, {
        status: 'failed', step: 'watchdog_error', progress: 100,
        logs: [`[${new Date().toISOString()}] Update watchdog failed: ${err.message}`],
        error: `Update watchdog failed: ${err.message}`, finishedAt: Date.now(),
      });
    }
  } catch {}
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exitCode = 1;
}

if (require.main === module) main().catch(reportFailure);

module.exports = { healthResponseMatches, restoreTransactionFiles, within };
