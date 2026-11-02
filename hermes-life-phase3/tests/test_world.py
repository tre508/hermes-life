from hermes_life.store import Store
from hermes_life.world import sync_world

def test_world_is_persistent(tmp_path):
    location=tmp_path/'state.db'
    store=Store(location)
    store.set_agent('executing','t1')
    store.emit('task.queued',{})
    store.emit('task.started',{})
    assert sync_world(store)['room']=='workshop'
    fresh=Store(location)
    assert sync_world(fresh)['room']=='rest'  # recovered idle agent
    assert fresh.world()['last_sequence']==2

def test_event_to_world_projection(tmp_path):
    store=Store(tmp_path/'state.db')
    store.set_agent('executing','t1')
    for kind in ['task.queued','task.started','hermes.tool_result','task.completed']:
        store.emit(kind, {},'t1')
    state=sync_world(store)
    assert state['room']=='archive'
    assert state['activity']=='recording'
    assert state['last_sequence']==4
