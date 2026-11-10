#!/usr/bin/env bash
# =============================================================================
#  VPN Panel — Remote Deploy Script
#  Run from your local Mac to build, package, and deploy to the server
#
#  Usage: ./deploy/deploy.sh [user@host] [-p port] [--skip-build]
#  Example: ./deploy/deploy.sh root@<SERVER_IP> -p 22
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════${NC}"; \
            echo -e "${BOLD}${BLUE}  $*${NC}"; \
            echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"; }

die() { error "$*"; exit 1; }

# ── Parse args ────────────────────────────────────────────────────────────────
SSH_TARGET=""
SSH_PORT="22"
SKIP_BUILD=false
REMOTE_TMP="/tmp/vpn-panel-deploy"
TARBALL="vpn-panel.tar.gz"

usage() {
    echo "Usage: $0 user@host [-p ssh_port] [--skip-build]"
    echo ""
    echo "  user@host       Remote server (e.g. root@your-server-ip)"
    echo "  -p port         SSH port (default: 22)"
    echo "  --skip-build    Skip frontend build (use existing dist/)"
    echo ""
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--port) SSH_PORT="$2"; shift 2 ;;
        --skip-build) SKIP_BUILD=true; shift ;;
        -h|--help) usage ;;
        *) [[ -z "${SSH_TARGET}" ]] && SSH_TARGET="$1" || die "Unknown argument: $1"; shift ;;
    esac
done

[[ -n "${SSH_TARGET}" ]] || usage

# ── Locate project root ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
BACKEND_DIR="${PROJECT_ROOT}/backend"

[[ -d "${BACKEND_DIR}" ]]  || die "Backend directory not found: ${BACKEND_DIR}"
[[ -d "${FRONTEND_DIR}" ]] || die "Frontend directory not found: ${FRONTEND_DIR}"

SSH_OPTS="-p ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
SCP_OPTS="-P ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

header "VPN Panel — Remote Deploy"
info "Target : ${SSH_TARGET}"
info "SSH Port: ${SSH_PORT}"
info "Project : ${PROJECT_ROOT}"

# ── Test SSH connectivity ─────────────────────────────────────────────────────
header "Testing SSH Connection"

# shellcheck disable=SC2086
ssh ${SSH_OPTS} "${SSH_TARGET}" "echo 'SSH OK'" || die "Cannot connect to ${SSH_TARGET}:${SSH_PORT}. Check your SSH key/config."
success "SSH connection established."

# ── Build frontend ────────────────────────────────────────────────────────────
if [[ "${SKIP_BUILD}" == false ]]; then
    header "Building Frontend"

    if ! command -v node &>/dev/null; then
        die "Node.js is not installed on this machine. Install it or use --skip-build."
    fi

    info "Node: $(node --version) | npm: $(npm --version)"

    cd "${FRONTEND_DIR}"
    info "Installing frontend dependencies..."
    npm install --silent
    info "Building production bundle..."
    npm run build
    success "Frontend built → ${FRONTEND_DIR}/dist/"
    cd -
else
    warn "--skip-build: Skipping frontend build."
    [[ -d "${FRONTEND_DIR}/dist" ]] || die "No dist/ found. Remove --skip-build to build it."
fi

# ── Create deployment tarball ─────────────────────────────────────────────────
header "Packaging Deployment Tarball"

TMPDIR_LOCAL=$(mktemp -d)
STAGE="${TMPDIR_LOCAL}/vpn-panel"
mkdir -p "${STAGE}/backend" "${STAGE}/frontend/dist" "${STAGE}/deploy"

# Backend (exclude node_modules)
rsync -a --exclude='node_modules' --exclude='.git' "${BACKEND_DIR}/" "${STAGE}/backend/"
# Frontend dist only
rsync -a "${FRONTEND_DIR}/dist/" "${STAGE}/frontend/dist/"
# Deploy scripts
rsync -a "${SCRIPT_DIR}/" "${STAGE}/deploy/"

TARBALL_PATH="${TMPDIR_LOCAL}/${TARBALL}"
tar -czf "${TARBALL_PATH}" -C "${TMPDIR_LOCAL}" vpn-panel

TARBALL_SIZE=$(du -sh "${TARBALL_PATH}" | cut -f1)
success "Tarball created: ${TARBALL_PATH} (${TARBALL_SIZE})"

# ── Upload to server ──────────────────────────────────────────────────────────
header "Uploading to Server"

# shellcheck disable=SC2086
ssh ${SSH_OPTS} "${SSH_TARGET}" "mkdir -p ${REMOTE_TMP} && rm -rf ${REMOTE_TMP:?}/*"
# shellcheck disable=SC2086
scp ${SCP_OPTS} "${TARBALL_PATH}" "${SSH_TARGET}:${REMOTE_TMP}/${TARBALL}"
success "Uploaded ${TARBALL} to ${SSH_TARGET}:${REMOTE_TMP}/"

# ── Extract & install on server ───────────────────────────────────────────────
header "Running Installer on Server"

# shellcheck disable=SC2086
ssh ${SSH_OPTS} "${SSH_TARGET}" bash << REMOTE
set -euo pipefail

cd ${REMOTE_TMP}
echo "Extracting tarball..."
tar -xzf ${TARBALL}

echo "Running install.sh..."
chmod +x vpn-panel/deploy/install.sh
SUDO=""
if [[ "\$(id -u)" -ne 0 ]]; then
    SUDO="sudo -E"
fi
\$SUDO bash vpn-panel/deploy/install.sh

echo "Cleaning up temp files..."
rm -rf ${REMOTE_TMP}
REMOTE

# ── Local cleanup ──────────────────────────────────────────────────────────────
rm -rf "${TMPDIR_LOCAL}"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      Remote Deploy Completed Successfully!       ║${NC}"
echo -e "${BOLD}${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Server  : ${CYAN}${SSH_TARGET}${NC}"
echo -e "${BOLD}${GREEN}║${NC}  Logs    : ssh -p ${SSH_PORT} ${SSH_TARGET} journalctl -u vpn-panel -f"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
