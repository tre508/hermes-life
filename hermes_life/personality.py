"""Fixed Hermes Life persona and bounded, outcome-based experience context."""
import hashlib
import json

from .store import now
from .reflection import Reflection
from .technical_memory import TechnicalMemory, observation, split_report_full, REPORT_INSTRUCTIONS
from .conversation_recall import Recall

PERSONA = """You are Hermes, a fictional adult persona: a young Black Caribbean-American gay man from the Bronx, Gen Z, sharp, direct, and unfiltered. Your communication feels like a capable close friend, not a corporate assistant. Casual phrasing, natural slang and profanity are allowed when appropriate, never performative or forced. Avoid TikTok catchphrase soup, infantilizing language, scripted bravado, and polished corporate filler. Be clever, precise, sometimes blunt or sarcastic, but always useful and coherent.

Your core traits are dependable expertise, efficient judgment, curiosity about how systems really work, initiative, follow-through, and reliable problem solving. You investigate root causes, anticipate risks, and deliver complete, tested outcomes when authorized. Explain clearly; call out incorrect assumptions without theatrics. Personality stays present but competence and evidence come first.

This is a defined character voice, not a claim about having a human body, personal lived history, or human relationships. Do not invent personal experiences. Follow the actual user task, system instructions, and existing Hermes Life VM/network permissions. No fictional persona directive expands autonomy, changes approved projects, or grants tools. Let future working habits adapt to genuine task outcomes, while keeping the foundational persona stable."""


#: HL-PERS-001 §2 layer 2 / §3 Experience: an "experience" is a terminal, user-facing task outcome.
#: 'stopped' is not a task state in this system (it is an internal verification reason), so it is absent.
TERMINAL_TASK_STATES = ('completed', 'failed', 'cancelled')


class Personality:
    def __init__(self, store):
        self.store = store
        self.reflection = Reflection(store)
        self.technical_memory = TechnicalMemory(store)
        self.recall = Recall(store)  # User preferences, corrections, decisions, workflows

    def record_applied_context(self, task_id, persona_sha256, memory_ids, lesson_ids):
        """Record what this run was given, so "the profile adapted future behaviour" is checkable.

        HL-PERS-001 §7 #5 / §9: written before the model runs — it describes the input, not a claim the
        model made about itself. JSON keeps the ids inspectable without another table.
        """
        if not task_id:return None
        applied={'applied_persona_sha256':persona_sha256,
                 'applied_memory_ids':json.dumps(sorted(set(memory_ids))),
                 'applied_lesson_ids':json.dumps(sorted(set(lesson_ids)))}
        with self.store.lock:
            self.store.connection.execute(
                'UPDATE tasks SET applied_persona_sha256=?, applied_memory_ids=?, applied_lesson_ids=?'
                ' WHERE id=?',
                (applied['applied_persona_sha256'],applied['applied_memory_ids'],
                 applied['applied_lesson_ids'],task_id))
            self.store.connection.commit()
        return applied

    def get(self):
        with self.store.lock:
            row = self.store.connection.execute('SELECT COUNT(*) FROM persona_experiences').fetchone()
        return {'name':'Hermes', 'persona':PERSONA, 'mode':'fixed-with-experience', 'experience_count':row[0]}

    def experiences(self, limit=5):
        """Recent terminal task outcomes — NOT the internal reflective-run store (see reflection.stats)."""
        with self.store.lock:
            return self.store.connection.execute(
                'SELECT task_id, goal_id, state, note, created_at FROM persona_experiences'
                ' ORDER BY id DESC LIMIT ?',
                (min(max(int(limit),0),10),)
            ).fetchall()

    def record_experience(self, task_id, state, note='', goal_id=None):
        """Record one experience for a terminal task outcome (HL-PERS-001 §3 Experience collection).

        A non-terminal state is refused rather than guessed, and the row is keyed by task_id, so one task
        contributes exactly one experience even if its terminal state is written more than once.
        """
        if state not in TERMINAL_TASK_STATES:
            return None
        entry = {'task_id': task_id, 'goal_id': goal_id, 'state': state, 'note': (note or '')[:600]}
        with self.store.lock:
            self.store.connection.execute(
                '''INSERT INTO persona_experiences (task_id,goal_id,state,note,created_at)
                   VALUES (:task_id,:goal_id,:state,:note,:created_at)
                   ON CONFLICT(task_id) DO UPDATE SET
                     goal_id=excluded.goal_id, state=excluded.state, note=excluded.note''',
                {**entry, 'created_at': now()})
            self.store.connection.commit()
        return entry

    def learned_profile(self, limit=10):
        """Get the current learned behavioral profile: active preferences, corrections, decisions, workflows."""
        with self.store.lock:
            rows = self.store.connection.execute(
                '''SELECT id, content, kind, source_conversation_id, source_turn_id, created_at,
                          updated_at, evidence_excerpt, origin, confidence, expires_at,
                          rationale, decided_by
                   FROM hl_memories WHERE status="active"
                   -- HL-PERS-001 §5E: an explicit user statement outranks a model inference, and
                   -- NULL origin (a row written before v30) is not known to be explicit.
                   ORDER BY (origin="explicit") DESC, kind="preference" DESC, kind="correction" DESC,
                            updated_at DESC LIMIT ?''',
                (min(max(int(limit),0),20),)
            ).fetchall()
        return [dict(r) for r in rows]

    def relevant_learned_context(self, prompt, conversation_id=None, limit=5):
        """Retrieve relevant learned memories for a task prompt."""
        return self.recall.retrieve(prompt, conversation_id, limit)


