#!/usr/bin/env bash
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/vpn-panel}"
SERVICE_NAME="vpn-panel"
PANEL_USER="vpn-panel"
PANEL_GROUP="vpn-panel"
VERSION="1.4.4"
RELEASE_ROOT="https://github.com/soulripper13/vpn-panel/releases/download/v${VERSION}"
WORK_DIR="/tmp/vpn-panel-migration-${VERSION}-$$"
BACKUP_DIR="/opt/vpn-panel-migration-backups/$(date +%Y%m%d_%H%M%S)"

die() { echo "ERROR: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "Run this script as root over SSH."
[[ -d "${PANEL_DIR}" ]] || die "Panel directory not found: ${PANEL_DIR}"
command -v curl >/dev/null || die "curl is required."
command -v openssl >/dev/null || die "openssl is required."
command -v systemctl >/dev/null || die "systemd is required for this migration."

mkdir -p "${WORK_DIR}" "${BACKUP_DIR}"
WAS_ACTIVE=0
WAS_ENABLED=0
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
    systemctl daemon-reload
    [[ "${WAS_ENABLED}" -eq 1 ]] && systemctl enable "${SERVICE_NAME}" || systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    [[ "${WAS_ACTIVE}" -eq 1 ]] && systemctl start "${SERVICE_NAME}" || true
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
openssl pkeyutl -verify -pubin -inkey "${WORK_DIR}/public-key.pem" \
  -in "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.json" -sigfile "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.sig" >/dev/null \
  || die "Release signature verification failed. No files were migrated."
expected=$(sed -n 's/.*"sha256":"\([a-f0-9]\{64\}\)".*/\1/p' "${WORK_DIR}/vpn-panel-v${VERSION}.manifest.json")
actual=$(sha256sum "${WORK_DIR}/vpn-panel-v${VERSION}.tar.gz" | awk '{print $1}')
[[ "${expected}" == "${actual}" ]] || die "Release digest verification failed. No files were migrated."

tar -xzf "${WORK_DIR}/vpn-panel-v${VERSION}.tar.gz" -C "${WORK_DIR}"
SOURCE="${WORK_DIR}/vpn-panel-v${VERSION}"
[[ -f "${SOURCE}/deploy/vpn-panel-privileged.service" ]] || die "Verified release is missing the privileged helper."

systemctl is-active --quiet "${SERVICE_NAME}" && WAS_ACTIVE=1 || WAS_ACTIVE=0
systemctl is-enabled --quiet "${SERVICE_NAME}" && WAS_ENABLED=1 || WAS_ENABLED=0
cp -a "${PANEL_DIR}" "${BACKUP_DIR}/panel"
cp -a "/etc/systemd/system/${SERVICE_NAME}.service" "${BACKUP_DIR}/vpn-panel.service" 2>/dev/null || true
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true

if ! id -u "${PANEL_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${PANEL_DIR}" --no-create-home --shell /usr/sbin/nologin "${PANEL_USER}"
fi
PANEL_GROUP=$(id -gn "${PANEL_USER}")
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0750 "${PANEL_DIR}/.privileged-staging"
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0770 "${PANEL_DIR}/.panel-update-backups"

if command -v rsync >/dev/null; then
  rsync -a --delete --exclude='.env' --exclude='data' --exclude='node_modules' "${SOURCE}/backend/" "${PANEL_DIR}/backend/"
  rsync -a "${SOURCE}/backend/public/" "${PANEL_DIR}/public/"
  rsync -a "${SOURCE}/deploy/" "${PANEL_DIR}/deploy/"
else
  cp -rf "${SOURCE}/backend/src" "${PANEL_DIR}/backend/"
  cp -f "${SOURCE}/backend/package.json" "${SOURCE}/backend/package-lock.json" "${PANEL_DIR}/backend/"
  cp -rf "${SOURCE}/backend/public/." "${PANEL_DIR}/backend/public/"
  cp -rf "${SOURCE}/backend/public/." "${PANEL_DIR}/public/"
  cp -rf "${SOURCE}/deploy/." "${PANEL_DIR}/deploy/"
fi
cp -f "${SOURCE}/deploy/vpn-panel.service" /etc/systemd/system/vpn-panel.service
cp -f "${SOURCE}/deploy/vpn-panel-privileged.service" /etc/systemd/system/vpn-panel-privileged.service
cp -f "${SOURCE}/deploy/panel-release-public-key.pem" "${PANEL_DIR}/deploy/panel-release-public-key.pem"

chown -R root:"${PANEL_GROUP}" "${PANEL_DIR}"
chmod -R 750 "${PANEL_DIR}"
chown "${PANEL_USER}:${PANEL_GROUP}" "${PANEL_DIR}/data"
chmod 770 "${PANEL_DIR}/data"
chown "${PANEL_USER}:${PANEL_GROUP}" "${PANEL_DIR}/data/panel.db"
chmod 660 "${PANEL_DIR}/data/panel.db"
chown root:"${PANEL_GROUP}" "${PANEL_DIR}/.env"
chmod 640 "${PANEL_DIR}/.env"

if [[ -f "${PANEL_DIR}/.env" ]]; then
  # Existing TLS files under /root are copied to a root-owned, panel-readable path.
  CERT_FULLCHAIN=$(sed -n 's/^CERT_FULLCHAIN=//p' "${PANEL_DIR}/.env" | tail -1)
  CERT_PRIVKEY=$(sed -n 's/^CERT_PRIVKEY=//p' "${PANEL_DIR}/.env" | tail -1)
  SINGBOX_CONFIG=$(sed -n 's/^SINGBOX_CONFIG=//p' "${PANEL_DIR}/.env" | tail -1)
  XRAY_CONFIG=$(sed -n 's/^XRAY_CONFIG=//p' "${PANEL_DIR}/.env" | tail -1)
  if [[ -f "${CERT_FULLCHAIN}" || -f "${CERT_PRIVKEY}" ]]; then
    install -d -o root -g "${PANEL_GROUP}" -m 0750 /etc/vpn-panel/tls
    [[ -f "${CERT_FULLCHAIN}" ]] && install -o root -g "${PANEL_GROUP}" -m 0640 "${CERT_FULLCHAIN}" /etc/vpn-panel/tls/fullchain.pem
    [[ -f "${CERT_PRIVKEY}" ]] && install -o root -g "${PANEL_GROUP}" -m 0640 "${CERT_PRIVKEY}" /etc/vpn-panel/tls/privkey.pem
    sed -i 's#^CERT_FULLCHAIN=.*#CERT_FULLCHAIN=/etc/vpn-panel/tls/fullchain.pem#; s#^CERT_PRIVKEY=.*#CERT_PRIVKEY=/etc/vpn-panel/tls/privkey.pem#' "${PANEL_DIR}/.env"
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
rm -rf "${PANEL_DIR}/backend/node_modules"
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0750 "${PANEL_DIR}/backend/node_modules"
install -d -o "${PANEL_USER}" -g "${PANEL_GROUP}" -m 0750 "${PANEL_DIR}/data/npm-home" "${PANEL_DIR}/data/npm-cache"
runuser -u "${PANEL_USER}" -- env HOME="${PANEL_DIR}/data/npm-home" npm_config_cache="${PANEL_DIR}/data/npm-cache" npm ci --omit=dev --silent --prefix "${PANEL_DIR}/backend"
if [[ -f /etc/vpn-panel/tls/fullchain.pem ]]; then CERT_FULLCHAIN=/etc/vpn-panel/tls/fullchain.pem; fi
if [[ -f /etc/vpn-panel/tls/privkey.pem ]]; then CERT_PRIVKEY=/etc/vpn-panel/tls/privkey.pem; fi
runuser -u "${PANEL_USER}" -- env CERT_FULLCHAIN="${CERT_FULLCHAIN:-}" CERT_PRIVKEY="${CERT_PRIVKEY:-}" \
  node -e "const Settings=require('${PANEL_DIR}/backend/src/models/Settings'); if(process.env.CERT_FULLCHAIN) Settings.set('cert_fullchain',process.env.CERT_FULLCHAIN); if(process.env.CERT_PRIVKEY) Settings.set('cert_privkey',process.env.CERT_PRIVKEY);"
systemctl daemon-reload
systemctl enable --now vpn-panel-privileged.service
systemctl enable "${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"
sleep 3
systemctl is-active --quiet "${SERVICE_NAME}" || die "New service did not become active."
MIGRATION_COMPLETE=1
echo "Migration complete. Backup retained at ${BACKUP_DIR}."
