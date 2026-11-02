#!/usr/bin/env python3
"""Executed inside the Hermes Life VM via SSH stdin; emits JSONL, no host API access."""
import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

URL = 'https://raw.githubusercontent.com/CodeWithHarry/The-Ultimate-Python-Course/main/The%20Ultimate%20Python%20Handbook.pdf'
SOURCE = 'https://github.com/CodeWithHarry/The-Ultimate-Python-Course/blob/main/The%20Ultimate%20Python%20Handbook.pdf'
BASE = Path('/home/hermes/learning/python-handbook')
PDF = BASE / 'The Ultimate Python Handbook.pdf'


def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def load_reader():
    try:
        from pypdf import PdfReader
        return PdfReader
    except ImportError:
        pass
    venv = BASE / '.venv'
    python = venv / 'bin/python'
    if not python.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True, stdout=sys.stderr)
    subprocess.run([str(python), '-m', 'pip', '-q', 'install', 'pypdf>=5,<7'], check=True, stdout=sys.stderr)
    for site in (venv / "lib").glob("python*/site-packages"):
        sys.path.insert(0, str(site))
    from pypdf import PdfReader
    return PdfReader


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    if not PDF.exists() or PDF.stat().st_size < 1024:
        request = urllib.request.Request(URL, headers={'User-Agent':'Hermes-Life-Knowledge-Ingest/1.0'})
        with urllib.request.urlopen(request, timeout=90) as response, open(PDF.with_suffix('.download'), 'wb') as output:
            while True:
                data = response.read(1024 * 1024)
                if not data: break
                output.write(data)
        PDF.with_suffix('.download').replace(PDF)
    with PDF.open('rb') as f:
        if f.read(5) != b'%PDF-': raise RuntimeError('Downloaded file is not a PDF')
    Reader = load_reader()
    reader = Reader(str(PDF))
    with PDF.open('rb') as handle:
        sha = hashlib.file_digest(handle, 'sha256').hexdigest()
    emit(kind='metadata', title='The Ultimate Python Handbook', url=SOURCE,
         raw_url=URL, sha256=sha, revision='main', total_pages=len(reader.pages), bytes=PDF.stat().st_size)
    for i, page in enumerate(reader.pages, 1):
        content = page.extract_text(extraction_mode='plain') or ''
        if len(content) > 30000:
            raise RuntimeError(f'Page {i} has {len(content)} characters; exceeds library 30000-character limit')
        emit(kind='page', page=i, text=content)
    emit(kind='end', total_pages=len(reader.pages))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'VM extraction failed: {type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
