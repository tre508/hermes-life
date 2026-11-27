/** Knowledge Deck Stage A — read-only indexed library browser.
 * Data comes exclusively from existing /api/library/sources and /api/library/search.
 * This module doesn't create study progress, synthesize documents, or execute tasks.
 */
import { onNavigationChange } from './navigation-state.ts';

type Source = {
  id: number; title: string | null; url: string | null; kind: string | null;
  status: string | null; sha256: string | null; revision: string | null;
  indexed_pages: number | null; chunks: number | null;
};
type Match = {
  id: number; source_id: number; title: string | null; url: string | null;
  page: number | null; content: string; score: number | null;
};

const el = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const str = (x: unknown): string => typeof x === 'string' ? x : x == null ? '' : String(x);
const cleanUrl = (input: string | null): string | null => {
  if (!input) return null;
  try { const u = new URL(input, window.location.href); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
};
const make = (tag: string, text = '', cls = ''): HTMLElement => {
  const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n;
};
const safeNumber = (x: unknown): number => Number.isFinite(Number(x)) ? Number(x) : 0;

let sources: Source[] = [];
let matches: Match[] = [];
let selectedId: number | null = null;
let searchText = '';
let searchMode = false;
let initialLoad = false;
let searchGeneration = 0;
let selectedSearchIndex: number | null = null;

async function readJSON(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}
function showStatus(message: string, error = false) {
  const n = el('knowledge-status'); if (!n) return;
  n.textContent = message;
  n.dataset.error = String(error);
}
function displaySource(s: Source) { return str(s.title).trim() || str(s.url).trim() || `Source ${s.id}`; }
function selectSource(id: number, matchId: number | null = null) {
  selectedId = id;
  selectedSearchIndex = matchId;
  renderSources();
  renderDetail();
}
function renderSources() {
  const host = el('knowledge-source-list'); if (!host) return;
  host.replaceChildren();
  const query = searchMode ? '' : searchText.trim().toLowerCase();
  const shown = sources.filter(s => !query || [s.title, s.url, s.kind].some(v => str(v).toLowerCase().includes(query)));
  const count = el('knowledge-source-count'); if (count) count.textContent = `${shown.length} of ${sources.length} sources`;
  if (!shown.length) {
    host.append(make('p', sources.length ? 'No registered sources match the filter.' : 'No library sources have been registered.', 'knowledge-empty'));
    return;
  }
  for (const source of shown) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'knowledge-source';
    button.setAttribute('aria-pressed', String(source.id === selectedId));
    button.append(make('strong', displaySource(source)));
    button.append(make('small', `${str(source.kind) || 'source'} · ${safeNumber(source.indexed_pages)} indexed pages · ${safeNumber(source.chunks)} chunks`));
    button.addEventListener('click', () => selectSource(source.id));
    host.append(button);
  }
}
function renderMatches() {
  const host = el('knowledge-results'); if (!host) return;
  host.replaceChildren();
  const title = el('knowledge-results-title');
  if (title) title.textContent = searchMode ? `Search results (${matches.length})` : 'Indexed content search';
  if (!searchMode) {
    host.append(make('p', 'Search indexed page text to find relevant excerpts and their sources.', 'knowledge-empty'));
    return;
  }
  if (!matches.length) {
    host.append(make('p', 'No indexed excerpts match this query.', 'knowledge-empty'));
    return;
  }
  for (const m of matches) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'knowledge-match';
    b.setAttribute('aria-pressed', String(m.id === selectedSearchIndex));
    const source = sources.find(s => s.id === m.source_id);
    b.append(make('strong', displaySource(source || { id:m.source_id, title:m.title, url:m.url, kind:null, status:null, revision:null, sha256:null, indexed_pages:null, chunks:null })));
    b.append(make('small', `Page ${m.page == null ? '—' : m.page} · matched indexed content`));
    b.append(make('span', str(m.content).slice(0, 430), 'knowledge-excerpt'));
    b.addEventListener('click', () => selectSource(m.source_id, m.id));
    host.append(b);
  }
}
function fact(label: string, value: string): HTMLElement {
  const row = make('div', '', 'knowledge-fact');
  row.append(make('span', label), make('strong', value || '—'));
  return row;
}
function renderDetail() {
  const host = el('knowledge-detail'); if (!host) return;
  host.replaceChildren();
  const source = sources.find(s => s.id === selectedId);
  if (!source) {
    host.append(make('p', selectedId === null ? 'Select a source or search result to inspect its provenance.' : 'This source is not available in the current library list.', 'knowledge-empty'));
    return;
  }
  host.append(make('h3', displaySource(source)));
  host.append(fact('Source ID', String(source.id)));
  host.append(fact('Type', str(source.kind)));
  host.append(fact('Index status', str(source.status)));
  host.append(fact('Indexed pages', String(safeNumber(source.indexed_pages))));
  host.append(fact('Searchable chunks', String(safeNumber(source.chunks))));
  host.append(fact('Revision', str(source.revision)));
  if (source.sha256) host.append(fact('SHA-256', str(source.sha256)));
  const url = cleanUrl(source.url);
  if (url) {
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.className = 'knowledge-source-link'; link.textContent = 'Open source URL ↗'; host.append(link);
  } else if (source.url) host.append(fact('Registered URI', str(source.url)));
  const matching = matches.find(m => m.id === selectedSearchIndex);
  if (matching) {
    host.append(make('h4', `Matched page ${matching.page ?? '—'}`));
    host.append(make('p', str(matching.content), 'knowledge-selected-excerpt'));
  } else {
    host.append(make('p', 'The current API exposes source metadata and indexed search excerpts. It does not expose a full-document reader.', 'knowledge-note'));
  }
}
async function loadSources() {
  showStatus('Loading indexed sources…');
  try {
    const body = await readJSON('/api/library/sources') as { sources?: unknown };
    const list = Array.isArray(body?.sources) ? body.sources : [];
    sources = list.filter((item): item is Source => !!item && typeof item === 'object' && Number.isFinite(Number((item as Source).id)))
      .map(item => ({ ...item, id: Number(item.id) }));
    initialLoad = true;
    if (selectedId !== null && !sources.some(s => s.id === selectedId)) selectedId = null;
    showStatus(`Library loaded · ${sources.length} registered sources`);
    renderSources(); renderMatches(); renderDetail();
  } catch (err) { showStatus(`Unable to load Knowledge Library: ${str(err)}`, true); }
}
async function performSearch() {
  const q = el<HTMLInputElement>('knowledge-query')?.value.trim() || '';
  searchText = q;
  const token = ++searchGeneration;
  if (!q) {
    searchMode = false; matches = []; selectedSearchIndex = null;
    renderSources(); renderMatches(); renderDetail();
    showStatus(`${sources.length} registered sources`);
    return;
  }
  searchMode = true; showStatus(`Searching indexed content for “${q}”…`);
  try {
    const body = await readJSON(`/api/library/search?q=${encodeURIComponent(q)}&limit=10`) as { matches?: unknown };
    if (token !== searchGeneration) return;
    matches = Array.isArray(body?.matches) ? body.matches.filter((x): x is Match => !!x && typeof x === 'object') : [];
    selectedSearchIndex = null;
    showStatus(`${matches.length} indexed excerpt matches (maximum 10 returned)`);
    renderSources(); renderMatches(); renderDetail();
  } catch (err) { if (token === searchGeneration) { matches=[]; renderMatches(); showStatus(`Search unavailable: ${str(err)}`, true); } }
}
// ========================= P4: Obsidian vault via /memory =========================
type VaultHealth = {
  vault?: unknown; reachable?: boolean; writable?: boolean;
  index?: { notes?: number; last_scan?: number | null; fresh?: boolean };
  watcher?: { running?: boolean; poll_seconds?: number; changes_seen?: number; error?: string | null };
  errors?: unknown[];
};
type VaultResult = { note_id: string; title: string; path: string; excerpt: string; kind: string; relevance: number };
type VaultNote = {
  note_id: string; path: string; title: string; body: string; revision: string;
  outgoing_links: string[]; backlinks: string[]; headings: string[]; kind: string;
};
let vaultHealthy: boolean | null = null;
let vaultNoteShown: string | null = null;

