#!/usr/bin/env bash
# =============================================================================
#  VPN Panel — Update Script
#  Pulls latest code from GitHub, rebuilds/updates, and restarts the panel
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
REPO_URL="https://github.com/soulripper13/vpn-panel.git"
TARBALL_URL="https://github.com/soulripper13/vpn-panel/archive/refs/heads/main.tar.gz"

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}${BLUE}  $*${NC}"; \
            echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"; }

die() { error "$*"; exit 1; }

trap 'error "Update failed on line $LINENO."; exit 1' ERR

if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        echo -e "${CYAN}[INFO]${NC}  Not running as root. Elevating privileges with sudo..."
        exec sudo -E bash "$0" "$@"
    else
        die "Must be run as root (sudo or su -)."
    fi
fi

[[ -d "${PANEL_DIR}" ]] || die "Panel not installed at ${PANEL_DIR}. Run install.sh first."

# Ensure vpn-panel service account and staging directories exist for isolated helper mode
if ! id -u vpn-panel >/dev/null 2>&1; then
    info "Setting up vpn-panel service account..."
    useradd --system --home-dir "${PANEL_DIR}" --no-create-home --shell /usr/sbin/nologin vpn-panel 2>/dev/null || true
fi
for grp in systemd-journal adm; do
    if getent group "$grp" >/dev/null 2>&1; then
        usermod -a -G "$grp" vpn-panel 2>/dev/null || true
    fi
done
PANEL_GROUP=$(id -gn vpn-panel 2>/dev/null || echo "vpn-panel")
install -d -o vpn-panel -g "${PANEL_GROUP}" -m 0750 "${PANEL_DIR}/.privileged-staging" 2>/dev/null || true
install -d -o vpn-panel -g "${PANEL_GROUP}" -m 0770 "${PANEL_DIR}/.panel-update-backups" 2>/dev/null || true
chown -R vpn-panel:"${PANEL_GROUP}" "${DATA_DIR}" 2>/dev/null || true
chmod 770 "${DATA_DIR}" 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

header "VPN Panel Updater"

# If run directly on installed panel without local git clone, download latest GitHub release
CLEANUP_TMP=false
if [[ "${SOURCE_DIR}" == "${PANEL_DIR}" || ! -d "${SOURCE_DIR}/.git" ]]; then
    info "Fetching latest release package from GitHub..."
    TMP_DIR="/tmp/vpn-panel-update-$(date +%s)"
    mkdir -p "${TMP_DIR}"
    curl -fsSL --connect-timeout 15 -o "${TMP_DIR}/main.tar.gz" "${TARBALL_URL}"
    tar -xzf "${TMP_DIR}/main.tar.gz" -C "${TMP_DIR}"
    SOURCE_DIR="${TMP_DIR}/vpn-panel-main"
    CLEANUP_TMP=true
    success "Latest source downloaded."
fi

info "Source : ${SOURCE_DIR}"
info "Target : ${PANEL_DIR}"

# ── Backup current deployment ──────────────────────────────────────────────────
header "Backing Up Current Installation"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "${BACKUP_PATH}"

[[ -f "${DATA_DIR}/panel.db" ]] && cp -a "${DATA_DIR}/panel.db" "${BACKUP_PATH}/panel.db" 2>/dev/null && info "Database backed up."
[[ -f "${PANEL_DIR}/.env" ]] && cp -a "${PANEL_DIR}/.env" "${BACKUP_PATH}/.env" 2>/dev/null && info "Configuration backed up."
[[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]] && cp -a "/etc/systemd/system/${SERVICE_NAME}.service" "${BACKUP_PATH}/vpn-panel.service" 2>/dev/null || true
[[ -d "${BACKEND_DIR}" ]] && cp -r "${BACKEND_DIR}" "${BACKUP_PATH}/backend" 2>/dev/null || warn "Could not backup backend."
[[ -d "${FRONTEND_DIR}" ]] && cp -r "${FRONTEND_DIR}" "${BACKUP_PATH}/public" 2>/dev/null || warn "Could not backup frontend."

success "Backup saved to ${BACKUP_PATH}"

# Prune backups older than 7 days
find "${BACKUP_DIR}" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null || true
info "Old backups pruned (> 7 days)."

# ── Deploy new backend ────────────────────────────────────────────────────────
header "Updating Backend"

if [[ -d "${SOURCE_DIR}/backend" ]]; then
    if command -v rsync &>/dev/null; then
        rsync -a --delete \
            --exclude='node_modules' \
            --exclude='.env' \
            "${SOURCE_DIR}/backend/" "${BACKEND_DIR}/"
    else
        mkdir -p "${BACKEND_DIR}"
        cp -rf "${SOURCE_DIR}/backend/src" "${BACKEND_DIR}/"
        cp -f "${SOURCE_DIR}/backend/package.json" "${BACKEND_DIR}/"
        [[ -f "${SOURCE_DIR}/backend/package-lock.json" ]] && cp -f "${SOURCE_DIR}/backend/package-lock.json" "${BACKEND_DIR}/"
        [[ -d "${SOURCE_DIR}/backend/public" ]] && cp -rf "${SOURCE_DIR}/backend/public" "${BACKEND_DIR}/"
    fi
    if [[ -f "${SOURCE_DIR}/VERSION" ]]; then
        cp -f "${SOURCE_DIR}/VERSION" "${PANEL_DIR}/VERSION" 2>/dev/null || true
    fi
    success "Backend files updated."
else
    die "Backend source not found: ${SOURCE_DIR}/backend"
fi

