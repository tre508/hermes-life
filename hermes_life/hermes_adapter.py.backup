"""Hermes CLI bridge; accepts an injected runner for testing."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


class HermesError(RuntimeError):
    pass


class HermesAdapter:
    def __init__(self, executable='hermes', timeout_seconds=1800):
        self.executable = executable
        self.timeout_seconds = timeout_seconds

    def available(self):
        return shutil.which(self.executable) is not None

    def run(self, prompt, event_callback):
        if not self.available():
            raise HermesError(f'{self.executable} CLI not found on PATH')
        # Use a prompt file to avoid shell interpolation and argument leakage.
        with tempfile.TemporaryDirectory(prefix='hermes-life-') as tmp:
            path = Path(tmp) / 'prompt.txt'
            path.write_text(prompt, encoding='utf-8')
            command = [self.executable, 'chat', '--query-file', str(path), '--format', 'stream-json']
            env = dict(os.environ)
            proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, bufsize=1, env=env, start_new_session=True)
            final = None
            try:
                import time
                started = time.monotonic()
                for line in proc.stdout:
                    if time.monotonic() - started > self.timeout_seconds:
                        raise HermesError('Hermes timed out')
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        event_callback('hermes.unparsed', {'line':line[:1000]})
                        continue
                    kind = item.get('type', 'unknown')
                    if kind in ('system','tool_use','tool_result','result'):
                        event_callback('hermes.' + kind, item)
                    if kind == 'result':
                        final = item
                code = proc.wait(timeout=10)
                if code != 0 or not final or final.get('exit_code', code) != 0:
                    raise HermesError((final or {}).get('error') or f'Hermes exited with code {code}')
                return {'result':final.get('text', ''),'session_id':final.get('session_id')}
            except Exception:
                proc.kill()
                proc.wait()
                raise