async function loadVaultHealth(): Promise<void> {
  const host = el('vault-health'); if (!host) return;
  try {
    const data = await readJSON('/api/memory/health') as VaultHealth;
    const idx = data.index || {};
    const watcher = data.watcher || {};
    vaultHealthy = !!data.reachable;
    host.replaceChildren();
    if (!data.reachable) {
      host.append(make('span', 'Vault unreachable', 'vault-health-bad'));
      host.append(make('small', ` — ${str((data.errors || [])[0]) || 'check the mounted disk'}`));
    } else {
      host.append(make('span', data.writable ? 'Reachable · writable' : 'Reachable · read-only', 'vault-health-ok'));
      host.append(make('small', ` · ${safeNumber(idx.notes)} notes indexed` +
        (idx.last_scan ? ` · watcher ${watcher.running ? 'live' : 'down'} (${safeNumber(watcher.poll_seconds)}s)` : ' · index empty')));
    }
  } catch (err) {
    vaultHealthy = false;
    host.replaceChildren();
    host.append(make('span', 'Memory service unavailable', 'vault-health-bad'));
    host.append(make('small', ` — ${str(err)}`));
  }
}

async function performVaultSearch(): Promise<void> {
  const host = el('vault-results'); if (!host) return;
  const q = el<HTMLInputElement>('vault-query')?.value.trim() || '';
  vaultNoteShown = null;
  if (!q) { host.replaceChildren(); return; }
  if (vaultHealthy === false) {
    // Honest gate: don't query a store we just observed as unreachable.
    host.replaceChildren(make('p', 'The vault is currently unreachable — check the health line above.', 'knowledge-empty'));
    return;
  }
  host.replaceChildren(make('p', `Searching the vault for “${q}”…`, 'knowledge-empty'));
  try {
    const body = await readJSON(`/api/memory/search?q=${encodeURIComponent(q)}&limit=20`) as { results?: VaultResult[] };
    const results = Array.isArray(body?.results) ? body.results : [];
    host.replaceChildren();
    if (!results.length) { host.append(make('p', 'No vault notes match this query.', 'knowledge-empty')); return; }
    for (const r of results) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'knowledge-match';
      b.append(make('strong', r.title || r.path));
      b.append(make('small', `${r.path}${r.kind ? ` · ${r.kind}` : ''}`));
      if (r.excerpt) b.append(make('span', r.excerpt, 'knowledge-excerpt'));
      b.addEventListener('click', () => void showVaultNote(r.note_id));
      host.append(b);
    }
  } catch (err) {
    host.replaceChildren(make('p', `Vault search unavailable: ${str(err)}`, 'knowledge-empty'));
  }
}

