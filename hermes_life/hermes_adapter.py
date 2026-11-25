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
import re
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


def _agent_command(toolsets=None, provider=None, model=None, resume=None):
    command = f'{GUEST_HERMES} chat --query-file "$prompt_file" --format stream-json'
    # convo-redesign.md §10: continue the conversation's previous CLI session.
    # `--resume` is accepted by `hermes chat` (id, or 'latest'); the id is the
    # one the CLI reported on the previous turn and Hermes Life stored on the
    # task row. Quoted because a title may be used in place of an id.
    if resume:
        command += ' --resume ' + shlex.quote(str(resume))
    if toolsets:
        command += ' -t ' + toolsets
    if provider:
        command += ' --provider ' + shlex.quote(provider)
    if model:
        command += ' --model ' + shlex.quote(model)
    return command


#: Emitted on the worker before the CLI starts, and only when no --model was
#: passed. `hermes chat` reports the model in its own init line ONLY when it was
#: overridden, so every "Worker default" turn told the host `model: ''` and the
#: host could not record which model ran — which left the context window (and so
#: the usage meter) unknowable. `hermes config get` is the CLI's own resolver, so
#: this follows the worker's configuration rather than guessing a default, and it
#: is labelled `resolved_model` so it is never mistaken for the CLI's own init.
#: The value is admitted only if it is a bare model id, so the JSON needs no
#: escaping (anything else is dropped rather than mangled).
_RESOLVED_MODEL_SNIPPET = """
effective_model=$({hermes} config get model.default 2>/dev/null || true)
case "$effective_model" in
  *[!A-Za-z0-9._/:~+-]*|"") ;;
  *) printf '{{"type":"system","subtype":"resolved_model","model":"%s"}}\\n' "$effective_model" ;;
esac
"""


def remote_script(profile='interactive', provider=None, model=None, resume=None):
    """Build the guest shell script that runs exactly one Hermes turn."""
    if profile not in PROFILES:
        raise ValueError('Unknown capability profile: ' + str(profile))
    resolve = '' if model else _RESOLVED_MODEL_SNIPPET.format(hermes=shlex.quote(GUEST_HERMES))
    return (_SCRIPT_HEAD + resolve
            + _agent_command(PROFILES[profile], provider, model, resume) + '\n')


#: Read the CLI's OWN session record, read-only, and print it as one JSON line.
#: This is where the authoritative numbers live: `model` is populated even for a
#: turn whose init event was blank, `_usage_anchor.prompt_tokens` is the size of
#: the LAST request's prompt (i.e. the context actually occupied, which the
#: cumulative stream counter can never give), and the CLI has already priced the
#: session from the provider's model list (`cost_source: provider_models_api`).
#: `api_call_count` is what makes the cumulative figure intelligible: one real
#: task made 69 calls, so its "input" was the sum of 69 prompts, not a context.
#: The program is fed on STDIN, never interpolated into a command line, and the
#: session id is bound as a SQL parameter.
#:
#: NOTE the two token conventions, which differ: the CLI's `input_tokens` EXCLUDES
#: cache reads, while the stream's `tokens.input` INCLUDES them
#: (stream input == input_tokens + cache_read_tokens + cache_write_tokens, verified
#: exactly on a real session). Anything comparing the two must normalise.
WORKER_SESSION_SCRIPT = r'''
import json, os, sqlite3, sys
path = os.path.expanduser('~/.hermes/state.db')
want = sys.argv[1] if len(sys.argv) > 1 else ''
columns = ('id', 'model', 'billing_provider', 'input_tokens', 'output_tokens',
           'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens',
           'estimated_cost_usd', 'actual_cost_usd', 'cost_status', 'cost_source',
           'api_call_count', 'message_count', 'model_config')
sql = 'SELECT %s FROM sessions%s' % (','.join(columns), ' WHERE id=?' if want else '')
try:
    db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    rows = db.execute(sql, (want,)).fetchall() if want else db.execute(sql).fetchall()
except Exception as exc:
    print(json.dumps({'error': str(exc)[:200]}))
    raise SystemExit(0)
for row in rows:
    record = dict(row)
    anchor = None
    try:
        anchor = (json.loads(record.pop('model_config') or '{}') or {}).get('_usage_anchor') or {}
    except Exception:
        record.pop('model_config', None)
    record['context_anchor_tokens'] = anchor.get('prompt_tokens') if isinstance(anchor, dict) else None
    print(json.dumps(record))
'''

