#!/usr/bin/env bash
# =============================================================================
#  VPN Panel — One-Click Install Script
#  Manages sing-box + xray simultaneously on Debian 13
# =============================================================================
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── Config ────────────────────────────────────────────────────────────────────
PANEL_DIR="/opt/vpn-panel"
BACKEND_DIR="${PANEL_DIR}/backend"
FRONTEND_DIR="${PANEL_DIR}/public"
DATA_DIR="${PANEL_DIR}/data"
ENV_FILE="${PANEL_DIR}/.env"
SERVICE_NAME="vpn-panel"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_VERSION="20"

SINGBOX_BIN="/usr/bin/sing-box"
SINGBOX_CONFIG="/etc/sing-box/config.json"
XRAY_BIN="/usr/local/x-ui/bin/xray-linux-amd64"
XRAY_CONFIG="/usr/local/x-ui/bin/config.json"
CERT_PATH="/root/cert/ip/fullchain.pem"
KEY_PATH="/root/cert/ip/privkey.pem"

PANEL_PORT=2096
DEFAULT_ADMIN_USER="admin"
DEFAULT_ADMIN_PASS="admin123"

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}${BLUE}  $*${NC}"; \
            echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"; }

die() {
    error "$*"
    exit 1
}

trap 'error "Install failed on line $LINENO. Check the output above for details."; exit 1' ERR

# ── Step 1: Preflight checks ──────────────────────────────────────────────────
header "VPN Panel Installer — Preflight Checks"

[[ $EUID -eq 0 ]] || die "This script must be run as root (sudo or su -)."

if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
    [[ "${ID}" == "debian" ]] || warn "Not Debian — detected: ${ID}. Proceeding anyway, but untested."
    info "OS: ${PRETTY_NAME}"
else
    warn "Cannot detect OS. Proceeding anyway."
fi

info "Checking for existing services..."
for bin in curl wget tar node npm sqlite3; do
    command -v "$bin" &>/dev/null && info "  ✔ $bin found" || info "  ✗ $bin not found (will install)"
done

# ── Step 2: Install system dependencies ───────────────────────────────────────
header "Installing System Dependencies"

apt-get update -qq
apt-get install -y --no-install-recommends \
    curl wget ca-certificates gnupg lsb-release \
    tar gzip unzip sqlite3 openssl ufw iptables jq git \
    2>/dev/null
success "System packages installed."

# ── Step 3: Enable TCP BBR Congestion Control ─────────────────────────────────
header "Enabling TCP BBR Congestion Control"

if ! grep -q "net.ipv4.tcp_congestion_control=bbr" /etc/sysctl.conf 2>/dev/null; then
    echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
    echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
    sysctl -p >/dev/null 2>&1 || true
    success "TCP BBR enabled."
else
    success "TCP BBR is already enabled."
fi

# ── Step 4: Install sing-box Core ─────────────────────────────────────────────
header "Checking / Installing sing-box Core"

SINGBOX_INSTALLED=false
if command -v sing-box &>/dev/null || [[ -f /usr/bin/sing-box ]] || [[ -f /usr/local/bin/sing-box ]]; then
    SINGBOX_INSTALLED=true
    success "sing-box already installed: $(command -v sing-box || echo /usr/bin/sing-box)"
