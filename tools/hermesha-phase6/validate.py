#!/usr/bin/env python3
"""Phase 6 - conservative, reproducible source and runtime validation report.

Never treats static inspection as proof of browser appearance. All findings written
under the requested output directory; does not edit application sources.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def run(command: list[str], cwd: Path, timeout: int = 240) -> dict:
    try:
        result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=timeout, check=False)
        return {'ok': result.returncode == 0, 'code': result.returncode,
                'command': ' '.join(command), 'output': result.stdout[-25000:]}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'ok': False, 'code': -1, 'command': ' '.join(command), 'output': str(exc)}


def audit_source() -> dict[str, dict]:
    checks: dict[str, dict] = {}
    def check(key: str, ok: bool, details: str):
        checks[key] = {'ok': bool(ok), 'details': details}
    def source(rel: str) -> str:
        path = ROOT / rel
        return path.read_text(encoding='utf8') if path.is_file() else ''

    html = source('frontend/index.html')
    ui = source('frontend/src/command-centre-ui.ts')
    rooms = source('frontend/src/town-world/ship-rooms.ts')
    renderer = source('frontend/src/town-renderer-3d.ts')
    bubbles = source('frontend/src/town-world/bubbles.ts')
    model = source('frontend/src/town-model.ts')
    layout = source('frontend/src/town-world/layout.ts')
    api = source('frontend/src/main.v2.ts')
    tests = ROOT / 'frontend/tests/hermesha-phase6.test.ts'

    check('single_command_centre', html.count('Hermesha Command Centre') >= 1 and not re.search(r'ISONET|WeKeKe', html, re.I),
          'Brand appears and reference workspace names are not present in dashboard markup')
    expected = ['director_office','research_station','review_station','dev_station','control_room','lab','archive','break_room']
    check('physical_rooms', all(f"id: '{item}'" in rooms for item in expected) and len(re.findall(r"id: '(?:"+'|'.join(expected)+r")'", rooms)) >= 8,
          'All eight physical room identities are defined')
    check('seven_role_assignment', "owner: 'planner'" in rooms and "owner: 'coordinator'" in rooms and 'owner: null' in rooms,
          'Piper, Hermes, and unowned Break Room explicitly represented')
    check('physical_room_pick', 'roomPickables' in renderer and 'hermesha:room:select' in renderer and 'detailedPickables' in renderer,
          'Room hit targets exist with resident/station priority')
    check('bubble_head_anchor', 'residentPos.headX' in bubbles and 'residentPos.headY' in bubbles and 'getWorldPosition(headWorld)' in renderer,
          'Bubble anchor uses rendered resident head instead of a fixed screen offset')
    check('authoritative_state', "import { ROLES, ROSTER" in renderer and 'applyState(next: TownState)' in renderer and 'taskRunning' in model,
          'Existing TownState adapter remains the sole role-state input; behavioral testing still required')
    check('existing_work_and_chat', 'task-form' in html and 'chat-host' in html and 'hermes:open-task' in api,
          'Existing task/chat DOM contracts and deep-link event are retained')
    check('eight_room_nav', all(f'data-hc-room="{k}"' in html for k in ['director','research','review','control','dev','lab','archive','break']) and 'hermesha:room:select' in ui,
          'Eight navigation shortcuts and physical-room event listener exist')
    check('phase_6_tests_installed', tests.is_file(), 'Contract regression tests installed')
    check('phase_3_art', (ROOT / 'frontend/src/town-world/ship-art.ts').is_file() and 'buildShipRooms' in rooms,
          'Visual art/architecture source is installed')
    check('no_eighth_backend_agent', 'break_room' not in model,
          'No new backend presentation role introduced in town-model.ts')
    check('no_duplicate_world_switcher', not re.search(r'data-hc-(?:space|workspace|command-centre)', html),
          'No second command-centre selection widget in markup')
    check('frontend_modules', (ROOT / 'frontend/package.json').is_file(), 'Frontend package exists')
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(ROOT / 'phase6-reports'), help='Folder for reports')
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--skip-tests', action='store_true')
    args = parser.parse_args()
    output = Path(args.output).expanduser().resolve(); output.mkdir(parents=True, exist_ok=True)
    checks = audit_source()
    commands: dict[str, dict] = {}
    frontend = ROOT / 'frontend'
    if not args.skip_build:
        commands['build'] = run(['npm', 'run', 'build'], frontend, timeout=300)
    if not args.skip_tests:
        commands['existing_tests'] = run(['npm', 'test'], frontend, timeout=300)
        commands['hermesha_contract_tests'] = run(['node', '--import', 'tsx', '--test', 'tests/hermesha-phase6.test.ts'], frontend, timeout=120)
    summary = {'generated_at': datetime.now(timezone.utc).isoformat(), 'repo': str(ROOT),
               'source_checks': checks, 'commands': commands, 'visual_review': 'NOT VERIFIED: requires real browser capture and human comparison',
               'task_lifecycle_e2e': 'NOT VERIFIED: requires running backend and an actual task',
               'fps_integrated_gpu': 'NOT VERIFIED: requires representative client browser session'}
    (output / 'phase6-results.json').write_text(json.dumps(summary, indent=2) + '\n')
    lines = ['# Hermesha Command Centre — Phase 6 Validation', '', f"Generated UTC: {summary['generated_at']}", '',
             '## Automated source checks', '', '| Check | Result | Evidence |', '|---|---|---|']
    for key, v in checks.items():
        lines.append(f"| `{key}` | {'PASS' if v['ok'] else 'FAIL'} | {v['details']} |")
    lines.extend(['', '## Reproducible commands', ''])
    for key, v in commands.items():
        lines.extend([f"### {key}: {'PASS' if v['ok'] else 'FAIL'}", '', f"`{v['command']}` (exit {v['code']})", '', '```text', v['output'], '```', ''])
    lines.extend(['## Not certified by this package', '',
        '- Pixel/layout similarity to the user reference: capture the running browser and inspect the comparison.',
        '- Real task lifecycle/WebSocket reconnect: requires a running backend and controlled test task.',
        '- Actual framerate, GPU memory, and browser teardown: requires measurements in a real browser.',
        '- Accessibility interactions: require a keyboard/screen-reader browser review.', '',
        'A build/test pass does **not** imply visual or end-to-end acceptance.', ''])
    (output / 'phase6-report.md').write_text('\n'.join(lines))
    print('Report:', output / 'phase6-report.md')
    failed = [k for k,v in checks.items() if not v['ok']] + [k for k,v in commands.items() if not v['ok']]
    if failed:
        print('FAILED:', ', '.join(failed), file=sys.stderr)
        return 1
    print('Automated gates passed. Visual/runtime gates remain pending.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
