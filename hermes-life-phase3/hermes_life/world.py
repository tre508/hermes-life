"""Deterministic presentation reducer; world movement is visualization, not tool execution."""
ROOMS = {
    'control': (2, 2), 'library': (9, 2), 'workshop': (16, 2),
    'archive': (2, 9), 'laboratory': (9, 9), 'rest': (16, 9),
}


def reduce_event(event, current):
    kind = event['type']
    if kind == 'task.queued':
        return 'control', 'planning'
    if kind in {'task.started', 'hermes.tool_use'}:
        return 'workshop', 'coding'
    if kind == 'hermes.tool_result':
        return 'laboratory', 'reviewing'
    if kind == 'hermes.system':
        return 'library', 'researching'
    if kind == 'hermes.result':
        return 'laboratory', 'evaluating'
    if kind in {'task.completed', 'task.failed'}:
        return 'archive', 'recording' if kind == 'task.completed' else 'failed'
    return current['room'], current['activity']


def sync_world(store):
    """Replay unseen events after restart; idle reconciled from actual task state."""
    state = store.world()
    cursor = state['last_sequence']
    while True:
        batch = store.events(cursor, 500)
        if not batch:
            break
        for event in batch:
            room, activity = reduce_event(event, state)
            x, y = ROOMS[room]
            state = store.set_world(room, activity, x, y, event['sequence'])
            cursor = event['sequence']
    agent = store.agent()
    if agent['state'] == 'idle' and state['activity'] in {'coding', 'planning', 'researching', 'reviewing', 'evaluating'}:
        x, y = ROOMS['rest']
        state = store.set_world('rest', 'idle', x, y, cursor)
    return state
