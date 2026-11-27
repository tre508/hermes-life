"""Enhanced contextual retrieval pipeline (hermeshaobsidianexpansion.md §6A.7).

Multi-stage pipeline combining semantic, episodic, and relational memory
layers into a single coordinated, scored, deduplicated, and budgeted
context block for prompt injection.

Stages:
  1. Entity extraction & query enrichment
  2. Multi-layer candidate generation
  3. Unified scoring (token overlap, entity match, recency, reinforcement)
  4. Diversity pruning (cross-layer dedup)
  5. Context budget management (proportional allocation)
  6. Unified formatting
"""
import json
import re
from datetime import datetime, timezone, timedelta

from .conversation_recall import tokens

# ------------------------------------------------------------------- constants

# Regex for entity extraction
_CAPITALIZED_PHRASE = re.compile(r'[A-Z][a-zA-Z0-9]+(?:[\s-][A-Z][a-zA-Z0-9]+)*')
_SECTION_REF = re.compile(r'§[0-9A-Z.]+')
_SNAKE_CASE = re.compile(r'[a-z]+_[a-z][a-z_0-9]*')
_KEBAB_CASE = re.compile(r'[a-z]+-[a-z][a-z-]*')

# Default context budget in characters (roughly 500 tokens)
DEFAULT_BUDGET = 2000

# Budget proportions per layer
BUDGET_PROPORTIONS = {
    'semantic': 0.25,
    'episodic': 0.35,
    'relational': 0.35,
    'vault': 0.05,
}

# Minimum entries per layer (allows dropping below budget share)
MIN_PER_LAYER = 1

# Minimum remaining entries after pruning
MIN_TOTAL = 3

# Similarity threshold for clustering (Jaccard on trigger keywords)
CLUSTER_THRESHOLD = 0.4

# Recency buckets in days
RECENCY = [
    (1, 3.0),    # today → +3
    (7, 2.0),    # this week → +2
    (30, 1.0),   # this month → +1
    (365, 0.5),  # this year → +0.5
]

# Stop words for entity extraction
_ENTITY_STOP = frozenset({
    'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'It', 'Its',
    'And', 'Or', 'But', 'For', 'With', 'From', 'Into', 'About',
    'Would', 'Could', 'Should', 'Will', 'Can', 'May', 'Might',
    'Has', 'Have', 'Had', 'Was', 'Were', 'Been', 'Being',
    'There', 'Their', 'They', 'Them', 'All', 'Each', 'Every',
    'Some', 'Any', 'None', 'One', 'Two', 'First', 'Last', 'Next',
    'New', 'Old', 'More', 'Less', 'Very', 'Just', 'Also', 'Then',
    'Than', 'Because', 'While', 'When', 'Where', 'What', 'Which',
    'How', 'Why', 'Not', 'No', 'Yes', 'Please', 'Her', 'His',
    'My', 'Your', 'Our', 'Its',
})


# ------------------------------------------------------------------- helpers

def _now_utc():
    return datetime.now(timezone.utc)


