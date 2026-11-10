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
PANEL_USER="vpn-panel"
PANEL_GROUP="vpn-panel"
NODE_VERSION="20"

SINGBOX_BIN="/usr/bin/sing-box"
SINGBOX_CONFIG="/etc/sing-box/config.json"
XRAY_BIN="/usr/local/bin/xray"
XRAY_CONFIG="/etc/xray/config.json"
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

if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        echo -e "${CYAN}[INFO]${NC}  Not running as root. Elevating privileges with sudo..."
        if [[ -f "$0" ]]; then
            exec sudo -E bash "$0" "$@"
        else
            exec sudo -E bash -c "$(curl -fsSL https://raw.githubusercontent.com/soulripper13/vpn-panel/main/deploy/install.sh)" "$@"
        fi
    else
        die "This script must be run as root (sudo or su -)."
    fi
fi

if [[ -e "${PANEL_DIR}/.env" || -e "${DATA_DIR}/panel.db" || -f "${SERVICE_FILE}" ]]; then
    warn "An existing VPN Panel installation was detected at ${PANEL_DIR}."
    info "Existing configuration and database will be backed up safely before upgrade."
fi

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
    tar gzip unzip sqlite3 openssl ufw iptables jq git rsync \
    build-essential python3 \
    2>/dev/null
success "System packages installed."

# ── Backup existing configurations (Safe Upgrade Protection) ─────────────────
BACKUP_DIR="/opt/vpn-panel-backups/pre-install-$(date +%Y%m%d%H%M%S)"
HAS_BACKUP=false

for f in "/etc/sing-box/config.json" "/usr/local/x-ui/bin/config.json" "/etc/xray/config.json" "/etc/x-ui/x-ui.db" "/opt/vpn-panel/data/panel.db"; do
    if [[ -f "$f" ]]; then
        # Preserve directory hierarchy to prevent collisions with identical basenames (e.g. multiple config.json)
        dest_dir="${BACKUP_DIR}$(dirname "$f")"
        mkdir -p "${dest_dir}"
        # Use -L to dereference symlinks into standalone physical backups
        cp -aL "$f" "${dest_dir}/" 2>/dev/null || cp -f "$f" "${dest_dir}/" 2>/dev/null || true
        HAS_BACKUP=true
    fi
done

if [[ "$HAS_BACKUP" == true ]]; then
    success "Existing configs safely backed up to ${BACKUP_DIR}"
fi

# ── Step 3: Interactive Configuration ─────────────────────────────────────────
header "Interactive Setup & Customization"

prompt_user() {
    local prompt_msg="$1"
    local default_val="$2"
    local result=""
    if [[ -t 0 ]]; then
        read -rp "$(echo -e "$prompt_msg")" result
    elif [[ -r /dev/tty ]]; then
        read -rp "$(echo -e "$prompt_msg")" result </dev/tty
    else
        result="$default_val"
    fi
    echo "${result:-$default_val}"
}

