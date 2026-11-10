#!/usr/bin/env bash
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/vpn-panel}"
SERVICE_NAME="vpn-panel"
PANEL_USER="vpn-panel"
PANEL_GROUP="vpn-panel"
VERSION="1.4.14"
RELEASE_ROOT="https://github.com/soulripper13/vpn-panel/releases/download/v${VERSION}"
WORK_DIR="/tmp/vpn-panel-migration-${VERSION}-$$"
BACKUP_DIR="/opt/vpn-panel-migration-backups/$(date +%Y%m%d_%H%M%S)"

die() { echo "ERROR: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "Run this script as root over SSH."
[[ -d "${PANEL_DIR}" ]] || die "Panel directory not found: ${PANEL_DIR}"
command -v curl >/dev/null || die "curl is required."
command -v openssl >/dev/null || die "openssl is required."
command -v systemctl >/dev/null || die "systemd is required for this migration."

mkdir -p "${WORK_DIR}"
WAS_ACTIVE=0
WAS_ENABLED=0
HELPER_WAS_ACTIVE=0
HELPER_WAS_ENABLED=0
HELPER_UNIT_EXISTED=0
MIGRATION_COMPLETE=0
CERT_FULLCHAIN=""
CERT_PRIVKEY=""
on_exit() {
  local rc=$?
  if [[ "${rc}" -ne 0 && -d "${BACKUP_DIR}/panel" ]]; then
    echo "Migration failed; restoring the previous installation..." >&2
    systemctl stop vpn-panel-privileged.service 2>/dev/null || true
    systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
    rm -rf "${PANEL_DIR}"
    cp -a "${BACKUP_DIR}/panel" "${PANEL_DIR}"
    [[ -f "${BACKUP_DIR}/vpn-panel.service" ]] && cp -f "${BACKUP_DIR}/vpn-panel.service" /etc/systemd/system/vpn-panel.service
    if [[ "${HELPER_UNIT_EXISTED}" -eq 1 ]]; then
      cp -f "${BACKUP_DIR}/vpn-panel-privileged.service" /etc/systemd/system/vpn-panel-privileged.service
    else
      systemctl disable vpn-panel-privileged.service 2>/dev/null || true
      rm -f /etc/systemd/system/vpn-panel-privileged.service
    fi
    systemctl daemon-reload
    [[ "${WAS_ENABLED}" -eq 1 ]] && systemctl enable "${SERVICE_NAME}" || systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    [[ "${WAS_ACTIVE}" -eq 1 ]] && systemctl start "${SERVICE_NAME}" || true
    if [[ "${HELPER_WAS_ENABLED}" -eq 1 ]]; then systemctl enable vpn-panel-privileged.service; else systemctl disable vpn-panel-privileged.service 2>/dev/null || true; fi
    [[ "${HELPER_WAS_ACTIVE}" -eq 1 ]] && systemctl start vpn-panel-privileged.service || true
    echo "Previous installation restored from ${BACKUP_DIR}." >&2
  fi
  rm -rf "${WORK_DIR}"
  exit "${rc}"
}
trap on_exit EXIT

echo "Backing up the existing installation to ${BACKUP_DIR}..."

cat > "${WORK_DIR}/public-key.pem" <<'KEY'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAcKF94wwaxrYLifiEQnCjF55ZmroVPH84mYZEed4Qjzo=
-----END PUBLIC KEY-----
KEY
for suffix in tar.gz manifest.json manifest.sig; do
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    "${RELEASE_ROOT}/vpn-panel-v${VERSION}.${suffix}" -o "${WORK_DIR}/vpn-panel-v${VERSION}.${suffix}"
done
if ! openssl pkeyutl -verify -pubin -inkey "${WORK_DIR}/public-key.pem" \
  -in "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.json" -sigfile "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.sig" >/dev/null 2>&1; then
  command -v node >/dev/null || die "Release signature verification failed and Node.js is unavailable for the compatibility verifier. No files were migrated."
  node - "${WORK_DIR}/public-key.pem" \
    "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.json" \
    "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.sig" <<'NODE' || die "Release signature verification failed. No files were migrated."
const fs = require('fs');
const crypto = require('crypto');
const [publicKeyPath, manifestPath, signaturePath] = process.argv.slice(2);
const valid = crypto.verify(
  null,
  fs.readFileSync(manifestPath),
  fs.readFileSync(publicKeyPath),
  fs.readFileSync(signaturePath),
);
if (!valid) process.exit(1);
NODE
fi
expected=$(sed -n 's/.*"sha256":"\([a-f0-9]\{64\}\)".*/\1/p' "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.json")
actual=$(sha256sum "${WORK_DIR}/vpn-panel-v${VERSION}.tar.gz" | awk '{print $1}')
[[ "${expected}" == "${actual}" ]] || die "Release digest verification failed. No files were migrated."

tar -xzf "${WORK_DIR}/vpn-panel-v${VERSION}.tar.gz" -C "${WORK_DIR}"
SOURCE="${WORK_DIR}/vpn-panel-v${VERSION}"
[[ -f "${SOURCE}/deploy/vpn-panel-privileged.service" ]] || die "Verified release is missing the privileged helper."

command -v npm >/dev/null || die "npm is required to prepare the verified release. Install Node.js and npm, then retry; the running panel has not been changed."
command -v runuser >/dev/null || die "runuser is required to prepare dependencies as the panel account."
if ! command -v make >/dev/null || ! command -v g++ >/dev/null; then
  command -v apt-get >/dev/null || die "A C/C++ build toolchain is required for native dependencies. Install build-essential, then retry; the running panel has not been changed."
  echo "Installing native dependency build tools before stopping the current service..."
  apt-get update
  apt-get install -y --no-install-recommends build-essential python3
fi
if ! id -u "${PANEL_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${PANEL_DIR}" --no-create-home --shell /usr/sbin/nologin "${PANEL_USER}"
fi
PANEL_GROUP=$(id -gn "${PANEL_USER}")
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0750 \
  "${WORK_DIR}/npm-home" "${WORK_DIR}/npm-cache"
chown -R "${PANEL_USER}:${PANEL_GROUP}" "${SOURCE}/backend"
echo "Installing production dependencies into the verified release before stopping the current service..."
runuser -u "${PANEL_USER}" -- env HOME="${WORK_DIR}/npm-home" npm_config_cache="${WORK_DIR}/npm-cache" \
  npm ci --omit=dev --no-audit --no-fund --prefix "${SOURCE}/backend" || \
  die "Production dependency installation failed. The running panel has not been changed."
runuser -u "${PANEL_USER}" -- env NODE_PATH="${SOURCE}/backend/node_modules" \
  node -e "require('js-yaml'); require('better-sqlite3')" || \
  die "Production dependency smoke check failed. The running panel has not been changed."

systemctl is-active --quiet "${SERVICE_NAME}" && WAS_ACTIVE=1 || WAS_ACTIVE=0
systemctl is-enabled --quiet "${SERVICE_NAME}" && WAS_ENABLED=1 || WAS_ENABLED=0
systemctl is-active --quiet vpn-panel-privileged.service && HELPER_WAS_ACTIVE=1 || HELPER_WAS_ACTIVE=0
systemctl is-enabled --quiet vpn-panel-privileged.service && HELPER_WAS_ENABLED=1 || HELPER_WAS_ENABLED=0
[[ -f /etc/systemd/system/vpn-panel-privileged.service ]] && HELPER_UNIT_EXISTED=1 || HELPER_UNIT_EXISTED=0
mkdir -p "${BACKUP_DIR}"
cp -a "${PANEL_DIR}" "${BACKUP_DIR}/panel"
cp -a "/etc/systemd/system/${SERVICE_NAME}.service" "${BACKUP_DIR}/vpn-panel.service" 2>/dev/null || true
[[ "${HELPER_UNIT_EXISTED}" -eq 1 ]] && cp -a /etc/systemd/system/vpn-panel-privileged.service "${BACKUP_DIR}/vpn-panel-privileged.service"
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true

install -d -o root -g "${PANEL_GROUP}" -m 0750 /etc/sing-box /etc/xray /usr/local/share/xray
if [[ -d /usr/local/x-ui ]]; then chmod 755 /usr/local/x-ui; fi
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0750 "${PANEL_DIR}/.privileged-staging"
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0770 "${PANEL_DIR}/.panel-update-backups"

if command -v rsync >/dev/null; then
  rsync -a --delete --exclude='.env' --exclude='data' "${SOURCE}/backend/" "${PANEL_DIR}/backend/"
  rsync -a "${SOURCE}/backend/public/" "${PANEL_DIR}/public/"
  rsync -a "${SOURCE}/deploy/" "${PANEL_DIR}/deploy/"
else
  cp -rf "${SOURCE}/backend/src" "${PANEL_DIR}/backend/"
  cp -f "${SOURCE}/backend/package.json" "${SOURCE}/backend/package-lock.json" "${PANEL_DIR}/backend/"
  rm -rf "${PANEL_DIR}/backend/node_modules"
  cp -a "${SOURCE}/backend/node_modules" "${PANEL_DIR}/backend/"
  cp -rf "${SOURCE}/backend/public/." "${PANEL_DIR}/backend/public/"
  cp -rf "${SOURCE}/backend/public/." "${PANEL_DIR}/public/"
  cp -rf "${SOURCE}/deploy/." "${PANEL_DIR}/deploy/"
fi
cp -f "${SOURCE}/deploy/vpn-panel.service" /etc/systemd/system/vpn-panel.service
cp -f "${SOURCE}/deploy/vpn-panel-privileged.service" /etc/systemd/system/vpn-panel-privileged.service
cp -f "${SOURCE}/deploy/panel-release-public-key.pem" "${PANEL_DIR}/deploy/panel-release-public-key.pem"

chown -R root:"${PANEL_GROUP}" "${PANEL_DIR}"
chmod -R 750 "${PANEL_DIR}"
chown "${PANEL_USER}:${PANEL_GROUP}" "${PANEL_DIR}/.privileged-staging" "${PANEL_DIR}/.panel-update-backups"
chmod 750 "${PANEL_DIR}/.privileged-staging"
chmod 770 "${PANEL_DIR}/.panel-update-backups"
chown -R "${PANEL_USER}:${PANEL_GROUP}" "${PANEL_DIR}/data"
find "${PANEL_DIR}/data" -type d -exec chmod 770 {} +
find "${PANEL_DIR}/data" -type f -exec chmod 660 {} +
chown root:"${PANEL_GROUP}" "${PANEL_DIR}/.env"
chmod 640 "${PANEL_DIR}/.env"

if [[ -f "${PANEL_DIR}/.env" ]]; then
  # Legacy deployments may keep certificate paths in SQLite instead of .env.
  CERT_FULLCHAIN=$(sed -n 's/^CERT_FULLCHAIN=//p' "${PANEL_DIR}/.env" | tail -1)
  CERT_PRIVKEY=$(sed -n 's/^CERT_PRIVKEY=//p' "${PANEL_DIR}/.env" | tail -1)
  SINGBOX_CONFIG=$(sed -n 's/^SINGBOX_CONFIG=//p' "${PANEL_DIR}/.env" | tail -1)
  XRAY_CONFIG=$(sed -n 's/^XRAY_CONFIG=//p' "${PANEL_DIR}/.env" | tail -1)
fi

if command -v sqlite3 >/dev/null && [[ -f "${PANEL_DIR}/data/panel.db" ]]; then
  [[ -n "${CERT_FULLCHAIN:-}" ]] || CERT_FULLCHAIN=$(sqlite3 -noheader "${PANEL_DIR}/data/panel.db" "SELECT value FROM settings WHERE key='cert_fullchain' LIMIT 1;" 2>/dev/null || true)
  [[ -n "${CERT_PRIVKEY:-}" ]] || CERT_PRIVKEY=$(sqlite3 -noheader "${PANEL_DIR}/data/panel.db" "SELECT value FROM settings WHERE key='cert_privkey' LIMIT 1;" 2>/dev/null || true)
fi
CERT_FULLCHAIN=${CERT_FULLCHAIN//$'\r'/}
CERT_FULLCHAIN=${CERT_FULLCHAIN//$'\n'/}
CERT_PRIVKEY=${CERT_PRIVKEY//$'\r'/}
CERT_PRIVKEY=${CERT_PRIVKEY//$'\n'/}

# Keep TLS enabled and readable by the unprivileged service after migration.
if [[ -n "${CERT_FULLCHAIN}" || -n "${CERT_PRIVKEY}" ]]; then
  [[ -f "${CERT_FULLCHAIN}" && -f "${CERT_PRIVKEY}" ]] || die "Configured TLS certificate or private key is missing; refusing to migrate without HTTPS. The old installation will be restored."
  install -d -o root -g "${PANEL_GROUP}" -m 0750 /etc/vpn-panel/tls
  [[ "${CERT_FULLCHAIN}" == /etc/vpn-panel/tls/fullchain.pem ]] || install -o root -g "${PANEL_GROUP}" -m 0640 "${CERT_FULLCHAIN}" /etc/vpn-panel/tls/fullchain.pem
  [[ "${CERT_PRIVKEY}" == /etc/vpn-panel/tls/privkey.pem ]] || install -o root -g "${PANEL_GROUP}" -m 0640 "${CERT_PRIVKEY}" /etc/vpn-panel/tls/privkey.pem
  CERT_FULLCHAIN=/etc/vpn-panel/tls/fullchain.pem
  CERT_PRIVKEY=/etc/vpn-panel/tls/privkey.pem
  if [[ -f "${PANEL_DIR}/.env" ]]; then
    if grep -q '^CERT_FULLCHAIN=' "${PANEL_DIR}/.env"; then
      sed -i 's#^CERT_FULLCHAIN=.*#CERT_FULLCHAIN=/etc/vpn-panel/tls/fullchain.pem#' "${PANEL_DIR}/.env"
    else
      printf '\nCERT_FULLCHAIN=/etc/vpn-panel/tls/fullchain.pem\n' >> "${PANEL_DIR}/.env"
    fi
    if grep -q '^CERT_PRIVKEY=' "${PANEL_DIR}/.env"; then
      sed -i 's#^CERT_PRIVKEY=.*#CERT_PRIVKEY=/etc/vpn-panel/tls/privkey.pem#' "${PANEL_DIR}/.env"
    else
      printf 'CERT_PRIVKEY=/etc/vpn-panel/tls/privkey.pem\n' >> "${PANEL_DIR}/.env"
    fi
  fi
fi

for config_path in "${SINGBOX_CONFIG:-/etc/sing-box/config.json}" "${XRAY_CONFIG:-/etc/xray/config.json}"; do
  if [[ -f "${config_path}" ]]; then
    chown root:"${PANEL_GROUP}" "${config_path}"
    chmod 640 "${config_path}"
    chmod 750 "$(dirname "${config_path}")"
  fi
done

chown root:"${PANEL_GROUP}" "${PANEL_DIR}/.env"
chmod 640 "${PANEL_DIR}/.env"
if [[ -f /etc/vpn-panel/tls/fullchain.pem ]]; then CERT_FULLCHAIN=/etc/vpn-panel/tls/fullchain.pem; fi
if [[ -f /etc/vpn-panel/tls/privkey.pem ]]; then CERT_PRIVKEY=/etc/vpn-panel/tls/privkey.pem; fi
if command -v sqlite3 >/dev/null && [[ -f "${PANEL_DIR}/data/panel.db" ]]; then
  [[ -n "${CERT_FULLCHAIN:-}" ]] && sqlite3 "${PANEL_DIR}/data/panel.db" "INSERT OR REPLACE INTO settings(key,value) VALUES('cert_fullchain','/etc/vpn-panel/tls/fullchain.pem');"
  [[ -n "${CERT_PRIVKEY:-}" ]] && sqlite3 "${PANEL_DIR}/data/panel.db" "INSERT OR REPLACE INTO settings(key,value) VALUES('cert_privkey','/etc/vpn-panel/tls/privkey.pem');"
fi
systemctl daemon-reload
systemctl enable --now vpn-panel-privileged.service
systemctl enable "${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"
healthy=0
for attempt in $(seq 1 30); do
  if systemctl is-active --quiet "${SERVICE_NAME}" && curl -kfsS --max-time 2 "https://127.0.0.1:${PANEL_PORT:-2096}/healthz" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
[[ "${healthy}" -eq 1 ]] || die "New service did not pass its health check within 30 seconds."
sleep 5
systemctl is-active --quiet "${SERVICE_NAME}" || die "New service stopped after its health check."
MIGRATION_COMPLETE=1
echo "Migration complete. Backup retained at ${BACKUP_DIR}."
