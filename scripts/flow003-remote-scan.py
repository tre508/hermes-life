import io
import json
import os
from pathlib import Path
import re
import tokenize

# Read-only, bounded scan of VM-approved projects. Never imports or executes source.
root = Path('/home/hermes/projects')
found = []
SKIP = {'.git', '.venv', 'venv', 'node_modules', 'build', 'dist', '__pycache__',
        'tests', '__tests__', 'fixtures', '.pytest_cache', 'coverage'}
SOURCE = {'.py', '.ts', '.tsx', '.js', '.jsx', '.cpp', '.hpp', '.h', '.qml'}
PREFIX = re.compile(r'^(?://|/\*|\*)\s*(?:TODO|FIXME)\b', re.I)
PY_MARKER = re.compile(r'^#\s*(?:TODO|FIXME)\b', re.I)


def scan_file(file):
    if file.suffix == '.py':
        # Python tokenizer distinguishes actual comments from quoted strings,
        # triple-quoted examples and SQL containing TODO/FIXME.
        try:
            with tokenize.open(file) as handle:
                for token in tokenize.generate_tokens(handle.readline):
                    if token.type == tokenize.COMMENT and PY_MARKER.match(token.string.strip()):
                        yield token.start[0], token.string.strip()[:180]
        except (OSError, UnicodeError, SyntaxError, tokenize.TokenError):
            return
    else:
        # Only standalone comments; inline strings/examples are not candidates.
        try:
            with file.open(encoding='utf-8', errors='replace') as handle:
                for number, line in enumerate(handle, 1):
                    trimmed = line.strip()
                    if PREFIX.match(trimmed):
                        yield number, trimmed[:180]
        except (OSError, UnicodeError):
            return

if root.is_dir():
    for project in sorted(root.iterdir()):
        if project.is_symlink() or not project.is_dir():
            continue
        inspected = 0
        for base, dirs, files in os.walk(project, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in SKIP and not Path(base, d).is_symlink())
            if len(Path(base).relative_to(project).parts) >= 4:
                dirs[:] = []
            for name in sorted(files):
                if inspected >= 500 or len(found) >= 80:
                    break
                file = Path(base, name)
                if (file.is_symlink() or file.suffix not in SOURCE
                        or name.startswith(('test_', 'spec_'))
                        or name.endswith(('.test.ts', '.spec.ts', '.test.js', '.spec.js'))):
                    continue
                inspected += 1
                try:
                    if file.stat().st_size > 100000:
                        continue
                    for line, note in scan_file(file):
                        found.append({'project': project.name, 'file': str(file.relative_to(project)),
                                      'line': line, 'note': note})
                        if len(found) >= 80:
                            break
                except OSError:
                    continue
            if inspected >= 500 or len(found) >= 80:
                break
        if len(found) >= 80:
            break
print(json.dumps(found))
