'use strict';

/**
 * VPN Panel — Version Configuration
 *
 * Single source of truth for the application version.
 * You can edit the version here, or in the root /VERSION file.
 */

const fs = require('fs');
const path = require('path');

// Primary version constant
const VERSION = '1.5.1';

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
          return raw.split('\n')[0].trim();
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
