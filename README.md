# 🌐 Unified VPN Panel (sing-box + Xray)

A unified web management dashboard inspired by 3x-ui, capable of controlling **both sing-box and Xray-core simultaneously** on a single server without port collisions.

---

## 🌟 Key Features

- **Dual-Engine Architecture:** Run `sing-box` and `Xray-core` at the same time, managed through a single cohesive dashboard.
- **Secret Web Base Path (Anti-Scanner Security):** Hide the panel behind a secret URL path (e.g. `http://<IP>:2096/my-secret/`). Requests to root `/` return `404 Not Found`, shielding your server from automated bots and search engines (Shodan, Censys, masscan).
- **One-Click In-Panel Updates:** Update the VPN Panel itself, sing-box, and Xray-core directly from the web panel UI with real-time log streaming and automatic service reconnection.
- **Extensive Protocol Support:**
  - **sing-box:** ShadowTLS v3, Shadowsocks 2022 (`2022-blake3-aes-128-gcm`), VLESS Reality, Hysteria 2, TUIC v5, NaiveProxy, WireGuard.
  - **Xray-core:** VLESS Reality / TLS, VMess (WebSocket + TLS), Trojan, Hysteria 2, Shadowsocks.
- **Client & Inbound Management:**
  - Create, edit, and configure multiple listening inbounds and clients per engine.
  - Universal subscription endpoint (`/api/sub/:token`) supporting Clash Meta (with full Shadow-TLS v3 plugins), Sing-box JSON, and Base64.
  - Generate share links (`vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`, `tuic://`).
  - Instant QR code generation for mobile clients (v2rayNG, Shadowrocket, Sing-box, FoXray, Streisand, Clash Meta).
  - Per-inbound & per-client traffic quotas and expiration dates.
- **Real-Time Monitoring:**
  - WebSocket telemetry push for CPU, RAM, and Disk utilization.
  - Interactive 24-hour traffic area graphs.
  - Live system log viewer with auto-refresh for both engines.
- **Modern Dark UI:** Responsive React + Tailwind CSS dashboard with dark theme aesthetic.
- **Embedded Database:** SQLite (WAL mode) with automatic migration and zero external database dependencies.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        VPN Panel Web Dashboard                         │
│                    (React 18 + Tailwind + Vite)                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / WebSocket (:2096)
┌───────────────────────────────────▼────────────────────────────────────┐
│                         Node.js Express Backend                        │
│          SQLite DB (panel.db) • Auth • Config Sync • Telemetry         │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
                   │ Config Sync & Process           │ Config Sync & Process
                   ▼                                 ▼
┌─────────────────────────────────────┐ ┌────────────────────────────────┐
│           sing-box core             │ │           Xray-core            │
│  - ShadowTLS v3 (2053)              │ │  - Hysteria 2 (443)            │
│  - Shadowsocks 2022 (blake3)        │ │  - VLESS Reality               │
│  - TUIC v5                          │ │  - VMess + WS                  │
└─────────────────────────────────────┘ └────────────────────────────────┘
```

---

## 🚀 Quick Deployment to Debian / Ubuntu Server

Run the remote deployment script from your workstation:

```bash
cd vpn-panel
./deploy/deploy.sh root@<SERVER_IP> -p <SSH_PORT>
```

Or install directly on your target server:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/soulripper13/vpn-panel/main/deploy/install.sh)
```

---

## 🔐 Initial Access & Security

- **URL:** `https://<SERVER_IP>:2096` (or `http://` for local test/dev setups)
- **Initial Setup:** The installer generates secure random credentials or prompts you to configure them in `/opt/vpn-panel/.env` (`ADMIN_USERNAME` and `ADMIN_PASSWORD`).
- **Security Notice:** Change default credentials immediately upon first login. When deploying to production, configure SSL/TLS certificates and place the management interface behind an authenticated proxy or VPN.

---

## 🛠️ Project Structure

```
vpn-panel/
├── backend/
│   ├── src/
│   │   ├── api/          # Express route controllers (auth, inbounds, engine, stats, settings)
│   │   ├── config/       # App config and SQLite setup (better-sqlite3)
│   │   ├── middleware/   # Session auth & Joi request validation
│   │   ├── models/       # Database models (Inbound, Client, User, Settings)
│   │   ├── services/     # sing-box, xray, and traffic monitoring services
│   │   ├── utils/        # Config generators and Link/QR creators
│   │   └── index.js      # Main Express & WebSocket entry point
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/   # UI elements, layouts, and modals
│   │   ├── hooks/        # React Query and WebSocket hooks
│   │   ├── pages/        # Dashboard, Inbounds, Clients, Settings, Logs, Login
│   │   ├── store/        # Zustand auth store
│   │   └── utils/        # Axios API client, formatting helpers, URI links
│   └── package.json
└── deploy/
    ├── deploy.sh         # Workstation remote deploy script
    ├── install.sh        # Server installer & systemd service config
    ├── uninstall.sh      # Clean uninstaller
    ├── update.sh         # Update manager
    └── vpn-panel.service # Systemd service unit definition
```

---

## 🔄 Updates & Upgrades

The panel supports one-click updates directly from the web interface or via CLI:

### 1. In-Panel One-Click Updates (Recommended)
Navigate to **Settings** → **Panel & Core Engine Updates**:
- **VPN Panel:** Detects latest GitHub commits and releases, performs atomic database backup, updates assets, and gracefully restarts the service with live log streaming.
- **sing-box & Xray-core:** Directly updates core binaries in-place from official upstream releases with automated syntax verification and restart.

### 2. Command-Line Update
If SSH access is preferred, run the updater script directly:
```bash
bash /opt/vpn-panel/deploy/update.sh
```