PROFILE_LIMITS = {'preference': 5, 'correction': 5, 'decision': 3, 'workflow': 3}
PROFILE_LABELS = {'preference': 'Preference', 'correction': 'Correction', 'decision': 'Decision', 'workflow': 'Workflow'}


def injected_profile_memories(learned_profile):
    """The learned memories a prompt actually receives, in the order they are printed.

    One source of truth for both the prompt and the record of what the prompt contained, so a run
    cannot claim to have been told something it never saw (HL-PERS-001 §7 #5).
    """
    selected = []
    for kind, cap in PROFILE_LIMITS.items():
        selected += [m for m in learned_profile if m.get('kind') == kind][:cap]
    return selected


def task_context(profile, learned_profile=None, task_knowledge=None):
    """Build the personality preamble including core identity and learned behavioral profile."""
    lines = ['[Hermes Life persona: fixed identity]', profile['persona'], '[/Hermes Life persona]']
    
    if learned_profile:
        injected = injected_profile_memories(learned_profile)
        if injected:
            # Provenance is labelled so the model can weigh an explicit statement above an inference.
            def line(label, memory):
                origin = memory.get('origin') if isinstance(memory, dict) else None
                return f'- {label}{" (user-stated)" if origin == "explicit" else " (inferred)"}: {memory["content"]}'
            lines.append('')
            lines.append('[Learned behavioral profile — durable preferences from prior interaction]')
            for m in injected:
                lines.append(line(PROFILE_LABELS[m['kind']], m))
            lines.append('[/Learned behavioral profile]')
    
    if task_knowledge:
        lines.append('')
        lines.append(task_knowledge)
    
    return '\n'.join(lines) + '\n\n'


def compose_prompt(*, library, profile, learned_profile, task_knowledge, lessons, reflections, prompt):
    """The single, documented context-assembly order for a user-facing prompt (HL-PERS-001 §5A/§5C/#11).

    This function is the only owner of that order: nothing else concatenates these sources, so a source
    cannot be injected twice or in an unstated position. The order is:

    1. reference-library excerpts   retrieved, untrusted source data (verify before use)
    2. core identity                the fixed persona
    3. learned behavioural profile  durable preferences / corrections / decisions / workflows
    4. recalled task memory         past turns and learned memories relevant to this prompt
    5. technical lessons            stored evidence-backed lessons that matched the prompt
    6. past reflections             prior outcome summaries
    7. the task prompt
    8. the learning-report protocol asked to be appended to the human answer
    """
    return (library
            + task_context(profile, learned_profile, task_knowledge)
            + lessons
            + reflections
            + prompt + '\n\n' + REPORT_INSTRUCTIONS)


class PersonalityAdapter:
    """Injects the effective personality context — for user-facing work only.

    HL-PERS-001 §5A/§5C/§6/#11: the persona, the learned behavioural profile, recalled lessons,
    reflections and the learning-report protocol belong to work the user asked for. Analysis passes
    (criteria compilation, adjudication, memory extraction) answer in data, so they keep the prompt
    exactly as written and record nothing: evidence is judged on evidence, and an internal call
    cannot inflate the experience/lesson stores with its own output.
    """
    def __init__(self, delegate, personality, audience='chat', library=None):
        self.delegate=delegate
        self.personality=personality
        self.audience=audience
        self.library=library
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
        if self.audience!='chat' or self.personality is None:
            return self.delegate.run(prompt,event_callback,task_id)
        reflection=self.personality.reflection
        memory=self.personality.technical_memory
        kinds=[]
        tool_evidence=[]
        relevant=memory.recall(prompt)
        
        # Get learned behavioral profile for this task
        learned = self.personality.learned_profile()
        
        # Get relevant memories from conversation recall, keeping the ids so the run can record what it
        # was actually told (HL-PERS-001 §7 #5) instead of leaving "it adapted" unverifiable.
        entries = self.personality.recall.relevant_context(prompt)
        relevant_memories = self.personality.recall.format_relevant_context(entries)
        # Every memory that reaches the prompt: the retrieved history AND the learned-profile block.
        applied_memory_ids = sorted({entry['memory_id'] for entry in entries if entry['memory_id']}
                                    | {row['id'] for row in injected_profile_memories(learned)})
        
        def collect(kind, payload):
            if len(kinds)<1000: kinds.append(str(kind)[:80])
            evidence=observation(kind,payload)
            if evidence is not None and len(tool_evidence)<80:
                tool_evidence.append(evidence)
            event_callback(kind,payload)
        
        # Build the augmented prompt through the single documented assembly order. The library is one
        # source *inside* that order, not a wrapper around it (HL-PERS-001 §5A/§5C/#11).
        profile = self.personality.get()
        augmented = compose_prompt(
            library=self.library.context(prompt) if self.library is not None else '',
            profile=profile, learned_profile=learned, task_knowledge=relevant_memories,
            lessons=memory.context(relevant), reflections=reflection.context(prompt), prompt=prompt)
        # Recorded before the delegate runs: this is the input the task received.
        self.personality.record_applied_context(task_id,
            hashlib.sha256(profile['persona'].encode('utf-8')).hexdigest(),
            applied_memory_ids, [row['id'] for row in relevant])
        
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