# Auto-detect public server IP for smart default
info "Detecting public server IP..."
DETECTED_IP=$(curl -s4 --max-time 3 ifconfig.me 2>/dev/null || curl -s4 --max-time 3 icanhazip.com 2>/dev/null || ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

# Generate secure suggested random password (alphanumeric 10 chars)
SUGGESTED_PASS=$(openssl rand -base64 9 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 10)
[[ -z "${SUGGESTED_PASS}" ]] && SUGGESTED_PASS="admin123"

echo -e "\n${BOLD}${CYAN}Please customize your VPN Panel settings (press Enter to accept suggested defaults):${NC}\n"

# 1. Port
PANEL_PORT=$(prompt_user "${BOLD}1. Web Panel Port${NC} [default: ${YELLOW}2096${NC}]: " "2096")

# 2. Username
ADMIN_USERNAME=$(prompt_user "${BOLD}2. Admin Username${NC} [default: ${YELLOW}admin${NC}]: " "admin")

# 3. Password
ADMIN_PASSWORD=$(prompt_user "${BOLD}3. Admin Password${NC} [default: ${YELLOW}${SUGGESTED_PASS}${NC}]: " "${SUGGESTED_PASS}")

# 4. Domain / IP selection
echo ""
echo -e "${BOLD}4. Server Host / Domain Configuration:${NC}"
echo -e "   Detected Public IP: ${GREEN}${DETECTED_IP}${NC}"
USE_DOMAIN=$(prompt_user "   Do you want to bind a domain name to this server? (y/n) [default: ${YELLOW}n${NC}]: " "n")

SERVER_HOST="${DETECTED_IP}"
CERT_FULLCHAIN=""
CERT_PRIVKEY=""

if [[ "${USE_DOMAIN}" =~ ^[Yy]$ ]]; then
    DOMAIN_INPUT=$(prompt_user "   Enter your domain name (e.g. ${CYAN}vpn.example.com${NC}): " "")
    if [[ -n "${DOMAIN_INPUT}" ]]; then
        SERVER_HOST="${DOMAIN_INPUT}"
        info "Domain set to: ${SERVER_HOST}"
        # Automatically detect existing Let's Encrypt certificates if present
        if [[ -f "/etc/letsencrypt/live/${SERVER_HOST}/fullchain.pem" ]]; then
            CERT_FULLCHAIN="/etc/letsencrypt/live/${SERVER_HOST}/fullchain.pem"
            CERT_PRIVKEY="/etc/letsencrypt/live/${SERVER_HOST}/privkey.pem"
            success "Existing Let's Encrypt certificate found for ${SERVER_HOST}."
        fi
    else
        warn "No domain entered. Falling back to server IP: ${DETECTED_IP}"
    fi
else
    info "Using public IP: ${DETECTED_IP}"
fi

# 5. Secret Base Path selection
SUGGESTED_BASE_PATH=$(openssl rand -hex 4 2>/dev/null || echo "admin")
echo ""
echo -e "${BOLD}5. Web Secret Base Path Security:${NC}"
echo -e "   Hides the panel from internet scanners (Shodan, Censys) by requiring a secret URL path."
echo -e "   Any scanner requesting root ${CYAN}/${NC} will receive 404 Not Found."
WEB_PATH_CHOICE=$(prompt_user "   Use secret URL path? (y/n) [default: ${YELLOW}n${NC} (root /)]: " "n")

WEB_BASE_PATH="/"
if [[ "${WEB_PATH_CHOICE}" =~ ^[Yy]$ ]]; then
    SUGGESTED_TOKEN="/${SUGGESTED_BASE_PATH}"
    CUSTOM_PATH=$(prompt_user "   Enter secret path [default: ${YELLOW}${SUGGESTED_TOKEN}${NC}]: " "${SUGGESTED_TOKEN}")
    [[ "${CUSTOM_PATH}" != /* ]] && CUSTOM_PATH="/${CUSTOM_PATH}"
    CUSTOM_PATH="${CUSTOM_PATH%/}"
    WEB_BASE_PATH="${CUSTOM_PATH:-/}"
    info "Web Secret Path set to: ${WEB_BASE_PATH}"
else
    info "Using standard root path: /"
fi

echo ""
info "Setup values:"
info "  • Panel Port     : ${PANEL_PORT}"
info "  • Admin Username : ${ADMIN_USERNAME}"
info "  • Admin Password : ${ADMIN_PASSWORD}"
info "  • Host / Domain  : ${SERVER_HOST}"
info "  • Secret Path    : ${WEB_BASE_PATH}"
echo ""

# ── Step 4: Enable TCP BBR Congestion Control ─────────────────────────────────
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
if command -v xray &>/dev/null || [[ -f /usr/local/bin/xray ]]; then
    XRAY_INSTALLED=true
    success "Xray already installed: $(command -v xray || echo /usr/local/bin/xray)"
elif [[ -f /usr/local/x-ui/bin/xray-linux-amd64 ]]; then
    info "Migrating Xray binary to /usr/local/bin/xray (safely decoupling from x-ui)..."
    mkdir -p /usr/local/bin
    rm -f /usr/local/bin/xray
    cp -aL /usr/local/x-ui/bin/xray-linux-amd64 /usr/local/bin/xray 2>/dev/null || true
    chmod +x /usr/local/bin/xray
    XRAY_INSTALLED=true
    success "Xray migrated to /usr/local/bin/xray."
else
    info "Installing Xray core from official GitHub release..."
    XRAY_VER=$(curl -s https://api.github.com/repos/XTLS/Xray-core/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
    ARCH=$(dpkg --print-architecture 2>/dev/null || echo "64")
    [[ "$ARCH" == "amd64" ]] && ARCH="64"
    [[ "$ARCH" == "arm64" ]] && ARCH="arm64-v8a"
    curl -Lo /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VER}/Xray-linux-${ARCH}.zip"
    mkdir -p /usr/local/bin /usr/local/share/xray /etc/xray /tmp/xray-extracted
    unzip -qo /tmp/xray.zip -d /tmp/xray-extracted
    mv /tmp/xray-extracted/xray /usr/local/bin/xray
    mv /tmp/xray-extracted/geoip.dat /usr/local/share/xray/ 2>/dev/null || true
    mv /tmp/xray-extracted/geosite.dat /usr/local/share/xray/ 2>/dev/null || true
    chmod +x /usr/local/bin/xray
    rm -rf /tmp/xray*
    success "Xray v${XRAY_VER} installed from GitHub."
fi

# Ensure geoip/geosite are in standard /usr/local/share/xray
mkdir -p /usr/local/share/xray /etc/xray
if [[ ! -f /usr/local/share/xray/geoip.dat && -f /usr/local/x-ui/bin/geoip.dat ]]; then
    cp -a /usr/local/x-ui/bin/geoip.dat /usr/local/share/xray/ 2>/dev/null || true
fi
if [[ ! -f /usr/local/share/xray/geosite.dat && -f /usr/local/x-ui/bin/geosite.dat ]]; then
    cp -a /usr/local/x-ui/bin/geosite.dat /usr/local/share/xray/ 2>/dev/null || true
fi

# Migrate existing Xray config out of /usr/local/x-ui/bin/ into standard /etc/xray/config.json
if [[ -L /etc/xray/config.json ]]; then
    target=$(readlink -f /etc/xray/config.json 2>/dev/null || true)
    if [[ -n "$target" && -f "$target" ]]; then
        rm -f /etc/xray/config.json
        cp -aL "$target" /etc/xray/config.json 2>/dev/null || true
    fi
elif [[ ! -f /etc/xray/config.json && -f /usr/local/x-ui/bin/config.json ]]; then
    info "Migrating Xray config to /etc/xray/config.json..."
    cp -aL /usr/local/x-ui/bin/config.json /etc/xray/config.json 2>/dev/null || true
fi

if [[ ! -f /etc/xray/config.json ]]; then
    cat > /etc/xray/config.json <<EOF
{
  "log": { "loglevel": "info" },
  "inbounds": [],
  "outbounds": [{ "protocol": "freedom", "tag": "direct" }]
}
EOF
fi

# Maintain compatibility symlinks if /usr/local/x-ui exists
if [[ -d /usr/local/x-ui/bin ]]; then
    ln -sf /usr/local/bin/xray /usr/local/x-ui/bin/xray-linux-amd64 2>/dev/null || true
    ln -sf /etc/xray/config.json /usr/local/x-ui/bin/config.json 2>/dev/null || true
fi

# Ensure standalone xray systemd service points to standard /usr/local/bin/xray and /etc/xray/config.json
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
ExecStart=/usr/local/bin/xray run -config /etc/xray/config.json
Restart=on-failure
RestartPreventExitStatus=23
LimitNPROC=10000
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable xray 2>/dev/null || true
systemctl restart xray 2>/dev/null || systemctl start xray 2>/dev/null || true
success "Standalone xray service installed and active."
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
info "Installing dependencies from package-lock.json..."
if [[ -f "${BACKEND_DIR}/package-lock.json" ]]; then
    if ! npm ci --omit=dev; then
        warn "npm ci failed; retrying with npm install so the dependency error is visible."
        npm install --omit=dev || die "Backend dependency installation failed. See the npm error above."
    fi
else
    npm install --omit=dev || die "Backend dependency installation failed. See the npm error above."
fi
success "Backend dependencies installed."
cd -

# ── Step 11: Install systemd service & CLI tool ──────────────────────────────
header "Installing Systemd Service & CLI Tool"

if ! id -u "${PANEL_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${PANEL_DIR}" --no-create-home --shell /usr/sbin/nologin "${PANEL_USER}"
fi
for grp in systemd-journal adm; do
    if getent group "$grp" >/dev/null 2>&1; then
        usermod -a -G "$grp" "${PANEL_USER}" 2>/dev/null || true
    fi
done
PANEL_GROUP=$(id -gn "${PANEL_USER}")

mkdir -p "${PANEL_DIR}/deploy"
cp -rf "${SCRIPT_DIR}/"* "${PANEL_DIR}/deploy/" 2>/dev/null || true
chmod +x "${PANEL_DIR}/deploy/"*.sh 2>/dev/null || true

cp "${PANEL_DIR}/deploy/vpn-panel.service" "${SERVICE_FILE}" 2>/dev/null || cp "${SCRIPT_DIR}/vpn-panel.service" "${SERVICE_FILE}"
cp "${PANEL_DIR}/deploy/vpn-panel-privileged.service" /etc/systemd/system/vpn-panel-privileged.service
systemctl daemon-reload
success "Service file installed at ${SERVICE_FILE}"

# Register CLI commands in PATH
ln -sf "${PANEL_DIR}/deploy/vpn-panel.sh" /usr/local/bin/vpn-panel
ln -sf "${PANEL_DIR}/deploy/vpn-panel.sh" /usr/bin/vpn-panel
ln -sf "${PANEL_DIR}/deploy/vpn-panel.sh" /usr/local/bin/panel
chmod +x /usr/local/bin/vpn-panel /usr/bin/vpn-panel /usr/local/bin/panel 2>/dev/null || true
success "CLI tool 'vpn-panel' and 'panel' registered to PATH."

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
WEB_BASE_PATH=${WEB_BASE_PATH}
SESSION_SECRET=${SESSION_SECRET}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
SERVER_IP=${SERVER_HOST}
CERT_FULLCHAIN=${CERT_FULLCHAIN}
CERT_PRIVKEY=${CERT_PRIVKEY}
DB_PATH=${DATA_DIR}/panel.db
SINGBOX_BIN=${SINGBOX_BIN}
SINGBOX_CONFIG=${SINGBOX_CONFIG}
XRAY_BIN=${XRAY_BIN}
XRAY_CONFIG=${XRAY_CONFIG}
LOG_LEVEL=info
EOF

chmod 600 "${ENV_FILE}"
success ".env written to ${ENV_FILE}"

# Keep TLS private keys out of /root while allowing only the panel account to read them.
if [[ -f "${CERT_FULLCHAIN}" || -f "${CERT_PRIVKEY}" ]]; then
    TLS_DIR="/etc/vpn-panel/tls"
    install -d -o root -g "${PANEL_GROUP}" -m 0750 "${TLS_DIR}"
    if [[ -f "${CERT_FULLCHAIN}" ]]; then install -o root -g "${PANEL_GROUP}" -m 0640 "${CERT_FULLCHAIN}" "${TLS_DIR}/fullchain.pem"; CERT_FULLCHAIN="${TLS_DIR}/fullchain.pem"; fi
    if [[ -f "${CERT_PRIVKEY}" ]]; then install -o root -g "${PANEL_GROUP}" -m 0640 "${CERT_PRIVKEY}" "${TLS_DIR}/privkey.pem"; CERT_PRIVKEY="${TLS_DIR}/privkey.pem"; fi
fi
sed -i "s#^CERT_FULLCHAIN=.*#CERT_FULLCHAIN=${CERT_FULLCHAIN}#; s#^CERT_PRIVKEY=.*#CERT_PRIVKEY=${CERT_PRIVKEY}#" "${ENV_FILE}"
chown root:"${PANEL_GROUP}" "${ENV_FILE}"
chmod 640 "${ENV_FILE}"
chown root:"${PANEL_GROUP}" "${SINGBOX_CONFIG}" "${XRAY_CONFIG}" 2>/dev/null || true
chmod 640 "${SINGBOX_CONFIG}" "${XRAY_CONFIG}" 2>/dev/null || true
chmod 750 "$(dirname "${SINGBOX_CONFIG}")" "$(dirname "${XRAY_CONFIG}")" 2>/dev/null || true

# ── Step 14: Initialize SQLite database ─────────────────────────────────────
header "Initializing Database"

mkdir -p "${DATA_DIR}"
if [[ -f "${BACKEND_DIR}/data/panel.db" && ! -f "${DATA_DIR}/panel.db" ]]; then
    mv "${BACKEND_DIR}/data/panel.db"* "${DATA_DIR}/" 2>/dev/null || true
fi

cd "${BACKEND_DIR}"
DB_PATH="${DATA_DIR}/panel.db" PANEL_DIR="${PANEL_DIR}" node -e "
const db = require('./src/config/database');
const Settings = require('./src/models/Settings');
Settings.set('panel_port', '${PANEL_PORT}');
Settings.set('web_base_path', '${WEB_BASE_PATH}');
Settings.set('server_ip', '${SERVER_HOST}');
if ('${CERT_FULLCHAIN}') Settings.set('cert_fullchain', '${CERT_FULLCHAIN}');
if ('${CERT_PRIVKEY}') Settings.set('cert_privkey', '${CERT_PRIVKEY}');
"
cd -

success "Database initialized at ${DATA_DIR}/panel.db"
info "Credentials configured → user: ${ADMIN_USERNAME} / pass: ${ADMIN_PASSWORD}"

# ── Step 15: Set ownership & permissions ────────────────────────────────────
header "Setting Permissions"

chown -R root:"${PANEL_GROUP}" "${PANEL_DIR}"
chmod -R 750 "${PANEL_DIR}"
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0750 "${PANEL_DIR}/.privileged-staging"
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0770 "${PANEL_DIR}/.panel-update-backups"
chown -R "${PANEL_USER}:${PANEL_GROUP}" "${PANEL_DIR}/data"
chmod 770 "${PANEL_DIR}/data"
if [[ -e "${PANEL_DIR}/data/panel.db" ]]; then
    chown "${PANEL_USER}:${PANEL_GROUP}" "${PANEL_DIR}/data/panel.db"* 2>/dev/null || true
    chmod 660 "${PANEL_DIR}/data/panel.db"* 2>/dev/null || true
fi
chown root:"${PANEL_GROUP}" "${ENV_FILE}"
chmod 640 "${ENV_FILE}"
chmod 755 "${FRONTEND_DIR}"
chmod +x "${PANEL_DIR}/deploy/"*.sh 2>/dev/null || true
chmod +x /usr/local/bin/vpn-panel /usr/local/bin/panel /usr/bin/vpn-panel 2>/dev/null || true
success "Permissions set."

# ── Step 16: Configure firewall (optional) ───────────────────────────────────
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

# ── Step 17: Start service ───────────────────────────────────────────────────
header "Starting VPN Panel Service"

systemctl enable vpn-panel-privileged.service 2>/dev/null || true
systemctl restart vpn-panel-privileged.service 2>/dev/null || systemctl start vpn-panel-privileged.service 2>/dev/null || true
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}" 2>/dev/null || systemctl start "${SERVICE_NAME}"

sleep 2

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    success "vpn-panel.service is running!"
else
    error "Service failed to start. Check logs:"
    journalctl -u "${SERVICE_NAME}" -n 30 --no-pager
    die "Startup failed."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
CLEAN_PATH="${WEB_BASE_PATH#/}"
if [[ -n "${CLEAN_PATH}" ]]; then
    FINAL_PATH="/${CLEAN_PATH}/"
else
    FINAL_PATH="/"
fi
PROTOCOL="http"
if [[ -n "${CERT_FULLCHAIN:-}" && -f "${CERT_FULLCHAIN}" ]]; then
    PROTOCOL="https"
fi
SERVER_URL="${PROTOCOL}://${SERVER_HOST}:${PANEL_PORT}${FINAL_PATH}"
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      VPN Panel Installed Successfully!       ║${NC}"
echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Panel URL : ${CYAN}${SERVER_URL}${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Username  : ${YELLOW}${ADMIN_USERNAME}${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Password  : ${YELLOW}${ADMIN_PASSWORD}${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Host/SNI  : ${GREEN}${SERVER_HOST}${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Path      : ${PURPLE:-}${WEB_BASE_PATH}${NC}"
echo -e "${BOLD}${GREEN}║${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Config    : ${ENV_FILE}"
echo -e "${BOLD}${GREEN}║${NC}  CLI Tool  : Type 'vpn-panel' or 'panel' anytime"
echo -e "${BOLD}${GREEN}║${NC}  Logs      : journalctl -u vpn-panel -f"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
