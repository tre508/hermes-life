#!/usr/bin/env bash
# Dev-config change C: move the Cloudflare Tunnel from the Lenovo onto the NUC.
#
# WHY: today the tunnel runs on the Lenovo, so the public URL depends on the
# laptop being awake. That is also the ONLY reason the Vite dev server binds
# 0.0.0.0:5173 (LAN-exposed) instead of loopback. Move the tunnel, and Vite can
# bind 127.0.0.1 and stop being reachable from the LAN.
#
# This script needs ROOT ON THE NUC (it writes /etc and a systemd unit). Run it
# on the NUC:
#     sudo bash tools/devconfig/C-move-cloudflared-to-nuc.sh
#
# ORDER IS LOAD-BEARING. Do not bind Vite to loopback until step 4 verifies the
# tunnel is serving from the NUC, or the public site goes dark.
set -euo pipefail

NUC_IP="${NUC_IP:-192.168.178.23}"
PUBLIC_HOST="${PUBLIC_HOST:-dev.hermeshaplease.com}"
TOKEN_FILE=/etc/cloudflared/token
UNIT=/etc/systemd/system/cloudflared.service

say(){ printf '\n== %s\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run me with sudo (root on the NUC)"

# ---------------------------------------------------------------- 1. preflight
say "1. Preflight"
command -v curl >/dev/null || die "curl missing"
# Create the token's directory NOW, so the paste step in the message below works
# even on a machine where cloudflared has never been installed (otherwise
# `sudo tee /etc/cloudflared/token` fails with ENOENT).
install -d -m 0700 /etc/cloudflared
# Resumable: a previous run may have installed and started the connector without
# getting past the dashboard step. Skip the install, but DO continue to the
# ingress check — do not exit here, or the run can never be completed.
ALREADY=0
if systemctl is-active --quiet cloudflared; then
  ALREADY=1
  echo "ok: cloudflared is ALREADY running here — skipping install, continuing to the ingress check"
else
  echo "ok: not running here yet; /etc/cloudflared ready"
fi

# ------------------------------------------------------------------- 2. token
say "2. Tunnel token"
if [[ ! -f $TOKEN_FILE ]]; then
  cat <<EOF
No token at ${TOKEN_FILE} yet. Nothing else has been changed.
The directory /etc/cloudflared is created and ready. Get the token here with ONE of:

  a) read it on the LENOVO, then paste it on THIS NUC.
     On the LENOVO:      sudo cat /etc/cloudflared/token
     Then HERE:          sudo tee ${TOKEN_FILE} >/dev/null     (paste the value, Ctrl-D)
                         sudo chmod 600 ${TOKEN_FILE}
     Note: do NOT pipe it over ssh — the token is root-owned on the Lenovo, and a
     non-interactive ssh has no TTY for sudo ("A terminal is required to authenticate").

  b) or re-issue it in the Cloudflare dashboard:
     Zero Trust -> Networks -> Tunnels -> <tunnel> -> Configure -> install connector
     and paste the token value into ${TOKEN_FILE} here.

Re-run this script once the token is in place. The running Lenovo tunnel is untouched.
EOF
  exit 0
fi
echo "ok: token present"

# -------------------------------------------------------------- 3. install+unit
if [[ $ALREADY -eq 1 ]]; then
  say "3. Install — skipped (cloudflared is already running here)"
else
say "3. Install cloudflared and the service unit"
if ! command -v cloudflared >/dev/null; then
  # Match the Lenovo's channel rather than pinning a version here.
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq && apt-get install -y cloudflared
fi
cloudflared --version

install -d -m 0700 /etc/cloudflared
chmod 600 "$TOKEN_FILE"
cat > "$UNIT" <<'UNITEOF'
[Unit]
Description=Cloudflare Tunnel (Hermes Life)
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token-file /etc/cloudflared/token
Restart=on-failure
RestartSec=5
# Keep the connector from reaching into the app's files.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNITEOF
systemctl daemon-reload
systemctl enable --now cloudflared
sleep 5
systemctl is-active --quiet cloudflared || { journalctl -u cloudflared -n 30 --no-pager; die "cloudflared did not start"; }
echo "ok: cloudflared running on the NUC"
fi

