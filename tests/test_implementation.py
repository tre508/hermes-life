import json
import sqlite3
from hermes_life.schema import SCHEMA_VERSION, migrate
from hermes_life.implementation import ImplementationEngine

def test_schema_v2_upgrade(tmp_path):
    db=sqlite3.connect(tmp_path/'test.db')
    db.execute('PRAGMA user_version=2')
    migrate(db)
    assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
    assert db.execute("SELECT name FROM sqlite_master WHERE name='implementation_runs'").fetchone()

def test_vm_project_name_validation():
    import re
    for name in ('../private','bad/name','; rm -rf /',''):
        assert not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}',name)

def test_guest_helper_syntax():
    from hermes_life.implementation import GUEST
    compile(GUEST,'<guest helper>','exec')
