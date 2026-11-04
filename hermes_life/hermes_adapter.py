"""Hermes CLI adapter: local CLI or isolated SSH guest transport.

HL-AUTO-004: an approval scope is a capability, not a label, and where possible it
is enforced where the capability actually lives — never by prompt text.

* ``interactive`` — the user-driven default, unchanged.
* ``read_only`` — analysis only: the session is pinned to ``READ_ONLY_TOOLSETS``,
  which removes shell, code execution, delegation, skills, memory, browser and cron
  tools. An approved read-only investigation therefore cannot install packages, run
  arbitrary commands, or change system settings.

What this layer can and cannot do (measured against the live guest, 2026-11-04):

* The toolset pin reaches the tool executor, so dropping ``terminal`` and
  ``code_execution`` is a real restriction.
* Filesystem *immutability* is NOT enforceable here, and no guard is pretended.
  Hermes ships ``read_file``/``search_files`` in the same ``file`` toolset as
  ``write_file``/``patch`` and ships no toolset containing one without the other;
  worse, on this deployment tool calls are executed by a long-running
  ``hermes gateway run`` process, which a guest-side mount namespace cannot
  constrain (an unprivileged ``unshare -rm`` guard binds the caller's namespace,
  which is not where the write happens). A read-only scope can therefore still
  write files the agent user may write. The pin stays because it genuinely closes
  the package-installation and code-execution paths; it does not close file writes.
  See FIX.md FIX-001 for the measurements and the options that would close it.
"""
import json
import os
import selectors
import shlex
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path


class HermesError(RuntimeError):
    pass


GUEST_HERMES = '/home/hermes/.local/bin/hermes'

#: Toolset for a scope that must not acquire shell or code-execution capability.
#: Every shipped toolset containing ``read_file`` also ships ``write_file`` and
#: ``patch``, so "read but never write" cannot be expressed; this is the narrowest
#: set that still lets an investigation inspect source.
READ_ONLY_TOOLSETS = 'file,web,vision'

#: Scope -> explicit toolset pin (None = the deployment's own default).
PROFILES = {
    'interactive': None,
    'read_only': READ_ONLY_TOOLSETS,
}

#: Reads the prompt from stdin into a guest-side temp file; nothing is
#: shell-interpreted, so quotes, $(...) and backticks arrive verbatim.
_SCRIPT_HEAD = """set -eu
umask 077
prompt_file=$(mktemp /tmp/hermes-life-prompt.XXXXXXXX)
trap 'rm -f "$prompt_file"' EXIT
cat > "$prompt_file"
"""


def _agent_command(toolsets=None):
    command = f'{GUEST_HERMES} chat --query-file "$prompt_file" --format stream-json'
    if toolsets:
        command += ' -t ' + toolsets
    return command


def remote_script(profile='interactive'):
    """Build the guest shell script that runs exactly one Hermes turn."""
    if profile not in PROFILES:
        raise ValueError('Unknown capability profile: ' + str(profile))
    return _SCRIPT_HEAD + _agent_command(PROFILES[profile]) + '\n'


class HermesAdapter:
    def __init__(self, executable='hermes', timeout_seconds=1800, transport=None,
                 host=None, user=None, identity_file=None, port=None, profile='interactive'):
        if profile not in PROFILES:
            raise ValueError('Unknown capability profile: ' + str(profile))
        self.profile = profile
        self.executable = executable
        self.timeout_seconds = timeout_seconds
        self.transport = transport or os.getenv('HERMES_LIFE_TRANSPORT', 'local')
        self.host = host or os.getenv('HERMES_LIFE_VM_HOST', '192.168.124.136')
        self.user = user or os.getenv('HERMES_LIFE_VM_USER', 'hermes')
        self.identity_file = Path(identity_file or os.getenv('HERMES_LIFE_VM_KEY', '~/.ssh/hermes_life_vm')).expanduser()
        self.port = int(port or os.getenv('HERMES_LIFE_VM_PORT', '22'))
        if self.transport not in ('local', 'ssh'):
            raise ValueError('HERMES_LIFE_TRANSPORT must be local or ssh')

    def _ssh_base(self):
        return ['ssh', '-T', '-p', str(self.port), '-i', str(self.identity_file),
                '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15',
                '-o', 'ServerAliveCountMax=2', f'{self.user}@{self.host}']

    def available(self):
        if self.transport == 'local':
            return shutil.which(self.executable) is not None
        if shutil.which('ssh') is None or not self.identity_file.is_file():
            return False
        try:
            probe = subprocess.run(self._ssh_base() + ['test -x /home/hermes/.local/bin/hermes'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=12)
            return probe.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def run(self, prompt, event_callback):
        if not self.available():
            raise HermesError(f'Hermes unavailable via {self.transport} transport')
        if self.transport == 'ssh':
            # The prompt is sent over stdin, not a command-line argument or a host-side file.
            command = self._ssh_base() + ['sh -c ' + shlex.quote(remote_script(self.profile))]
        else:
            # A restricted scope is enforced by the guest's session toolset; the legacy
            # local transport cannot apply it, so it refuses rather than running with
            # more capability than the scope authorised.
            if PROFILES[self.profile]:
                raise HermesError(
                    f'Capability profile {self.profile!r} requires the isolated VM transport')
            import tempfile
            # Local path retained for backwards compatibility.
            with tempfile.TemporaryDirectory(prefix='hermes-life-') as tmp:
                file = Path(tmp) / 'prompt.txt'
                file.write_text(prompt, encoding='utf-8')
                command = [self.executable, 'chat', '--query-file', str(file), '--format', 'stream-json']
                return self._execute(command, None, event_callback)
        return self._execute(command, prompt, event_callback)

    def _execute(self, command, prompt_stdin, event_callback):
        proc = subprocess.Popen(command, stdin=subprocess.PIPE if prompt_stdin is not None else subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, bufsize=1, start_new_session=True)
        stderr_tail = deque(maxlen=16)
        def drain_stderr():
            for line in proc.stderr:
                stderr_tail.append(line.strip()[:350])
        reader = threading.Thread(target=drain_stderr, daemon=True)
        reader.start()
        try:
            if prompt_stdin is not None:
                proc.stdin.write(prompt_stdin)
                proc.stdin.close()
            selector = selectors.DefaultSelector()
            selector.register(proc.stdout, selectors.EVENT_READ)
            started = time.monotonic()
            final = None
            try:
                while True:
                    remaining = self.timeout_seconds - (time.monotonic() - started)
                    if remaining <= 0:
                        raise HermesError('Hermes execution timed out')
                    ready = selector.select(timeout=min(remaining, 0.5))
                    if not ready:
                        if proc.poll() is not None:
                            # Drain any remaining stdout on process exit.
                            pass
                        continue
                    line = proc.stdout.readline()
                    if not line:
                        break
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        event_callback('hermes.unparsed', {'line': line[:1000]})
                        continue
                    kind = item.get('type', 'unknown')
                    if kind in ('system', 'text', 'tool_use', 'tool_result', 'result'):
                        event_callback('hermes.' + kind, item)
                    if kind == 'result':
                        final = item
            finally:
                selector.close()
            code = proc.wait(timeout=max(0.1, min(10, self.timeout_seconds - (time.monotonic() - started))))
            if code != 0 or not final or final.get('exit_code', code) != 0:
                detail = (final or {}).get('error') or '; '.join(stderr_tail) or f'Hermes exited with code {code}'
                raise HermesError(str(detail)[-1600:])
            return {'result': final.get('text', ''), 'session_id': final.get('session_id')}
        except Exception:
            import signal
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise
        finally:
            reader.join(timeout=1)
