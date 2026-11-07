# 🌐 Unified VPN Panel (sing-box + Xray)

A unified web management dashboard inspired by 3x-ui, capable of controlling **both sing-box and Xray-core simultaneously** on a single server without port collisions.

---

## 🌟 Key Features

- **Dual-Engine Architecture:** Run `sing-box` and `Xray-core` at the same time, managed through a single cohesive dashboard.
- **Extensive Protocol Support:**
  - **sing-box:** ShadowTLS v3, Shadowsocks 2022 (`2022-blake3-aes-128-gcm`), VLESS Reality, Hysteria 2, TUIC v5, NaiveProxy, WireGuard.
  - **Xray-core:** VLESS Reality / TLS, VMess (WebSocket + TLS), Trojan, Hysteria 2, Shadowsocks.
- **Client & Inbound Management:**
  - Create and configure multiple listening inbounds per engine.
  - Generate share links (`vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`, `tuic://`).
  - Instant QR code generation for mobile clients (v2rayNG, Sing-box, FoXray, Streisand, Clash Meta).
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
./deploy/deploy.sh root@107.182.23.115 -p 26183
```

Or install directly on your target server:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/soulripper13/vpn-panel/main/deploy/install.sh)
```

---

## 🔐 Default Credentials

- **URL:** `http://<SERVER_IP>:2096`
- **Username:** `admin`
- **Password:** `admin123`

*(Remember to change the admin password in the Settings page upon initial login.)*

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