cd "${BACKEND_DIR}"
info "Installing/updating dependencies with package-lock..."
if [[ -f "${BACKEND_DIR}/package-lock.json" ]]; then
    npm ci --omit=dev --silent 2>/dev/null || npm install --production --silent
else
    npm install --production --silent
fi
success "Dependencies updated."
cd -

# ── Deploy new frontend ───────────────────────────────────────────────────────
header "Updating Frontend"

mkdir -p "${FRONTEND_DIR}" "${BACKEND_DIR}/public"
if [[ -d "${SOURCE_DIR}/backend/public" ]]; then
    cp -rf "${SOURCE_DIR}/backend/public/"* "${FRONTEND_DIR}/" 2>/dev/null || true
    cp -rf "${SOURCE_DIR}/backend/public/"* "${BACKEND_DIR}/public/" 2>/dev/null || true
    success "Pre-built frontend deployed."
elif [[ -d "${SOURCE_DIR}/frontend/dist" ]]; then
    cp -rf "${SOURCE_DIR}/frontend/dist/"* "${FRONTEND_DIR}/" 2>/dev/null || true
    cp -rf "${SOURCE_DIR}/frontend/dist/"* "${BACKEND_DIR}/public/" 2>/dev/null || true
    success "Pre-built frontend deployed."
elif [[ -d "${SOURCE_DIR}/frontend" ]]; then
    warn "Frontend dist not found. Building..."
    cd "${SOURCE_DIR}/frontend"
    npm install --silent
    npm run build
    cp -rf "${SOURCE_DIR}/frontend/dist/"* "${FRONTEND_DIR}/"
    cp -rf "${SOURCE_DIR}/frontend/dist/"* "${BACKEND_DIR}/public/"
    cd -
    success "Frontend built and deployed."
else
    warn "No frontend source found — skipping frontend update."
fi

# ── Deploy deploy scripts & CLI helper ─────────────────────────────────────────
mkdir -p "${PANEL_DIR}/deploy"
if [[ -d "${SOURCE_DIR}/deploy" ]]; then
    cp -rf "${SOURCE_DIR}/deploy/"* "${PANEL_DIR}/deploy/" 2>/dev/null || true
    chmod +x "${PANEL_DIR}/deploy/"*.sh 2>/dev/null || true
    ln -sf "${PANEL_DIR}/deploy/vpn-panel.sh" /usr/local/bin/vpn-panel
    ln -sf "${PANEL_DIR}/deploy/vpn-panel.sh" /usr/bin/vpn-panel
    ln -sf "${PANEL_DIR}/deploy/vpn-panel.sh" /usr/local/bin/panel
    chmod +x /usr/local/bin/vpn-panel /usr/bin/vpn-panel /usr/local/bin/panel 2>/dev/null || true
    info "CLI tool 'vpn-panel' updated."
    if [[ -f "${PANEL_DIR}/deploy/vpn-panel-privileged.service" ]]; then
        cp -f "${PANEL_DIR}/deploy/vpn-panel-privileged.service" /etc/systemd/system/vpn-panel-privileged.service
        systemctl daemon-reload
        systemctl enable vpn-panel-privileged.service 2>/dev/null || true
        systemctl restart vpn-panel-privileged.service 2>/dev/null || true
    fi
    if [[ -f "${SOURCE_DIR}/deploy/vpn-panel.service" ]]; then
        cp -f "${SOURCE_DIR}/deploy/vpn-panel.service" "/etc/systemd/system/${SERVICE_NAME}.service"
        success "Panel systemd sandbox rules updated."
    fi
    chown -R root:"${PANEL_GROUP}" "${PANEL_DIR}" 2>/dev/null || true
    chmod -R 750 "${PANEL_DIR}" 2>/dev/null || true
    chown -R vpn-panel:"${PANEL_GROUP}" "${DATA_DIR}" "${PANEL_DIR}/.privileged-staging" "${PANEL_DIR}/.panel-update-backups" 2>/dev/null || true
    chmod 770 "${DATA_DIR}" "${PANEL_DIR}/.panel-update-backups" 2>/dev/null || true
    chmod 750 "${PANEL_DIR}/.privileged-staging" 2>/dev/null || true
fi

# Clean up temp downloads if any
if [[ "${CLEANUP_TMP}" == true ]]; then
    rm -rf "${TMP_DIR}" 2>/dev/null || true
fi

# ── Reload systemd & restart service ──────────────────────────────────────────
header "Restarting Service"

systemctl daemon-reload
systemctl restart "${SERVICE_NAME}"
sleep 2

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    success "vpn-panel.service restarted successfully!"
else
    error "Service failed to start after update!"
    warn "Rolling back to backup ${BACKUP_PATH}..."
    [[ -d "${BACKUP_PATH}/backend" ]] && cp -rf "${BACKUP_PATH}/backend/"* "${BACKEND_DIR}/" 2>/dev/null || true
    [[ -d "${BACKUP_PATH}/public" ]] && cp -rf "${BACKUP_PATH}/public/"* "${FRONTEND_DIR}/" 2>/dev/null || true
    [[ -f "${BACKUP_PATH}/panel.db" ]] && cp -a "${BACKUP_PATH}/panel.db" "${DATA_DIR}/panel.db" 2>/dev/null || true
    [[ -f "${BACKUP_PATH}/vpn-panel.service" ]] && cp -f "${BACKUP_PATH}/vpn-panel.service" "/etc/systemd/system/${SERVICE_NAME}.service" 2>/dev/null || true
    systemctl daemon-reload
    systemctl start "${SERVICE_NAME}" && warn "Rollback successful." || error "Rollback failed — manual intervention required."
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
