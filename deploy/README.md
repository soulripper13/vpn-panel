# VPN Panel — Deployment Guide

## Prerequisites

The installer requires root because it creates the `vpn-panel` service account and a narrowly scoped root helper. After installation, the web process runs as `vpn-panel`; it does not run as root. On hosts where you cannot install system services, run the panel as the account that owns the files and use `deploy/update.sh` manually. The one-click in-panel updater and core binary updater require the root helper.

### Migrate an existing root-run installation

On the VPS, open an SSH session as root (or an account with sudo), then run the signed migration script from the latest release:

```bash
curl -fsSL https://github.com/soulripper13/vpn-panel/releases/download/v1.4.11/migrate-legacy-install.sh | sudo bash
```

It verifies the signed release before stopping the existing service, keeps a complete backup under `/opt/vpn-panel-migration-backups/`, and restores the previous root-run service if migration fails. Keep your SSH session open and verify access to the panel and VPN services before closing it. Do not use `deploy/update.sh` for this first migration.

| Requirement | Details |
|---|---|
| **Server OS** | Debian 12 / 13 (Trixie) or Ubuntu 22.04+ |
| **Access** | Root SSH access |
| **Binaries** | `sing-box` at `/usr/bin/sing-box`, `xray` at `/usr/local/x-ui/bin/xray-linux-amd64` |
| **Certificates** | TLS certs at `/root/cert/ip/` (`fullchain.pem` + `privkey.pem`) |
| **Local (deploy.sh)** | Node.js 18+ and npm installed on your Mac |

---

## Installation

### Option A — One-Click Direct Remote Install (on server)

```bash
bash <(curl -Ls https://raw.githubusercontent.com/soulripper13/vpn-panel/main/deploy/install.sh)
```

The interactive installer will prompt you to configure:
1. **Web Panel Port** *(default: `2096`)*
2. **Admin Username** *(default: `admin`)*
3. **Admin Password** *(default: auto-generated secure random password)*
4. **Domain Configuration** *(bind a domain or use auto-detected public IP)*

### Option B — Remote Deploy from your Workstation (deploy.sh)

```bash
# Clone the repository
git clone https://github.com/soulripper13/vpn-panel.git
cd vpn-panel

# Run deploy script targeting your VPS
./deploy/deploy.sh root@<SERVER_IP> -p <SSH_PORT>
```

### Option C — Manual Git Clone on the Server

```bash
git clone https://github.com/soulripper13/vpn-panel.git /tmp/vpn-panel
cd /tmp/vpn-panel
chmod +x deploy/install.sh
sudo ./deploy/install.sh
```

---

## Accessing the Panel

After installation, open in your browser:

```
http://<YOUR_SERVER_IP_OR_DOMAIN>:<PANEL_PORT>
```

**Credentials:**
Configured during the interactive installer (or default `admin` with your chosen/suggested password).

> **⚠ Change your password immediately after first login!**

---

## Changing the Default Password

1. Log in to the panel
2. Navigate to **Settings → Account**
3. Enter current password and new password
4. Click **Save**

Alternatively via CLI on the server:

```bash
sqlite3 /opt/vpn-panel/data/panel.db
```

```sql
-- Generate a new hash in Node.js first:
-- node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');const h=c.createHmac('sha256',s).update('newpassword').digest('hex');console.log(s+':'+h);"
UPDATE users SET password='<new_hash>' WHERE username='admin';
```

---

## Updating the Panel

### Remote update from Mac

```bash
cd vpn-panel
git pull
./deploy/deploy.sh root@<SERVER_IP> -p <SSH_PORT>
```

### On-server update

```bash
cd /tmp/vpn-panel
git pull
sudo ./deploy/update.sh
```

The update script automatically:
- Backs up the current installation to `/opt/vpn-panel-backups/`
- Deploys new files
- Rolls back automatically if the new version fails to start

---

## Port Configuration

Edit `/opt/vpn-panel/.env` on the server:

```bash
nano /opt/vpn-panel/.env
# Change: PANEL_PORT=2096
systemctl restart vpn-panel
```

If UFW is active, update the firewall:

```bash
ufw delete allow 2096/tcp
ufw allow <new_port>/tcp
```

---

## Service Management

```bash
# Status
systemctl status vpn-panel

# Start / Stop / Restart
systemctl start vpn-panel
systemctl stop vpn-panel
systemctl restart vpn-panel

# Live logs
journalctl -u vpn-panel -f

# Last 100 log lines
journalctl -u vpn-panel -n 100 --no-pager
```

---

## Backup & Restore

### Manual Backup

```bash
# Back up database and config
cp /opt/vpn-panel/data/panel.db ~/panel-backup-$(date +%Y%m%d).db
cp /opt/vpn-panel/.env ~/panel-env-backup-$(date +%Y%m%d)
```

### Restore

```bash
systemctl stop vpn-panel
cp ~/panel-backup-20241101.db /opt/vpn-panel/data/panel.db
systemctl start vpn-panel
```

### Automatic backups (cron)

```bash
# Add to crontab: crontab -e
0 3 * * * sqlite3 /opt/vpn-panel/data/panel.db ".backup /opt/vpn-panel-backups/db-$(date +\%Y\%m\%d).db"
```

---

## Uninstalling

```bash
sudo ./deploy/uninstall.sh
```

You will be prompted whether to also remove:
- Backup directory
- Node.js

---

## Troubleshooting

### Panel won't start

```bash
journalctl -u vpn-panel -n 50 --no-pager
```

Common causes:
- **Port in use**: `ss -tlnp | grep 2096` — change `PANEL_PORT` in `.env`
- **Missing .env**: `cp /opt/vpn-panel/deploy/.env.example /opt/vpn-panel/.env`
- **Node.js missing**: `node --version` — reinstall if needed

### Cannot connect to panel

```bash
# Check the service is running
systemctl is-active vpn-panel

# Check the port is listening
ss -tlnp | grep 2096

# Check firewall
ufw status
```

### sing-box or xray won't start via panel

```bash
# Test binaries manually
/usr/bin/sing-box run -c /etc/sing-box/config.json
/usr/local/x-ui/bin/xray-linux-amd64 run -c /usr/local/x-ui/bin/config.json

# Check config JSON syntax
sing-box check -c /etc/sing-box/config.json
```

### Logs location

| Component | Log command |
|---|---|
| Panel | `journalctl -u vpn-panel -f` |
| sing-box | `journalctl -u sing-box -f` |
| System | `/var/log/syslog` |

---

## Directory Structure

```
/opt/vpn-panel/
├── backend/          # Node.js Express backend
│   ├── src/
│   │   └── index.js
│   └── package.json
├── public/           # Built React frontend (served statically)
├── data/
│   └── panel.db      # SQLite database
└── .env              # Configuration (keep secret!)
```
