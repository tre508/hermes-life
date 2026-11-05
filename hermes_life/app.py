import sqlite3
import asyncio
import os
import threading
from pathlib import Path
from contextlib import asynccontextmanager
from .schema import migrate, recover_interrupted
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from typing import List
from .store import Store, now
from .hermes_adapter import HermesAdapter, PROFILES
from .world import sync_world
from .autonomy import Autonomy
from .discovery import Discovery
from .decision import DecisionEngine
from .curiosity_workflow import register_routes as register_curiosity_workflow_routes  # HL_FLOW_003
from .formulation import GoalFormulator
from .investigation import InvestigationPlanner
from .implementation import ImplementationEngine
from .implementation_review import ImplementationReview
from .implementation_revision import ImplementationRevision
from .personality import Personality, PersonalityAdapter
from .conversation_memory import ConversationMemory
from .conversation_recall import Recall
from .vault_memory import VaultMemory  # PHASE49_VAULT_MEMORY
from .knowledge_library import KnowledgeLibrary, KnowledgeAdapter
from .project_workspaces import ProjectWorkspaces, add_project_routes, SELECTOR  # PHASE411_PROJECT_WORKSPACES
from .project_knowledge import ProjectKnowledge, add_knowledge_routes  # PHASE414_PROJECT_KNOWLEDGE
from .project_approvals import add_approval_routes  # PHASE412_APPROVALS
from .maintenance import MaintenanceService
from .study import StudyService, create_study_service

class GoalInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    prompt: str = Field(min_length=1, max_length=20000)
    priority: int = Field(default=50, ge=0, le=100)

class AutonomyInput(BaseModel):
    enabled: bool

class TaskInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=20000)
    conversation_id: str | None = None
    revision_of: int | None = None
    revision_text: str | None = None

class Runtime:
    def __init__(self, database, adapter=None):
        self.store = Store(database)
        self.personality = Personality(self.store)
        self.conversations = ConversationMemory(self.store)
        self.recall = Recall(self.store)
        self.vault_memory = VaultMemory(self.store, self.recall)
        self.knowledge_library = KnowledgeLibrary(self.store)
        timeout = int(os.getenv('HERMES_LIFE_TIMEOUT', '1800'))

        def chain(profile):
            # HL-AUTO-004: a scope is a capability, not a label. A call site holds the
            # chain matching the approval it acts on, so an approved read-only
            # investigation cannot reach the interactive toolset.
            delegate = adapter if adapter is not None else HermesAdapter(
                timeout_seconds=timeout, profile=profile)
            return KnowledgeAdapter(PersonalityAdapter(delegate, self.personality), self.knowledge_library)

        self.adapters = {profile: chain(profile) for profile in PROFILES}
        self.adapter = self.adapters['interactive']
        self.vault_memory.adapter = self.adapter  # PHASE4101_SEMANTIC_MEMORY
        self.project_workspaces = ProjectWorkspaces(self)
        self.project_knowledge = ProjectKnowledge(self)
        self.maintenance = MaintenanceService(self)
        self.study = create_study_service(self.store, self)
        self.active = threading.Lock()

    def task_scope(self, ident):
        """HL-AUTO-004: the approval that created a task decides its capability.

        Both approval paths (curiosity/discovery evidence and formulation) link the
        goal to an approved formulation, so a read-only investigation is identified
        from durable lineage rather than from prompt text. Manual chat and manual
        goals carry no such lineage and keep the interactive scope.
        """
        with self.store.lock:
            row = self.store.connection.execute(
                "SELECT 1 FROM goals g JOIN formulated_goals f ON f.goal_id=g.id "
                "WHERE g.task_id=? AND f.state='approved' LIMIT 1", (ident,)).fetchone()
        return 'read_only' if row else 'interactive'

    def run_task(self, ident):
        try:
            scope = self.task_scope(ident)
            adapter = self.adapters[scope]
            self.store.update_task(ident, 'running')
            self.store.set_agent('executing',ident)
            self.store.emit('task.started', {'scope': scope}, ident)
            def on_event(name, payload):
                self.store.emit(name, payload, ident)
            conversation_id = self.conversations.conversation_for_task(ident)
            context = self.conversations.context(conversation_id, ident) if conversation_id else ''
            # Select a registered project from chat or goal prompts using @project slug.
            selected = SELECTOR.search(self.store.task(ident)['prompt'])
            if selected:
                # A read-only scope must not be told it may modify the workspace.
                workspace = self.project_workspaces.context(
                    selected.group(1), read_only=(scope == 'read_only'))
                context = workspace + self.project_knowledge.context(selected.group(1), self.store.task(ident)['prompt']) + context

            recall = self.recall.retrieve(self.store.task(ident)['prompt'], conversation_id) if conversation_id else ''
            recall += self.vault_memory.retrieve_notes(self.store.task(ident)['prompt'])
            result = adapter.run(recall + context + self.store.task(ident)['prompt'], on_event, ident)
            self.store.update_task(ident, 'completed', **result)
            if conversation_id:
                self.conversations.finish(conversation_id, ident, result)
                try:
                    self.vault_memory.extract_completed(conversation_id, ident)
                except Exception as exc:
                    self.store.emit("memory.extraction_failed", {"error":str(exc)[:400]}, ident)
            self.store.emit('task.completed', {'session_id':result.get('session_id')},ident)
        except Exception as exc:
            self.store.update_task(ident, 'failed', error=str(exc))
            conversation_id = self.conversations.conversation_for_task(ident)
            if conversation_id: self.conversations.finish(conversation_id, ident, {'error':str(exc)})
            self.store.emit('task.failed', {'error':str(exc)},ident)
        finally:
            self.store.set_agent('idle')
            self.active.release()


