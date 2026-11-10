#!/usr/bin/env bash
# =============================================================================
#  VPN Panel — Interactive CLI Management Tool
#  Command: vpn-panel / panel
# =============================================================================
set -uo pipefail

PANEL_DIR="/opt/vpn-panel"
BACKEND_DIR="${PANEL_DIR}/backend"
DATA_DIR="${PANEL_DIR}/data"
ENV_FILE="${PANEL_DIR}/.env"
DB_PATH="${DATA_DIR}/panel.db"
SERVICE_NAME="vpn-panel"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo -e "${RED}[ERROR] This tool must be run as root (e.g. sudo vpn-panel).${NC}"
        exit 1
    fi
}

get_db_setting() {
    local key="$1"
    local default_val="${2:-}"
    local val=""

    # 1. Try sqlite3 CLI
    if command -v sqlite3 &>/dev/null && [[ -f "${DB_PATH}" ]]; then
        val=$(sqlite3 "${DB_PATH}" "SELECT value FROM settings WHERE key='${key}' LIMIT 1;" 2>/dev/null || echo "")
        if [[ -n "${val}" ]]; then
            echo "${val}"
            return
        fi
    fi

    # 2. Try Node.js with better-sqlite3
    if command -v node &>/dev/null && [[ -f "${DB_PATH}" && -f "${BACKEND_DIR}/src/config/database.js" ]]; then
        val=$(node -e "try { const db = require('${BACKEND_DIR}/src/config/database'); const r = db.prepare('SELECT value FROM settings WHERE key = ?').get('${key}'); if (r && r.value) console.log(r.value); } catch {}" 2>/dev/null || true)
        if [[ -n "${val}" ]]; then
            echo "${val}"
            return
        fi
    fi

    # 3. Fallback to .env file
    if [[ -f "${ENV_FILE}" ]]; then
        local env_key=""
        case "${key}" in
            panel_port) env_key="PANEL_PORT" ;;
            web_base_path) env_key="WEB_BASE_PATH" ;;
            server_ip) env_key="SERVER_IP" ;;
            cert_fullchain) env_key="CERT_FULLCHAIN" ;;
            cert_privkey) env_key="CERT_PRIVKEY" ;;
        esac
        if [[ -n "${env_key}" ]]; then
            val=$(grep -E "^${env_key}=" "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
            if [[ -n "${val}" ]]; then
                echo "${val}"
                return
            fi
        fi
    fi

    echo "${default_val}"
}

set_db_setting() {
    local key="$1"
    local val="$2"
    if command -v sqlite3 &>/dev/null && [[ -f "${DB_PATH}" ]]; then
        sqlite3 "${DB_PATH}" "INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${val}');" 2>/dev/null || true
    fi
    if command -v node &>/dev/null && [[ -f "${BACKEND_DIR}/src/config/database.js" ]]; then
        node -e "try { const db = require('${BACKEND_DIR}/src/config/database'); db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('${key}', '${val}'); } catch {}" 2>/dev/null || true
    fi
}

get_panel_version() {
    if [[ -f "${BACKEND_DIR}/package.json" ]]; then
        grep -o '"version": *"[^"]*"' "${BACKEND_DIR}/package.json" | head -n 1 | cut -d'"' -f4
    else
        echo "1.4.10"
    fi
}

