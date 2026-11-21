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
import signal
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

from .guest_env import GUEST_HOME, HERMES_BIN


class HermesError(RuntimeError):
    pass


#: Kept as a module constant (tests and guest-script assertions import it); the value comes from
#: guest_env so the worker's home is configured in one place.
GUEST_HERMES = HERMES_BIN

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
        # HL-WORKER: the worker address is configuration, never a default. The literal that used to
        # live here pointed at the retired VM, so a missing env file meant silently driving the wrong
        # machine; ssh now refuses to start with an incomplete worker configuration.
        self._configured_host = host or os.getenv('HERMES_LIFE_VM_HOST') or ''
        self._configured_user = user or os.getenv('HERMES_LIFE_VM_USER') or ''
        configured_key = identity_file or os.getenv('HERMES_LIFE_VM_KEY') or ''
        self.host = self._configured_host
        self.user = self._configured_user
        self.identity_file = Path(configured_key).expanduser() if configured_key else None
        self.port = int(port or os.getenv('HERMES_LIFE_VM_PORT', '22'))
        if self.transport not in ('local', 'ssh'):
            raise ValueError('HERMES_LIFE_TRANSPORT must be local or ssh')
        if self.transport == 'ssh':
            missing = [name for name, value in (
                ('HERMES_LIFE_VM_HOST', self._configured_host),
                ('HERMES_LIFE_VM_USER', self._configured_user),
                ('HERMES_LIFE_VM_KEY', str(self.identity_file) if self.identity_file else ''),
            ) if not value]
            if missing:
                raise ValueError(
                    'ssh transport is configured without a worker address; set '
                    + ', '.join(missing)
                    + ' (source config/hermes-life-lenovo.env) or use HERMES_LIFE_TRANSPORT=local')
        # Registry of running processes: task_id -> (pgid, proc)
        self._running = {}
        self._running_lock = threading.Lock()

    def _ssh_base(self):
        return ['ssh', '-T', '-p', str(self.port), '-i', str(self.identity_file),
                '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15',
                '-o', 'ServerAliveCountMax=2', f'{self.user}@{self.host}']

    @property
    def worker(self):
        """Which coding worker this adapter drives — reported by /health and the startup log."""
        if self.transport == 'ssh':
            return {'transport': 'ssh', 'target': f'{self.user}@{self.host}:{self.port}',
                    'guest_home': GUEST_HOME, 'agent': HERMES_BIN}
        return {'transport': 'local', 'target': 'local', 'guest_home': GUEST_HOME, 'agent': self.executable}

    def available(self):
        if self.transport == 'local':
            return shutil.which(self.executable) is not None
        if shutil.which('ssh') is None or self.identity_file is None or not self.identity_file.is_file():
            return False
        try:
            probe = subprocess.run(self._ssh_base() + [f'test -x {shlex.quote(HERMES_BIN)}'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=12)
            return probe.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False

    def run(self, prompt, event_callback, task_id=None):
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
                return self._execute(command, None, event_callback, task_id)
        return self._execute(command, prompt, event_callback, task_id)

    def _execute(self, command, prompt_stdin, event_callback, task_id=None):
        proc = subprocess.Popen(command, stdin=subprocess.PIPE if prompt_stdin is not None else subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, bufsize=1, start_new_session=True)
        pgid = proc.pid
        # Register running process for cancellation
        if task_id:
            with self._running_lock:
                self._running[task_id] = (pgid, proc)
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
            # Deregister running process
            if task_id:
                with self._running_lock:
                    self._running.pop(task_id, None)
            reader.join(timeout=1)

    def cancel(self, task_id):
        """Cancel a running task by sending SIGTERM then SIGKILL to its process group."""
        with self._running_lock:
            entry = self._running.pop(task_id, None)
        if entry is None:
            return False
        pgid, proc = entry
        try:
            # Try graceful termination first
            os.killpg(pgid, signal.SIGTERM)
            proc.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            # Escalate to SIGKILL
            try:
                if proc.poll() is None:
                    os.killpg(pgid, signal.SIGKILL)
                proc.wait(timeout=2)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                pass
        return True
