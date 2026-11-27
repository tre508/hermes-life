# Dev-config changes — handover scripts

From the review of `genericdevconfig.md` (`devconfigeval.md`). Everything that
needs **root** is a script here, because this agent has no passwordless sudo on
either machine (`sudo -n true` fails; only `sudo -u devshare` is permitted).

Each script: backs up what it touches, verifies the real thing (not just unit
state), and prints its own rollback. All are re-runnable.

| # | Change | Machine | Needs root | Status |
|---|---|---|---|---|
| A | Credentials out of the devshare-readable tree | NUC | no | **DONE** (this agent) |
| B | Fix the dangling passkey store path | NUC | no | **DONE** (this agent) |
| C | Move cloudflared onto the NUC, bind Vite to loopback | NUC + dashboard | **yes** | script ready |
| D | Make the entrance gate fail closed | NUC | no (code) | awaiting approval |
| E | Run the app as systemd services | NUC | **yes** | script ready |
| F | Sandbox the app runtime | NUC | **yes** | script ready |
| G | Git worktrees for agent tasks | NUC | no | **DROPPED** (user does not use git) |
| H | SSHFS mount options + persistence | **Lenovo** | no | **DONE** (this agent) |

## Order that matters

    C  then  E  then  F          H is independent (Lenovo side)

- **C before E**: C changes where the frontend binds. Doing E first would create
  systemd units that bind `0.0.0.0` and then immediately need editing.
- **E before F**: F writes systemd *drop-ins* onto the units E creates; F refuses
  to run without them.
- **H is independent** — it only touches the Lenovo, and it is the one change that
  needs **no root at all** (systemd *user* units).

## Running them

One command for the NUC side (C skips cleanly if the tunnel token isn't in place
yet; E and F still run):

    sudo bash /home/gayzer/Apps/hermes-life/tools/devconfig/run-all-on-nuc.sh

Or individually, on the NUC:

    sudo bash tools/devconfig/C-move-cloudflared-to-nuc.sh
    sudo bash tools/devconfig/E-systemd-services.sh
    sudo bash tools/devconfig/F-runtime-isolation.sh

Then H — run it **on the Lenovo, as `glenn`, with NO sudo** (user units need no
privileges, and running it as root is explicitly refused):

    scp tools/devconfig/H-sshfs-user-units.sh glenn@192.168.178.37:~/
    ssh glenn@192.168.178.37 'bash ~/H-sshfs-user-units.sh'

No `-t` needed any more, because there is no `sudo` to prompt for. It backs off
before touching a working mount: it proves both remotes mount to a scratch
directory first, and only then hands the live mounts over to systemd.

## The one manual step

C cannot be fully automated: the tunnel is **token-managed**, so the
hostname → origin rule lives in the Cloudflare dashboard, not in a local file.
The script stops and waits until you have changed the origin from
`192.168.178.23:5173` to `127.0.0.1:5173` and confirmed `/health` returns 200.
It will not touch Vite until then, because binding Vite to loopback before the
NUC tunnel serves would take the public site offline.

## Things these scripts deliberately do NOT do

- **F does not move the app to a dedicated account.** It bounds where the service
  can write, which is the immediate win. Moving off `gayzer` needs a new user,
  chown of the DB and state dirs, its own SSH key, and a config re-point — do that
  as its own change.
- **E does not retire `hermes-life.sh`.** The manager still exists; after E, use
  `systemctl restart hermes-life-backend hermes-life-frontend` instead of the
  manager's start/restart, or two copies will fight over the ports.

## Findings that shaped these scripts

- The `cloudflared` "path mismatch" in the review (`/usr/local/bin` vs
  `/usr/bin`) is a **symlink**, not a problem — it was the review's #1 priority
  and needs no work.
- The NUC's bind mounts **are** already persistent (`/etc/fstab` +
  systemd-generated units), so the review's §11.4 concern was a doc gap.
- The **Lenovo's SSHFS mounts were not persistent** (no fstab, no units) — H
  fixes that as well as the missing options.
- **H was first written as a root-mounted `/etc/fstab` entry. That approach does
  not work here and was replaced with systemd *user* units.** Three traps, all hit:
  - `user_id=`/`group_id=` are **reported** by FUSE in `/proc/mounts` but are
    **not settable options** — passing them fails the mount outright
    (`fuse: unknown option(s)`). They were copied out of `mount` output as if
    they were inputs.
  - A root-owned FUSE mount needs `allow_other`, and **root cannot stat through a
    mount it does not own** — so `[[ -d $mountpoint ]]` reads *false*, and both
    `install -d` and `mkdir -p` then fail trying to create a path that exists.
  - `/proc/mounts` lists the **autofs placeholder** for an automount, so grepping
    it for the path reports "mounted" even when the real sshfs never mounted.
    Verification must read the mount's `fuse.sshfs` type or the sshfs process args.
- The **Lenovo runs `uutils coreutils`**, not GNU — its `install -d` and
  `mkdir -p` behave differently on an existing target.
- A script that replaces a working mount must **prove the new one mounts first**.
  H's first version unmounted the live mounts and only then discovered the
  replacement was broken, leaving the user with neither.
- **FUSE mounts are owner-only without `allow_other`**, so a script running as
  root cannot see the user's mounts at all — test every primitive as the identity
  the script will run under.
- The Vite host binding lives in **two** places (`vite.config.js` *and* the
  `dev` script in `package.json`), and the CLI flag wins — C edits both and fails
  if any `0.0.0.0` survives.
