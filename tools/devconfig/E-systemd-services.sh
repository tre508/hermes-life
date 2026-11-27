#!/usr/bin/env bash
# Dev-config change E: run the app as systemd services instead of hand-started
# background processes.
#
# WHY: today the backend and frontend are started by hermes-life.sh (nohup/setsid)
# or by hand in a terminal. They do not survive a reboot, and nothing restarts
# them after a crash. systemd gives restart-on-failure, a boot-time start, and
# journald logs — and it is the prerequisite for the F hardening drop-ins.
#
# This script needs ROOT ON THE NUC. Run it there:
#     sudo bash tools/devconfig/E-systemd-services.sh
#
# This is a BASELINE migration: it does not sandbox anything yet (that is F).
set -euo pipefail

ROOT_DIR=/home/gayzer/Apps/hermes-life
APP_USER=gayzer
RUN_DIR="$ROOT_DIR/.run"
say(){ printf '\n== %s\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run me with sudo (root on the NUC)"
[[ -d $ROOT_DIR ]] || die "no $ROOT_DIR"
id -u "$APP_USER" >/dev/null 2>&1 || die "no such user: $APP_USER"

# ------------------------------------------------------------------ 1. preflight
say "1. Preflight"
NPM="$(command -v npm || true)"
[[ -n $NPM ]] || die "npm not found on PATH (the frontend unit needs it)"
[[ -x $ROOT_DIR/start.sh ]] || die "$ROOT_DIR/start.sh missing or not executable"
echo "npm:    $NPM"
echo "user:   $APP_USER ($(id -u "$APP_USER"))"
# A port already served by the old nohup processes would collide with the units.
for p in 8766 5173; do
  if ss -ltn 2>/dev/null | grep -q ":$p "; then
    echo "note: port $p is currently in use — the units will fail to bind until"
    echo "      the hand-started process is stopped (this script does that in step 3)."
  fi
done

# --------------------------------------------------------------- 2. unit files
say "2. Write the unit files"
cat > /etc/systemd/system/hermes-life-backend.service <<EOF
[Unit]
Description=Hermes Life backend (FastAPI/uvicorn on 127.0.0.1:8766)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
# start.sh owns the venv check, env loading (config/*.env -> keys.env) and the
# uvicorn exec, so the unit reuses it rather than duplicating that logic.
WorkingDirectory=$ROOT_DIR
Environment=HOME=/home/$APP_USER
ExecStart=$ROOT_DIR/start.sh
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hermes-life-backend

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/hermes-life-frontend.service <<EOF
[Unit]
Description=Hermes Life frontend (Vite dev server on :5173)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$ROOT_DIR/frontend
Environment=HOME=/home/$APP_USER
ExecStart=$NPM run dev
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hermes-life-frontend

[Install]
WantedBy=multi-user.target
EOF

# ------------------------------------------------- 3. hand over from the manager
say "3. Stop the hand-started processes so the units can bind"
for p in 8766 5173; do
  pids=$(ss -ltnp 2>/dev/null | awk -v P=":$p" '$4 ~ P {print $NF}' | grep -oP 'pid=\K[0-9]+' | sort -u || true)
  for pid in $pids; do
    echo "stopping pid $pid (port $p)"
    kill "$pid" 2>/dev/null || true
  done
done
sleep 2
rm -f "$RUN_DIR/backend.pid" "$RUN_DIR/frontend.pid" 2>/dev/null || true

# --------------------------------------------------------------- 4. enable+start
say "4. Enable and start"
systemctl daemon-reload
systemctl enable --now hermes-life-backend.service hermes-life-frontend.service
sleep 6
for u in hermes-life-backend hermes-life-frontend; do
  printf '%s: ' "$u"
  systemctl is-active "$u" || { journalctl -u "$u" -n 25 --no-pager; die "$u failed to start"; }
done

# ------------------------------------------------------------------ 5. verify
say "5. Verify the real thing, not just the unit state"
curl -fsS -o /dev/null -w 'backend  /health -> %{http_code}\n' http://127.0.0.1:8766/health || die "backend health failed"
curl -fsS -o /dev/null -w 'frontend /       -> %{http_code}\n' http://127.0.0.1:5173/ || die "frontend not answering"
echo
echo "Survives a reboot:      $(systemctl is-enabled hermes-life-backend hermes-life-frontend | tr '\n' ' ')"
echo "Logs:                   journalctl -u hermes-life-backend -f"
echo
echo "NOTE: hermes-life.sh still exists. Do not use its start/restart for these two"
echo "      services any more, or you will get a second copy fighting for the ports."
echo "      Use: systemctl restart hermes-life-backend hermes-life-frontend"
echo
say "Rollback"
cat <<'EOF'
  sudo systemctl disable --now hermes-life-backend hermes-life-frontend
  sudo rm /etc/systemd/system/hermes-life-{backend,frontend}.service
  sudo systemctl daemon-reload
  ./hermes-life.sh start      # back to the hand-started manager
EOF
