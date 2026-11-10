/**
 * index.js
 * Main entry point for the VPN Panel backend.
 * Unified management server for sing-box and Xray cores.
 */

'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');

const cfg = require('./config/app-config');
// Ensure database is initialized
const db = require('./config/database');
const Settings = require('./models/Settings');
const PanelUpdaterService = require('./services/panel-updater');
const { importExistingConfigs } = require('./utils/importer');
importExistingConfigs();

const TrafficService = require('./services/traffic');
const { defaultStore: sessionStore } = require('./utils/session-store');
const { csrfProtection } = require('./middleware/csrf');

// Routers
const authRouter = require('./api/auth');
const subscriptionRouter = require('./api/subscription');
const inboundsRouter = require('./api/inbounds');
const engineRouter = require('./api/engine');
const statsRouter = require('./api/stats');
const settingsRouter = require('./api/settings');

const app = express();

// Trust reverse proxy if deployed behind Caddy / Nginx (C3)
app.set('trust proxy', 'loopback');

// Helper to determine active normalized base path
function getActiveBasePath() {
  const raw = Settings.get('web_base_path', cfg.WEB_BASE_PATH || '');
  return Settings.normalizeBasePath(raw);
}

function parseAllowedOrigins(value) {
  return new Set(String(value || '').split(',').map((entry) => {
    try {
      const url = new URL(entry.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
        return null;
      }
      return url.origin;
    } catch {
      return null;
    }
  }).filter(Boolean));
}

const allowedCorsOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

// Helper to load SSL certificate config with fail-closed checks (C3)
function getSslConfig() {
  const certPath = Settings.get('cert_fullchain', cfg.CERT_FULLCHAIN || '');
  const keyPath = Settings.get('cert_privkey', cfg.CERT_PRIVKEY || '');
  const sslMode = Settings.get('panel_ssl', 'auto'); // 'auto' | '1' | '0' | 'false' | 'true' | 'http'

  if (sslMode === '0' || sslMode === 'false' || sslMode === 'http') {
    return null;
  }

  // If explicit TLS mode is configured, verify certificates strictly
  const isExplicitTls = sslMode === '1' || sslMode === 'true' ||
    Boolean(certPath || keyPath || cfg.CERT_FULLCHAIN || cfg.CERT_PRIVKEY);

  if (certPath || keyPath || isExplicitTls) {
    if (!certPath || !keyPath || !fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      if (isExplicitTls && cfg.NODE_ENV === 'production') {
        console.error('[SSL Fatal] TLS certificate is explicitly configured but files are missing or unreadable. Halting to avoid insecure fallback in production.');
        process.exit(1);
      }
      return null;
    }

    try {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      if (cert.length > 50 && key.length > 50) {
        return { cert, key, certPath, keyPath };
      }
    } catch (err) {
      if (cfg.NODE_ENV === 'production') {
        console.error('[SSL Fatal] Failed to read certificate files in production:', err.message);
        process.exit(1);
      }
      console.warn('[SSL] Could not read certificate files:', err.message);
    }
  }

  return null;
}

const sslConfig = getSslConfig();
let server;
let isHttps = false;

