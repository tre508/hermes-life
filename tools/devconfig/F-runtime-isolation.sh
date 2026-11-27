#!/usr/bin/env bash
# Dev-config change F: sandbox the app's runtime.
#
# WHY: the backend runs as `gayzer` — the personal account — so any code it
# executes (project tests, build scripts, agent-driven commands) runs with access
# to personal files. Filesystem isolation on the SFTP account does NOT constrain
# what the application executes. These drop-ins bound where the service can WRITE
# and what it can do, without moving it to a new account.
#
# Implemented as systemd DROP-INS so they layer on top of the E units and can be
# reverted on their own. Needs ROOT ON THE NUC:
#     sudo bash tools/devconfig/F-runtime-isolation.sh
#
# Run E first (this script refuses to run without those units).
#
# WHAT THIS DOES NOT DO: it does not move the app to a dedicated account. That is
# a larger migration (new user, chown, SSH key, DB ownership) and is deliberately
# left out — see the note at the end.
set -euo pipefail

ROOT_DIR=/home/gayzer/Apps/hermes-life
APP_HOME=/home/gayzer
HOST_ENV="$ROOT_DIR/config/hermes-life-host.env"
BACKEND=hermes-life-backend.service
FRONTEND=hermes-life-frontend.service
say(){ printf '\n== %s\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run me with sudo (root on the NUC)"
for u in $BACKEND $FRONTEND; do
  [[ -f /etc/systemd/system/$u ]] || die "$u not found — run E-systemd-services.sh first"
done

# --------------------------------------------------- 1. derive the writable set
# The sandbox is only as tight as the configured project roots. Read them from the
# real config instead of guessing, so ReadWritePaths matches what the app needs.
say "1. Derive ReadWritePaths from the live config"
val(){
  [[ -f $HOST_ENV ]] || return 0
  sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$1=['\"]?([^'\"]*)['\"]?.*/\2/p" "$HOST_ENV" | head -1
}
PROJECT_ROOT="$(val HERMES_LIFE_PROJECT_ROOT)"; PROJECT_ROOT="${PROJECT_ROOT:-$APP_HOME/Apps}"
EXTRA_ROOTS="$(val HERMES_LIFE_PROJECT_EXTRA_ROOTS)"
VAULT="$(val HERMES_LIFE_OBSIDIAN_VAULT)"

CAND=(
  "$ROOT_DIR"                             # source, .run/ logs+pids, uploads
  "$APP_HOME/.local/share/hermes-life"    # SQLite database
  "$APP_HOME/.config/hermes-life"         # keys.env (read) + passkey store (write)
  "$PROJECT_ROOT"                         # project create/edit
)
IFS=':' read -r -a extras <<< "$EXTRA_ROOTS"
for r in "${extras[@]}"; do [[ -n ${r// } ]] && CAND+=("$r"); done
[[ -n $VAULT ]] && CAND+=("$VAULT")       # Obsidian note writes

RW=()
BROAD=""
for p in "${CAND[@]}"; do
  p="${p%/}"
  [[ -d $p ]] || { echo "  skip (missing): $p"; continue; }
  RW+=("$p")
  [[ $p == "$APP_HOME" ]] && BROAD="$p"
done
printf '  ReadWritePaths: %s\n' "${RW[*]}"

if [[ -n $BROAD ]]; then
  say "!! WARNING: a project root is the whole home directory ($BROAD)"
  cat <<EOF
  HERMES_LIFE_PROJECT_EXTRA_ROOTS includes $APP_HOME, so the app must be allowed to
  write anywhere under it — which makes ProtectSystem=strict much weaker than it
  looks. The sandbox still blocks /etc, /usr, /var, other users' homes and the
  kernel, but it will NOT contain writes inside your home.

  To tighten: narrow HERMES_LIFE_PROJECT_EXTRA_ROOTS in $HOST_ENV to just the
  directories you actually develop in, then re-run this script.
EOF
  read -r -p "  Continue with the broad path anyway? [y/N] " a
  [[ ${a:-n} == y || ${a:-n} == Y ]] || die "aborted — nothing was changed"
fi

# ------------------------------------------------------------- 2. write drop-ins
say "2. Write the hardening drop-ins"
install -d -m 0755 /etc/systemd/system/$BACKEND.d /etc/systemd/system/$FRONTEND.d

rwp=$(printf '%s\n' "${RW[@]}" | paste -sd' ' -)

cat > /etc/systemd/system/$BACKEND.d/10-hardening.conf <<EOF
# Dev-config F: runtime isolation. Revert by deleting this file + daemon-reload.
[Service]
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
CapabilityBoundingSet=
AmbientCapabilities=
MemoryMax=4G
TasksMax=512
# Files the service creates default to 0644/0755 world-readable. 0027 keeps them
# group-readable but not world-readable (systemd-analyze security flags this).
UMask=0027
# Everything else is read-only under ProtectSystem=strict; these are the only
# trees the app may write. Note ProtectHome is intentionally NOT set: the app
# reads ~/.ssh to reach the worker, and the project roots live under ~.
ReadWritePaths=$rwp
EOF

cat > /etc/systemd/system/$FRONTEND.d/10-hardening.conf <<EOF
[Service]
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
MemoryMax=2G
TasksMax=256
UMask=0027
# Vite needs its cache under the frontend dir, and reads the project.
ReadWritePaths=$ROOT_DIR/frontend $ROOT_DIR
EOF

# --------------------------------------------------------------- 3. apply+verify
say "3. Apply and verify (the sandbox must not break real work)"
systemctl daemon-reload
systemctl restart $BACKEND $FRONTEND
sleep 6
for u in $BACKEND $FRONTEND; do
  printf '%s: ' "$u"; systemctl is-active "$u" || { journalctl -u "$u" -n 30 --no-pager; die "$u failed after hardening"; }
done
curl -fsS -o /dev/null -w 'backend  /health -> %{http_code}\n' http://127.0.0.1:8766/health || die "health failed after hardening"
curl -fsS -o /dev/null -w 'frontend /       -> %{http_code}\n' http://127.0.0.1:5173/ || die "frontend failed after hardening"

say "4. Confirm the sandbox is actually on"
systemctl show -p NoNewPrivileges -p ProtectSystem -p CapabilityBoundingSet -p ReadWritePaths $BACKEND
echo
echo "Security score (lower exposure = higher score):"
systemd-analyze security $BACKEND --no-pager 2>/dev/null | tail -3 || echo "(systemd-analyze unavailable)"

cat <<EOF

== THEN EXERCISE IT (a passing health check does not prove writes still work)
In the app, confirm the paths the sandbox re-opened:
  1. Chat: send a message            -> the SQLite DB under ~/.local/share is writable
  2. Projects: open a workspace and edit a file -> $PROJECT_ROOT is writable
  3. Knowledge: write a vault note   -> $VAULT is writable
If any of those fail with EACCES, add the missing tree to ReadWritePaths in
/etc/systemd/system/$BACKEND.d/10-hardening.conf and \`systemctl daemon-reload && systemctl restart $BACKEND\`.

== NOT DONE HERE (deliberately): a dedicated runtime account
Moving the app off \`gayzer\` closes the remaining gap (executed code currently
inherits your personal account). It needs: a new system user, chown of the DB and
state dirs, an SSH key it owns, and a re-point of $HOST_ENV. Do that as its own
change with a rollback plan — this drop-in already bounds writes in the meantime.

== Rollback
  sudo rm -rf /etc/systemd/system/$BACKEND.d /etc/systemd/system/$FRONTEND.d
  sudo systemctl daemon-reload && sudo systemctl restart $BACKEND $FRONTEND
EOF
