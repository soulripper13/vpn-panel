#!/usr/bin/env bash
# =============================================================================
#  VPN Panel — Uninstall Script
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
SERVICE_NAME="vpn-panel"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BACKUP_DIR="/opt/vpn-panel-backups"
PANEL_PORT=2096

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}${BLUE}  $*${NC}"; \
            echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"; }

die() { error "$*"; exit 1; }

[[ $EUID -eq 0 ]] || die "Must be run as root."

header "VPN Panel — Uninstaller"
echo ""
echo -e "${RED}${BOLD}WARNING: This will remove the VPN panel and all its data!${NC}"
echo -e "Panel directory : ${PANEL_DIR}"
echo -e "Backups dir     : ${BACKUP_DIR}"
echo ""
read -r -p "Are you sure you want to uninstall? [y/N] " CONFIRM
[[ "${CONFIRM,,}" == "y" ]] || { info "Uninstall cancelled."; exit 0; }

read -r -p "Remove backup directory (${BACKUP_DIR})? [y/N] " RM_BACKUPS
read -r -p "Remove Node.js? [y/N] " RM_NODE

# ── Stop & disable service ────────────────────────────────────────────────────
header "Stopping Service"

if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    systemctl stop "${SERVICE_NAME}"
    success "Service stopped."
else
    info "Service is not running."
fi

if systemctl is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
    systemctl disable "${SERVICE_NAME}"
    success "Service disabled."
fi

# ── Remove service file ───────────────────────────────────────────────────────
if [[ -f "${SERVICE_FILE}" ]]; then
    rm -f "${SERVICE_FILE}"
    systemctl daemon-reload
    success "Service file removed."
fi

# ── Remove firewall rule ──────────────────────────────────────────────────────
header "Removing Firewall Rule"

if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    ufw delete allow "${PANEL_PORT}/tcp" 2>/dev/null && success "UFW rule removed." || warn "UFW rule not found."
else
    info "UFW inactive or not installed — skipping."
fi

# ── Remove panel directory ────────────────────────────────────────────────────
header "Removing Panel Files"

if [[ -d "${PANEL_DIR}" ]]; then
    rm -rf "${PANEL_DIR}"
    success "Removed ${PANEL_DIR}"
else
    info "${PANEL_DIR} not found (already removed?)."
fi

# ── Remove backups (optional) ─────────────────────────────────────────────────
if [[ "${RM_BACKUPS,,}" == "y" ]]; then
    if [[ -d "${BACKUP_DIR}" ]]; then
        rm -rf "${BACKUP_DIR}"
        success "Removed ${BACKUP_DIR}"
    else
        info "No backup directory found."
    fi
else
    info "Backups retained at ${BACKUP_DIR}."
fi

# ── Remove Node.js (optional) ─────────────────────────────────────────────────
if [[ "${RM_NODE,,}" == "y" ]]; then
    header "Removing Node.js"
    apt-get remove -y nodejs npm 2>/dev/null && success "Node.js removed." || warn "Failed to remove Node.js."
    # Remove NodeSource list
    rm -f /etc/apt/sources.list.d/nodesource.list
    apt-get autoremove -y 2>/dev/null || true
    success "Node.js and npm uninstalled."
else
    info "Node.js retained."
fi

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║     VPN Panel Uninstalled Successfully!      ║${NC}"
echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}${GREEN}║${NC}  To re-install, run: ./deploy/install.sh"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
