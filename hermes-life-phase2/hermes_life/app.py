import asyncio
import os
import threading
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from .store import Store
from .hermes_adapter import HermesAdapter
from .world import sync_world

class TaskInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=20000)

class Runtime:
    def __init__(self, database, adapter=None):
        self.store = Store(database)
        self.adapter = adapter or HermesAdapter(timeout_seconds=int(os.getenv('HERMES_LIFE_TIMEOUT','1800')))
        self.active = threading.Lock()

    def run_task(self, ident):
        try:
            self.store.update_task(ident, 'running')
            self.store.set_agent('executing',ident)
            self.store.emit('task.started', {}, ident)
            def on_event(name, payload):
                self.store.emit(name, payload, ident)
            result = self.adapter.run(self.store.task(ident)['prompt'], on_event)
            self.store.update_task(ident, 'completed', **result)
            self.store.emit('task.completed', {'session_id':result.get('session_id')},ident)
        except Exception as exc:
            self.store.update_task(ident, 'failed', error=str(exc))
            self.store.emit('task.failed', {'error':str(exc)},ident)
        finally:
            self.store.set_agent('idle')
            self.active.release()


def create_app(database=None, adapter=None):
    path = database or os.getenv('HERMES_LIFE_DB', str(Path.home() / '.local/share/hermes-life/life.db'))
    runtime = Runtime(path,adapter)
    app = FastAPI(title='Hermes Life', version='0.1.0')
    app.state.runtime = runtime

    @app.get('/health')
    def health():
        return {'status':'ok','hermes_available':runtime.adapter.available()}

    @app.get('/api/world/state')
    def world_state():
        return sync_world(runtime.store)

    @app.get('/api/agent/state')
    def state():
        return runtime.store.agent()

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
        if not runtime.adapter.available():
            raise HTTPException(503, 'Hermes CLI unavailable')
        if not runtime.active.acquire(blocking=False):
            raise HTTPException(409, 'Agent is busy')
        try:
            task = runtime.store.create_task(payload.prompt)
            runtime.store.emit('task.queued', {'task_id':task['id']},task['id'])
            threading.Thread(target=runtime.run_task,args=(task['id'],),daemon=True).start()
            return task
        except Exception:
            runtime.active.release()
            raise

    @app.get('/api/events')
    def events(after: int=0, limit: int=200):
        return runtime.store.events(after,limit)

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

app = create_app()
