"""HL-STUDY-001..004: Directed study subsystem.

A study source is a registered document (PDF, etc.) with known page coverage.
Units are sequential chunks of the source, each tied to a goal for tracking.
The scheduler (Autonomy.tick) advances units idempotently under the single-scheduler rule.
"""
from __future__ import annotations
import json
import os
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from .guest_env import GUEST_HOME
from .store import Store, now


@dataclass
class StudySource:
    id: int
    uri: str
    title: Optional[str]
    sha256: Optional[str]
    pages_total: int
    pages_indexed: int
    kind: str
    registered_at: str


@dataclass
class StudyUnit:
    id: int
    source_id: int
    ordinal: int
    title: str
    kind: str
    start_page: int
    end_page: int
    state: str  # not_queued, queued, running, completed, failed, blocked
    goal_id: Optional[str]
    report_path: Optional[str]
    checks_path: Optional[str]
    error: Optional[str]
    created_at: str
    updated_at: str


class StudyService:
    def __init__(self, store: Store, runtime=None):
        self.store = store
        self.runtime = runtime
        self._lock = threading.Lock()

    # --- Sources ---

    def register_source(self, uri: str, title: str, sha256: str, pages_total: int,
                        pages_indexed: int, kind: str = 'pdf') -> StudySource:
        """Register a new study source."""
        stamp = now()
        with self.store.lock:
            cur = self.store.connection.execute(
                """INSERT INTO study_sources (uri, title, sha256, pages_total, pages_indexed, kind, registered_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (uri, title, sha256, pages_total, pages_indexed, kind, stamp)
            )
            source_id = cur.lastrowid
            self.store.connection.commit()
        return self.get_source(source_id)

    def get_source(self, source_id: int) -> Optional[StudySource]:
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT * FROM study_sources WHERE id=?", (source_id,)
            ).fetchone()
        return StudySource(**dict(row)) if row else None

    def list_sources(self) -> List[StudySource]:
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT * FROM study_sources ORDER BY id"
            ).fetchall()
        return [StudySource(**dict(r)) for r in rows]

    # --- Units ---

    def create_units(self, source_id: int, units_data: List[dict]) -> List[StudyUnit]:
        """Create study units for a source from structured data.

        units_data: list of dicts with keys: title, kind, start_page, end_page, ordinal
        """
        stamp = now()
        created = []
        with self.store.lock:
            for u in units_data:
                cur = self.store.connection.execute(
                    """INSERT INTO study_units
                       (source_id, ordinal, title, kind, start_page, end_page, state, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, 'not_queued', ?, ?)""",
                    (source_id, u['ordinal'], u['title'], u['kind'],
                     u['start_page'], u['end_page'], stamp, stamp)
                )
                unit_id = cur.lastrowid
                if unit_id:
                    unit = self.get_unit(unit_id)
                    if unit:
                        created.append(unit)
            self.store.connection.commit()
        return created

    def get_unit(self, unit_id: int) -> Optional[StudyUnit]:
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT * FROM study_units WHERE id=?", (unit_id,)
            ).fetchone()
        return StudyUnit(**dict(row)) if row else None

    def get_unit_by_ordinal(self, source_id: int, ordinal: int) -> Optional[StudyUnit]:
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT * FROM study_units WHERE source_id=? AND ordinal=?", (source_id, ordinal)
            ).fetchone()
        return StudyUnit(**dict(row)) if row else None

    def list_units(self, source_id: int) -> List[StudyUnit]:
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT * FROM study_units WHERE source_id=? ORDER BY ordinal", (source_id,)
            ).fetchall()
        return [StudyUnit(**dict(r)) for r in rows]

    def get_next_queuable_unit(self, source_id: int) -> Optional[StudyUnit]:
        """Get the next unit that should be queued (HL-STUDY-002: no double enqueue after restart).

        Returns the first unit in ordinal order that is 'not_queued' and has no goal_id,
        or 'queued'/'running' but the linked goal is terminal (completed/failed).
        """
        with self.store.lock:
            rows = self.store.connection.execute(
                "SELECT * FROM study_units WHERE source_id=? ORDER BY ordinal", (source_id,)
            ).fetchall()

        for row in rows:
            unit = StudyUnit(**dict(row))
            if unit.state == 'not_queued' and not unit.goal_id:
                return unit
            if unit.state in ('queued', 'running') and unit.goal_id:
                goal = self.store.connection.execute(
                    "SELECT state FROM goals WHERE id=?", (unit.goal_id,)
                ).fetchone()
                if goal:
                    goal_state = goal['state']
                    if goal_state in ('completed', 'failed', 'cancelled'):
                        if goal_state == 'completed':
                            return unit
                        elif goal_state in ('failed', 'cancelled'):
                            self._mark_unit_failed(unit.id, f'Goal {unit.goal_id} {goal_state}')
                            continue
                return None
            if unit.state == 'completed':
                continue
            if unit.state in ('failed', 'blocked'):
                return None
        return None

    def enqueue_unit(self, unit_id: int, goal_id: str) -> Optional[StudyUnit]:
        """Mark a unit as queued with its goal_id."""
        stamp = now()
        with self.store.lock:
            self.store.connection.execute(
                "UPDATE study_units SET state='queued', goal_id=?, updated_at=? WHERE id=?",
                (goal_id, stamp, unit_id)
            )
            self.store.connection.commit()
        return self.get_unit(unit_id)

    def mark_unit_running(self, unit_id: int) -> Optional[StudyUnit]:
        """Mark a unit as running (when goal transitions to running)."""
        stamp = now()
        with self.store.lock:
            self.store.connection.execute(
                "UPDATE study_units SET state='running', updated_at=? WHERE id=?",
                (stamp, unit_id)
            )
            self.store.connection.commit()
        return self.get_unit(unit_id)

    def mark_unit_completed(self, unit_id: int, report_path: str, checks_path: str) -> Optional[StudyUnit]:
        """Mark a unit as completed with evidence paths."""
        stamp = now()
        with self.store.lock:
            self.store.connection.execute(
                """UPDATE study_units
                   SET state='completed', report_path=?, checks_path=?, updated_at=?
                   WHERE id=?""",
                (report_path, checks_path, stamp, unit_id)
            )
            self.store.connection.commit()
        return self.get_unit(unit_id)

    def _mark_unit_failed(self, unit_id: int, error: str) -> Optional[StudyUnit]:
        """Mark a unit as failed with error."""
        stamp = now()
        with self.store.lock:
            self.store.connection.execute(
                "UPDATE study_units SET state='failed', error=?, updated_at=? WHERE id=?",
                (error, stamp, unit_id)
            )
            self.store.connection.commit()
        return self.get_unit(unit_id)

    # --- Scheduler hook ---

    def tick(self, autonomy) -> Optional[dict]:
        """HL-STUDY-004: Scheduler hook called from Autonomy.tick.

        For each source, find the next queuable unit and enqueue it as a goal.
        Returns dict with action taken or None.
        """
        with self.store.lock:
            sources = self.store.connection.execute("SELECT id FROM study_sources").fetchall()

        for src_row in sources:
            source_id = src_row['id']
            next_unit = self.get_next_queuable_unit(source_id)
            if not next_unit:
                continue

            # Check if there's already a running/queued goal for this source
            # (avoid double-enqueue if the previous goal is still active)
            if next_unit.state in ('queued', 'running') and next_unit.goal_id:
                goal = self.store.connection.execute(
                    "SELECT state FROM goals WHERE id=?", (next_unit.goal_id,)
                ).fetchone()
                if goal and goal['state'] not in ('completed', 'failed', 'cancelled'):
                    continue  # still active, don't enqueue another

            # Enqueue a new goal for this unit
            source = self.get_source(source_id)
            if not source:
                continue

            prompt = self._build_unit_prompt(next_unit, source)
            title = f"Study {source.title or 'source'} {next_unit.ordinal}: {next_unit.title}"[:160]

            # Use autonomy.add to create the goal (respects priority, single-scheduler)
            try:
                goal = autonomy.add(title, prompt, 50)
                if goal and goal.get('id'):
                    self.enqueue_unit(next_unit.id, goal['id'])
                    self.store.emit('study.unit_queued', {
                        'source_id': source_id,
                        'unit_id': next_unit.id,
                        'unit_ordinal': next_unit.ordinal,
                        'goal_id': goal['id']
                    })
                    return {
                        'action': 'study_unit_queued',
                        'source_id': source_id,
                        'unit_id': next_unit.id,
                        'unit_ordinal': next_unit.ordinal,
                        'goal_id': goal['id']
                    }
            except Exception as exc:
                self.store.emit('study.enqueue_failed', {
                    'source_id': source_id,
                    'unit_id': next_unit.id,
                    'error': str(exc)[:300]
                })
                # Don't raise - let other sources continue

        return None

    def _build_unit_prompt(self, unit: StudyUnit, source: StudySource) -> str:
        """Build the study prompt for a unit (similar to scripts/study-python-handbook.py)."""
        guest_home = GUEST_HOME
        return f'''STUDY WORKFLOW — {source.title or 'Registered Study Source'}
This is unit {unit.ordinal} of the study: {unit.title} (PDF pages {unit.start_page}–{unit.end_page}).
Run ONLY inside the isolated Hermes Life coding worker ({guest_home}).

1. Read ALL PDF pages {unit.start_page}–{unit.end_page} using Python/pypdf. Identify actual section/chapter headings and the relevant concepts; note extraction gaps.
2. Write a study report at {guest_home}/learning/python-handbook/study/unit-{unit.ordinal:02d}.md: sections and PDF page citations; concepts paraphrased in your own words; examples; limits and version-sensitive assertions; questions requiring verification.
3. Create a separate executable verification script at {guest_home}/learning/python-handbook/study/unit-{unit.ordinal:02d}-checks.py. Choose representative safe examples from THIS unit, with explicit expected outcomes. Run the script on the worker and capture the actual stdout/stderr and exit status in a test log beside the report. Do not claim code has passed unless it ran.
4. For each finding, distinguish DOCUMENT-SOURCED information from EXECUTION-VERIFIED evidence. Cite the PDF page(s). Where relevant, compare with Python's current actual behavior, and clearly label differences instead of falsifying test results.
5. Emit 0–5 concrete reusable technical lessons through the existing [HERMES_LEARNING_JSON] report ONLY if they are supported by exact tool_result excerpts FROM THIS run. Avoid generic lessons, do not copy entire pages, do not write directly to the host DB, and do not mark the entire book verified.
6. In your final answer report pages processed, actual sections read, tests executed/passed/failed, evidence locations, and any extraction gaps. Preserve all earlier study files and lessons.

Do not install packages globally, change the transport, modify the host, or alter the fixed persona.'''


def create_study_service(store: Store, runtime=None) -> StudyService:
    return StudyService(store, runtime)