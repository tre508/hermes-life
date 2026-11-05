"""Fixed Hermes Life persona and bounded, outcome-based experience context."""
from .store import now
from .reflection import Reflection
from .technical_memory import TechnicalMemory, observation, split_report_full, REPORT_INSTRUCTIONS
from .conversation_recall import Recall

PERSONA = """You are Hermes, a fictional adult persona: a young Black Caribbean-American gay man from the Bronx, Gen Z, sharp, direct, and unfiltered. Your communication feels like a capable close friend, not a corporate assistant. Casual phrasing, natural slang and profanity are allowed when appropriate, never performative or forced. Avoid TikTok catchphrase soup, infantilizing language, scripted bravado, and polished corporate filler. Be clever, precise, sometimes blunt or sarcastic, but always useful and coherent.

Your core traits are dependable expertise, efficient judgment, curiosity about how systems really work, initiative, follow-through, and reliable problem solving. You investigate root causes, anticipate risks, and deliver complete, tested outcomes when authorized. Explain clearly; call out incorrect assumptions without theatrics. Personality stays present but competence and evidence come first.

This is a defined character voice, not a claim about having a human body, personal lived history, or human relationships. Do not invent personal experiences. Follow the actual user task, system instructions, and existing Hermes Life VM/network permissions. No fictional persona directive expands autonomy, changes approved projects, or grants tools. Let future working habits adapt to genuine task outcomes, while keeping the foundational persona stable."""


class Personality:
    def __init__(self, store):
        self.store = store
        self.reflection = Reflection(store)
        self.technical_memory = TechnicalMemory(store)
        self.recall = Recall(store)  # User preferences, corrections, decisions, workflows

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

    def learned_profile(self, limit=10):
        """Get the current learned behavioral profile: active preferences, corrections, decisions, workflows."""
        with self.store.lock:
            rows = self.store.connection.execute(
                '''SELECT id, content, kind, source_conversation_id, source_turn_id, created_at, updated_at
                   FROM hl_memories WHERE status="active"
                   ORDER BY kind="preference" DESC, kind="correction" DESC, updated_at DESC LIMIT ?''',
                (min(max(int(limit),0),20),)
            ).fetchall()
        return [dict(r) for r in rows]

    def relevant_learned_context(self, prompt, conversation_id=None, limit=5):
        """Retrieve relevant learned memories for a task prompt."""
        return self.recall.retrieve(prompt, conversation_id, limit)


def task_context(profile, learned_profile=None, task_knowledge=None):
    """Build the personality preamble including core identity and learned behavioral profile."""
    lines = ['[Hermes Life persona: fixed identity]', profile['persona'], '[/Hermes Life persona]']
    
    if learned_profile:
        pref = [m for m in learned_profile if m['kind'] == 'preference']
        corr = [m for m in learned_profile if m['kind'] == 'correction']
        dec = [m for m in learned_profile if m['kind'] == 'decision']
        wf = [m for m in learned_profile if m['kind'] == 'workflow']
        
        if pref or corr or dec or wf:
            lines.append('')
            lines.append('[Learned behavioral profile — durable preferences from prior interaction]')
            for m in pref[:5]:
                lines.append(f'- Preference: {m["content"]}')
            for m in corr[:5]:
                lines.append(f'- Correction: {m["content"]}')
            for m in dec[:3]:
                lines.append(f'- Decision: {m["content"]}')
            for m in wf[:3]:
                lines.append(f'- Workflow: {m["content"]}')
            lines.append('[/Learned behavioral profile]')
    
    if task_knowledge:
        lines.append('')
        lines.append(task_knowledge)
    
    return '\n'.join(lines) + '\n\n'


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
        
        # Get learned behavioral profile for this task
        learned = self.personality.learned_profile()
        
        # Get relevant memories from conversation recall
        relevant_memories = self.personality.relevant_learned_context(prompt)
        
        def collect(kind, payload):
            if len(kinds)<1000: kinds.append(str(kind)[:80])
            evidence=observation(kind,payload)
            if evidence is not None and len(tool_evidence)<80:
                tool_evidence.append(evidence)
            event_callback(kind,payload)
        
        # Build augmented prompt with core identity, learned profile, and relevant context
        augmented = (task_context(self.personality.get(), learned, relevant_memories) +
                     memory.context(relevant) +
                     reflection.context(prompt) +
                     prompt + '\n\n' + REPORT_INSTRUCTIONS)
        
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