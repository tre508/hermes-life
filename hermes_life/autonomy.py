"""Persisted, opt-in autonomous goal queue. No autonomous repository scanning in v0.3."""
import threading
import time
from uuid import uuid4
from .store import now

class Autonomy:
    def __init__(self, runtime):
        self.runtime = runtime
        self.store = runtime.store
        self.stop_event = threading.Event()
        self.worker = None
        # Injected by create_app after the planning engine exists (avoids a cycle).
        self.planner = None
        self.study = None

    def settings(self):
        with self.store.lock:
            row=self.store.connection.execute('SELECT enabled FROM autonomy_settings WHERE id=1').fetchone()
            return {'enabled':bool(row['enabled']), 'worker_running':bool(self.worker and self.worker.is_alive())}

    def enable(self, value):
        with self.store.lock:
            self.store.connection.execute('UPDATE autonomy_settings SET enabled=? WHERE id=1',(int(value),))
            self.store.connection.commit()
        self.store.emit('autonomy.resumed' if value else 'autonomy.paused', {})
        return self.settings()

    def add(self, title, prompt, priority):
        ident=str(uuid4());stamp=now()
        with self.store.lock:
            self.store.connection.execute('INSERT INTO goals (id,title,prompt,state,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                                          (ident,title,prompt,'pending',priority,stamp,stamp))
            self.store.connection.commit()
        self.store.emit('goal.created',{'goal_id':ident,'title':title})
        return self.get(ident)

    def get(self, ident):
        with self.store.lock:
            row=self.store.connection.execute('SELECT * FROM goals WHERE id=?',(ident,)).fetchone()
            return dict(row) if row else None

    def list(self):
        with self.store.lock:
            return [dict(r) for r in self.store.connection.execute('SELECT * FROM goals ORDER BY created_at DESC LIMIT 200')]

    def update(self, ident, state, task_id=None, error=None):
        with self.store.lock:
            self.store.connection.execute('UPDATE goals SET state=?,task_id=COALESCE(?,task_id),error=?,updated_at=? WHERE id=?',
                                          (state,task_id,error,now(),ident))
            self.store.connection.commit()
        self.store.emit('goal.'+state,{'goal_id':ident,'task_id':task_id,'error':error},task_id)
        return self.get(ident)

    def cancel(self, ident):
        goal=self.get(ident)
        if not goal:return None
        if goal['state'] not in ('pending','interrupted'):
            raise ValueError('Only pending/interrupted goals can be cancelled')
        return self.update(ident,'cancelled')

    def retry(self, ident):
        goal=self.get(ident)
        if not goal:return None
        if goal['state'] not in ('interrupted','failed'):
            raise ValueError('Only interrupted/failed goals can be retried')
        return self.update(ident,'pending')

    def start(self):
        if self.worker and self.worker.is_alive():return
        self.stop_event.clear()
        self.worker=threading.Thread(target=self.loop,name='hermes-life-scheduler',daemon=True)
        self.worker.start()

    def stop(self):
        self.stop_event.set()
        if self.worker:self.worker.join(timeout=3)

    def loop(self):
        while not self.stop_event.wait(1):
            try:self.tick()
            except Exception as exc:self.store.emit('autonomy.error',{'error':str(exc)})

    def tick(self):
        if not self.settings()['enabled'] or not self.runtime.adapter.available():
            return False
        # HL-STUDY-004: advance study units under the single-scheduler rule.
        if self.study:
            try:
                self.study.tick(self)
            except Exception as exc:
                self.store.emit('study.tick_error', {'error': str(exc)[:300]})
        # Only one in-flight task for manual and autonomous calls.
        if not self.runtime.active.acquire(blocking=False):
            return False
        handed_off = False
        try:
            with self.store.lock:
                goal=self.store.connection.execute("SELECT * FROM goals WHERE state='pending' ORDER BY priority DESC,created_at ASC LIMIT 1").fetchone()
                if goal is None:return False
                goal=dict(goal)
                # Re-check the flag under the same database lock used for selection.
                enabled=self.store.connection.execute('SELECT enabled FROM autonomy_settings WHERE id=1').fetchone()['enabled']
                if not enabled:return False
                task=self.store.create_task(goal['prompt'])
                self.store.connection.execute("UPDATE goals SET state='running',task_id=?,updated_at=? WHERE id=?",(task['id'],now(),goal['id']))
                self.store.connection.commit()
            self.store.emit('goal.selected',{'goal_id':goal['id'],'title':goal['title']},task['id'])
            self.store.emit('task.queued',{'task_id':task['id'],'source':'autonomy'},task['id'])
            def runner():
                try:
                    self.runtime.run_task(task['id']) # releases active lock itself
                finally:
                    outcome=self.store.task(task['id'])
                    status='completed' if outcome and outcome['state']=='completed' else 'failed'
                    self.update(goal['id'],status,error=outcome['error'] if outcome else 'Task missing')
                    # HL-FLOW-001: advance a completed investigation into planning.
                    self._advance_lifecycle(goal['id'], status)
            threading.Thread(target=runner,daemon=True).start()
            handed_off = True
            return True
        except Exception:
            raise
        finally:
            # Keep active lock held while the Hermes thread is running.
            # The 'return False' path and early exception path must release it.
            if not handed_off:
                self.runtime.active.release()

    def _advance_lifecycle(self, goal_id, status):
        """Idempotent investigation -> planning handoff (spec 8.1 / FLOW-01).

        Fires on the goal-completion boundary inside the single existing scheduler.
        Only a successfully completed goal whose formulation was approved is advanced;
        failed, cancelled or incomplete investigations never produce a plan. plan() is
        itself idempotent (investigation_plans.formulation_id is UNIQUE), so repeated
        completion events or restarts cannot duplicate records.
        """
        if status != 'completed':
            return
        planner = getattr(self, 'planner', None)
        if planner is None:
            return
        with self.store.lock:
            f = self.store.connection.execute(
                "SELECT id FROM formulated_goals WHERE goal_id=? AND state='approved'",
                (goal_id,)).fetchone()
        if f is None:
            return  # manual goal with no approved formulation: nothing to plan
        # Retry briefly on scheduler contention so a handoff is never silently dropped.
        for attempt in range(5):
            try:
                planner.plan(f['id'])
                return
            except ValueError as exc:
                if 'busy' in str(exc).lower() and attempt < 4:
                    time.sleep(0.3 * (attempt + 1))
                    continue
                return  # duplicate or ineligible: idempotent no-op
            except Exception:
                return  # environment error: non-fatal to the autonomy loop
