"""Persistent, opt-in discovery decisions. No implicit execution or repository modifications."""
import os
import threading
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from .store import now

class DecisionEngine:
 def __init__(self, runtime, autonomy, discovery):
  self.runtime,self.autonomy,self.discovery=runtime,autonomy,discovery
  self.store=runtime.store
  self.stop_event=threading.Event();self.worker=None

 def settings(self):
  with self.store.lock:
   r=self.store.connection.execute('SELECT * FROM decision_settings WHERE id=1').fetchone()
   return {**dict(r),'enabled':bool(r['enabled'])}
 def configure(self,enabled,interval=None):
  if interval is not None and not 60<=interval<=86400:raise ValueError('Interval must be 60–86400 seconds')
  with self.store.lock:
   if interval is None:self.store.connection.execute('UPDATE decision_settings SET enabled=? WHERE id=1',(int(enabled),))
   else:self.store.connection.execute('UPDATE decision_settings SET enabled=?,scan_interval_seconds=? WHERE id=1',(int(enabled),interval))
   self.store.connection.commit()
  self.store.emit('decision.enabled' if enabled else 'decision.paused',{})
  return self.settings()
 def curiosity(self):
  with self.store.lock:
   return [dict(r) for r in self.store.connection.execute('SELECT * FROM curiosity ORDER BY priority DESC,created_at ASC LIMIT 200')]
 def set_curiosity_state(self,ident,state):
  if state not in ('deferred','dismissed','open'):raise ValueError('Invalid curiosity state')
  with self.store.lock:
   row=self.store.connection.execute('SELECT * FROM curiosity WHERE id=?',(ident,)).fetchone()
   if not row:return None
   self.store.connection.execute('UPDATE curiosity SET state=?,updated_at=? WHERE id=?',(state,now(),ident))
   self.store.connection.commit()
  self.store.emit('curiosity.'+state,{'curiosity_id':ident})
  return dict(self.store.connection.execute('SELECT * FROM curiosity WHERE id=?',(ident,)).fetchone())
 def _sync_questions(self):
  new=0
  for d in self.discovery.list():
   if d['state'] not in ('proposed','deferred'):continue
   question=f"What is the verified impact of {d['note'][:110]} in {d['project']}/{d['path']}?"
   priority=65 if 'FIXME' in d['note'].upper() else 40
   with self.store.lock:
    cur=self.store.connection.execute('INSERT OR IGNORE INTO curiosity VALUES (?,?,?,?,?,?,?,?,?)',
     (str(uuid4()),d['id'],question,'research',priority,'open',d['rationale'],now(),now()))
    self.store.connection.commit()
   new+=int(cur.rowcount>0)
  return new
 def tick(self,force=False):
  cfg=self.settings()
  if not cfg['enabled'] and not force:return {'action':'paused'}
  # Never run scans concurrently with an active Hermes task or another scan.
  if not self.runtime.active.acquire(blocking=False):return {'action':'busy'}
  try:
   last=datetime.fromisoformat(cfg['last_scan']) if cfg['last_scan'] else None
   if not force and last and datetime.now(timezone.utc)-last<timedelta(seconds=cfg['scan_interval_seconds']):
    return {'action':'rest','reason':'Waiting for next discovery interval'}
   self.store.emit('decision.selected',{'action':'discover','reason':'Scheduled read-only VM repository scan'})
   outcome=self.discovery.scan()
   new=self._sync_questions()
   with self.store.lock:
    self.store.connection.execute('UPDATE decision_settings SET last_scan=?,last_error=NULL WHERE id=1',(now(),))
    self.store.connection.commit()
   self.store.emit('decision.completed',{'action':'discover','questions_added':new,**outcome})
   return {'action':'discover','questions_added':new,**outcome}
  except Exception as e:
   with self.store.lock:
    self.store.connection.execute('UPDATE decision_settings SET last_scan=?,last_error=? WHERE id=1',(now(),str(e)[:500]))
    self.store.connection.commit()
   self.store.emit('decision.error',{'error':str(e)[:500]})
   raise
  finally:self.runtime.active.release()
 def start(self):
  if self.worker and self.worker.is_alive():return
  self.stop_event.clear();self.worker=threading.Thread(target=self.loop,daemon=True,name='hermes-life-decisions');self.worker.start()
 def stop(self):
  self.stop_event.set()
  if self.worker:self.worker.join(timeout=3)
 def loop(self):
  while not self.stop_event.wait(10):
   try:self.tick()
   except Exception:pass # Persisted in decision_settings and emitted in event log.