async function showVaultNote(noteId: string): Promise<void> {
  const host = el('vault-results'); if (!host) return;
  vaultNoteShown = noteId;
  host.replaceChildren(make('p', 'Loading note…', 'knowledge-empty'));
  try {
    const note = await readJSON(`/api/memory/notes/${encodeURIComponent(noteId)}`) as VaultNote;
    if (vaultNoteShown !== noteId) return;
    host.replaceChildren();
    const back = document.createElement('button');
    back.type = 'button'; back.textContent = '← Back to results';
    back.addEventListener('click', () => void performVaultSearch());
    host.append(back, make('h4', note.title, 'vault-note-title'));
    const meta = make('p', `${note.path} · revision ${note.revision}${note.kind ? ` · ${note.kind}` : ''}`, 'knowledge-note');
    host.append(meta);
    if (note.backlinks.length) host.append(make('p', `Backlinks: ${note.backlinks.join(', ')}`, 'knowledge-note'));
    const pre = document.createElement('pre');
    pre.className = 'registered-diff';
    pre.textContent = note.body.trim();
    host.append(pre);
    const graphBtn = document.createElement('button');
    graphBtn.type = 'button';
    graphBtn.className = 'vault-graph-btn';
    graphBtn.textContent = 'View note graph';
    graphBtn.addEventListener('click', () => void showNoteGraph(noteId));
    host.append(graphBtn, make('div', '', 'vault-graph'));
  } catch (err) {
    if (vaultNoteShown === noteId) host.replaceChildren(make('p', `Could not open the note: ${str(err)}`, 'knowledge-empty'));
  }
}

/** Note graph (spec §6 GET /memory/graph): resolved outgoing links,
 *  backlinks and project clusters, all clickable into the same note view. */
