#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const versionFilePath = path.join(rootDir, 'VERSION');

let newVersion = process.argv[2];

// If no argument provided, read the current version from the main VERSION file
if (!newVersion) {
  if (fs.existsSync(versionFilePath)) {
    newVersion = fs.readFileSync(versionFilePath, 'utf8').trim().split('\n')[0].trim();
  }
}

if (!newVersion || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(newVersion)) {
  console.error('Usage: node scripts/set-version.js <new-version> (e.g. 1.4.24)');
  console.error('Or simply edit the main VERSION file and run: node scripts/set-version.js');
  process.exit(1);
}

// 1. Root VERSION (Single source of truth)
fs.writeFileSync(versionFilePath, `${newVersion}\n`, 'utf8');
console.log(`[OK] Updated VERSION -> ${newVersion}`);

// 2. backend/src/config/version.js
const versionJsPath = path.join(rootDir, 'backend/src/config/version.js');
const versionJsContent = `'use strict';

/**
 * VPN Panel — Version Configuration
 *
 * Single source of truth for the application version.
 * You can edit the version here, or in the root /VERSION file.
 */

const fs = require('fs');
const path = require('path');

// Primary version constant
const VERSION = '${newVersion}';

function getVersion() {
  const candidatePaths = [
    path.resolve(__dirname, '../../../VERSION'),
    path.resolve(__dirname, '../../VERSION'),
    path.resolve(__dirname, '../../version.json'),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8').trim();
        if (candidate.endsWith('.json')) {
          const parsed = JSON.parse(raw);
          if (parsed.version) return String(parsed.version).trim();
        } else if (raw) {
          return raw.split('\\n')[0].trim();
        }
      } catch {}
    }
  }

  return VERSION;
}

const currentVersion = getVersion();

module.exports = {
  VERSION: currentVersion,
  getVersion,
};
`;
fs.writeFileSync(versionJsPath, versionJsContent, 'utf8');
console.log(`[OK] Updated backend/src/config/version.js -> ${newVersion}`);

// 3. backend/version.json
const verJsonPath = path.join(rootDir, 'backend/version.json');
let verJson = {};
try {
  verJson = JSON.parse(fs.readFileSync(verJsonPath, 'utf8'));
} catch {}
verJson.version = newVersion;
verJson.buildDate = new Date().toISOString();
fs.writeFileSync(verJsonPath, JSON.stringify(verJson, null, 2) + '\n', 'utf8');
console.log(`[OK] Updated backend/version.json -> ${newVersion}`);

// 4. backend/package.json
const backendPkgPath = path.join(rootDir, 'backend/package.json');
if (fs.existsSync(backendPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(backendPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[OK] Updated backend/package.json -> ${newVersion}`);
}

// 5. frontend/package.json
const frontendPkgPath = path.join(rootDir, 'frontend/package.json');
if (fs.existsSync(frontendPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(frontendPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[OK] Updated frontend/package.json -> ${newVersion}`);
}

// 6. backend/package-lock.json
const backendLockPath = path.join(rootDir, 'backend/package-lock.json');
if (fs.existsSync(backendLockPath)) {
  try {
    const lock = JSON.parse(fs.readFileSync(backendLockPath, 'utf8'));
    lock.version = newVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = newVersion;
    }
    fs.writeFileSync(backendLockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
    console.log(`[OK] Updated backend/package-lock.json -> ${newVersion}`);
  } catch {}
}

console.log(`\nSuccessfully synced VPN Panel version to v${newVersion}!`);