get_access_url() {
    local ip host port base_path ssl_mode protocol fullchain privkey
    port=$(get_db_setting "panel_port" "2096")
    host=$(get_db_setting "server_ip" "")
    base_path=$(get_db_setting "web_base_path" "/")
    ssl_mode=$(get_db_setting "panel_ssl" "auto")
    fullchain=$(get_db_setting "cert_fullchain" "")
    privkey=$(get_db_setting "cert_privkey" "")

    if [[ -z "${host}" ]]; then
        host=$(curl -s4m 2 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
    fi

    protocol="http"
    if [[ "${ssl_mode}" != "0" && "${ssl_mode}" != "http" && -n "${fullchain}" && -n "${privkey}" && -f "${fullchain}" && -f "${privkey}" ]]; then
        protocol="https"
    fi

    # Format base path
    if [[ "${base_path}" == "/" || -z "${base_path}" ]]; then
        base_path="/"
    else
        [[ "${base_path}" != /* ]] && base_path="/${base_path}"
        [[ "${base_path}" != */ ]] && base_path="${base_path}/"
    fi

    echo "${protocol}://${host}:${port}${base_path}"
}

service_status_badge() {
    local sname="$1"
    if systemctl is-active --quiet "${sname}" 2>/dev/null; then
        echo -e "${GREEN}Active (running)${NC}"
    else
        echo -e "${RED}Stopped${NC}"
    fi
}

show_header() {
    clear
    local ver access_url
    ver=$(get_panel_version)
    access_url=$(get_access_url)

    echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║             VPN Panel Management Tool — v${ver}             ║${NC}"
    echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo -e " Panel URL : ${YELLOW}${access_url}${NC}"
    echo -e " Services  : vpn-panel: $(service_status_badge vpn-panel) | sing-box: $(service_status_badge sing-box) | xray: $(service_status_badge xray)"
    echo -e "------------------------------------------------------------"
}

start_panel() {
    echo -e "\n${CYAN}Starting VPN Panel service...${NC}"
    systemctl start "${SERVICE_NAME}"
    sleep 1
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
        echo -e "${GREEN}[OK] VPN Panel started successfully!${NC}"
    else
        echo -e "${RED}[ERROR] Failed to start. Check: journalctl -u vpn-panel -n 20${NC}"
    fi
    read -rp "Press Enter to return to menu..."
}

stop_panel() {
    echo -e "\n${CYAN}Stopping VPN Panel service...${NC}"
    systemctl stop "${SERVICE_NAME}"
    sleep 1
    echo -e "${YELLOW}[OK] VPN Panel stopped.${NC}"
    read -rp "Press Enter to return to menu..."
}

restart_panel() {
    echo -e "\n${CYAN}Restarting VPN Panel service...${NC}"
    systemctl daemon-reload
    systemctl restart "${SERVICE_NAME}"
    sleep 1
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
        echo -e "${GREEN}[OK] VPN Panel restarted successfully!${NC}"
    else
        echo -e "${RED}[ERROR] Failed to restart. Check: journalctl -u vpn-panel -n 20${NC}"
    fi
    read -rp "Press Enter to return to menu..."
}

view_logs() {
    echo -e "\n${CYAN}Recent VPN Panel logs (Press Ctrl+C to exit):${NC}\n"
    journalctl -u "${SERVICE_NAME}" -n 50 -f --no-pager
}

update_panel() {
    echo -e "\n${CYAN}Checking for panel updates...${NC}"
    if [[ -f "${PANEL_DIR}/deploy/update.sh" ]]; then
        bash "${PANEL_DIR}/deploy/update.sh"
    else
        echo -e "${RED}[ERROR] update.sh not found at ${PANEL_DIR}/deploy/update.sh${NC}"
    fi
    read -rp "Press Enter to return to menu..."
}

reset_admin() {
    echo -e "\n${BOLD}${CYAN}── Reset Admin Credentials ──${NC}"
    read -rp "Enter new admin username [default: admin]: " new_user
    new_user="${new_user:-admin}"

    read -rp "Enter new admin password: " new_pass
    if [[ -z "${new_pass}" ]]; then
        echo -e "${RED}[ERROR] Password cannot be empty.${NC}"
        read -rp "Press Enter to return to menu..."
        return
    fi

    echo -e "${CYAN}Updating database credentials...${NC}"
    cd "${BACKEND_DIR}"
    node -e "
const bcrypt = require('bcrypt');
const db = require('./src/config/database');
const hash = bcrypt.hashSync('${new_pass}', 12);
const res = db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE role = ?').run('${new_user}', hash, 'admin');
if (res.changes === 0) {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('${new_user}', hash, 'admin');
}
console.log('SUCCESS');
" 2>/dev/null

    echo -e "${GREEN}[OK] Admin credentials reset successfully!${NC}"
    echo -e "Username: ${YELLOW}${new_user}${NC}"
    echo -e "Password: ${YELLOW}${new_pass}${NC}"
    read -rp "Press Enter to return to menu..."
}

change_port_path() {
    echo -e "\n${BOLD}${CYAN}── Change Web Port & Secret Path ──${NC}"
    local cur_port cur_path
    cur_port=$(get_db_setting "panel_port" "2096")
    cur_path=$(get_db_setting "web_base_path" "/")

    read -rp "Enter new port [current: ${cur_port}]: " new_port
    new_port="${new_port:-$cur_port}"

    read -rp "Enter new secret path (e.g. /my-secret or / for root) [current: ${cur_path}]: " new_path
    new_path="${new_path:-$cur_path}"

    # Normalize path
    if [[ "${new_path}" == "/" || -z "${new_path}" ]]; then
        new_path="/"
    else
        [[ "${new_path}" != /* ]] && new_path="/${new_path}"
        new_path="${new_path%/}"
    fi

    echo -e "${CYAN}Saving configuration...${NC}"
    set_db_setting "panel_port" "${new_port}"
    set_db_setting "web_base_path" "${new_path}"

    if [[ -f "${ENV_FILE}" ]]; then
        sed -i -E "s/^PANEL_PORT=.*/PANEL_PORT=${new_port}/" "${ENV_FILE}" 2>/dev/null || true
        sed -i -E "s|^WEB_BASE_PATH=.*|WEB_BASE_PATH=${new_path}|" "${ENV_FILE}" 2>/dev/null || echo "WEB_BASE_PATH=${new_path}" >> "${ENV_FILE}"
    fi

    # Open firewall port if ufw active
    if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
        ufw allow "${new_port}/tcp" comment "VPN Panel" &>/dev/null || true
    fi

    echo -e "${CYAN}Restarting panel service...${NC}"
    systemctl restart "${SERVICE_NAME}"
    sleep 1

    echo -e "${GREEN}[OK] Configuration updated successfully!${NC}"
    echo -e "New Access URL: ${YELLOW}$(get_access_url)${NC}"
    read -rp "Press Enter to return to menu..."
}

manage_ssl() {
    while true; do
        clear
        echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}${CYAN}║             SSL / TLS Certificate Management               ║${NC}"
        echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
        echo -e " Fullchain Path : ${YELLOW}$(get_db_setting "cert_fullchain" "Not set")${NC}"
        echo -e " Privkey Path   : ${YELLOW}$(get_db_setting "cert_privkey" "Not set")${NC}"
        echo -e " Panel SSL Mode : ${YELLOW}$(get_db_setting "panel_ssl" "auto")${NC}"
        echo -e "------------------------------------------------------------"
        echo -e "  ${GREEN}1.${NC} Issue Free Let's Encrypt Certificate (via acme.sh)"
        echo -e "  ${GREEN}2.${NC} Set Custom Certificate File Paths"
        echo -e "  ${GREEN}3.${NC} Generate Self-Signed Certificate for IP / Domain"
        echo -e "  ${GREEN}4.${NC} Toggle Panel HTTPS Mode (Enable / Disable)"
        echo -e "  ${GREEN}0.${NC} Back to Main Menu"
        echo -e "------------------------------------------------------------"
        read -rp "Please enter an option [0-4]: " ssl_choice

        case "${ssl_choice}" in
            1)
                echo -e "\n${BOLD}${CYAN}── Issue Let's Encrypt Certificate ──${NC}"
                read -rp "Enter your domain name (e.g. vpn.example.com): " domain
                if [[ -z "${domain}" ]]; then
                    echo -e "${RED}[ERROR] Domain name cannot be empty.${NC}"
                    sleep 1
                    continue
                fi

                echo -e "Checking acme.sh installation..."
                if [[ ! -f "/root/.acme.sh/acme.sh" ]]; then
                    echo -e "${CYAN}Installing acme.sh...${NC}"
                    curl -fsSL https://get.acme.sh | sh
                fi

                echo -e "${CYAN}Stopping conflicting web services on port 80...${NC}"
                systemctl stop nginx 2>/dev/null || true
                systemctl stop apache2 2>/dev/null || true

                echo -e "${CYAN}Issuing certificate for ${domain}...${NC}"
                /root/.acme.sh/acme.sh --set-default-ca --server letsencrypt
                if /root/.acme.sh/acme.sh --issue -d "${domain}" --standalone --force; then
                    CERT_DIR="/root/cert/${domain}"
                    mkdir -p "${CERT_DIR}"
                    /root/.acme.sh/acme.sh --install-cert -d "${domain}" \
                        --key-file       "${CERT_DIR}/privkey.pem" \
                        --fullchain-file "${CERT_DIR}/fullchain.pem"

                    set_db_setting "cert_fullchain" "${CERT_DIR}/fullchain.pem"
                    set_db_setting "cert_privkey" "${CERT_DIR}/privkey.pem"
                    set_db_setting "panel_ssl" "auto"
                    set_db_setting "server_ip" "${domain}"

                    systemctl restart "${SERVICE_NAME}"
                    echo -e "${GREEN}[OK] Certificate issued and applied successfully!${NC}"
                    echo -e "Access URL: ${YELLOW}$(get_access_url)${NC}"
                else
                    echo -e "${RED}[ERROR] Certificate issuance failed. Ensure your domain points to this server IP and port 80 is open.${NC}"
                fi
                read -rp "Press Enter to continue..."
                ;;
            2)
                echo -e "\n${BOLD}${CYAN}── Custom Certificate Paths ──${NC}"
                read -rp "Enter full path to fullchain.pem (.crt): " fpath
                read -rp "Enter full path to privkey.pem (.key): " kpath

                if [[ -f "${fpath}" && -f "${kpath}" ]]; then
                    set_db_setting "cert_fullchain" "${fpath}"
                    set_db_setting "cert_privkey" "${kpath}"
                    set_db_setting "panel_ssl" "auto"
                    systemctl restart "${SERVICE_NAME}"
                    echo -e "${GREEN}[OK] Certificate paths configured successfully!${NC}"
                else
                    echo -e "${RED}[ERROR] Specified certificate files do not exist.${NC}"
                fi
                read -rp "Press Enter to continue..."
                ;;
            3)
                echo -e "\n${BOLD}${CYAN}── Generate Self-Signed Certificate ──${NC}"
                read -rp "Enter domain or IP for certificate [default: localhost]: " self_host
                self_host="${self_host:-localhost}"
                mkdir -p "/root/cert/self-signed"
                openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
                    -keyout "/root/cert/self-signed/privkey.pem" \
                    -out "/root/cert/self-signed/fullchain.pem" \
                    -subj "/CN=${self_host}" 2>/dev/null

                set_db_setting "cert_fullchain" "/root/cert/self-signed/fullchain.pem"
                set_db_setting "cert_privkey" "/root/cert/self-signed/privkey.pem"
                set_db_setting "panel_ssl" "auto"
                systemctl restart "${SERVICE_NAME}"
                echo -e "${GREEN}[OK] Self-signed certificate created and activated!${NC}"
                read -rp "Press Enter to continue..."
                ;;
            4)
                local cur_mode
                cur_mode=$(get_db_setting "panel_ssl" "auto")
                if [[ "${cur_mode}" == "0" || "${cur_mode}" == "http" ]]; then
                    set_db_setting "panel_ssl" "auto"
                    echo -e "${GREEN}Panel HTTPS mode ENABLED (auto).${NC}"
                else
                    set_db_setting "panel_ssl" "0"
                    echo -e "${YELLOW}Panel HTTPS mode DISABLED (plain HTTP).${NC}"
                fi
                systemctl restart "${SERVICE_NAME}"
                read -rp "Press Enter to continue..."
                ;;
            0)
                break
                ;;
            *)
                echo -e "${RED}Invalid option.${NC}"
                sleep 1
                ;;
        esac
    done
}