async function showNoteGraph(noteId: string): Promise<void> {
  const host = el<HTMLDivElement>('vault-results');
  if (!host) return;
  const graphHost = host.querySelector<HTMLDivElement>('.vault-graph');
  if (!graphHost) return;
  graphHost.replaceChildren(make('p', 'Loading note graph…', 'knowledge-empty'));
  try {
    const g = await readJSON(`/api/memory/graph?note_id=${encodeURIComponent(noteId)}`) as {
      note_id: string; title: string; outgoing: { link: string; note_id: string | null; path: string | null }[];
      backlinks: string[]; projects: Record<string, string[]>;
    };
    if (vaultNoteShown !== noteId) return;
    graphHost.replaceChildren();
    graphHost.append(make('h4', `Graph — ${g.title}`, 'vault-note-title'));
    const links = make('p', '', 'knowledge-note');
    if (g.outgoing.length) {
      links.append('Outgoing: ');
      for (const o of g.outgoing) {
        const target = o.note_id ? `${o.link} → ${o.path}` : `${o.link} (unresolved)`;
        const chip = document.createElement(o.note_id ? 'button' : 'span');
        if (o.note_id) {
          chip.className = 'vault-graph-link';
          chip.addEventListener('click', () => void showVaultNote(o.note_id as string));
        }
        chip.textContent = target;
        links.append(chip, ' ');
      }
    } else links.append('No outgoing wikilinks.');
    graphHost.append(links);
    if (g.backlinks.length) graphHost.append(make('p', `Backlinks: ${g.backlinks.join(', ')}`, 'knowledge-note'));
    const projects = Object.entries(g.projects || {});
    if (projects.length) {
      const p = make('p', '', 'knowledge-note');
      p.append('Projects: ');
      for (const [pid, notes] of projects) p.append(make('span', `${pid} (${notes.length} notes)`, 'vault-graph-project'), ' ');
      graphHost.append(p);
    }
  } catch (err) {
    if (vaultNoteShown === noteId) graphHost.replaceChildren(make('p', `Graph unavailable: ${str(err)}`, 'knowledge-empty'));
  }
}

// =============================================================================
// Episodic memory views (hermeshaobsidianexpansion.md §6A.2/§6A.10)
// =============================================================================

type EpisodicMemory = {
  id: string; kind: string; title: string; summary: string;
  context: string | null; significance: string | null;
  retrieval_triggers: string; emotional_context: string | null;
  created_at: string; status: string;
};

async function loadEpisodicMemories(): Promise<void> {
  const host = el('episodic-list'); if (!host) return;
  const health = el('episodic-health');
  const kindFilter = el<HTMLSelectElement>('episodic-kind-filter')?.value || '';
  if (health) health.textContent = 'Loading episodic memories…';
  host.replaceChildren();
  try {
    const params = new URLSearchParams({ limit: '50', status: 'active' });
    if (kindFilter) params.set('kind', kindFilter);
    const body = await readJSON(`/api/memory/episodic?${params}`) as { memories?: EpisodicMemory[] };
    const list = Array.isArray(body?.memories) ? body.memories : [];
    if (health) health.textContent = `${list.length} active episodic memories`;
    if (!list.length) { host.append(make('p', 'No episodic memories recorded yet.', 'knowledge-empty')); return; }
    for (const mem of list) {
      const card = document.createElement('article');
      card.className = 'knowledge-match';
      card.append(make('strong', `[${mem.kind.replace(/_/g, ' ')}] ${mem.title}`));
      card.append(make('small', `created ${when(mem.created_at)} · ${mem.status}${mem.context ? ` · ${mem.context.slice(0, 120)}` : ''}`));
      card.append(make('span', mem.summary, 'knowledge-excerpt'));
      if (mem.significance) {
        card.append(make('small', `Why it matters: ${mem.significance.slice(0, 200)}`, 'knowledge-note'));
      }
      card.addEventListener('click', () => toggleCardDetail(card, mem));
      host.append(card);
    }
  } catch (err) {
    if (health) health.textContent = 'Episodic memory unavailable';
    host.append(make('p', `Could not load episodic memories: ${str(err)}`, 'knowledge-empty'));
  }
}

// =============================================================================
// Relational memory views (hermeshaobsidianexpansion.md §6A.2/§6A.10)
// =============================================================================

type RelationalMemory = {
  id: string; category: string; title: string; context: string | null;
  significance: string | null; retrieval_triggers: string;
  reinforced_count: number; created_at: string; last_reinforced_at: string;
  status: string;
};