else
    info "Installing sing-box..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://sing-box.app/gpg.key -o /etc/apt/keyrings/sagernet.asc 2>/dev/null || true
    chmod 644 /etc/apt/keyrings/sagernet.asc 2>/dev/null || true
    echo "deb [signed-by=/etc/apt/keyrings/sagernet.asc] https://deb.sagernet.org/ * *" > /etc/apt/sources.list.d/sagernet.list
    apt-get update -qq 2>/dev/null || true
    apt-get install -y sing-box 2>/dev/null && SINGBOX_INSTALLED=true

    if [[ "$SINGBOX_INSTALLED" == false ]] || ! command -v sing-box &>/dev/null; then
        info "Falling back to official GitHub release binary for sing-box..."
        SB_VER=$(curl -s https://api.github.com/repos/SagerNet/sing-box/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
        ARCH=$(dpkg --print-architecture 2>/dev/null || echo "amd64")
        curl -Lo /tmp/sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v${SB_VER}/sing-box-${SB_VER}-linux-${ARCH}.tar.gz"
        tar -xzf /tmp/sing-box.tar.gz -C /tmp/
        mv /tmp/sing-box-${SB_VER}-linux-${ARCH}/sing-box /usr/bin/sing-box
        chmod +x /usr/bin/sing-box
        rm -rf /tmp/sing-box*
        success "sing-box v${SB_VER} installed from GitHub."
    fi
fi

# Ensure sing-box symlink in /usr/local/bin
if [[ -f /usr/bin/sing-box && ! -f /usr/local/bin/sing-box ]]; then
    ln -sf /usr/bin/sing-box /usr/local/bin/sing-box
fi

# Ensure /etc/sing-box/config.json exists
mkdir -p /etc/sing-box
if [[ ! -f /etc/sing-box/config.json ]]; then
    cat > /etc/sing-box/config.json <<EOF
{
  "log": { "level": "info", "timestamp": true },
  "inbounds": [],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF
fi

# Ensure sing-box systemd service exists & is enabled
if [[ ! -f /etc/systemd/system/sing-box.service && ! -f /lib/systemd/system/sing-box.service ]]; then
    cat > /etc/systemd/system/sing-box.service <<EOF
[Unit]
Description=sing-box service
Documentation=https://sing-box.sagernet.org
After=network.target nss-lookup.target

[Service]
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
ExecStart=/usr/bin/sing-box run -c /etc/sing-box/config.json
Restart=on-failure
RestartSec=5s
LimitNOFILE=infinity

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
fi
systemctl enable sing-box 2>/dev/null || true
systemctl start sing-box 2>/dev/null || true
success "sing-box service enabled."

# ── Step 5: Install Xray Core ─────────────────────────────────────────────────
header "Checking / Installing Xray Core"

XRAY_INSTALLED=false
if command -v xray &>/dev/null || [[ -f /usr/local/bin/xray ]] || [[ -f /usr/local/x-ui/bin/xray-linux-amd64 ]]; then
    XRAY_INSTALLED=true
    success "Xray already installed: $(command -v xray || echo /usr/local/bin/xray)"
else
    info "Installing Xray core from official GitHub release..."
    XRAY_VER=$(curl -s https://api.github.com/repos/XTLS/Xray-core/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    ARCH=$(dpkg --print-architecture 2>/dev/null || echo "64")
    [[ "$ARCH" == "amd64" ]] && ARCH="64"
    [[ "$ARCH" == "arm64" ]] && ARCH="arm64-v8a"
    curl -Lo /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VER}/Xray-linux-${ARCH}.zip"
    mkdir -p /usr/local/bin /usr/local/share/xray /usr/local/x-ui/bin /etc/xray /tmp/xray-extracted
    unzip -qo /tmp/xray.zip -d /tmp/xray-extracted
    mv /tmp/xray-extracted/xray /usr/local/bin/xray
    mv /tmp/xray-extracted/geoip.dat /usr/local/share/xray/ 2>/dev/null || true
    mv /tmp/xray-extracted/geosite.dat /usr/local/share/xray/ 2>/dev/null || true
    chmod +x /usr/local/bin/xray
    rm -rf /tmp/xray*
    success "Xray v${XRAY_VER} installed from GitHub."
fi

# Ensure compatibility symlinks
mkdir -p /usr/local/x-ui/bin /usr/local/bin
if [[ -f /usr/local/bin/xray && ! -f /usr/local/x-ui/bin/xray-linux-amd64 ]]; then
    ln -sf /usr/local/bin/xray /usr/local/x-ui/bin/xray-linux-amd64
fi
if [[ -f /usr/local/x-ui/bin/xray-linux-amd64 && ! -f /usr/local/bin/xray ]]; then
    ln -sf /usr/local/x-ui/bin/xray-linux-amd64 /usr/local/bin/xray
fi
if [[ -f /usr/local/bin/xray && ! -f /usr/bin/xray ]]; then
    ln -sf /usr/local/bin/xray /usr/bin/xray
fi

# Ensure config file exists
if [[ ! -f /usr/local/x-ui/bin/config.json && ! -f /etc/xray/config.json ]]; then
    cat > /usr/local/x-ui/bin/config.json <<EOF
{
  "log": { "loglevel": "info" },
  "inbounds": [],
  "outbounds": [{ "protocol": "freedom", "tag": "direct" }]
}
EOF
fi

# Ensure xray systemd service exists & is enabled
if [[ ! -f /etc/systemd/system/xray.service && ! -f /lib/systemd/system/xray.service ]]; then
    cat > /etc/systemd/system/xray.service <<EOF
[Unit]
Description=Xray Service
Documentation=https://github.com/xtls
After=network.target nss-lookup.target

[Service]
User=root
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=/usr/local/bin/xray run -config /usr/local/x-ui/bin/config.json
Restart=on-failure
RestartPreventExitStatus=23
LimitNPROC=10000
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
fi
systemctl enable xray 2>/dev/null || true
systemctl start xray 2>/dev/null || true
success "xray service enabled."

# ── Step 6: Install Node.js 20 ────────────────────────────────────────────────
header "Installing Node.js ${NODE_VERSION}"

if node --version 2>/dev/null | grep -q "^v${NODE_VERSION}\."; then
    success "Node.js $(node --version) already installed."
else
    info "Adding NodeSource repository..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
    success "Node.js $(node --version) installed."
fi

info "npm version: $(npm --version)"

# ── Step 7: Stop & disable conflicting x-ui panel ─────────────────────────────
header "Checking for Conflicting Services"

if systemctl is-active --quiet x-ui 2>/dev/null; then
    info "Stopping conflicting x-ui.service..."
    systemctl stop x-ui
    success "x-ui stopped."
fi

if systemctl is-enabled --quiet x-ui 2>/dev/null; then
    info "Disabling conflicting x-ui.service..."
    systemctl disable x-ui
    success "x-ui disabled."
fi

# ── Step 8: Create directory structure ───────────────────────────────────────
header "Creating Directory Structure"

mkdir -p "${BACKEND_DIR}" "${FRONTEND_DIR}" "${DATA_DIR}"
info "Created: ${PANEL_DIR}"

# ── Step 9: Deploy panel files ────────────────────────────────────────────────
header "Deploying Panel Files"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# If run directly via curl pipe (e.g. bash <(curl -Ls ...))
if [[ ! -d "${SOURCE_DIR}/backend" ]]; then
    info "Running from remote pipe — cloning repository from GitHub..."
    TMP_CLONE="/tmp/vpn-panel-repo"
    rm -rf "${TMP_CLONE}"
    git clone https://github.com/soulripper13/vpn-panel.git "${TMP_CLONE}"
    SOURCE_DIR="${TMP_CLONE}"
    SCRIPT_DIR="${SOURCE_DIR}/deploy"
fi

# Backend
if [[ -d "${SOURCE_DIR}/backend" ]]; then
    info "Copying backend..."
    rsync -a --delete "${SOURCE_DIR}/backend/" "${BACKEND_DIR}/"
    success "Backend copied to ${BACKEND_DIR}"
else
    die "Backend source directory not found: ${SOURCE_DIR}/backend"
fi

# Frontend (pre-built dist)
if [[ -d "${SOURCE_DIR}/frontend/dist" ]]; then
    info "Copying pre-built frontend..."
    rsync -a --delete "${SOURCE_DIR}/frontend/dist/" "${FRONTEND_DIR}/"
    success "Frontend copied to ${FRONTEND_DIR}"
elif [[ -d "${SOURCE_DIR}/frontend" ]]; then
    warn "Frontend dist not found. Building frontend now (requires internet)..."
    cd "${SOURCE_DIR}/frontend"
    npm install --silent
    npm run build
    rsync -a --delete "${SOURCE_DIR}/frontend/dist/" "${FRONTEND_DIR}/"
    cd -
    success "Frontend built and copied."
else
    die "Frontend source directory not found: ${SOURCE_DIR}/frontend"
fi

# ── Step 10: Install backend dependencies ────────────────────────────────────
header "Installing Backend Dependencies"

cd "${BACKEND_DIR}"
info "Running npm install --production ..."
npm install --production --silent
success "Backend dependencies installed."
cd -

# ── Step 11: Install systemd service ─────────────────────────────────────────
header "Installing Systemd Service"

cp "${SCRIPT_DIR}/vpn-panel.service" "${SERVICE_FILE}"
systemctl daemon-reload
success "Service file installed at ${SERVICE_FILE}"

# ── Step 12: Create .env config ───────────────────────────────────────────────
header "Creating Configuration"

SESSION_SECRET=$(openssl rand -hex 32)

if [[ -f "${ENV_FILE}" ]]; then
    warn ".env already exists — backing up to ${ENV_FILE}.bak"
    cp "${ENV_FILE}" "${ENV_FILE}.bak"
fi

cat > "${ENV_FILE}" << EOF
NODE_ENV=production
PANEL_PORT=${PANEL_PORT}
SESSION_SECRET=${SESSION_SECRET}
DB_PATH=${DATA_DIR}/panel.db
SINGBOX_BIN=${SINGBOX_BIN}
SINGBOX_CONFIG=${SINGBOX_CONFIG}
XRAY_BIN=${XRAY_BIN}
XRAY_CONFIG=${XRAY_CONFIG}
CERT_PATH=${CERT_PATH}
KEY_PATH=${KEY_PATH}
LOG_LEVEL=info
EOF

chmod 600 "${ENV_FILE}"
success ".env written to ${ENV_FILE}"

# ── Step 13: Initialize SQLite database ─────────────────────────────────────
header "Initializing Database"

DB_PATH="${DATA_DIR}/panel.db"

HASHED_PASS=$(node -e "
const crypto = require('crypto');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.createHmac('sha256', salt).update('${DEFAULT_ADMIN_PASS}').digest('hex');
console.log(salt + ':' + hash);
")

sqlite3 "${DB_PATH}" << SQLEOF
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    UNIQUE NOT NULL,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'admin',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login  DATETIME
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users (username, password, role)
VALUES ('${DEFAULT_ADMIN_USER}', '${HASHED_PASS}', 'admin');

INSERT OR REPLACE INTO settings (key, value) VALUES
    ('panel_port', '${PANEL_PORT}'),
    ('theme', 'dark'),
    ('log_retention_days', '7');
SQLEOF

chmod 600 "${DB_PATH}"
success "Database initialized at ${DB_PATH}"
info "Default credentials → user: ${DEFAULT_ADMIN_USER} / pass: ${DEFAULT_ADMIN_PASS}"

# ── Step 14: Set ownership & permissions ────────────────────────────────────
header "Setting Permissions"

chown -R root:root "${PANEL_DIR}"
chmod -R 750 "${PANEL_DIR}"
chmod 755 "${FRONTEND_DIR}"
success "Permissions set."

# ── Step 15: Configure firewall (optional) ───────────────────────────────────
header "Firewall Configuration"

if command -v ufw &>/dev/null; then
    if ufw status | grep -q "Status: active"; then
        ufw allow "${PANEL_PORT}/tcp" comment "VPN Panel" 2>/dev/null && \
            success "UFW: port ${PANEL_PORT} allowed." || \
            warn "UFW rule add failed — check manually."
    else
        info "UFW is inactive — skipping firewall rule."
    fi
else
    info "UFW not installed — skipping firewall configuration."
fi

# ── Step 16: Start service ───────────────────────────────────────────────────
header "Starting VPN Panel Service"

systemctl enable "${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"

sleep 2

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    success "vpn-panel.service is running!"
else
    error "Service failed to start. Check logs:"
    journalctl -u "${SERVICE_NAME}" -n 30 --no-pager
    die "Startup failed."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      VPN Panel Installed Successfully!       ║${NC}"
echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Panel URL : ${CYAN}http://${SERVER_IP}:${PANEL_PORT}${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Username  : ${YELLOW}${DEFAULT_ADMIN_USER}${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Password  : ${YELLOW}${DEFAULT_ADMIN_PASS}${NC}"
echo -e "${BOLD}${GREEN}║${NC}"
echo -e "${BOLD}${GREEN}║${NC}  ${RED}⚠ Change your password immediately!${NC}"
echo -e "${BOLD}${GREEN}║${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Config    : ${ENV_FILE}"
echo -e "${BOLD}${GREEN}║${NC}  Logs      : journalctl -u vpn-panel -f"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