#: Durable trace read: the CLI's messages table already records every reasoning
#: block and every tool call in order. Reading it back makes the chat's
#: reasoning/tool trace survive a reload without a second place storing
#: history. Same transport discipline as WORKER_SESSION_SCRIPT: the program
#: travels on STDIN and the id is bound as a SQL parameter.
WORKER_TRACE_SCRIPT = r'''
import json, os, sqlite3, sys
path = os.path.expanduser('~/.hermes/state.db')
want = sys.argv[1] if len(sys.argv) > 1 else ''
if not want:
    raise SystemExit(0)
sql = ('SELECT id, role, content, tool_calls, tool_name, reasoning, timestamp, tool_call_id '
       'FROM messages WHERE session_id=? ORDER BY id')
try:
    db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    rows = db.execute(sql, (want,)).fetchall()
except Exception as exc:
    print(json.dumps({'error': str(exc)[:200]}))
    raise SystemExit(0)
for row in rows:
    record = dict(row)
    for field in ('content', 'reasoning'):
        value = record.get(field)
        if not isinstance(value, str):
            continue
        # Reasoning keeps (nearly) its full text — the chat displays the model's
        # extended thinking as prose, so a 4000-char cut destroys the very
        # content the feature exists to show. 100k is a runaway guard, not a
        # display cap. Tool results stay at 4000: they render as summaries.
        record[field] = value[:100000] if field == 'reasoning' else value[:4000]
    print(json.dumps(record))
'''

#: Session ids look like `local-<hex>`; anything else is refused before it can
#: reach a shell or a query.
_SESSION_ID = re.compile(r'^[A-Za-z0-9._:-]{1,200}$')

_RESULT_KEYS = ('output', 'content', 'stdout', 'result', 'text', 'error')
_MAX_STEPS = 200


def _result_text(content):
    """The tool row's content column → the result string the UI summarises.

    Tool rows store the payload the tool returned (usually a JSON object with
    an output/content field); anything unparsable passes through as text.
    """
    if not isinstance(content, str):
        return ''
    text = content.strip()
    if not text:
        return ''
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text[:4000]
    if isinstance(parsed, dict):
        for key in _RESULT_KEYS:
            value = parsed.get(key)
            if isinstance(value, str) and value.strip():
                return value[:4000]
        return json.dumps(parsed)[:4000]
    if isinstance(parsed, str):
        return parsed[:4000]
    return json.dumps(parsed)[:4000]


