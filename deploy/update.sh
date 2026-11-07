#!/usr/bin/env bash
# =============================================================================
#  VPN Panel — Update Script
#  Pulls latest code, rebuilds, and restarts the panel
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PANEL_DIR="/opt/vpn-panel"
BACKEND_DIR="${PANEL_DIR}/backend"
FRONTEND_DIR="${PANEL_DIR}/public"
DATA_DIR="${PANEL_DIR}/data"
SERVICE_NAME="vpn-panel"
BACKUP_DIR="/opt/vpn-panel-backups"

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}${BLUE}  $*${NC}"; \
            echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"; }

die() { error "$*"; exit 1; }

trap 'error "Update failed on line $LINENO."; exit 1' ERR

[[ $EUID -eq 0 ]] || die "Must be run as root."
[[ -d "${PANEL_DIR}" ]] || die "Panel not installed at ${PANEL_DIR}. Run install.sh first."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

header "VPN Panel Updater"
info "Source : ${SOURCE_DIR}"
info "Target : ${PANEL_DIR}"

# ── Backup current deployment ──────────────────────────────────────────────────
header "Backing Up Current Installation"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "${BACKUP_PATH}"

cp -r "${BACKEND_DIR}" "${BACKUP_PATH}/backend" 2>/dev/null || warn "Could not backup backend."
cp -r "${FRONTEND_DIR}" "${BACKUP_PATH}/public" 2>/dev/null || warn "Could not backup frontend."
cp "${DATA_DIR}/panel.db" "${BACKUP_PATH}/panel.db" 2>/dev/null || warn "No DB to backup."

success "Backup saved to ${BACKUP_PATH}"

# Prune backups older than 7 days
find "${BACKUP_DIR}" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null || true
info "Old backups pruned (> 7 days)."

# ── Stop service ───────────────────────────────────────────────────────────────
header "Stopping Panel Service"
systemctl stop "${SERVICE_NAME}" && success "Service stopped." || warn "Service was not running."

# ── Deploy new backend ────────────────────────────────────────────────────────
header "Updating Backend"

if [[ -d "${SOURCE_DIR}/backend" ]]; then
    rsync -a --delete \
        --exclude='node_modules' \
        "${SOURCE_DIR}/backend/" "${BACKEND_DIR}/"
    success "Backend files updated."
else
    die "Backend source not found: ${SOURCE_DIR}/backend"
fi

cd "${BACKEND_DIR}"
info "Installing/updating dependencies..."
npm install --production --silent
success "Dependencies updated."
cd -

# ── Deploy new frontend ───────────────────────────────────────────────────────
header "Updating Frontend"

if [[ -d "${SOURCE_DIR}/frontend/dist" ]]; then
    rsync -a --delete "${SOURCE_DIR}/frontend/dist/" "${FRONTEND_DIR}/"
    success "Pre-built frontend updated."
elif [[ -d "${SOURCE_DIR}/frontend" ]]; then
    warn "Frontend dist not found. Building..."
    cd "${SOURCE_DIR}/frontend"
    npm install --silent
    npm run build
    rsync -a --delete "${SOURCE_DIR}/frontend/dist/" "${FRONTEND_DIR}/"
    cd -
    success "Frontend built and deployed."
else
    warn "No frontend source found — skipping frontend update."
fi

# ── Reload systemd & restart service ──────────────────────────────────────────
header "Restarting Service"

systemctl daemon-reload
systemctl start "${SERVICE_NAME}"
sleep 2

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    success "vpn-panel.service restarted successfully!"
else
    error "Service failed to start after update!"
    warn "Rolling back to backup ${BACKUP_PATH}..."
    rsync -a --delete "${BACKUP_PATH}/backend/" "${BACKEND_DIR}/" 2>/dev/null || true
    rsync -a --delete "${BACKUP_PATH}/public/"  "${FRONTEND_DIR}/" 2>/dev/null || true
    systemctl start "${SERVICE_NAME}" && warn "Rollback successful." || error "Rollback also failed — manual intervention required."
    die "Update failed; rollback attempted."
fi

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      VPN Panel Updated Successfully!         ║${NC}"
echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Backup : ${BACKUP_PATH}"
echo -e "${BOLD}${GREEN}║${NC}  Logs   : journalctl -u vpn-panel -f"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