async function loadRelationalMemories(): Promise<void> {
  const host = el('relational-list'); if (!host) return;
  const health = el('relational-health');
  const catFilter = el<HTMLSelectElement>('relational-category-filter')?.value || '';
  if (health) health.textContent = 'Loading relational memories…';
  host.replaceChildren();
  try {
    const params = new URLSearchParams({ limit: '50', status: 'active' });
    if (catFilter) params.set('category', catFilter);
    const body = await readJSON(`/api/memory/relational?${params}`) as { memories?: RelationalMemory[] };
    const list = Array.isArray(body?.memories) ? body.memories : [];
    if (health) health.textContent = `${list.length} active relational memories`;
    if (!list.length) { host.append(make('p', 'No relational memories recorded yet.', 'knowledge-empty')); return; }
    for (const mem of list) {
      const card = document.createElement('article');
      card.className = 'knowledge-match';
      const count = mem.reinforced_count || 1;
      card.append(make('strong', `[${mem.category.replace(/_/g, ' ')}] ${mem.title}`));
      card.append(make('small',
        `reinforced ${count}× · last ${when(mem.last_reinforced_at)}${mem.context ? ` · ${mem.context.slice(0, 100)}` : ''}`));
      // Show top retrieval triggers as chips
      const triggers = safeJSON(mem.retrieval_triggers) as string[];
      if (triggers.length) {
        const tagRow = document.createElement('div');
        tagRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px';
        for (const t of triggers.slice(0, 6)) {
          const chip = document.createElement('span');
          chip.textContent = t;
          chip.style.cssText = 'background:#12303c;color:#9de4e1;padding:2px 7px;border-radius:4px;font-size:11px';
          tagRow.append(chip);
        }
        if (triggers.length > 6) tagRow.append(make('small', `+${triggers.length - 6} more`, 'knowledge-note'));
        card.append(tagRow);
      }
      card.addEventListener('click', () => toggleCardDetail(card, mem));
      host.append(card);
    }
  } catch (err) {
    if (health) health.textContent = 'Relational memory unavailable';
    host.append(make('p', `Could not load relational memories: ${str(err)}`, 'knowledge-empty'));
  }
}

// =============================================================================
// Consolidation status (hermeshaobsidianexpansion.md §6A.6)
// =============================================================================

async function loadConsolidationStatus(): Promise<void> {
  const host = el('consolidation-detail'); if (!host) return;
  const health = el('consolidation-health');
  if (health) health.textContent = 'Checking…';
  host.replaceChildren();
  try {
    const status = await readJSON('/api/consolidation/status') as Record<string, unknown>;
    const enabled = !!status.enabled;
    const interval = Number(status.interval_seconds) || 21600;
    const lastRun = str(status.last_run);
    const nextRun = str(status.next_run);
    const total = Number(status.total_consolidated) || 0;
    const lastError = str(status.last_error);
    if (health) {
      health.textContent = enabled
        ? `Enabled · every ${Math.round(interval / 3600)}h · ${total} items consolidated`
        : 'Disabled (manual only)';
    }
    host.append(make('p',
      `Status: ${enabled ? 'Automatic' : 'Manual only (use "Run now")'} · Interval: ${Math.round(interval / 3600)}h`,
      'knowledge-note'));
    if (lastRun) host.append(make('p', `Last run: ${when(lastRun)}`, 'knowledge-note'));
    if (nextRun) host.append(make('p', `Next run: ${when(nextRun)}`, 'knowledge-note'));
    host.append(make('p', `Total items consolidated: ${total}`, 'knowledge-note'));
    if (lastError) host.append(make('p', `Last error: ${lastError}`, 'knowledge-note'));
  } catch (err) {
    if (health) health.textContent = 'Consolidation service unavailable';
    host.append(make('p', `Could not load consolidation status: ${str(err)}`, 'knowledge-empty'));
  }
}

