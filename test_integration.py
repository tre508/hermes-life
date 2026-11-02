import sys,types,sqlite3,threading,datetime,hashlib
from pathlib import Path
sys.path.insert(0,'/mnt/data/p394')
store=types.ModuleType('hermes_life.store');store.now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();sys.modules['hermes_life.store']=store
ref=types.ModuleType('hermes_life.reflection');ref.terms=lambda s:set(str(s).lower().split());ref.categorize=lambda *a:'implementation';sys.modules['hermes_life.reflection']=ref
from hermes_life.schema import migrate
from hermes_life.technical_memory import TechnicalMemory
c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row;migrate(c)
assert c.execute('pragma user_version').fetchone()[0]==11
for i in range(1,5):
 c.execute('INSERT INTO reflective_runs(id,created_at,category,status,terms_json,evidence_json,lesson) VALUES (?,?,?,?,?,?,?)',(i,'today','implementation','completed','[]','[]','x'))
c.execute("INSERT INTO technical_lessons(run_id,created_at,category,topic,lesson,applicability,evidence_excerpt,evidence_sha256,evidence_kind,state) VALUES (?,?,?,?,?,?,?,?,?,?)",(1,'today','implementation','Python boolean integer checks','Python bool subclasses int and strict type is int rejects bool','For strict Python integer checks','print(True)','hash','tool_result','supported'))
c.execute("INSERT INTO technical_lesson_evidence(lesson_id,run_id,excerpt,evidence_sha256,created_at) VALUES (?,?,?,?,?)",(1,1,'print(True)','hash','today'))
c.commit()
obj=type('Store',(),{'connection':c,'lock':threading.RLock()})()
m=TechnicalMemory(obj)
assert m._metrics(1)['confidence_status']=='provisional'
assert m._record_challenge(2,{'challenges_lesson_id':1,'lesson':'Python bool is not an int in strict type validation according to this test','tool_evidence':'contradiction-result-for-bool'},['contradiction-result-for-bool'])
assert m._metrics(1)['confidence_status']=='disputed'
assert m.recall('Python boolean integer checks')==[]
c.execute("INSERT INTO technical_lesson_evidence(lesson_id,run_id,excerpt,evidence_sha256,created_at) VALUES (?,?,?,?,?)",(1,3,'independent verification shows bool is int subclass','hash2','today'))
c.commit()
assert m.resolve(1,'upheld','Independent verification confirms original statement',3,'independent verification shows bool is int subclass')['status']=='restored'
assert m._metrics(1)['unresolved_challenges']==0
assert m._metrics(1)['resolution_verdict']=='upheld'
assert m._record_challenge(4,{'challenges_lesson_id':1,'lesson':'Python bool is not an int in strict type validation according to this test','tool_evidence':'new-contradiction-against-bool'},['new-contradiction-against-bool'])
assert m._metrics(1)['confidence_status']=='disputed'
assert len(m.challenge_history(1)['resolutions'])==1
print('PASS migration, quarantine, independent verification, restore, re-dispute, audit retention')
