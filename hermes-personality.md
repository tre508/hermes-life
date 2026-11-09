# HL-PERS-001 — Adaptive Personality & Persistent Experience Integration

**Severity:** Medium — Functional and architectural gap  
**Category:** Personality, Memory, Learning & Architecture  
**Status:** Implemented and verified end-to-end — the personality findings (PSP-01…PSP-07, UI-01) are closed; the only outstanding §9 deliverable is a standalone context-assembly architecture note (the order itself is documented in `personality.compose_prompt`)  
**Specification references:** HL-ARCH-002, HL-ARCH-004, HL-MEM-001  
**Primary files:** `hermes_life/personality.py`, personality adapter, conversation memory, reflection, Obsidian memory, and project knowledge components.

## 1. Problem

Hermes Life is intended to function as a persistent, adaptive personal AI assistant that learns from conversations, user feedback, corrections, completed tasks, and previous experiences.

The current implementation contains personality, memory, and reflection components, but these have not been verified to operate as a unified learning system.

A specific example exists in `hermes_life/personality.py`:

```python
def task_context(profile, learned_profile=None, task_knowledge=None):
    """Build the personality preamble including core identity and learned behavioral profile."""
```

An earlier revision of this specification quoted this function with a `history=()` parameter that was
accepted but never used. That signature no longer exists: the preamble now renders the fixed core
identity **and** the learned behavioral profile, and both parameters are used. The defect it pointed at was
never the unused parameter itself — it is that learned information was not shown to consistently influence
behaviour.

**Current standing** (tracked in `personalityaudit.md`): the end-to-end loop is now implemented and verified
(extraction → consolidation → retrieval → prompt assembly → execution → post-task learning); every context source
is composed in one documented order; and "experience" is a terminal task outcome, recorded once per completed,
failed or cancelled task. The unused-parameter example cited here is closed.

Although `PersonalityAdapter.run()` injects memory and reflection context separately, this does not establish that learned information consistently influences Hermes' behavioral profile or persists as an evolving personality.

**The underlying issue is incomplete integration between personality, experience, memory retrieval, and behavioral adaptation—not merely an unused function parameter.**

## 2. Intended Behavior

Hermes must maintain a consistent identity while progressively adapting how it communicates, reasons, investigates problems, and collaborates with the user.

Its personality should consist of three distinct layers:

| Layer | Purpose | Persistence |
|---|---|---|
| **Core Identity** | Hermes' identity, purpose, operating principles, and relationship with its user | Stable unless explicitly changed |
| **Learned Behavioral Profile** | User preferences, communication style, working habits, corrections, and experience-derived improvements | Persistent and evolving |
| **Task-Specific Context** | Relevant memories, conversations, previous outcomes, and project knowledge | Dynamically retrieved for each task |

The learned profile must evolve through evidence-backed memory consolidation, not through unrestricted rewriting of Hermes' core identity.

### Example

If the user repeatedly corrects Hermes for providing generic troubleshooting commands, Hermes should learn to prioritize root-cause analysis and targeted diagnostics.

That preference should influence future troubleshooting sessions, including new conversations, without requiring the user to repeat the instruction.

It should not alter unrelated behavior or permanently change Hermes' core identity.

## 3. Required Learning Architecture

The system must implement a continuous learning loop:

**Experience → Extraction → Validation → Consolidation → Persistence → Retrieval → Behavioral Adaptation → Execution → Reflection**

### Experience collection

Capture meaningful information from:

- Conversations and explicit user preferences.
- User corrections and feedback.
- Task execution results and failures.
- Successful problem-solving approaches.
- Project-specific decisions and technical lessons.
- Previous reflections and validated outcomes.

### Memory processing

Extract candidate memories, validate their supporting evidence, identify duplicates or contradictions, and consolidate relevant durable information.

Persist accepted memories and behavioral changes in SQLite and the configured Obsidian vault.

### Context retrieval

Before executing a task, retrieve only information relevant to that task, including applicable preferences, previous lessons, conversation context, and project knowledge.

Do not inject complete conversation histories or the entire vault into every prompt.

### Personality construction

Assemble the effective personality context from:

1. Stable core identity.
2. Current learned behavioral profile.
3. Relevant task-specific experience and memory.

The resulting context must influence Hermes' execution without duplicating or contradicting instructions already supplied by other context builders.

### Post-task learning

After meaningful conversations or completed tasks, evaluate whether new information should update Hermes' learned profile.

Persist validated changes, link them to supporting evidence, and make them available for subsequent tasks.

## 4. Existing Components to Reuse

Inspect and integrate the existing architecture before implementing new storage or retrieval mechanisms.

| Component | Existing responsibility |
|---|---|
| `Personality.get()` | Retrieve the personality profile |
| `task_context()` | Construct the persona preamble |
| `PersonalityAdapter.run()` | Inject personality, memory, and reflection context |
| `ConversationMemory` | Store and retrieve conversational history |
| `VaultMemory` | Extract, retrieve, and persist curated Obsidian memories |
| `Reflection` | Record lessons and outcomes from previous execution |
| `ProjectKnowledge` | Supply project specifications and reference material |

Determine how these components currently exchange information, which functions are already operational, and where the learning lifecycle is incomplete.

**Extend existing mechanisms rather than creating parallel personality or memory systems.**

