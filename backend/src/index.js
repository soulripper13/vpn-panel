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
require('./config/database');
const Settings = require('./models/Settings');
const { importExistingConfigs } = require('./utils/importer');
importExistingConfigs();

const TrafficService = require('./services/traffic');

// Routers
const authRouter = require('./api/auth');
const subscriptionRouter = require('./api/subscription');
const inboundsRouter = require('./api/inbounds');
const engineRouter = require('./api/engine');
const statsRouter = require('./api/stats');
const settingsRouter = require('./api/settings');

const app = express();

// Helper to determine active normalized base path
function getActiveBasePath() {
  const raw = Settings.get('web_base_path', cfg.WEB_BASE_PATH || '');
  return Settings.normalizeBasePath(raw);
}

// Helper to load SSL certificate config if available
function getSslConfig() {
  const certPath = Settings.get('cert_fullchain', cfg.CERT_FULLCHAIN || '');
  const keyPath = Settings.get('cert_privkey', cfg.CERT_PRIVKEY || '');
  const sslMode = Settings.get('panel_ssl', 'auto'); // 'auto' | '1' | '0'

  if (sslMode === '0' || sslMode === 'false' || sslMode === 'http') {
    return null;
  }

  if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      if (cert.length > 50 && key.length > 50) {
        return { cert, key, certPath, keyPath };
      }
    } catch (err) {
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
    console.error('[SSL] Failed to initialize HTTPS server, falling back to HTTP:', err.message);
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
  contentSecurityPolicy: false, // Allow inline styles & scripts for dashboard
}));

app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Session
app.use(
  session({
    secret: cfg.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isHttps, // Secure cookie if running over HTTPS
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
    },
  })
);

// Rate limiting for auth
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

// ─── Base Path Gatekeeper ─────────────────────────────────────────────────────

app.use((req, res, next) => {
  const basePath = getActiveBasePath();

  // 1. Always whitelist subscription endpoints so external client apps can fetch configs
  if (req.path.startsWith('/sub') || req.path.startsWith('/api/sub')) {
    return next();
  }

  // 2. If no secret base path is set (standard root deployment '/'), allow all
  if (!basePath) {
    return next();
  }

  // 3. Exact match without trailing slash -> redirect to trailing slash (e.g. /secret -> /secret/)
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

// Candidate frontend directories
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
    const injection = `<script>window.__BASE_PATH__ = "${cleanBase}";</script>\n  `;
    return cachedIndexHtml.replace('</head>', `${injection}</head>`);
  } catch {
    return null;
  }
}

if (staticDir) {
  console.log(`[Static] Serving frontend from: ${staticDir}`);
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

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    data: null,
  });
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const basePath = getActiveBasePath();
  const url = request.url || '';
  const pathname = url.split('?')[0];

  const allowedPath = basePath ? `${basePath}/ws` : '/ws';
  if (pathname === allowedPath || pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  TrafficService.addWsClient(ws);
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

  // Start background traffic polling
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