def _trace_steps(rows):
    """Map CLI transcript rows into the chat trace's ordered steps.

    Mirrors the CLI transcript's shape: a reasoning block, then the call it
    produced, then the next block. Mid-turn assistant text becomes a narration
    step. The final assistant text is the answer bubble, not trace content, so
    it (and everything after it) stays out.
    """
    final_index = None
    for index, row in enumerate(rows):
        if row.get('role') == 'assistant' and row.get('content'):
            final_index = index

    steps = []
    pending = []  # tool steps awaiting their result row, in call order

    def extend_thought(text):
        if not text:
            return
        last = steps[-1] if steps else None
        if last and last.get('kind') == 'thought':
            last['text'] = (last['text'] + text)[:200000]
        else:
            steps.append({'kind': 'thought', 'text': text[:200000]})

    def timestamp(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    for index, row in enumerate(rows[:_MAX_STEPS if final_index is None else final_index + 1]):
        role = row.get('role')
        if index == final_index:
            break  # the answer bubble owns this text; trace stops before it
        if role == 'assistant':
            reasoning = row.get('reasoning')
            if isinstance(reasoning, str) and reasoning.strip():
                extend_thought(reasoning.strip())
            narration = row.get('content')
            if isinstance(narration, str) and narration.strip():
                steps.append({'kind': 'text', 'text': narration.strip()[:4000]})
            calls = row.get('tool_calls')
            try:
                calls = json.loads(calls) if isinstance(calls, str) else calls
            except json.JSONDecodeError:
                calls = None
            if isinstance(calls, list):
                for call in calls:
                    if not isinstance(call, dict):
                        continue
                    fn = call.get('function')
                    if not isinstance(fn, dict):
                        fn = {}
                    name = fn.get('name') or call.get('name') or row.get('tool_name') or 'tool'
                    raw_args = fn.get('arguments') if fn else call.get('arguments')
                    try:
                        args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    except json.JSONDecodeError:
                        args = raw_args
                    step = {'kind': 'tool', 'label': str(name), 'args': args,
                            'startedAt': timestamp(row.get('timestamp')),
                            '_uid': call.get('id')}
                    steps.append(step)
                    pending.append(step)
            continue
        if role == 'tool':
            if not pending:
                continue
            uid = row.get('tool_call_id') or row.get('tool_call_uid')
            target = None
            if uid:
                for step in pending:
                    if step.get('_uid') == uid:
                        target = step
                        break
            if target is None:
                target = pending[0]
            if target in pending:
                pending.remove(target)
            done = timestamp(row.get('timestamp'))
            if target.get('startedAt') is not None and done is not None:
                target['ms'] = max(0.0, done - target['startedAt'])
            target['result'] = _result_text(row.get('content'))

    # Trailing narration is the answer's own lead-in, and the answer is already
    # the turn's bubble. A turn can end with a short post-answer exchange (the
    # CLI replying to a background notification), which makes "the last row" the
    # wrong anchor for the answer above — so drop trailing text steps outright
    # rather than trusting that anchor. Mid-turn narration (text followed by
    # more tool work) is kept; only the tail is trimmed.
    while steps and steps[-1].get('kind') == 'text':
        steps.pop()

    for step in steps:
        step.pop('_uid', None)
        if step.get('startedAt') is None:
            step.pop('startedAt', None)
    return steps


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

    def run(self, prompt, event_callback, task_id=None, provider=None, model=None, resume=None):
        if (provider or model) and self.profile != 'interactive':
            raise HermesError('Model overrides are restricted to interactive chat')
        if not self.available():
            raise HermesError(f'Hermes unavailable via {self.transport} transport')
        if self.transport == 'ssh':
            # The prompt is sent over stdin, not a command-line argument or a host-side file.
            command = self._ssh_base() + ['sh -c ' + shlex.quote(remote_script(self.profile, provider, model, resume))]
        else:
            # A restricted scope is enforced by the guest's session toolset; the legacy
            # local transport cannot apply it, so it refuses rather than running with
            # more capability than the scope authorised.
            if PROFILES[self.profile]:
                raise HermesError(
                    f'Capability profile {self.profile!r} requires the isolated work-machine transport')
            import tempfile
            # Local path retained for backwards compatibility.
            with tempfile.TemporaryDirectory(prefix='hermes-life-') as tmp:
                file = Path(tmp) / 'prompt.txt'
                file.write_text(prompt, encoding='utf-8')
                command = [self.executable, 'chat', '--query-file', str(file), '--format', 'stream-json']
                if resume: command.extend(['--resume', str(resume)])
                if provider: command.extend(['--provider', provider])
                if model: command.extend(['--model', model])
                return self._finish(self._execute(command, None, event_callback, task_id), event_callback)
        return self._finish(self._execute(command, prompt, event_callback, task_id), event_callback)

    def _finish(self, outcome, event_callback):
        """Report the CLI's OWN session record for the turn that just finished.

        The stream cannot supply the context figure (its counter is cumulative
        across every call in the turn) and the CLI prices the session itself, so
        the session store is the authoritative source for both.
        """
        session_id = (outcome or {}).get('session_id')
        if session_id:
            try:
                usage = self.session_usage(session_id)
            except Exception:  # noqa: BLE001
                # Asking the worker for its session record happens AFTER a
                # successful turn. Telemetry must never turn a finished task into a
                # failed one, so any failure here costs the numbers, not the run.
                usage = None
            if usage:
                event_callback('hermes.session_usage', usage)
        return outcome

    def _worker_session_rows(self, session_id=None):
        """Rows from the CLI's session store, read-only. [] on any failure.

        The program travels on STDIN and the id is bound as a SQL parameter, so
        nothing here is interpolated into a command line or a query.
        """
        if session_id and not _SESSION_ID.match(session_id):
            return []
        if self.transport == 'ssh':
            remote = 'python3 -' + (' ' + shlex.quote(session_id) if session_id else '')
            command = self._ssh_base() + ['sh -c ' + shlex.quote(remote)]
            stdin_text = WORKER_SESSION_SCRIPT
        else:
            command = ['python3', '-c', WORKER_SESSION_SCRIPT] + ([session_id] if session_id else [])
            stdin_text = None
        try:
            finished = subprocess.run(command, input=stdin_text, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True, timeout=90)
        except (OSError, subprocess.TimeoutExpired):
            return []
        rows = []
        for line in (finished.stdout or '').splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and not item.get('error'):
                rows.append(item)
        return rows

    def session_usage(self, session_id):
        """The CLI's record for one session, or None when it cannot be read."""
        rows = self._worker_session_rows(session_id)
        return rows[0] if rows else None

    def all_session_usage(self):
        """Every session the CLI knows, keyed by id — ONE round trip for backfill."""
        return {row['id']: row for row in self._worker_session_rows() if row.get('id')}

    def session_trace(self, session_id):
        """The CLI's interleaved transcript for one session, as UI trace steps.

        The CLI store already records every reasoning block and tool call in
        order; reading it back makes the chat's trace durable across reloads
        without a second store. [] on any failure — a read failure costs the
        feature's content, never the request.
        """
        if not session_id or not _SESSION_ID.match(session_id):
            return []
        if self.transport == 'ssh':
            remote = 'python3 - ' + shlex.quote(session_id)
            command = self._ssh_base() + ['sh -c ' + shlex.quote(remote)]
            stdin_text = WORKER_TRACE_SCRIPT
        else:
            command = ['python3', '-c', WORKER_TRACE_SCRIPT, session_id]
            stdin_text = None
        try:
            finished = subprocess.run(command, input=stdin_text, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True, timeout=90)
        except (OSError, subprocess.TimeoutExpired):
            return []
        rows = []
        for line in (finished.stdout or '').splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and not item.get('error'):
                rows.append(item)
        return _trace_steps(rows)

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