manage_bbr() {
    echo -e "\n${BOLD}${CYAN}── TCP BBR Congestion Control ──${NC}"
    local cur_cc
    cur_cc=$(sysctl net.ipv4.tcp_congestion_control 2>/dev/null | awk '{print $3}')
    echo -e "Current TCP Congestion Control : ${YELLOW}${cur_cc}${NC}"

    if [[ "${cur_cc}" == "bbr" ]]; then
        echo -e "${GREEN}[OK] TCP BBR is already active and optimizing throughput!${NC}"
    else
        read -rp "Enable TCP BBR now? (y/n) [default: y]: " bbr_choice
        bbr_choice="${bbr_choice:-y}"
        if [[ "${bbr_choice}" =~ ^[Yy]$ ]]; then
            echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
            echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
            sysctl -p &>/dev/null || true
            echo -e "${GREEN}[OK] TCP BBR successfully enabled!${NC}"
        fi
    fi
    read -rp "Press Enter to return to menu..."
}

reinstall_panel() {
    echo -e "\n${BOLD}${RED}── Reinstall VPN Panel ──${NC}"
    read -rp "Are you sure you want to reinstall the panel? (y/n): " confirm
    if [[ "${confirm}" =~ ^[Yy]$ ]]; then
        echo -e "${CYAN}Fetching and running installer from GitHub...${NC}"
        bash <(curl -Ls https://raw.githubusercontent.com/soulripper13/vpn-panel/main/deploy/install.sh)
    fi
    read -rp "Press Enter to return to menu..."
}

uninstall_panel() {
    echo -e "\n${BOLD}${RED}── Uninstall VPN Panel ──${NC}"
    read -rp "Are you sure you want to completely uninstall VPN Panel? (y/n): " confirm
    if [[ "${confirm}" =~ ^[Yy]$ ]]; then
        if [[ -f "${PANEL_DIR}/deploy/uninstall.sh" ]]; then
            bash "${PANEL_DIR}/deploy/uninstall.sh"
        else
            systemctl stop vpn-panel 2>/dev/null || true
            systemctl disable vpn-panel 2>/dev/null || true
            rm -f /etc/systemd/system/vpn-panel.service
            systemctl daemon-reload
            rm -rf "${PANEL_DIR}" /usr/local/bin/vpn-panel /usr/local/bin/panel
            echo -e "${GREEN}[OK] VPN Panel uninstalled.${NC}"
        fi
        exit 0
    fi
    read -rp "Press Enter to return to menu..."
}

# ── Main Menu Loop ────────────────────────────────────────────────────────────

main_menu() {
    check_root
    while true; do
        show_header
        echo -e "  ${GREEN}1.${NC}  Start Panel"
        echo -e "  ${GREEN}2.${NC}  Stop Panel"
        echo -e "  ${GREEN}3.${NC}  Restart Panel"
        echo -e "  ${GREEN}4.${NC}  View Status & Live Logs"
        echo -e "  ${GREEN}5.${NC}  Update Panel (to latest release)"
        echo -e "  ${GREEN}6.${NC}  Reset Admin Username & Password"
        echo -e "  ${GREEN}7.${NC}  Change Web Port & Secret URL Path"
        echo -e "  ${GREEN}8.${NC}  SSL / TLS Certificate Management"
        echo -e "  ${GREEN}9.${NC}  Check / Enable TCP BBR Congestion Control"
        echo -e "  ${GREEN}10.${NC} Reinstall Panel"
        echo -e "  ${GREEN}11.${NC} Uninstall Panel"
        echo -e "  ${GREEN}0.${NC}  Exit"
        echo -e "------------------------------------------------------------"
        read -rp "Please enter an option [0-11]: " choice

        case "${choice}" in
            1)  start_panel ;;
            2)  stop_panel ;;
            3)  restart_panel ;;
            4)  view_logs ;;
            5)  update_panel ;;
            6)  reset_admin ;;
            7)  change_port_path ;;
            8)  manage_ssl ;;
            9)  manage_bbr ;;
            10) reinstall_panel ;;
            11) uninstall_panel ;;
            0)  clear; exit 0 ;;
            *)  echo -e "${RED}Invalid option.${NC}"; sleep 1 ;;
        esac
    done
}

# Handle command-line arguments (e.g. vpn-panel start, vpn-panel restart, vpn-panel url)
case "${1:-}" in
    start)       check_root; systemctl start "${SERVICE_NAME}" ;;
    stop)        check_root; systemctl stop "${SERVICE_NAME}" ;;
    restart)     check_root; systemctl restart "${SERVICE_NAME}" ;;
    status)      systemctl status "${SERVICE_NAME}" ;;
    log|logs)    journalctl -u "${SERVICE_NAME}" -f ;;
    update)      check_root; update_panel ;;
    url)         get_access_url ;;
    "")          main_menu ;;
    *)           main_menu ;;
esac