# ------------------------------------------------------------------ 4. ingress
say "4. Point the ingress at loopback (Cloudflare DASHBOARD — not local config)"
cat <<EOF
This tunnel is token-managed, so the hostname->origin rule lives in the dashboard.

  Zero Trust -> Networks -> Tunnels -> <tunnel> -> Public Hostname
    Hostname:    ${PUBLIC_HOST}
    Service:     HTTP
    Origin URL:  127.0.0.1:5173      <-- change FROM ${NUC_IP}:5173

Do that now. This script will WATCH the connector's own log until the new origin
arrives — an acknowledgement is not proof, and flipping Vite to loopback while the
origin still says ${NUC_IP} would take the public site offline.
EOF
deadline=$(( SECONDS + 300 ))
while :; do
  if journalctl -u cloudflared --no-pager 2>/dev/null | grep -q '127\.0\.0\.1:5173'; then
    echo "  origin confirmed: the connector received 127.0.0.1:5173"
    break
  fi
  if (( SECONDS >= deadline )); then
    cat <<EOF

  !! Timed out after 5 minutes — the connector still only knows ${NUC_IP}:5173.
     Nothing else was changed; Vite is untouched, so the site is still up.
     Re-check that you edited the PUBLIC HOSTNAME rule on the SAME tunnel this
     connector belongs to, and that it saved. Then re-run this script.
EOF
    exit 0
  fi
  printf '  waiting for the dashboard origin change… (%ss)\r' "$(( deadline - SECONDS ))"
  sleep 5
done
echo

# --------------------------------------------------------- 5. bind Vite locally
say "5. Bind Vite to loopback (only now)"
# The host binding lives in TWO places, and the CLI flag WINS over the config file:
#   frontend/vite.config.js   host: '0.0.0.0'
#   frontend/package.json     "dev": "vite --host 0.0.0.0"
# Editing only the config silently does nothing — the npm script overrides it.
FE=/home/gayzer/Apps/hermes-life/frontend
STAMP=$(date +%Y%m%d-%H%M%S)
for f in "$FE/vite.config.js" "$FE/package.json"; do cp -a "$f" "$f.bak-$STAMP"; done
sudo -u gayzer sed -i "s/host: '0.0.0.0'/host: '127.0.0.1'/" "$FE/vite.config.js"
sudo -u gayzer sed -i 's/vite --host 0.0.0.0/vite --host 127.0.0.1/' "$FE/package.json"
if grep -n "0\.0\.0\.0" "$FE/vite.config.js" "$FE/package.json"; then
  die "a 0.0.0.0 binding survived — Vite is still LAN-exposed"
fi
echo "ok: both bindings moved to loopback"
echo "Restart the frontend for it to take effect, then confirm it is NOT on the LAN:"
echo "    ss -ltn | grep 5173          # expect 127.0.0.1:5173, NOT 0.0.0.0:5173"

# ------------------------------------------------------------ 6. retire Lenovo
say "6. Retire the Lenovo connector (after the NUC tunnel is confirmed)"
cat <<EOF
On the LENOVO, once the NUC tunnel is serving:
    sudo systemctl disable --now cloudflared
EOF

say "Done. Rollback:"
cat <<EOF
  - Vite:    restore frontend/vite.config.js AND frontend/package.json from the .bak-* this script made
             (the host binding lives in both; restoring one leaves Vite on loopback)
  - NUC:     sudo systemctl disable --now cloudflared
  - Lenovo:  sudo systemctl enable --now cloudflared
  - dashboard: set the origin back to ${NUC_IP}:5173
EOF
