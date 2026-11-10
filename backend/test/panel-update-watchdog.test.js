const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const watchdogPath = path.join(__dirname, '../../deploy/panel-update-watchdog.js');
const { healthResponseMatches, restoreTransactionFiles, within } = require(watchdogPath);

test('panel update watchdog accepts only a successful response from the expected version', () => {
  assert.equal(healthResponseMatches(200, '{"success":true,"version":"1.3.1"}', '1.3.1'), true);
  assert.equal(healthResponseMatches(200, '{"success":true,"version":"1.3.0"}', '1.3.1'), false);
  assert.equal(healthResponseMatches(503, '{"success":true,"version":"1.3.1"}', '1.3.1'), false);
  assert.equal(healthResponseMatches(200, 'not-json', '1.3.1'), false);
  assert.equal(within('/opt/vpn-panel', '/opt/vpn-panel/data/db.sqlite'), true);
  assert.equal(within('/opt/vpn-panel', '/opt/vpn-panel-backups/db.sqlite'), false);
});

test('panel update watchdog rejects paths outside the installation', async () => {
  const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-panel-watchdog-path-test-'));
  const backupDir = path.join(panelDir, '.panel-update-backups', '12346');
  fs.mkdirSync(backupDir, { recursive: true });
  const updateId = '12346';
  fs.writeFileSync(path.join(backupDir, 'transaction.json'), JSON.stringify({ updateId, promoted: true, targets: [] }));
  try {
    await assert.rejects(execFileAsync(process.execPath, [
      watchdogPath,
      path.join(panelDir, 'state.json'),
      backupDir,
      panelDir,
      path.join(os.tmpdir(), 'outside-panel.db'),
      '12345',
      '1.3.1',
      updateId,
    ]));
  } finally {
    fs.rmSync(panelDir, { recursive: true, force: true });
  }
});

test('panel update watchdog restores a partially promoted file set', () => {
  const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-panel-watchdog-restore-'));
  const backupDir = path.join(panelDir, 'backup');
  const target = path.join(panelDir, 'backend', 'src');
  const backup = path.join(backupDir, 'previous-src');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(target, 'marker.js'), 'new');
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'marker.js'), 'old');
  try {
    const errors = restoreTransactionFiles(panelDir, backupDir, [{
      target: 'backend/src', backup: 'previous-src', existed: true, state: 'installed',
    }], true);
    assert.deepEqual(errors, []);
    assert.equal(fs.readFileSync(path.join(target, 'marker.js'), 'utf8'), 'old');
  } finally {
    fs.rmSync(panelDir, { recursive: true, force: true });
  }
});

test('PanelUpdaterService._promoteDirectly promotes staged files directly when running as root', async () => {
  const PanelUpdaterService = require('../src/services/panel-updater');
  const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-panel-promote-test-'));
  const backupDir = path.join(panelDir, 'backup');
  const stageDir = path.join(panelDir, 'stage');
  const liveTarget = path.join(panelDir, 'backend', 'src');
  const stagedFile = path.join(stageDir, 'app.js');

  fs.mkdirSync(liveTarget, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });

  fs.writeFileSync(path.join(liveTarget, 'app.js'), 'version 1');
  fs.writeFileSync(stagedFile, 'version 2');

  const replacements = [
    ['backend/src', stageDir],
  ];
  const transaction = {
    updateId: '9999',
    startedAt: Date.now(),
    promoted: false,
    targets: [{
      target: 'backend/src',
      backup: 'previous-0',
      existed: true,
      state: 'pending',
    }],
  };

  try {
    const result = await PanelUpdaterService._promoteDirectly({
      panelDir,
      backupDir,
      updateId: '9999',
      version: '1.4.16',
      watchdogPath: path.join(backupDir, 'watchdog.js'),
      transaction,
      replacements,
    });

    assert.equal(result.success, true);
    assert.equal(fs.readFileSync(path.join(liveTarget, 'app.js'), 'utf8'), 'version 2');
    assert.equal(fs.readFileSync(path.join(backupDir, 'previous-0', 'app.js'), 'utf8'), 'version 1');
  } finally {
    fs.rmSync(panelDir, { recursive: true, force: true });
  }
});
