#!/usr/bin/env bash
# Run the root-requiring NUC changes in the correct order, under ONE sudo prompt.
#
#     sudo bash tools/devconfig/run-all-on-nuc.sh
#
# Order is load-bearing: C changes where the frontend binds, so E must come after
# it or E's units would immediately need editing; F layers drop-ins onto E's units.
#
# C is interactive — it stops and waits for you to change the tunnel origin in the
# Cloudflare dashboard. Answer it, or press Ctrl-C and run the steps individually.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say(){ printf '\n\n############ %s ############\n' "$*"; }
die(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run me with sudo: sudo bash $0"

# Running as root, so the scripts' own `sudo -u gayzer` calls are harmless.
say "C — move cloudflared to the NUC (interactive: has a dashboard step)"
# C can legitimately SKIP (no tunnel token yet) or fail. E and F do not depend on
# it, so do not let set -e abort the whole run here.
if ! bash "$HERE/C-move-cloudflared-to-nuc.sh"; then
  echo
  echo "!! C did not complete. Continuing with E and F — neither depends on it."
fi

say "E — systemd services"
bash "$HERE/E-systemd-services.sh"

say "F — runtime isolation"
bash "$HERE/F-runtime-isolation.sh"

cat <<'EOF'

################ NUC DONE ################

Remaining — H runs ON THE LENOVO. Run these TWO commands HERE, on the NUC:

    scp /home/gayzer/Apps/hermes-life/tools/devconfig/H-sshfs-mount-options.sh glenn@192.168.178.37:~/
    ssh -t glenn@192.168.178.37 'sudo bash ~/H-sshfs-mount-options.sh'

(The -t is required: without a TTY the remote sudo cannot prompt.)

Then, once the NUC tunnel is confirmed serving, retire the Lenovo connector:

    ssh -t glenn@192.168.178.37 'sudo systemctl disable --now cloudflared'

If E succeeded, stop using hermes-life.sh for the two services:

    systemctl restart hermes-life-backend hermes-life-frontend
EOF
