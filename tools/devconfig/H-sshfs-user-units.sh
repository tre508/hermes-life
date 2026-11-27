#!/usr/bin/env bash
# Dev-config change H (final): make the SSHFS project mounts resilient and persistent.
#
# RUNS AS glenn ON THE LENOVO. NO SUDO — these are systemd USER units.
#
#     bash H-sshfs-user-units.sh
#
# WHY USER UNITS, NOT fstab: the first attempt used a root-mounted fstab entry and
# it does not work on this host. A root-owned FUSE mount has to opt in with
# allow_other (which needs /etc/fuse.conf and makes the mount owner-only for
# everyone else), and root cannot stat through a mount it does not own — which
# breaks every existence/`-p` test against the mountpoint. Mounting as the user who
# actually reads the mount avoids all of it, and needs no privileges.
#
# Also: do NOT pass user_id/group_id. FUSE *reports* those in /proc/mounts, but
# passing them fails the mount outright:
#     fuse: unknown option(s): `-o user_id=1000,group_id=1000'
set -euo pipefail

NUC=192.168.178.23
DEV_USER=devshare
UNIT_DIR="$HOME/.config/systemd/user"
KEY="$HOME/.ssh/id_ed25519"
KNOWN_HOSTS="$HOME/.ssh/known_hosts"
say(){ printf '\n== %s\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || die "run me as glenn, NOT with sudo (user units need no root)"
command -v sshfs >/dev/null || die "sshfs not installed"
[[ -r $KEY ]] || die "ssh identity not readable: $KEY"

# systemctl --user needs this over a non-interactive session.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# name:remote:local-relative-to-home
MOUNTS=(
  "projects-hermes-life:/hermes-life:Projects/hermes-life"
  "projects-media-viewer:/media-viewer:Projects/media-viewer"
)

OPTS="reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,ConnectTimeout=10"
OPTS="$OPTS,IdentityFile=$KEY,IdentitiesOnly=yes"
OPTS="$OPTS,UserKnownHostsFile=$KNOWN_HOSTS,StrictHostKeyChecking=accept-new"

say "1. Preflight"
echo "  sshfs:        $(command -v sshfs)"
echo "  identity:     $KEY"
echo "  linger:       $(loginctl show-user "$(id -un)" -p Linger 2>/dev/null || echo unknown)"
echo "  options:      $OPTS"

say "2. Write the user units"
mkdir -p "$UNIT_DIR"
for m in "${MOUNTS[@]}"; do
  IFS=: read -r unit remote rel <<< "$m"
  cat > "$UNIT_DIR/$unit.service" <<EOF
[Unit]
Description=SSHFS mount - $remote ($DEV_USER@$NUC)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# -f keeps sshfs in the foreground so systemd owns the process and can restart it.
# Deliberately NO user_id/group_id (FUSE rejects them as options) and no
# allow_other (a user mount is read by the user who owns it).
ExecStart=/usr/bin/sshfs -f -o $OPTS $DEV_USER@$NUC:$remote %h/$rel
ExecStop=/usr/bin/fusermount3 -u %h/$rel
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  echo "  wrote $unit.service"
done

say "3. Verify the exact command BEFORE tearing down anything working"
for m in "${MOUNTS[@]}"; do
  IFS=: read -r unit remote rel <<< "$m"
  probe="/tmp/sshfs-probe-$$"
  mkdir -p "$probe"
  if sshfs -o "$OPTS" "$DEV_USER@$NUC:$remote" "$probe" 2>/dev/null; then
    echo "  $remote: mountable"
    fusermount3 -u "$probe" 2>/dev/null || true
  else
    rmdir "$probe" 2>/dev/null || true
    die "$remote would NOT mount — not touching the live mounts"
  fi
  rmdir "$probe" 2>/dev/null || true
done

say "4. Hand the mounts over to systemd"
systemctl --user daemon-reload
for m in "${MOUNTS[@]}"; do
  IFS=: read -r unit remote rel <<< "$m"
  # Unmount any ad-hoc mount first, or the unit cannot take the path.
  if grep -qs "[[:space:]]$HOME/$rel[[:space:]]" /proc/mounts; then
    echo "  unmounting the ad-hoc mount at $HOME/$rel"
    fusermount3 -u "$HOME/$rel" 2>/dev/null || umount "$HOME/$rel" 2>/dev/null || true
  fi
done
sleep 1
systemctl --user enable --now "${MOUNTS[0]%%:*}.service" "${MOUNTS[1]%%:*}.service"
sleep 5

say "5. Verify for real"
ok=1
for m in "${MOUNTS[@]}"; do
  IFS=: read -r unit remote rel <<< "$m"
  active="$(systemctl --user is-active "$unit.service" 2>&1)"
  mounted="$(grep -c "[[:space:]]$HOME/$rel[[:space:]]" /proc/mounts || true)"
  content="$(ls "$HOME/$rel" 2>/dev/null | head -1)"
  printf '  %-24s %-8s mounted=%s  first=%s\n' "$unit" "$active" "$mounted" "${content:-<EMPTY>}"
  [[ $active == active && $mounted -ge 1 && -n $content ]] || ok=0
done
# /proc/mounts only reports FUSE-level options, so read the process args instead.
echo "  options actually applied:"
ps -o args= -C sshfs 2>/dev/null | tr ' ' '\n' \
  | grep -oE 'reconnect|ServerAliveInterval=15|ServerAliveCountMax=3|ConnectTimeout=10' \
  | sort -u | sed 's/^/    /'
[[ $ok -eq 1 ]] || die "a mount is not healthy — check: systemctl --user status projects-hermes-life"

cat <<EOF

== Done. What changed
  - Both mounts are systemd USER units, enabled at login.
  - Linger is on, so they also come up at boot with no session.
  - reconnect + ServerAlive* + ConnectTimeout make a network blip recoverable
    instead of leaving a hung mount.

== Verify across a reboot
  sudo reboot    # then, after logging back in:
  systemctl --user status projects-hermes-life --no-pager
  ls ~/Projects/hermes-life

== Rollback
  systemctl --user disable --now projects-hermes-life.service projects-media-viewer.service
  rm ~/.config/systemd/user/projects-*.service
  systemctl --user daemon-reload
  sshfs $DEV_USER@$NUC:/hermes-life ~/Projects/hermes-life   # back to ad-hoc
EOF
