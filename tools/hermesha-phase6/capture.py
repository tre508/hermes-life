#!/usr/bin/env python3
"""Capture the running Hermesha UI via Chromium, including browsers that remain alive after screenshot."""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.request

def complete_png(path: Path) -> bool:
    """A nontruncated PNG ends with its IEND chunk."""
    try:
        if path.stat().st_size < 1000:
            return False
        with path.open("rb") as f:
            if f.read(8) != b"\x89PNG\r\n\x1a\n":
                return False
            f.seek(-12, 2)
            return f.read(12)[4:8] == b"IEND"
    except (OSError, ValueError):
        return False

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default="http://127.0.0.1:5173/")
    ap.add_argument("--output", type=Path, default=Path("phase6-reports/live-ui.png"))
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--browser", help="Chromium/Chrome executable, if not on PATH")
    args = ap.parse_args()
    try:
        with urllib.request.urlopen(args.url, timeout=5) as response:
            if response.status >= 400:
                raise RuntimeError(f"HTTP {response.status}")
    except Exception as exc:
        raise SystemExit(f"Frontend server is not reachable at {args.url}: {exc}")

    binary = args.browser or next(
        (shutil.which(b) for b in
         ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave-browser")
         if shutil.which(b)), None
    )
    if not binary:
        raise SystemExit("Chromium-compatible browser not found. Pass --browser /path/to/browser.")

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Never accept a previous screenshot as evidence of this run.
    if output.exists():
        output.unlink()

    # Snap Chromium is confined: ~/.cache is not a writable profile location
    # from inside its sandbox. Its documented persistent writable data lives
    # under ~/snap/chromium/common; the usual Chrome variants use ~/.cache.
    is_chromium_snap = ("/snap/" in str(Path(binary).resolve())
                        or str(binary).startswith("/snap/bin/chromium")
                        or Path(binary).name in ("chromium", "chromium-browser")
                        and Path("/snap/chromium/current").exists())
    profile_base = (Path.home() / "snap/chromium/common" if is_chromium_snap
                    else Path.home() / ".cache")
    profile_base.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="hermesha-capture-", dir=profile_base) as profile:
        command = [
            binary, "--headless=new", "--no-first-run", "--no-default-browser-check",
            "--disable-background-networking", "--disable-extensions",
            "--disable-dev-shm-usage", "--hide-scrollbars",
            f"--user-data-dir={profile}", "--virtual-time-budget=3000",
            f"--window-size={args.width},{args.height}",
            f"--screenshot={output}", args.url
        ]
        # Chromium can retain renderer/WebSocket children after writing the file.
        # A completed PNG is success; do not require the browser to terminate itself.
        proc = subprocess.Popen(
            command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            start_new_session=True
        )
        try:
            deadline = time.monotonic() + args.timeout
            stable = 0
            last_size = -1
            while time.monotonic() < deadline:
                if complete_png(output):
                    size = output.stat().st_size
                    stable = stable + 1 if size == last_size else 0
                    last_size = size
                    if stable >= 2:
                        print(f"Captured: {output} ({size:,} bytes)")
                        return
                if proc.poll() is not None:
                    if complete_png(output):
                        print(f"Captured: {output} ({output.stat().st_size:,} bytes)")
                        return
                    break
                time.sleep(0.25)

            err = ""
            if proc.poll() is not None and proc.stderr:
                err = proc.stderr.read()[-1800:].decode("utf-8", errors="replace")
            raise SystemExit(
                f"Capture failed: Chromium did not produce a complete PNG within "
                f"{args.timeout}s (exit={proc.poll()}).\n{err}\n"
                f"Try: {binary} --headless=new --screenshot=/tmp/chromium-test.png about:blank"
            )
        finally:
            if proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    proc.wait(timeout=3)
            if proc.stderr:
                proc.stderr.close()

if __name__ == "__main__":
    main()