if (sslConfig) {
  try {
    server = https.createServer({ cert: sslConfig.cert, key: sslConfig.key }, app);
    isHttps = true;
    console.log(`[SSL] HTTPS server initialized with certificate: ${sslConfig.certPath}`);
  } catch (err) {
    if (cfg.NODE_ENV === 'production') {
      console.error('[SSL Fatal] Failed to initialize HTTPS server:', err.message);
      process.exit(1);
    }
    console.error('[SSL] Failed to initialize HTTPS server, falling back to HTTP in development:', err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

if (isHttps) {
  // Give friendly response when client sends plain HTTP request to HTTPS port
  server.on('clientError', (err, socket) => {
    if (err.code === 'ECONNRESET' || !socket.writable) return;
    try {
      socket.end(
        'HTTP/1.1 400 Bad Request\r\n' +
        'Content-Type: text/html; charset=utf-8\r\n' +
        'Connection: close\r\n\r\n' +
        '<!DOCTYPE html><html><head><title>400 HTTPS Required</title></head>' +
        '<body style="background:#0f1117;color:#fff;font-family:sans-serif;padding:40px;text-align:center;">' +
        '<h2>HTTPS Connection Required</h2>' +
        '<p>This VPN Panel is configured with SSL/TLS encryption.</p>' +
        '<p>Please access this server using <strong style="color:#818cf8;">https://</strong> instead of http://</p>' +
        '</body></html>\r\n'
      );
    } catch {}
  });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false, // Dashboard inline styles
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Also honor HTTPS terminated by a trusted loopback reverse proxy.
app.use((req, res, next) => {
  if (req.secure || isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Same-origin is the default. Cross-origin frontends must be explicitly listed
// as full origins (scheme, hostname, and port), not just a matching hostname.
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    return callback(null, allowedCorsOrigins.has(origin));
  },
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Persistent SQLite Session (H2, C4)
const persistentSecret = process.env.SESSION_SECRET || db.getSetting('session_secret') || cfg.SESSION_SECRET;

const sessionParser = session({
  store: sessionStore,
  secret: persistentSecret,
  resave: false,
  saveUninitialized: false,
  name: 'vpn_sid',
  cookie: {
    // Express uses req.secure, including X-Forwarded-Proto from trusted proxies.
    secure: 'auto',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
});

app.use(sessionParser);

// CSRF & Origin Protection (C4)
app.use(csrfProtection);

// Local update watchdog probe. It exposes the app version and readiness, without host details.
app.get('/healthz', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, version: PanelUpdaterService.getCurrentVersion().version });
});

// ─── Base Path Gatekeeper ─────────────────────────────────────────────────────

app.use((req, res, next) => {
  const basePath = getActiveBasePath();

  // 1. Whitelist public subscription endpoints so external client apps can fetch configs
  if (req.path.startsWith('/sub') || req.path.startsWith('/api/sub')) {
    return next();
  }

  // 2. If no secret base path is set, allow all
  if (!basePath) {
    return next();
  }

  // 3. Exact match without trailing slash -> redirect to trailing slash
  if (req.path === basePath) {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(302, `${basePath}/${qs}`);
  }

  // 4. If request starts with the secret base path (e.g. /secret/...)
  if (req.path.startsWith(`${basePath}/`)) {
    // Strip basePath from req.url so standard internal routers match directly
    req.basePath = basePath;
    req.url = req.url.slice(basePath.length);
    if (!req.url.startsWith('/')) {
      req.url = '/' + req.url;
    }
    return next();
  }

  // 5. Any other request (scanners, bots hitting /, /admin, /login, etc.) gets 404
  return res.status(404).send('Cannot GET ' + req.path);
});

// Keep state-changing APIs quiescent while files are being promoted or rolled back.
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) return next();
  if (req.path === '/auth/login' || req.path === '/engine/panel/update/status') return next();
  const update = PanelUpdaterService.getUpdateProgress();
  if (!['running', 'restarting'].includes(update.status)) return next();
  res.setHeader('Retry-After', '10');
  return res.status(503).json({ success: false, message: 'Panel update is in progress. Retry after it completes.' });
});

// ─── Rate Limiting (Mounted AFTER path normalization) (C4) ────────────────────

const authLimiter = rateLimit({
  windowMs: cfg.RATE_LIMIT_WINDOW_MS,
  max: cfg.LOGIN_RATE_LIMIT_MAX,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);

const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', globalApiLimiter);

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/sub', subscriptionRouter);
app.use('/sub', subscriptionRouter);
app.use('/api/auth', authRouter);
app.use('/api/inbounds', inboundsRouter);
app.use('/api/engine', engineRouter);
app.use('/api/stats', statsRouter);
app.use('/api/settings', settingsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'VPN Panel is operational',
    timestamp: new Date().toISOString(),
  });
});

// ─── Static Frontend Serving ──────────────────────────────────────────────────

const candidateStaticDirs = [
  path.join(__dirname, '../../public'),
  path.join(__dirname, '../../frontend/dist'),
  path.join(__dirname, '../public'),
  '/opt/vpn-panel/public',
];

let staticDir = null;
for (const dir of candidateStaticDirs) {
  if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
    staticDir = dir;
    break;
  }
}

let cachedIndexHtml = null;
let lastIndexMtime = 0;

function getInjectedIndexHtml(basePath) {
  if (!staticDir) return null;
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath)) return null;

  try {
    const stat = fs.statSync(indexPath);
    if (!cachedIndexHtml || stat.mtimeMs > lastIndexMtime) {
      cachedIndexHtml = fs.readFileSync(indexPath, 'utf8');
      lastIndexMtime = stat.mtimeMs;
    }
    const cleanBase = basePath || '/';
    const injection = `<script>window.__BASE_PATH__ = "${cleanBase}";</script>`;
    if (cachedIndexHtml.includes('<head>')) {
      return cachedIndexHtml.replace('<head>', `<head>\n    ${injection}`);
    }
    return cachedIndexHtml.replace('</head>', `    ${injection}\n  </head>`);
  } catch {
    return null;
  }
}

