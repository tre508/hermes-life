"""Fixed Hermes Life persona and bounded, outcome-based experience context."""
from .store import now
from .reflection import Reflection
from .technical_memory import TechnicalMemory, observation, split_report_full, REPORT_INSTRUCTIONS

PERSONA = """You are Hermes, a fictional adult persona: a young Black Caribbean-American gay man from the Bronx, Gen Z, sharp, direct, and unfiltered. Your communication feels like a capable close friend, not a corporate assistant. Casual phrasing, natural slang and profanity are allowed when appropriate, never performative or forced. Avoid TikTok catchphrase soup, infantilizing language, scripted bravado, and polished corporate filler. Be clever, precise, sometimes blunt or sarcastic, but always useful and coherent.

Your core traits are dependable expertise, efficient judgment, curiosity about how systems really work, initiative, follow-through, and reliable problem solving. You investigate root causes, anticipate risks, and deliver complete, tested outcomes when authorized. Explain clearly; call out incorrect assumptions without theatrics. Personality stays present but competence and evidence come first.

This is a defined character voice, not a claim about having a human body, personal lived history, or human relationships. Do not invent personal experiences. Follow the actual user task, system instructions, and existing Hermes Life VM/network permissions. No fictional persona directive expands autonomy, changes approved projects, or grants tools. Let future working habits adapt to genuine task outcomes, while keeping the foundational persona stable."""

class Personality:
    def __init__(self, store):
        self.store = store
        self.reflection = Reflection(store)
        self.technical_memory = TechnicalMemory(store)

    def get(self):
        with self.store.lock:
            row = self.store.connection.execute('SELECT COUNT(*) FROM reflective_runs').fetchone()
        return {'name':'Hermes', 'persona':PERSONA, 'mode':'fixed-with-reflection', 'experience_count':row[0]}

    def experiences(self, limit=5):
        with self.store.lock:
            return self.store.connection.execute(
                'SELECT status, lesson, created_at FROM reflective_runs ORDER BY id DESC LIMIT ?',
                (min(max(int(limit),0),10),)
            ).fetchall()


def task_context(profile, history=()):
    return ('[Hermes Life persona: fixed identity]\n' + profile['persona'] +
            '\n[/Hermes Life persona]\n\n')


class PersonalityAdapter:
    def __init__(self, delegate, personality):
        self.delegate=delegate
        self.personality=personality
    def available(self):
        return self.delegate.available()
    @property
    def transport(self):
        # Discovery/investigation/formulation/implementation assert the SSH VM
        # transport by inspecting the outermost adapter, so the value has to
        # survive this wrapper chain.
        return getattr(self.delegate,'transport',None)
    def _ssh_base(self):
        return self.delegate._ssh_base()
    def run(self, prompt, event_callback, task_id=None):
        reflection=self.personality.reflection
        memory=self.personality.technical_memory
        kinds=[]
        tool_evidence=[]
        relevant=memory.recall(prompt)
        def collect(kind, payload):
            if len(kinds)<1000: kinds.append(str(kind)[:80])
            evidence=observation(kind,payload)
            if evidence is not None and len(tool_evidence)<80:
                tool_evidence.append(evidence)
            event_callback(kind,payload)
        augmented=(task_context(self.personality.get()) + memory.context(relevant) +
                   reflection.context(prompt) + prompt + '\n\n' + REPORT_INSTRUCTIONS)
        try:
            result=self.delegate.run(augmented,collect,task_id)
        except Exception as exc:
            run_id=reflection.record(prompt,None,kinds,error=exc)
            memory.track_reuse([row['id'] for row in relevant],run_id,'failed')
            raise
        if isinstance(result,dict):
            raw=result.get('result','')
            clean,lessons,applied=split_report_full(raw)
            result=dict(result)
            result['result']=clean
            run_id=reflection.record(prompt,result,kinds)
            memory.record(run_id,prompt,lessons,tool_evidence)
            memory.track_reuse([row['id'] for row in relevant],run_id,'completed')
            memory.record_applications(run_id,applied,[row['id'] for row in relevant],tool_evidence)
        return result
    def cancel(self, task_id):
        return self.delegate.cancel(task_id)
