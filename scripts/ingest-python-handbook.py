#!/usr/bin/env python3
"""Run on the Kubuntu host. Extract PDF in VM, register/index via localhost API."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path


def request_json(base, method, route, payload=None):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    req = urllib.request.Request(base + route, data=data, method=method,
                                 headers={'Content-Type':'application/json'} if data is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'Library API {method} {route}: HTTP {exc.code}: {exc.read(600).decode(errors="replace")}') from exc


def main():
    parser=argparse.ArgumentParser(description='Ingest the Python Handbook from an isolated Hermes Life VM')
    parser.add_argument('--api', default='http://127.0.0.1:8766')
    parser.add_argument('--vm', default=os.environ.get('HERMES_LIFE_VM_HOST', '192.168.124.136'))
    parser.add_argument('--user', default=os.environ.get('HERMES_LIFE_VM_USER', 'hermes'))
    parser.add_argument('--key', default=os.environ.get('HERMES_LIFE_VM_KEY', '~/.ssh/hermes_life_vm'))
    args=parser.parse_args()
    base=args.api.rstrip('/')
    # Fail before remote work if library isn't installed or backend is down.
    status=request_json(base,'GET','/api/library/sources')
    if 'sources' not in status: raise RuntimeError('Unexpected Knowledge Library API response')
    remote_script=Path(__file__).with_name('_vm_extract_handbook.py').read_bytes()
    command=['ssh', '-o','BatchMode=yes', '-o','ConnectTimeout=10', '-i',str(Path(args.key).expanduser()),
             f'{args.user}@{args.vm}', 'python3', '-']
    with tempfile.TemporaryFile(mode='w+t') as stderr:
        process=subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=stderr, text=True, encoding='utf-8')
        assert process.stdin and process.stdout
        process.stdin.write(remote_script.decode())
        process.stdin.close()
        header=None
        source_id=None
        pages=[]
        received=0
        blank=[]
        seen=set()
        ended=False
        try:
            for line in process.stdout:
                row=json.loads(line)
                if row.get('kind')=='metadata':
                    if header is not None: raise RuntimeError('Duplicate PDF metadata')
                    header=row
                    registered=request_json(base,'POST','/api/library/sources',
                        {key: row[key] for key in ('url','title','revision','sha256')} | {'kind':'pdf'})
                    source_id=registered['source_id']
                    print(f'PDF: {row["total_pages"]} pages, SHA256={row["sha256"]}; source_id={source_id}',flush=True)
                elif row.get('kind')=='page':
                    if source_id is None: raise RuntimeError('Page received before metadata')
                    num=row['page']
                    if num in seen: raise RuntimeError(f'Duplicate page {num}')
                    seen.add(num)
                    if not row['text'].strip(): blank.append(num)
                    pages.append({'page':num,'text':row['text']})
                    received+=1
                    if len(pages)==50:
                        request_json(base,'POST',f'/api/library/sources/{source_id}/pages',{'pages':pages})
                        pages=[]
                        print(f'Indexed {received}/{header["total_pages"]} pages',flush=True)
                elif row.get('kind')=='end':
                    ended=True
                    if row['total_pages'] != received: raise RuntimeError('PDF extraction ended with missing pages')
                else: raise RuntimeError('Unexpected JSONL event from VM')
            status_code=process.wait()
            if status_code: raise RuntimeError(f'VM extraction failed (exit {status_code})')
            if not header or not ended or received != header['total_pages']:
                raise RuntimeError('Incomplete PDF extraction')
            if pages:
                request_json(base,'POST',f'/api/library/sources/{source_id}/pages',{'pages':pages})
            sources=request_json(base,'GET','/api/library/sources')['sources']
            entry=next(x for x in sources if x['id']==source_id)
            searchable_pages=header['total_pages']-len(blank)
            if entry['indexed_pages']!=searchable_pages:
                raise RuntimeError(f'Index incomplete: {entry["indexed_pages"]}/{searchable_pages} searchable pages')
            print(json.dumps({'source_id':source_id,'total_pages':received,'indexed_pages':entry['indexed_pages'],
                              'chunks':entry['chunks'],'blank_text_pages':blank,
                              'searchable_pages':searchable_pages,'sha256':header['sha256']},indent=2))
        except Exception:
            process.kill()
            process.wait()
            raise
        finally:
            stderr.seek(0)
            err=stderr.read()
            if err and (process.returncode or not ended): print(err[-4000:],file=sys.stderr)


if __name__ == '__main__':
    try: main()
    except (RuntimeError,OSError,ValueError,urllib.error.URLError) as exc:
        print(f'Ingestion failed: {exc}',file=sys.stderr)
        sys.exit(1)
