'use strict';

const fs = require('fs');
const net = require('net');
const cfg = require('../config/app-config');

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function isConfigured() { return fs.existsSync(cfg.PRIVILEGED_SOCKET); }

function call(operation, payload = {}, timeoutMs = 30000) {
  if (!isConfigured()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: cfg.PRIVILEGED_SOCKET });
    let response = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Privileged helper request timed out')), timeoutMs);

    socket.once('connect', () => {
      const request = JSON.stringify({ operation, payload });
      if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
        clearTimeout(timer);
        return finish(new Error('Privileged helper request is too large'));
      }
      socket.write(`${request}\n`);
    });
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {
        clearTimeout(timer);
        finish(new Error('Privileged helper response is too large'));
        return;
      }
      const newline = response.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(response.slice(0, newline)); } catch {
        finish(new Error('Invalid response from privileged helper'));
        return;
      }
      if (!parsed.ok) finish(new Error(parsed.error || 'Privileged operation failed'));
      else finish(null, parsed.result);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      finish(new Error(`Privileged helper unavailable: ${error.message}`));
    });
    socket.once('close', () => {
      clearTimeout(timer);
      if (!settled) finish(new Error('Privileged helper closed the connection'));
    });
  });
}

async function callRequired(operation, payload = {}, timeoutMs = 30000) {
  const result = await call(operation, payload, timeoutMs);
  if (result === null && process.env.REQUIRE_PRIVILEGED_HELPER === '1') {
    throw new Error('Privileged helper is required in production but is not available');
  }
  return result;
}

module.exports = { call, callRequired, isConfigured };
