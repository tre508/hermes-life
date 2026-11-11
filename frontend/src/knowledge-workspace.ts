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
function boot() {
  const panel = el('workspace-knowledge'); if (!panel) return;
  const form = el<HTMLFormElement>('knowledge-search-form');
  form?.addEventListener('submit', event => { event.preventDefault(); void performSearch(); });
  el('knowledge-refresh')?.addEventListener('click', () => void loadSources());
  el('knowledge-clear')?.addEventListener('click', () => {
    const input = el<HTMLInputElement>('knowledge-query'); if (input) input.value = '';
    void performSearch();
  });
  // Load lazily on the first visit; retain selection and current results across navigation.
  onNavigationChange(nav => { if (nav.workspace === 'knowledge' && !initialLoad) void loadSources(); });
  // Navigation can be restored before this module subscribes (initial URL deep link).
  const qs = new URLSearchParams(location.search);
  if (qs.get('view') === 'knowledge') void loadSources();
}
boot();
