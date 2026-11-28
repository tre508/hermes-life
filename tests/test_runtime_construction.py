"""HA-003 pin: Runtime must construct end-to-end, in order.

The in-flight refactor once passed self.personality into PersonalityAdapter
before assigning it (app.py), which broke every create_app()-based test at
fixture construction — 153 failures sharing one AttributeError hid a single
ordering bug. This test builds a Runtime directly so that regression can never
again hide behind fixture errors.
"""
from hermes_life.app import Runtime


def test_runtime_constructs_and_wires_personality(tmp_path):
    runtime = Runtime(tmp_path / 'runtime.db')
    # First use (PersonalityAdapter at construction) must follow assignment.
    assert runtime.personality is not None
    assert runtime.retrieval is not None
    assert runtime.adapter is runtime.adapters['interactive']
    assert 'read_only' in runtime.analysis_adapters
