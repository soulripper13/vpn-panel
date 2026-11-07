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
    tar gzip sqlite3 openssl ufw \
    2>/dev/null
success "System packages installed."

# ── Step 3: Install Node.js 20 ────────────────────────────────────────────────
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

# ── Step 4: Stop & disable x-ui ──────────────────────────────────────────────
header "Replacing x-ui Panel"

if systemctl is-active --quiet x-ui 2>/dev/null; then
    info "Stopping x-ui.service..."
    systemctl stop x-ui
    success "x-ui stopped."
else
    info "x-ui is not running (skipping stop)."
fi

if systemctl is-enabled --quiet x-ui 2>/dev/null; then
    info "Disabling x-ui.service..."
    systemctl disable x-ui
    success "x-ui disabled."
else
    info "x-ui is not enabled (skipping disable)."
fi

# ── Step 5: Create directory structure ───────────────────────────────────────
header "Creating Directory Structure"

mkdir -p "${BACKEND_DIR}" "${FRONTEND_DIR}" "${DATA_DIR}"
info "Created: ${PANEL_DIR}"

# ── Step 6: Deploy panel files ────────────────────────────────────────────────
header "Deploying Panel Files"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

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

# ── Step 7: Install backend dependencies ─────────────────────────────────────
header "Installing Backend Dependencies"

cd "${BACKEND_DIR}"
info "Running npm install --production ..."
npm install --production --silent
success "Backend dependencies installed."
cd -

# ── Step 8: Install systemd service ──────────────────────────────────────────
header "Installing Systemd Service"

cp "${SCRIPT_DIR}/vpn-panel.service" "${SERVICE_FILE}"
systemctl daemon-reload
success "Service file installed at ${SERVICE_FILE}"

# ── Step 9: Create .env config ────────────────────────────────────────────────
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

# ── Step 10: Initialize SQLite database ──────────────────────────────────────
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

# ── Step 11: Set ownership & permissions ─────────────────────────────────────
header "Setting Permissions"

chown -R root:root "${PANEL_DIR}"
chmod -R 750 "${PANEL_DIR}"
chmod 755 "${FRONTEND_DIR}"
success "Permissions set."

# ── Step 12: Configure firewall (optional) ────────────────────────────────────
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

# ── Step 13: Start service ────────────────────────────────────────────────────
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