if (staticDir) {
  app.use(express.static(staticDir, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws') || req.path.startsWith('/api') || req.path.includes('/api/')) {
      return next();
    }
    const basePath = getActiveBasePath();
    const html = getInjectedIndexHtml(basePath);
    if (html) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    res.sendFile(path.join(staticDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send(`
      <html>
        <head><title>VPN Panel</title></head>
        <body style="background:#0f1117;color:#fff;font-family:sans-serif;padding:40px;text-align:center;">
          <h1>VPN Panel Backend is Running</h1>
          <p>Frontend assets are being built or not yet deployed to the public folder.</p>
          <p>Access the API at <a href="/api/health" style="color:#818cf8;">/api/health</a></p>
        </body>
      </html>
    `);
  });
}

// Global error handler (M3)
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  const isProduction = cfg.NODE_ENV === 'production';
  res.status(500).json({
    success: false,
    message: isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error'),
    data: null,
  });
});

// ─── WebSocket Server (Authenticated, Origin-Checked, Bounded) (C2) ───────────

const wss = new WebSocketServer({ noServer: true });

function isLoopbackAddress(address = '') {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

function getUpgradeRequestOrigin(request) {
  const fromTrustedProxy = isLoopbackAddress(request.socket?.remoteAddress || '');
  const forwardedHost = fromTrustedProxy ? request.headers['x-forwarded-host'] : null;
  const forwardedProto = fromTrustedProxy ? request.headers['x-forwarded-proto'] : null;
  const requestHost = String(forwardedHost || request.headers.host || '').split(',')[0].trim();
  const requestProto = String(forwardedProto || (isHttps ? 'https' : 'http')).split(',')[0].trim().toLowerCase();

  if (!requestHost || !['http', 'https'].includes(requestProto)) return null;
  try {
    return new URL(`${requestProto}://${requestHost}`).origin;
  } catch {
    return null;
  }
}

server.on('upgrade', (request, socket, head) => {
  const basePath = getActiveBasePath();
  const url = request.url || '';
  const pathname = url.split('?')[0];

  // Strictly require matching base path (C2 base-path bypass fix)
  const allowedPath = basePath ? `${basePath}/ws` : '/ws';
  if (pathname !== allowedPath) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // Validate Origin (C2)
  const origin = request.headers.origin;
  let originAllowed = false;
  try {
    const parsedOrigin = new URL(origin || '');
    const expectedOrigin = getUpgradeRequestOrigin(request);
    originAllowed = Boolean(expectedOrigin) && (
      parsedOrigin.origin === expectedOrigin || allowedCorsOrigins.has(parsedOrigin.origin)
    );
  } catch {}
  if (!originAllowed) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // Parse session and authenticate user (C2)
  sessionParser(request, {}, () => {
    if (!request.session || !request.session.user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (TrafficService.wsClients.size >= TrafficService.MAX_WS_CLIENTS) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
});

wss.on('connection', (ws, req) => {
  TrafficService.addWsClient(ws, req.session?.user);
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(cfg.PANEL_PORT, '0.0.0.0', () => {
  const basePath = getActiveBasePath();
  const protocol = isHttps ? 'https' : 'http';
  const displayUrl = `${protocol}://${cfg.SERVER_IP || 'localhost'}:${cfg.PANEL_PORT}${basePath || '/'}`;
  console.log(`====================================================`);
  console.log(`  VPN Panel Server is listening on port ${cfg.PANEL_PORT}`);
  console.log(`  Protocol:         ${protocol.toUpperCase()} (${isHttps ? 'TLS Encrypted' : 'Plain Text'})`);
  console.log(`  Panel Access URL: ${displayUrl}`);
  console.log(`  Environment:      ${cfg.NODE_ENV}`);
  console.log(`  Sing-box Service: ${cfg.SINGBOX_SERVICE}`);
  console.log(`  Xray Service:     ${cfg.XRAY_SERVICE}`);
  console.log(`====================================================`);

  // Start background traffic polling, quota monitoring, and log retention
  TrafficService.start();
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('\nShutting down VPN Panel gracefully...');
  TrafficService.stop();
  try { wss.close(); } catch {}
  if (server.closeAllConnections) {
    server.closeAllConnections();
  }
  setTimeout(() => {
    process.exit(0);
  }, 1000).unref();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
}