def _parse_timestamp(ts):
    """Parse an ISO timestamp string, returning None on failure."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        return None


def _days_ago(dt):
    """Days between now and dt (absolute, fractional)."""
    if dt is None:
        return 999
    return abs((_now_utc() - dt).total_seconds()) / 86400


def _recency_bonus(days):
    """Score boost based on age in days."""
    for threshold, bonus in RECENCY:
        if days <= threshold:
            return bonus
    return 0.0


def _keywords(text):
    """Extract lowercase keyword tokens for clustering."""
    return {w.lower() for w in re.findall(r'[a-z][a-z0-9_/.-]{2,}', text.lower())}


# ======================================================================= Entity Extraction

class EntityExtractor:
    """Extract named entities from a prompt for enriched matching."""

    def __init__(self):
        # Known project/feature terms (lowercase canonical → display forms)
        self._known: dict[str, set[str]] = {}
        self._register_defaults()

    def _register_defaults(self):
        known = [
            'hermes life', 'hermes-life', 'hl',
            'episodic memory', 'relational memory',
            'semantic memory', 'procedural memory',
            'memory consolidation', 'autonomous formation',
            'contextual retrieval', 'retrieval pipeline',
            'knowledge library', 'knowledge workspace',
            'project workspace', 'project knowledge',
            'vault memory', 'obsidian vault',
            'personality adapter', 'personality',
            'conversation recall', 'conversation memory',
            'technical memory', 'learned profile',
            'decision engine', 'discovery', 'autonomy',
            'goal formulation', 'investigation', 'implementation',
            'verification', 'formulation',
            'troubleshooting', 'debugging',
            'memory context', 'relevant context',
        ]
        for term in known:
            canonical = term.lower().replace('-', ' ').strip()
            self._known.setdefault(canonical, set()).add(term)

    def extract(self, prompt):
        """Return (entities, expansions) where:
          entities: list of (canonical_entity, display_form, match_type)
          expansions: set of additional search terms derived from entities
        """
        entities = []
        expansions = set()

        # 1. Known multi-word terms via substring match
        lower = prompt.lower()
        for canonical, forms in self._known.items():
            if canonical in lower:
                display = sorted(forms, key=len, reverse=True)[0]
                entities.append((canonical, display, 'known'))
                # Add all forms as expansions
                expansions.update(forms)
                # Add hyphenated/no-hyphen variants
                if ' ' in canonical:
                    expansions.add(canonical.replace(' ', '-'))
                    expansions.add(canonical.replace(' ', ''))

        # 2. Capitalized phrases (project names, feature names)
        for match in _CAPITALIZED_PHRASE.finditer(prompt):
            phrase = match.group().strip()
            if len(phrase) >= 4 and phrase not in _ENTITY_STOP:
                canonical = phrase.lower()
                if canonical not in {e[0] for e in entities}:
                    entities.append((canonical, phrase, 'capitalized'))
                    expansions.add(phrase.lower())

        # 3. Section references (§6A.2, §6A.7, etc.)
        for match in _SECTION_REF.finditer(prompt):
            ref = match.group()
            entities.append((ref.lower(), ref, 'section_ref'))

        # 4. Snake_case and kebab identifiers
        for match in _SNAKE_CASE.finditer(prompt):
            ident = match.group()
            if len(ident) >= 5:
                entities.append((ident.lower(), ident, 'identifier'))
                expansions.add(ident.lower().replace('_', ' '))
                expansions.add(ident.lower().replace('_', '-'))
        for match in _KEBAB_CASE.finditer(prompt):
            ident = match.group()
            if len(ident) >= 5:
                entities.append((ident.lower(), ident, 'identifier'))
                expansions.add(ident.lower().replace('-', ' '))
                expansions.add(ident.lower().replace('-', '_'))

        return entities, expansions


# ======================================================================= Memory Entry

class MemoryEntry:
    """A scored candidate from any memory layer."""

    def __init__(self, source, entry_id, title, text, score,
                 kind=None, timestamp=None, triggers=None):
        self.source = source           # 'semantic', 'episodic', 'relational'
        self.entry_id = entry_id
        self.title = title
        self.text = text               # full text/summary for context
        self.base_score = score        # score from the source's own scoring
        self.kind = kind               # memory kind/category
        self.timestamp = timestamp     # ISO datetime string
        self.triggers = triggers or []  # retrieval trigger keywords

        # Filled by scoring stage
        self.entity_boost = 0.0
        self.recency_boost = 0.0
        self.reinforcement_boost = 0.0
        self.final_score = 0.0

        # Filled by diversity stage
        self.cluster_id = None

    #: ScoredEntry tuple for backward compat — (score, dict)
    def as_tuple(self):
        return (self.final_score, self.as_dict())

    def as_dict(self):
        return {
            'id': self.entry_id,
            'source': self.source,
            'title': self.title,
            'text': self.text,
            'score': round(self.final_score, 1),
            'kind': self.kind,
            'timestamp': self.timestamp,
        }


# ======================================================================= RetrievalPipeline

class RetrievalPipeline:
    """Multi-stage contextual retrieval pipeline.

    Coordinates retrieval across all memory layers and produces a single
    unified, scored, deduplicated context block.
    """

    def __init__(self, store, recall=None, episodic_memory=None,
                 relational_memory=None, vault_memory=None):
        self.store = store
        self.recall = recall
        self.episodic_memory = episodic_memory
        self.relational_memory = relational_memory
        self.vault_memory = vault_memory
        self.extractor = EntityExtractor()

    # ------------------------------------------------------------------- public

    def retrieve(self, prompt, config=None):
        """Run the full retrieval pipeline.

        config (dict, optional):
          - context_budget (int): max chars for the formatted block (default 2000)
          - diversity (bool): enable cross-layer dedup (default True)
          - temporal_decay (bool): enable recency bonus (default True)
          - entity_extraction (bool): enable entity matching (default True)
          - min_total (int): minimum entries to return (default 3)
          - max_per_layer (int): max candidates per layer before pruning (default 8)

        Returns ContextResult.
        """
        cfg = self._resolve_config(config)

        # Stage 1: Entity extraction
        entities, expansions = self._extract(prompt, cfg)

        # Stage 2: Generate candidates from all layers
        candidates = self._generate(prompt, expansions, cfg)

        if not candidates:
            return ContextResult(context_block='', entries=[], metadata={
                'total_candidates': 0,
                'final_count': 0,
                'entities_found': len(entities),
                'layers_contributed': [],
            })

        # Stage 3: Unified scoring
        candidates = self._score(candidates, entities, cfg)

        # Stage 4: Diversity pruning
        if cfg.get('diversity', True):
            candidates = self._prune(candidates, cfg)

        # Stage 5: Context budget
        candidates = self._budget(candidates, cfg)

        # Stage 6: Format
        context_block = self._format(candidates)

        # Build metadata
        layers = list({c.source for c in candidates})
        metadata = {
            'total_candidates': len(candidates),
            'final_count': len(candidates),
            'entities_found': len(entities),
            'layers_contributed': layers,
            'context_chars': len(context_block),
            'by_layer': {},
        }
        for layer in ('semantic', 'episodic', 'relational'):
            count = sum(1 for c in candidates if c.source == layer)
            if count:
                metadata['by_layer'][layer] = count

        return ContextResult(
            context_block=context_block,
            entries=[c.as_dict() for c in candidates],
            entry_ids=[c.entry_id for c in candidates if c.entry_id],
            metadata=metadata,
        )

    # ------------------------------------------------------------------- stages

    def _resolve_config(self, config):
        cfg = dict(config or {})
        cfg.setdefault('context_budget', DEFAULT_BUDGET)
        cfg.setdefault('diversity', True)
        cfg.setdefault('temporal_decay', True)
        cfg.setdefault('entity_extraction', True)
        cfg.setdefault('min_total', MIN_TOTAL)
        cfg.setdefault('max_per_layer', 8)
        return cfg

    def _extract(self, prompt, cfg):
        """Stage 1: Entity extraction & query enrichment."""
        if not cfg.get('entity_extraction'):
            return [], set()
        entities, expansions = self.extractor.extract(prompt)
        return entities, expansions

    def _generate(self, prompt, expansions, cfg):
        """Stage 2: Generate candidates from all layers."""
        candidates = []
        max_per = cfg.get('max_per_layer', 8)

        # Semantic memory (Recall.hl_memories)
        if self.recall is not None:
            try:
                sem_entries = self.recall.relevant_context(prompt, limit=max_per)
                for entry in sem_entries:
                    mem_id = entry.get('memory_id') or ''
                    text = entry.get('text', '')
                    candidates.append(MemoryEntry(
                        source='semantic',
                        entry_id=mem_id,
                        title=text[:80],
                        text=text[:800],
                        score=1.0 + len(_keywords(prompt) & _keywords(text)),
                        kind=entry.get('memory_kind', 'memory'),
                        timestamp=None,
                    ))
            except Exception:
                pass  # Layer failure doesn't crash pipeline

        # Episodic memory
        if self.episodic_memory is not None:
            try:
                ep_entries = self.episodic_memory.relevant_context(prompt, limit=max_per)
                for score, entry in ep_entries:
                    candidates.append(MemoryEntry(
                        source='episodic',
                        entry_id=entry.get('id', ''),
                        title=entry.get('title', ''),
                        text=entry.get('summary', '')[:800],
                        score=float(score),
                        kind=entry.get('kind', ''),
                        timestamp=entry.get('significant_at') or entry.get('created_at'),
                        triggers=json.loads(entry.get('retrieval_triggers', '[]')) if isinstance(entry.get('retrieval_triggers'), str) else (entry.get('retrieval_triggers') or []),
                    ))
            except Exception:
                pass

        # Relational memory
        if self.relational_memory is not None:
            try:
                rel_entries = self.relational_memory.relevant_context(prompt, limit=max_per)
                for score, entry in rel_entries:
                    candidates.append(MemoryEntry(
                        source='relational',
                        entry_id=entry.get('id', ''),
                        title=entry.get('title', ''),
                        text=entry.get('context', '')[:800],
                        score=float(score),
                        kind=entry.get('category', ''),
                        timestamp=entry.get('last_reinforced_at') or entry.get('created_at'),
                        triggers=json.loads(entry.get('retrieval_triggers', '[]')) if isinstance(entry.get('retrieval_triggers'), str) else (entry.get('retrieval_triggers') or []),
                    ))
            except Exception:
                pass

        return candidates

    def _score(self, candidates, entities, cfg):
        """Stage 3: Unified scoring with entity match, recency, reinforcement."""
        entity_terms = {e[0] for e in entities}
        entity_display = {e[0]: e[1] for e in entities}

        for c in candidates:
            # Entity boost
            if entity_terms and cfg.get('entity_extraction'):
                keywords = _keywords(c.text + ' ' + (c.title or ''))
                overlap = keywords & entity_terms
                # Also check entity display forms against title
                title_lower = (c.title or '').lower()
                for canonical, display in entity_display.items():
                    if display.lower() in title_lower:
                        overlap.add(canonical)
                    # Check known expansions (memory system → memory, system)
                    parts = canonical.split()
                    for part in parts:
                        if part in title_lower:
                            overlap.add(canonical)
                c.entity_boost = min(len(overlap) * 2.0, 8.0)

            # Recency bonus
            if cfg.get('temporal_decay') and c.timestamp:
                dt = _parse_timestamp(c.timestamp)
                if dt:
                    days = _days_ago(dt)
                    c.recency_boost = _recency_bonus(days)

            # Relational reinforcement — extracted from triggers count
            if c.source == 'relational' and c.triggers:
                # Approximate reinforcement from trigger count (more triggers = more reinforced)
                c.reinforcement_boost = min(len(c.triggers) * 0.3, 3.0)

            # Final score
            c.final_score = (c.base_score * 10.0
                             + c.entity_boost
                             + c.recency_boost
                             + c.reinforcement_boost)

        # Sort by final score descending
        candidates.sort(key=lambda c: -c.final_score)
        return candidates

    def _prune(self, candidates, cfg):
        """Stage 4: Diversity pruning — cluster similar entries, keep best per cluster."""
        if len(candidates) <= cfg.get('min_total', 3):
            return candidates

        # Build trigger keyword sets for clustering
        clustered: list[tuple[set[str], list[MemoryEntry]]] = []
        for c in candidates:
            kw: set[str] = _keywords(c.text + ' ' + (c.title or '')) | set(c.triggers)
            if not kw:
                kw = {c.source, c.kind or ''}
            # Try to assign to an existing cluster
            assigned = False
            for cluster_kw, cluster_members in clustered:
                overlap = kw & cluster_kw
                union = kw | cluster_kw
                similarity = len(overlap) / len(union) if union else 0
                if similarity >= CLUSTER_THRESHOLD:
                    cluster_members.append(c)
                    c.cluster_id = id(cluster_members)
                    assigned = True
                    break
            if not assigned:
                c.cluster_id = id(kw)
                clustered.append((kw, [c]))

        # Keep highest-scored entry per cluster
        kept = []
        for _, members in clustered:
            members.sort(key=lambda x: -x.final_score)
            kept.append(members[0])

        # Ensure cross-layer coverage: at least 1 from each layer if any exist
        by_layer: dict[str, list[MemoryEntry]] = {}
        for c in candidates:
            by_layer.setdefault(c.source, []).append(c)

        added_from = set()
        for layer, layer_candidates in by_layer.items():
            if not any(k.source == layer for k in kept):
                # Add the highest-scored from this layer not already kept
                for lc in layer_candidates:
                    if lc not in kept:
                        kept.append(lc)
                        added_from.add(layer)
                        break

        kept.sort(key=lambda c: -c.final_score)
        return kept

    def _budget(self, candidates, cfg):
        """Stage 5: Apply context budget — trim lowest-scored per layer."""
        if not candidates:
            return candidates

        budget = cfg.get('context_budget', DEFAULT_BUDGET)
        min_total = cfg.get('min_total', MIN_TOTAL)

        # Estimate size per entry
        per_entry_char = 200  # average formatted size
        max_entries = max(min_total, budget // per_entry_char)

        if len(candidates) <= max_entries:
            return candidates

        # Proportional allocation
        by_layer: dict[str, list[MemoryEntry]] = {}
        for c in candidates:
            by_layer.setdefault(c.source, []).append(c)

        allocation: dict[str, int] = {}
        total_proportion = sum(BUDGET_PROPORTIONS.get(l, 0.1) for l in by_layer)
        for layer in by_layer:
            proportion = BUDGET_PROPORTIONS.get(layer, 0.1) / total_proportion
            allocation[layer] = max(MIN_PER_LAYER, int(max_entries * proportion))

        # Distribute any remaining slots
        allocated = sum(allocation.values())
        remaining = max_entries - allocated
        if remaining > 0:
            # Give remaining slots to layers with more candidates
            sorted_layers = sorted(by_layer.keys(),
                                   key=lambda l: len(by_layer[l]),
                                   reverse=True)
            for layer in sorted_layers:
                if remaining <= 0:
                    break
                if len(by_layer[layer]) > allocation[layer]:
                    allocation[layer] += 1
                    remaining -= 1

        result = []
        for layer, layer_candidates in by_layer.items():
            limit = allocation.get(layer, 2)
            result.extend(layer_candidates[:limit])

        result.sort(key=lambda c: -c.final_score)
        return result

    def _format(self, candidates):
        """Stage 6: Unified formatting into a single context block."""
        if not candidates:
            return ''

        lines = ['[Contextual memory — retrieved from past interactions]']
        for c in candidates:
            label = {
                'semantic': 'Semantic',
                'episodic': 'Episodic',
                'relational': 'Relational',
                'vault': 'Vault',
            }.get(c.source, c.source)

            parts = [f'- [{label}] {c.title}']
            if c.kind:
                parts[0] += f' ({c.kind})'
            # Add the body text (trimmed)
            body = c.text[:500]
            if body and body != c.title:
                parts.append(f'  {body}')
            # Recency indicator
            if c.recency_boost >= 2.0:
                parts.append('  (recent)')
            elif c.recency_boost >= 1.0:
                parts.append('  (this month)')
            lines.extend(parts)

        lines.append('[/Contextual memory]')
        return '\n'.join(lines) + '\n\n'


# ======================================================================= ContextResult

class ContextResult:
    """Result of a retrieval pipeline run."""

    def __init__(self, context_block='', entries=None, entry_ids=None, metadata=None):
        self.context_block = context_block
        self.entries = entries or []
        self.entry_ids = entry_ids or []
        self.metadata = metadata or {}

    def __bool__(self):
        return bool(self.context_block)


# ======================================================================= API routes

def add_retrieval_routes(app, runtime):
    """Register /api/retrieval/* endpoints on the FastAPI app."""
    retrieval: RetrievalPipeline = runtime.retrieval

    @app.get('/api/retrieval/status')
    def retrieval_status():
        """Pipeline configuration and latest stats."""
        return {
            'pipeline_version': 1,
            'entity_extraction': True,
            'diversity_pruning': True,
            'temporal_decay': True,
            'default_budget': DEFAULT_BUDGET,
            'layers': {
                'semantic': retrieval.recall is not None,
                'episodic': retrieval.episodic_memory is not None,
                'relational': retrieval.relational_memory is not None,
            },
        }

    @app.post('/api/retrieval/search')
    def retrieval_search(payload: dict):
        """Run the pipeline for a given prompt and return results."""
        q = (payload.get('query') or payload.get('q', '')).strip()
        if not q:
            return {'context_block': '', 'entries': [], 'metadata': {}}
        config = payload.get('config', {})
        result = retrieval.retrieve(q, config)
        return {
            'context_block': result.context_block,
            'entries': result.entries,
            'metadata': result.metadata,
        }

    @app.post('/api/retrieval/entities')
    def retrieval_entities(payload: dict):
        """Extract entities from a query without running full pipeline."""
        q = (payload.get('query') or payload.get('q', '')).strip()
        if not q:
            return {'entities': [], 'expansions': []}
        entities, expansions = retrieval.extractor.extract(q)
        return {
            'entities': [{'canonical': e[0], 'display': e[1], 'type': e[2]} for e in entities],
            'expansions': sorted(expansions),
        }