## 5. Implementation Requirements

### A. Unified personality context

Replace the ambiguous `history` parameter with an explicit, structured personality-context interface.

The context should distinguish stable identity from learned behavior and transient task information.

A possible interface is:

```python
@dataclass
class PersonaContext:
    preferences: list[str]
    relevant_memories: list[str]
    past_lessons: list[str]
    task_context: str
```

This is an illustrative contract, not a requirement to introduce a duplicate data model.

Reuse existing context structures where they adequately support the required behavior.

### B. Persistent behavioral profile

Maintain a durable representation of learned behavioral preferences.

Each learned attribute must retain its source, supporting evidence, creation/update timestamps, and current validity.

Behavioral changes must survive application restarts and remain available across conversations.

### C. Relevant memory retrieval

Integrate conversation memory, Obsidian knowledge, reflections, and project context through a coherent retrieval process.

Prioritize relevance, reliability, and applicable user preferences.

Avoid redundant or conflicting context injection.

### D. Learning from feedback

Recognize explicit corrections, recurring preferences, and validated task lessons.

Distinguish temporary task instructions from durable behavioral preferences.

Do not treat every conversation statement or model-generated assumption as a permanent personality change.

### E. Contradiction handling

Detect conflicting or outdated preferences.

Support updating, superseding, or invalidating learned behavior while preserving the history of changes.

Explicit user corrections should take precedence over conflicting inferred preferences.

### F. Traceability and user control

Provide a way to inspect Hermes' current learned behavioral profile.

For each learned preference, expose its supporting evidence and origin.

Allow the user to correct or invalidate inaccurate information and ensure those corrections affect future behavior.

### G. Obsidian integration

Use the existing configured Obsidian vault as part of the persistent knowledge system.

Behavioral memories and meaningful experience-derived lessons should be represented consistently across the existing SQLite and Obsidian mechanisms.

Prevent duplicate entries, contradictory mirrors, and obsolete records from being treated as current knowledge.

### H. Reflection and continuous improvement

After task completion, evaluate relevant outcomes and corrections.

Store reusable lessons when evidence supports them.

Future similar tasks should retrieve applicable lessons and demonstrate improved behavior without requiring repeated user guidance.

## 6. Implementation Boundaries

- Preserve the stable core identity unless an explicit authorized change is made.
- Do not introduce a second independent memory system.
- Do not inject the complete conversation or vault into every task.
- Do not automatically accept unsupported inferred preferences.
- Do not confuse successful memory storage with demonstrated behavioral learning.
- Do not duplicate memory/reflection injection across adapters.
- Preserve existing conversation, autonomy, project knowledge, and task-execution functionality.

## 7. Acceptance Criteria

The implementation is complete only when the following behaviors are verified.

1. **Persistent learning:** A user provides a durable preference in one conversation. Hermes extracts, validates, stores, and applies it in a later conversation.

2. **Behavioral adaptation:** A correction to Hermes' troubleshooting approach measurably changes subsequent relevant responses.

3. **Stable identity:** Learned preferences can evolve without modifying the underlying core persona.

4. **Task relevance:** Relevant memories are retrieved when applicable, while unrelated memories are excluded.

5. **Cross-session persistence:** Learned behavior survives backend restarts and new conversations.

6. **Contradiction resolution:** A newer explicit correction supersedes an older conflicting preference.

7. **Obsidian persistence:** Learned behavioral changes and their provenance are recorded through the existing Obsidian integration.

8. **Traceability:** The user can inspect what Hermes learned, why it learned it, and which evidence supports it.

9. **User correction:** Correcting or invalidating an inaccurate memory changes future behavior without leaving conflicting active instructions.

10. **Compatibility:** Existing task execution, conversation context, reflection, and project knowledge systems continue operating correctly.

11. **No redundant context:** A task does not receive duplicated or contradictory memory and personality instructions from separate adapters.

12. **End-to-end verification:** Tests cover memory extraction, consolidation, retrieval, prompt assembly, execution, and post-task learning—not merely individual function behavior.

## 8. Development Procedure

1. Inspect the actual personality, conversation memory, reflection, and Obsidian implementations.
2. Trace the full information flow from conversation or task completion through memory persistence and subsequent retrieval.
3. Identify existing working capabilities, missing connections, duplicate responsibilities, and unverified behavior.
4. Design the smallest coherent integration using existing architecture.
5. Implement the unified personality-context pipeline and persistent behavioral profile.
6. Integrate validated learning and contradiction handling.
7. Add provenance and user-facing inspection/correction capabilities.
8. Test behavior across multiple conversations, tasks, and backend restarts.
9. Document the implemented interfaces, remaining limitations, and supporting test evidence.

## 9. Completion Requirements

The deliverable must include:

- Implemented source changes.
- Required database migrations, if any.
- Automated regression and integration tests.
- Evidence that learned preferences influence subsequent behavior.
- Verification of SQLite and Obsidian persistence.
- Documentation of the final context-assembly architecture.
- A report distinguishing completed functionality from remaining limitations.

**Definition of done:** Hermes demonstrably learns from relevant experience, maintains a persistent and correctable behavioral profile, retrieves that learning for future tasks, and applies it consistently while preserving its core identity.

Removing a single unused parameter alone does not satisfy this development goal.
