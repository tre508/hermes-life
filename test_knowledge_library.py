import sqlite3,threading
from hermes_life.knowledge_library import KnowledgeLibrary,KnowledgeAdapter
class Store:
    def __init__(self):
        self.lock=threading.RLock()
        self.connection=sqlite3.connect(':memory:',check_same_thread=False)
        self.connection.row_factory=sqlite3.Row
class Delegate:
    def available(self):return True
    def run(self,prompt,cb):return {'prompt':prompt}

def test():
    store=Store();lib=KnowledgeLibrary(store);lib.migrate()
    source=lib.register('https://example.org/python.pdf','Python Handbook')
    sid=source['source_id']
    assert lib.sources()[0]['indexed_pages']==0
    assert lib.add_pages(sid,[{'page':4,'text':'Python integer validation uses type(value) is int to exclude booleans.'}])['chunks_written']==1
    result=lib.search('python integer boolean validation')
    assert len(result)==1 and result[0]['page']==4
    assert 'page 4' in KnowledgeAdapter(Delegate(),lib).run('Need python integer validation',None)['prompt']
    assert not lib.search('spaceship thrusters')
    lib.add_pages(sid,[{'page':4,'text':'Another paragraph completely replaces old page.'}])
    assert not lib.search('booleans')
    assert lib.sources()[0]['chunks']==1
    print('PASS: migration, registration, page index, retrieval, adapter injection, page replacement, no unrelated recall')
if __name__=='__main__':test()