def _recover_lifecycle_handoffs(autonomy, planner):
    """Restart recovery: replan approved investigations whose plan was never recorded.

    Runs once per backend start, only while autonomy is enabled, and is fully
    idempotent (plan() skips formulations that already have a plan).
    """
    try:
        if not autonomy.settings().get('enabled'):
            return
        planner.recover_pending()
    except Exception:
        pass  # recovery is best-effort and must never block or crash startup


def create_app(database=None, adapter=None):
    path = database or os.getenv('HERMES_LIFE_DB', str(Path.home() / '.local/share/hermes-life/life.db'))
    runtime = Runtime(path,adapter)
    autonomy = Autonomy(runtime)
    discovery = Discovery(runtime, autonomy)
    decision = DecisionEngine(runtime, autonomy, discovery)
    formulation = GoalFormulator(runtime, autonomy, discovery)
    planner = InvestigationPlanner(runtime, autonomy, formulation)
    implementer = ImplementationEngine(runtime, planner)
    reviewer = ImplementationReview(runtime, implementer)
    revisions = ImplementationRevision(runtime, implementer, reviewer)
    autonomy.planner = planner  # lifecycle handoff at goal completion needs the planner
    autonomy.study = runtime.study  # HL-STUDY-004: scheduler hook for study units
    @asynccontextmanager
    async def lifespan(app):
        with runtime.store.lock:
            migrate(runtime.store.connection)
            runtime.knowledge_library.migrate()
            recover_interrupted(runtime.store.connection)
        autonomy.start()
        revisions.start()
        decision.start()
        # Recover interrupted implementation runs (mark as interrupted, emit events)
        implementer.recover_interrupted()
        # Best-effort restart recovery for a handoff lost between goal completion and
        # plan creation. Gated on autonomy being enabled so planned/disabled installs
        # and the manual API flows are unaffected; plan() itself is idempotent.
        threading.Thread(target=_recover_lifecycle_handoffs, args=(autonomy, planner), daemon=True).start()
        try:
            yield
        finally:
            decision.stop()
            revisions.stop()
            autonomy.stop()

    app = FastAPI(title='Hermes Life', version='0.3.8', lifespan=lifespan)
    app.state.runtime = runtime
    add_project_routes(app, runtime, runtime.project_workspaces)
    add_knowledge_routes(app, runtime.project_knowledge)
    add_approval_routes(app, runtime.project_workspaces)
    app.state.autonomy = autonomy
    app.state.discovery = discovery
    app.state.decision = decision
    app.state.formulation = formulation
    app.state.investigation_planner = planner
    app.state.implementer = implementer

    @app.get('/api/personality')
    def get_personality():
        return runtime.personality.get()

    @app.get('/api/reflections')
    def reflections():
        return {'stats':runtime.personality.reflection.stats(),
                'recent':[dict(r) for r in runtime.personality.experiences(10)]}

    @app.get('/api/library/sources')
    def library_sources():
        return {'sources': runtime.knowledge_library.sources()}

    @app.post('/api/library/sources')
    def library_register(payload: dict):
        try:
            return runtime.knowledge_library.register(payload.get('url'), payload.get('title'),
                payload.get('kind','pdf'), payload.get('revision',''), payload.get('sha256',''))
        except (ValueError,TypeError) as exc:
            raise HTTPException(422, str(exc))

    @app.post('/api/library/sources/{source_id}/pages')
    def library_pages(source_id: int, payload: dict):
        try:
            return runtime.knowledge_library.add_pages(source_id, payload.get('pages'))
        except (ValueError,TypeError) as exc:
            raise HTTPException(422, str(exc))

    @app.get('/api/library/search')
    def library_search(q: str, limit: int=5):
        return {'matches':runtime.knowledge_library.search(q,limit)}

    @app.get('/api/technical-lessons')
    def technical_lessons(limit: int = 30):
        records = runtime.personality.technical_memory.list(limit)
        return {'total_returned': len(records), 'lessons': records}

    @app.get('/api/technical-lessons/{lesson_id}/challenges')
    def technical_lesson_challenges(lesson_id: int):
        return runtime.personality.technical_memory.challenge_history(lesson_id)

    @app.post('/api/technical-lessons/{lesson_id}/resolve')
    def resolve_technical_lesson(lesson_id: int, payload: dict):
        try:
            return runtime.personality.technical_memory.resolve(
                lesson_id, payload.get('verdict'), payload.get('rationale'),
                payload.get('verification_run_id'), payload.get('verification_excerpt'))
        except (ValueError, TypeError, sqlite3.IntegrityError) as exc:
            raise HTTPException(409, str(exc))

    @app.get('/api/personality/experiences')
    def personality_experiences():
        return [{'state':state,'note':note,'created_at':created_at}
                for state,note,created_at in runtime.personality.experiences(10)]

    @app.get("/api/autonomy")
    def autonomy_state():
        return autonomy.settings()

    @app.put("/api/autonomy")
    def autonomy_control(payload: AutonomyInput):
        return autonomy.enable(payload.enabled)

    @app.get('/api/discoveries')
    def list_discoveries():
        return discovery.list()

    @app.post('/api/discoveries/scan')
    def scan_discoveries():
        try: return discovery.scan()
        except (ValueError,RuntimeError) as exc: raise HTTPException(409,str(exc))

    @app.post('/api/discoveries/{ident}/{action}')
    def decide_discovery(ident: str, action: str):
        try: item = discovery.transition(ident,action)
        except ValueError as exc: raise HTTPException(409,str(exc))
        if item is None: raise HTTPException(404,'Discovery not found')
        return item

    class DecisionInput(BaseModel):
        enabled: bool
        scan_interval_seconds: int = Field(default=3600, ge=60, le=86400)

    @app.get('/api/decisions')
    def decision_status():
        return decision.settings()

    @app.put('/api/decisions')
    def decision_control(payload: DecisionInput):
        return decision.configure(payload.enabled,payload.scan_interval_seconds)

    @app.post('/api/decisions/scan')
    def decision_scan():
        try: return decision.tick(force=True)
        except (ValueError,RuntimeError) as exc: raise HTTPException(409,str(exc))

    @app.get('/api/curiosity')
    def curiosity_queue():
        return decision.curiosity()

    register_curiosity_workflow_routes(app, runtime, discovery)  # HL_FLOW_003

    @app.post('/api/curiosity/{ident}/{state}')
    def curiosity_change(ident: str,state: str):
        try: result=decision.set_curiosity_state(ident,state)
        except ValueError as exc: raise HTTPException(400,str(exc))
        if result is None: raise HTTPException(404,'Question not found')
        return result

    @app.get('/api/formulations')
    def list_formulations():
        return formulation.list()

    @app.post('/api/formulations/from-discovery/{discovery_id}', status_code=201)
    def generate_formulation(discovery_id: str):
        try: return formulation.formulate(discovery_id)
        except KeyError as exc: raise HTTPException(404,str(exc))
        except (ValueError,RuntimeError) as exc: raise HTTPException(409,str(exc))
        except Exception as exc: raise HTTPException(422,'Invalid Hermes proposal: '+str(exc)[:240])

    @app.post('/api/formulations/{ident}/{action}')
    def decide_formulation(ident: str, action: str):
        try: item=formulation.transition(ident,action)
        except ValueError as exc: raise HTTPException(409,str(exc))
        if item is None: raise HTTPException(404,'Proposal not found')
        return item

    @app.get('/api/investigation-plans')
    def investigation_plans():
        return planner.list()

    @app.post('/api/investigation-plans/{plan_id}/approve')
    def approve_investigation_plan(plan_id: str):
        try: item = planner.approve(plan_id)
        except ValueError as exc: raise HTTPException(409,str(exc))
        if item is None: raise HTTPException(404,'Plan not found')
        return item

    @app.post('/api/investigation-plans/from-formulation/{formulation_id}', status_code=201)
    def create_investigation_plan(formulation_id: str):
        try: return planner.plan(formulation_id)
        except KeyError as exc: raise HTTPException(404,str(exc))
        except (ValueError,RuntimeError) as exc: raise HTTPException(409,str(exc))
        except Exception as exc: raise HTTPException(422,'Invalid plan: '+str(exc)[:240])

    class ImplementationInput(BaseModel):
        project: str = Field(min_length=1, max_length=80)

    @app.get('/api/implementations')
    def implementations():
        return implementer.list()

    @app.post('/api/implementations/{ident}/reevaluate')
    def reevaluate_implementation(ident: str):
        try:
            return implementer.reevaluate(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))

    @app.get('/api/implementations/{ident}/evaluations')
    def implementation_evaluations(ident: str):
        try:
            return implementer.evaluations(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))

    class ImplementationReviewInput(BaseModel):
        decision: str
        snapshot_sha256: str
        criteria: list[bool]
        feedback: str = ''

    @app.get('/api/implementations/{ident}/revisions')
    def get_implementation_revisions(ident: str):
        try:
            return revisions.list(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))

    @app.post('/api/implementations/{ident}/revisions/retry')
    def retry_implementation_revision(ident: str):
        try:
            return revisions.queue(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))

    @app.get('/api/implementations/{ident}/environment')
    def implementation_environment(ident: str):
        """FLOW-007A: recorded platform-owned test environment for a run."""
        try:
            return implementer.environment(ident) or {}
        except KeyError as exc:
            raise HTTPException(404, str(exc))

    @app.get('/api/implementations/{ident}/review-state')
    def implementation_review_state(ident: str):
        if implementer.get(ident) is None:
            raise HTTPException(404, 'Implementation not found')
        return reviewer.get_decision(ident)

    @app.get('/api/implementations/{ident}/review')
    def get_implementation_review(ident: str):
        try:
            return reviewer.view(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(409, str(exc))

    @app.post('/api/implementations/{ident}/review')
    def decide_implementation_review(ident: str, payload: ImplementationReviewInput):
        try:
            result = reviewer.decide(ident, payload.decision, payload.snapshot_sha256,
                                     payload.criteria, payload.feedback)
            if payload.decision == 'revision_requested':
                try:
                    attempt = revisions.queue(ident)
                    result['revision'] = {'attempt_id': attempt['id'], 'state': attempt['state']}
                    result['next_action'] = 'Revision queued automatically in isolated VM staging workspace'
                except (ValueError, KeyError) as exc:
                    # The review is already durable; startup recovery can enqueue it.
                    result['revision_queue_error'] = str(exc)
            return result
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))

    class ApplyInput(BaseModel):
        confirmation: str = Field(min_length=1, max_length=200)

    @app.get('/api/implementations/{ident}/apply-preview')
    def implementation_apply_preview(ident: str):
        """Preview the diff that would be applied to the host, without applying it."""
        try:
            return implementer.apply_preview(ident)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))

    @app.post('/api/implementations/{ident}/apply')
    def implementation_apply(ident: str, payload: ApplyInput):
        """Apply an accepted candidate to the registered host repository.

        Requires an accepted review, matching snapshot SHA-256, host at base commit
        with clean tree, and exact confirmation phrase.
        """
        try:
            return implementer.apply_to_host(ident, payload.confirmation)
        except KeyError as exc:
            raise HTTPException(404, str(exc))
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))

    @app.get('/api/implementations/{ident}')
    def implementation(ident: str):
        value=implementer.get(ident)
        if not value: raise HTTPException(404,'Implementation not found')
        return value

    @app.post('/api/implementations/from-plan/{plan_id}', status_code=201)
    def start_implementation(plan_id: str, payload: ImplementationInput):
        try: return implementer.start(plan_id,payload.project)
        except KeyError as exc: raise HTTPException(404,str(exc))
        except (ValueError,RuntimeError) as exc: raise HTTPException(409,str(exc))

    @app.get("/api/goals")
    def list_goals():
        return autonomy.list()

    @app.post("/api/goals", status_code=201)
    def add_goal(payload:GoalInput):
        return autonomy.add(payload.title,payload.prompt,payload.priority)

    @app.post("/api/goals/{goal_id}/cancel")
    def cancel_goal(goal_id:str):
        try: value=autonomy.cancel(goal_id)
        except ValueError as exc: raise HTTPException(409,str(exc))
        if not value:raise HTTPException(404,"Goal not found")
        return value

    @app.post("/api/goals/{goal_id}/retry")
    def retry_goal(goal_id:str):
        try: value=autonomy.retry(goal_id)
        except ValueError as exc: raise HTTPException(409,str(exc))
        if not value:raise HTTPException(404,"Goal not found")
        return value

    @app.get('/health')
    def health():
        return {'status':'ok','hermes_available':runtime.adapter.available()}

    @app.get('/api/world/state')
    def world_state():
        return sync_world(runtime.store)

    @app.get('/api/agent/state')
    def state():
        return runtime.store.agent()

    @app.get('/api/conversations')
    def conversations():
        return {'conversations':runtime.conversations.list()}

    @app.get('/api/conversations/{conversation_id}')
    def conversation(conversation_id: str):
        return {'conversation_id':conversation_id,'turns':runtime.conversations.turns(conversation_id)}

    @app.get('/api/conversations/{conversation_id}/revisions')
    def conversation_revisions(conversation_id: str):
        return {'revisions':runtime.recall.revisions(conversation_id)}

    @app.get('/api/memory-reviews')
    def memory_reviews():
        with runtime.store.lock:
            rows=runtime.store.connection.execute('SELECT * FROM hl_memory_reviews ORDER BY id DESC LIMIT 100').fetchall()
        return {'reviews':[dict(r) for r in rows]}

    @app.post('/api/memory-reviews/{review_id}/resolve')
    def resolve_memory_review(review_id: int, payload: dict):
        decision=payload.get('decision')
        if decision not in ('accept','reject'):
            raise HTTPException(422,'decision must be accept or reject')
        with runtime.store.lock:
            db=runtime.store.connection
            review=db.execute('SELECT * FROM hl_memory_reviews WHERE id=?',(review_id,)).fetchone()
            if review is None:raise HTTPException(404,'Review not found')
            if review['status']!='pending':raise HTTPException(409,'Review already resolved')
            old=db.execute('SELECT * FROM hl_memories WHERE id=? AND status="active"',
                           (review['existing_memory_id'],)).fetchone() if review['existing_memory_id'] else None
            if decision=='accept' and review['existing_memory_id'] and old is None:
                raise HTTPException(409,'Original memory is no longer active')
        if decision=='accept':
            if old:
                entry=runtime.recall.remember(review['candidate'],old['kind'],supersedes=old['id'])
            else:
                kind=payload.get('kind')
                if kind not in ('decision','preference','project','correction','workflow'):
                    raise HTTPException(422,'New lesson requires a valid kind')
                entry=runtime.recall.remember(review['candidate'],kind)
            try:runtime.vault_memory._mirror(entry)
            except (OSError,ValueError):pass
        with runtime.store.lock:
            runtime.store.connection.execute('UPDATE hl_memory_reviews SET status=? WHERE id=?',(decision,review_id))
            runtime.store.connection.commit()
        return {'id':review_id,'status':decision}

    # Study routes (HL-STUDY-001..004)
    class StudySourceInput(BaseModel):
        uri: str = Field(min_length=1, max_length=500)
        title: str = Field(min_length=1, max_length=200)
        sha256: str = Field(min_length=1, max_length=128)
        pages_total: int = Field(ge=1)
        pages_indexed: int = Field(ge=0)
        kind: str = Field(default='pdf', pattern='^(pdf|epub|html|text)$')

    class StudyUnitCreateInput(BaseModel):
        ordinal: int = Field(ge=1)
        title: str = Field(min_length=1, max_length=200)
        kind: str = Field(min_length=1, max_length=50)
        start_page: int = Field(ge=1)
        end_page: int = Field(ge=1)

    @app.get('/api/study/sources')
    def list_study_sources():
        return {'sources': [s.__dict__ for s in runtime.study.list_sources()]}

    @app.post('/api/study/sources', status_code=201)
    def register_study_source(payload: StudySourceInput):
        source = runtime.study.register_source(
            payload.uri, payload.title, payload.sha256,
            payload.pages_total, payload.pages_indexed, payload.kind
        )
        return source.__dict__

    @app.get('/api/study/sources/{source_id}')
    def get_study_source(source_id: int):
        source = runtime.study.get_source(source_id)
        if not source:
            raise HTTPException(404, 'Study source not found')
        return source.__dict__

    @app.get('/api/study/sources/{source_id}/units')
    def list_study_units(source_id: int):
        units = runtime.study.list_units(source_id)
        return {'units': [u.__dict__ for u in units]}

    @app.post('/api/study/sources/{source_id}/units', status_code=201)
    def create_study_units(source_id: int, payload: List[StudyUnitCreateInput]):
        if not runtime.study.get_source(source_id):
            raise HTTPException(404, 'Study source not found')
        units_data = [u.__dict__ for u in payload]
        units = runtime.study.create_units(source_id, units_data)
        return {'units': [u.__dict__ for u in units]}

    @app.get('/api/study/sources/{source_id}/next')
    def get_next_study_unit(source_id: int):
        unit = runtime.study.get_next_queuable_unit(source_id)
        if not unit:
            return {'unit': None, 'message': 'No queuable unit available (blocked, completed, or failed)'}
        return {'unit': unit.__dict__}

    @app.get('/api/study/sources/{source_id}/progress')
    def get_study_progress(source_id: int):
        """Get overall progress for a study source (HL-STUDY-004)."""
        source = runtime.study.get_source(source_id)
        if not source:
            raise HTTPException(404, 'Study source not found')
        units = runtime.study.list_units(source_id)
        total = len(units)
        completed = sum(1 for u in units if u.state == 'completed')
        queued = sum(1 for u in units if u.state == 'queued')
        running = sum(1 for u in units if u.state == 'running')
        failed = sum(1 for u in units if u.state == 'failed')
        blocked = sum(1 for u in units if u.state == 'blocked')
        not_queued = sum(1 for u in units if u.state == 'not_queued')
        return {
            'source_id': source_id,
            'title': source.title,
            'pages_total': source.pages_total,
            'pages_indexed': source.pages_indexed,
            'total_units': total,
            'completed': completed,
            'queued': queued,
            'running': running,
            'failed': failed,
            'blocked': blocked,
            'not_queued': not_queued,
            'progress_pct': round((completed / total * 100) if total else 0, 1),
        }

    @app.get('/api/memories')
    def memories(limit: int = 100):
        return {'memories':runtime.recall.list(limit)}

    @app.post('/api/memories', status_code=201)
    def remember(payload: dict):
        try:
            return runtime.recall.remember(payload.get('content',''), payload.get('kind','decision'),
                payload.get('conversation_id'), payload.get('turn_id'), payload.get('supersedes'))
        except (TypeError, ValueError) as exc:
            raise HTTPException(422,str(exc))

    # Personality / Learned Behavioral Profile endpoints (HL-PERS-001)
    @app.get('/api/personality/profile')
    def personality_profile():
        """Get the current learned behavioral profile (preferences, corrections, decisions, workflows)."""
        return {'profile': runtime.personality.learned_profile()}

    @app.get('/api/personality/profile/relevant')
    def personality_profile_relevant(prompt: str, conversation_id: str | None = None, limit: int = 5):
        """Get relevant learned memories for a specific task prompt."""
        context = runtime.personality.relevant_learned_context(prompt, conversation_id, limit)
        return {'context': context}

    class ProfileCorrectionInput(BaseModel):
        memory_id: str
        action: str = Field(pattern='^(supersede|delete)$')  # supersede=replace with new content, delete=supersede to inactive
        new_content: str | None = Field(default=None, max_length=1600)
        new_kind: str | None = Field(default=None, pattern='^(preference|correction|decision|workflow|project)$')

    @app.post('/api/personality/profile/{memory_id}/correct')
    def correct_profile_memory(memory_id: str, payload: ProfileCorrectionInput):
        """Correct or invalidate a learned behavioral memory.
        
        - supersede: replaces the memory with new_content (and optional new_kind), marking old as superseded
        - delete: marks the memory as superseded (inactive) without replacement
        """
        with runtime.store.lock:
            db = runtime.store.connection
            existing = db.execute('SELECT * FROM hl_memories WHERE id=?', (memory_id,)).fetchone()
            if not existing:
                raise HTTPException(404, 'Memory not found')
            if existing['status'] != 'active':
                raise HTTPException(409, 'Memory is not active')
        
        if payload.action == 'supersede':
            if not payload.new_content or len(payload.new_content.strip()) < 4:
                raise HTTPException(422, 'New content must be at least 4 characters')
            kind = payload.new_kind or existing['kind']
            result = runtime.recall.remember(payload.new_content.strip(), kind,
                existing['source_conversation_id'], existing['source_turn_id'], supersedes=memory_id)
            return {'action': 'superseded', 'old_id': memory_id, 'new': result}
        elif payload.action == 'delete':
            # Mark as superseded with no replacement
            with runtime.store.lock:
                db = runtime.store.connection
                db.execute('UPDATE hl_memories SET status="superseded", superseded_by=NULL, updated_at=? WHERE id=?',
                    (now(), memory_id))
                db.commit()
            runtime.store.emit('personality.profile_corrected', {'memory_id': memory_id, 'action': 'deleted'}, memory_id)
            return {'action': 'deleted', 'memory_id': memory_id}

    @app.get('/api/tasks')
    def tasks():
        return runtime.store.tasks()

    @app.get('/api/tasks/{task_id}')
    def get_task(task_id: str):
        task = runtime.store.task(task_id)
        if not task:
            raise HTTPException(404, 'Task not found')
        return task

    @app.post('/api/tasks', status_code=202)
    def create_task(payload: TaskInput):
        if payload.revision_of is not None:
            if not payload.conversation_id or not payload.revision_text:
                raise HTTPException(422, 'Revision requires conversation_id and revision_text')
            if not runtime.recall.revisable(payload.conversation_id, payload.revision_of):
                raise HTTPException(409, 'Original turn not found or already revised')
        if not runtime.adapter.available():
            raise HTTPException(503, 'Hermes CLI unavailable')
        if not runtime.active.acquire(blocking=False):
            raise HTTPException(409, 'Agent is busy')
        try:
            task = runtime.store.create_task(payload.prompt)
            cid = runtime.conversations.add_user_turn(payload.prompt,payload.conversation_id,task['id'])
            if payload.revision_of is not None:
                runtime.recall.assert_revision(cid, payload.revision_of, payload.revision_text, task['id'])
            task['conversation_id'] = cid
            runtime.store.emit('task.queued', {'task_id':task['id']},task['id'])
            threading.Thread(target=runtime.run_task,args=(task['id'],),daemon=True).start()
            return task
        except Exception:
            runtime.active.release()
            raise

    @app.post('/api/tasks/{task_id}/cancel')
    def cancel_task(task_id: str):
        """Cancel a running task. Returns the cancelled task state."""
        task = runtime.store.task(task_id)
        if not task:
            raise HTTPException(404, 'Task not found')
        if task['state'] not in ('queued', 'running', 'pending'):
            raise HTTPException(409, f'Task cannot be cancelled in state: {task["state"]}')
        # Try to cancel via the active adapter
        scope = runtime.task_scope(task_id)
        adapter = runtime.adapters[scope]
        if adapter.cancel(task_id):
            runtime.store.update_task(task_id, 'cancelled', error='Cancelled by user')
            runtime.store.emit('task.cancelled', {'task_id': task_id}, task_id)
            # Release the global lock if we hold it
            runtime.store.set_agent('idle')
            runtime.active.release()
            return runtime.store.task(task_id)
        else:
            raise HTTPException(409, 'Task not found in active process registry')

    # Maintenance routes (HL-MAINT-001/002, HL-ENV-004)
    class PruneInput(BaseModel):
        older_than_days: float = Field(default=30, ge=1, le=3650)
        confirm: bool = False

    @app.post('/api/maintenance/prune-experiments')
    def prune_experiments(payload: PruneInput):
        """Preview or execute experiment pruning.

        With confirm=false (default): dry-run preview only.
        With confirm=true: actually delete eligible entries and emit audit events.
        """
        try:
            if payload.confirm:
                return runtime.maintenance.prune(payload.older_than_days, confirm=True)
            else:
                return runtime.maintenance.preview(payload.older_than_days)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        except RuntimeError as exc:
            raise HTTPException(503, str(exc))
        except Exception as exc:
            raise HTTPException(500, f'Maintenance error: {exc}')

    @app.get('/api/events')
    def events(after: int=0, limit: int=200,
               goal_id: str | None = None, run_id: str | None = None,
               plan_id: str | None = None, project_id: str | None = None,
               correlation_id: str | None = None):
        """Get events with optional filtering by linking fields (HL-EVENT-002)."""
        filters = {}
        if goal_id: filters['goal_id'] = goal_id
        if run_id: filters['run_id'] = run_id
        if plan_id: filters['plan_id'] = plan_id
        if project_id: filters['project_id'] = project_id
        if correlation_id: filters['correlation_id'] = correlation_id
        return runtime.store.events(after, limit, **filters)

    @app.get('/api/events/{sequence}')
    def event_by_sequence(sequence: int):
        """Get a single event by sequence number."""
        events = runtime.store.events(sequence - 1, 1)
        if not events:
            raise HTTPException(404, 'Event not found')
        return events[0]

    @app.websocket('/ws/events')
    async def ws_events(websocket: WebSocket):
        await websocket.accept()
        try:
            after = max(0,int(websocket.query_params.get('after','0')))
            while True:
                sync_world(runtime.store)
                batch = runtime.store.events(after)
                for event in batch:
                    await websocket.send_json(event)
                    after = event['sequence']
                await asyncio.sleep(0.4)
        except (WebSocketDisconnect, RuntimeError):
            pass

    return app