async function triggerConsolidation(): Promise<void> {
  const host = el('consolidation-detail'); if (!host) return;
  host.replaceChildren(make('p', 'Running consolidation…', 'knowledge-empty'));
  try {
    const result = await readJSON('/api/consolidation/run') as Record<string, unknown>;
    const action = str(result.action);
    const ep = (result.episodic as Record<string, unknown>) || {};
    const rel = (result.relational as Record<string, unknown>) || {};
    const themes = (result.themes as Record<string, unknown>) || {};
    const epActioned = Number(ep.actioned) || 0;
    const relActioned = Number(rel.actioned) || 0;
    const themesFound = Number(themes.themes_found) || 0;
    host.replaceChildren();
    host.append(make('p', `Consolidation ${action}`, 'knowledge-note'));
    host.append(make('p', `Episodic: ${epActioned} deduplicated · Relational: ${relActioned} deduplicated · Themes: ${themesFound} identified`, 'knowledge-note'));
    // Show theme observations if any
    const obs = Array.isArray(themes.observations) ? themes.observations as { theme_keyword: string; kind: string; count: number }[] : [];
    if (obs.length) {
      const themeBlock = document.createElement('div');
      themeBlock.append(make('strong', 'Recurring themes:'));
      for (const o of obs.slice(0, 10)) {
        themeBlock.append(make('p', `"${o.theme_keyword}" appears in ${o.count} ${o.kind.replace(/_/g, ' ')} memories`, 'knowledge-note'));
      }
      host.append(themeBlock);
    }
    void loadConsolidationStatus();
  } catch (err) {
    host.replaceChildren(make('p', `Consolidation failed: ${str(err)}`, 'knowledge-empty'));
  }
}

// =============================================================================
// Shared helpers
// =============================================================================

function when(value: unknown): string {
  if (!value) return '—';
  const date = new Date(str(value));
  return Number.isFinite(date.valueOf()) ? date.toLocaleString() : str(value);
}

function safeJSON(value: unknown): unknown {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

/** Toggle expanded detail for a memory card — shows JSON below the summary. */
function toggleCardDetail(card: HTMLElement, mem: Record<string, unknown>): void {
  const existing = card.querySelector('.memory-detail-expanded');
  if (existing) { existing.remove(); return; }
  const detail = document.createElement('pre');
  detail.className = 'memory-detail-expanded';
  detail.style.cssText = 'font-size:11px;color:#9cb4c4;margin:8px 0 0;padding:8px;background:#0d1a24;border-radius:4px;overflow-x:auto;white-space:pre-wrap;max-height:200px;overflow-y:auto';
  detail.textContent = JSON.stringify(mem, null, 2);
  card.append(detail);
}

function boot() {
  const panel = el('workspace-knowledge'); if (!panel) return;
  const form = el<HTMLFormElement>('knowledge-search-form');
  form?.addEventListener('submit', event => { event.preventDefault(); void performSearch(); });
  el('knowledge-refresh')?.addEventListener('click', () => void loadSources());
  el('knowledge-clear')?.addEventListener('click', () => {
    const input = el<HTMLInputElement>('knowledge-query'); if (input) input.value = '';
    void performSearch();
  });
  el('vault-search-form')?.addEventListener('submit', event => { event.preventDefault(); void performVaultSearch(); });
  // Episodic memory controls
  el('episodic-refresh')?.addEventListener('click', () => void loadEpisodicMemories());
  el('episodic-kind-filter')?.addEventListener('change', () => void loadEpisodicMemories());
  // Relational memory controls
  el('relational-refresh')?.addEventListener('click', () => void loadRelationalMemories());
  el('relational-category-filter')?.addEventListener('change', () => void loadRelationalMemories());
  // Consolidation controls
  el('consolidation-refresh')?.addEventListener('click', () => void loadConsolidationStatus());
  el('consolidation-run')?.addEventListener('click', () => void triggerConsolidation());
  // Cross-surface handoff (spec §7): Research hands over a note id and the
  // same Knowledge context opens the exact original vault note.
  window.addEventListener('hermes:open-note', (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { note_id?: unknown } | null;
    const noteId = str(detail?.note_id);
    if (noteId) void showVaultNote(noteId);
  });
  // Vault health is a live state, not a promise: refresh it on every entry.
  onNavigationChange(nav => {
    if (nav.workspace !== 'knowledge') return;
    void loadVaultHealth();
    if (!initialLoad) void loadSources();
    void loadEpisodicMemories();
    void loadRelationalMemories();
    void loadConsolidationStatus();
  });
  // Navigation can be restored before this module subscribes (initial URL deep link).
  const qs = new URLSearchParams(location.search);
  if (qs.get('view') === 'knowledge') { void loadSources(); void loadVaultHealth(); }
}
boot();
