#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(newVersion)) {
  console.error('Usage: node scripts/set-version.js <new-version> (e.g. 1.4.20)');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

// 1. backend/version.json
const verJsonPath = path.join(rootDir, 'backend/version.json');
let verJson = {};
try {
  verJson = JSON.parse(fs.readFileSync(verJsonPath, 'utf8'));
} catch {}
verJson.version = newVersion;
verJson.buildDate = new Date().toISOString();
fs.writeFileSync(verJsonPath, JSON.stringify(verJson, null, 2) + '\n');
console.log(`[OK] Updated backend/version.json -> ${newVersion}`);

// 2. backend/package.json
const backendPkgPath = path.join(rootDir, 'backend/package.json');
if (fs.existsSync(backendPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(backendPkgPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(backendPkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[OK] Updated backend/package.json -> ${newVersion}`);
}

// 3. frontend/package.json
const frontendPkgPath = path.join(rootDir, 'frontend/package.json');
if (fs.existsSync(frontendPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(frontendPkgPath, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(frontendPkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[OK] Updated frontend/package.json -> ${newVersion}`);
}

// 4. backend/package-lock.json
const backendLockPath = path.join(rootDir, 'backend/package-lock.json');
if (fs.existsSync(backendLockPath)) {
  try {
    const lock = JSON.parse(fs.readFileSync(backendLockPath, 'utf8'));
    lock.version = newVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = newVersion;
    }
    fs.writeFileSync(backendLockPath, JSON.stringify(lock, null, 2) + '\n');
    console.log(`[OK] Updated backend/package-lock.json -> ${newVersion}`);
  } catch {}
}

console.log(`\nSuccessfully bumped VPN Panel version to v${newVersion}!`);
