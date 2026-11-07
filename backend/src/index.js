/**
 * index.js
 * Main entry point for the VPN Panel backend.
 * Unified management server for sing-box and Xray cores.
 */

'use strict';

const http = require('http');
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
const { importExistingConfigs } = require('./utils/importer');
importExistingConfigs();

const TrafficService = require('./services/traffic');

// Routers
const authRouter = require('./api/auth');
const inboundsRouter = require('./api/inbounds');
const engineRouter = require('./api/engine');
const statsRouter = require('./api/stats');
const settingsRouter = require('./api/settings');

const app = express();
const server = http.createServer(app);

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
      secure: false, // Set to true if running over HTTPS directly
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

// ─── API Routes ───────────────────────────────────────────────────────────────

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

if (staticDir) {
  console.log(`[Static] Serving frontend from: ${staticDir}`);
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
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

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  TrafficService.addWsClient(ws);
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(cfg.PANEL_PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  VPN Panel Server is listening on port ${cfg.PANEL_PORT}`);
  console.log(`  Environment: ${cfg.NODE_ENV}`);
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
