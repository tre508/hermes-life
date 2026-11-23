/**
 * Research workspace (P5, spec §4 Research).
 *
 * One session surface over REAL endpoints only — this module invents no
 * records and no progress:
 *   - Sources & matched facts ... /api/library/sources + /api/library/search
 *     (each fact carries its source id / URL / page as its citation anchor)
 *   - Findings ................. /api/discoveries (the work graph's discovery
 *     records; displayed status comes from the workflow chain annotation)
 *   - Open questions ........... /api/curiosity
 *   - Vault note links ......... /api/memory/search (Obsidian, read-only here)
 *
 * Promotion to durable knowledge is an EXPLICIT user action via
 * POST /api/memory/notes (spec §6 write pipeline: authorization policy,
 * atomic write, vault verification) — never an automatic side effect, and
 * it preserves the evidence links in the note body.
 */
import { onNavigationChange } from './navigation-state.ts';

type Rec = Record<string, unknown>;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const s = (x: unknown): string => typeof x === 'string' ? x : x == null ? '' : String(x);
const list = <T = Rec>(x: unknown): T[] =>
    Array.isArray(x) ? x as T[] : (x && typeof x === 'object' ? (((x as Rec).items as T[]) || []) : []);
const num = (x: unknown): number => Number.isFinite(Number(x)) ? Number(x) : 0;

type LibraryMatch = { id: unknown; source_id: unknown; title: unknown; url: unknown; page: unknown; content: unknown; score: unknown };
type SourceRec = { id: unknown; title: unknown; url: unknown; kind: unknown; status: unknown };
type Discovery = { id: unknown; project: unknown; path: unknown; line: unknown; note: unknown; rationale: unknown; state: unknown; status?: unknown };
type Curiosity = { id: unknown; question: unknown; category: unknown; priority: unknown; state: unknown; rationale?: unknown };
type VaultResult = { note_id: unknown; title: unknown; path: unknown; excerpt: unknown; kind: unknown; relevance: unknown };

let findings: Discovery[] = [];
let questions: Curiosity[] = [];
let sources: SourceRec[] = [];
let lastQuery = '';
let inFlight: Promise<void> | null = null;
let loadError = '';

async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const res = await fetch('/api' + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    if (!res.ok) {
        let detail: unknown = parsed;
        if (parsed && typeof parsed === 'object' && 'detail' in parsed) detail = (parsed as Rec).detail;
        throw new Error(`${res.status}: ${s(detail).slice(0, 300)}`);
    }
    return parsed;
}

function make(tag: string, text = '', cls = ''): HTMLElement {
    const n = document.createElement(tag);
    n.textContent = text;
    if (cls) n.className = cls;
    return n;
}

function setStatus(text: string, error = false): void {
    const host = $('research-status');
    if (!host) return;
    host.textContent = text;
    host.dataset.error = String(error);
}

function sourceTitle(src: SourceRec | undefined, matchSourceId: unknown): string {
    if (src) return s(src.title).trim() || s(src.url).trim() || `Source ${s(src.id)}`;
    return `Source ${s(matchSourceId) || '—'}`;
}

/** One matched fact with its citation anchor (spec §4: every fact traceable
 *  to a document/URL). The anchor is the registered source's own URL. */
function factCard(match: LibraryMatch, openUrl: (url: string) => void): HTMLElement {
    const card = make('article', '', 'research-fact');
    const src = sources.find(x => s(x.id) === s(match.source_id));
    card.append(make('strong', sourceTitle(src, match.source_id)));
    card.append(make('small', `source ${s(match.source_id)}${match.page != null ? ` · page ${s(match.page)}` : ''}`));
    if (match.content) card.append(make('p', s(match.content).slice(0, 360), 'research-fact-text'));
    const url = s(src?.url || match.url).trim();
    if (/^https?:\/\//.test(url)) {
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.className = 'research-link';
        link.textContent = 'Open source ↗';
        link.addEventListener('click', (ev) => { ev.preventDefault(); openUrl(url); });
        card.append(link);
    }
    return card;
}

/** A discovery record rendered as a finding, with an explicit promotion
 *  action. The note body keeps the provenance trail (project, path, line,
 *  discovery id) so the vault note never loses its evidence links. */
function findingCard(item: Discovery, promote: (d: Discovery) => void): HTMLElement {
    const card = make('article', '', 'research-finding');
    card.append(make('strong', s(item.note).slice(0, 160) || 'Discovery'));
    const where = s(item.project) ? `${s(item.project)}${item.path ? ` · ${s(item.path)}${item.line ? `:${s(item.line)}` : ''}` : ''}` : s(item.path);
    if (where) card.append(make('small', where));
    if (item.rationale) card.append(make('p', s(item.rationale).slice(0, 300), 'research-fact-text'));
    const status = s(item.status || item.state);
    const badge = make('span', status || 'unknown state', 'research-state');
    badge.dataset.state = status;
    card.append(badge);
    const actions = make('div', '', 'research-actions');
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save to vault';
    save.title = 'Explicitly promote this finding to a durable vault note (approval gate)';
    save.addEventListener('click', () => promote(item));
    actions.append(save);
    card.append(actions);
    return card;
}

function questionCard(item: Curiosity): HTMLElement {
    const card = make('article', '', 'research-question');
    card.append(make('strong', s(item.question).slice(0, 200) || 'Open question'));
    card.append(make('small', `${s(item.category) || 'question'} · priority ${num(item.priority)}`));
    const state = s(item.state);
    const badge = make('span', state || 'unknown state', 'research-state');
    badge.dataset.state = state;
    card.append(badge);
    return card;
}

function noteCard(r: VaultResult, openNote: (noteId: string) => void): HTMLElement {
    const card = make('article', '', 'research-note');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'research-note-open';
    open.append(make('strong', s(r.title) || s(r.path)));
    open.append(make('small', s(r.path)));
    if (r.excerpt) open.append(make('span', s(r.excerpt).slice(0, 240), 'research-fact-text'));
    open.addEventListener('click', () => openNote(s(r.note_id)));
    card.append(open);
    return card;
}

function empty(text: string): HTMLElement {
    return make('p', text, 'research-empty');
}

function render(openUrl: (url: string) => void, openNote: (id: string) => void, promote: (d: Discovery) => void): void {
    const srcHost = $('research-sources');
    if (srcHost) {
        srcHost.replaceChildren();
        if (loadError) srcHost.append(empty(`Sources unavailable: ${loadError}`));
        else if (!lastQuery) srcHost.append(empty('Enter a topic above — matched facts come from the registered source library only.'));
        else {
            void api(`/library/search?q=${encodeURIComponent(lastQuery)}&limit=8`).then(body => {
                const matches = list(body).filter(m => !!m);
                srcHost.replaceChildren();
                if (!matches.length) srcHost.append(empty('No indexed source excerpts match this topic.'));
                for (const m of matches as LibraryMatch[]) srcHost.append(factCard(m, openUrl));
                if (loadError) srcHost.append(empty(`Sources unavailable: ${loadError}`));
            }).catch(e => { srcHost.replaceChildren(empty(`Sources unavailable: ${s(e)}`)); });
        }
    }
    const findHost = $('research-findings');
    if (findHost) {
        findHost.replaceChildren();
        if (!findings.length) findHost.append(empty('No discovery records recorded yet.'));
        for (const d of findings) findHost.append(findingCard(d, promote));
    }
    const qHost = $('research-questions');
    if (qHost) {
        qHost.replaceChildren();
        if (!questions.length) qHost.append(empty('No open curiosity questions.'));
        for (const q of questions) qHost.append(questionCard(q));
    }
    const noteHost = $('research-notes');
    if (noteHost) {
        noteHost.replaceChildren();
        if (!lastQuery) noteHost.append(empty('Enter a topic above to find related vault notes.'));
        else {
            void api(`/memory/search?q=${encodeURIComponent(lastQuery)}&limit=8`).then(body => {
                const results = list(body).filter(r => !!r);
                noteHost.replaceChildren();
                if (!results.length) noteHost.append(empty('No vault notes relate to this topic.'));
                for (const r of results as VaultResult[]) noteHost.append(noteCard(r, openNote));
            }).catch(e => { noteHost.replaceChildren(empty(`Vault search unavailable: ${s(e)}`)); });
        }
    }
}

/** Explicit promotion (spec §6 write pipeline): the user presses the button,
 *  the service validates and atomically writes, and the response confirms the
 *  real revision. Queued intent is never displayed as success. */
async function promoteFinding(d: Discovery): Promise<void> {
    const title = s(d.note).slice(0, 80).trim() || `Discovery ${s(d.id).slice(0, 8)}`;
    const body = [
        `**Finding.** ${s(d.note)}`,
        s(d.rationale) ? `Rationale: ${s(d.rationale)}` : '',
        `Provenance: discovery ${s(d.id)} · project ${s(d.project) || '—'}${d.path ? ` · ${s(d.path)}${d.line ? `:${s(d.line)}` : ''}` : ''}`,
        `Origin: research workspace promotion (explicit user action)`,
    ].filter(Boolean).join('\n\n');
    try {
        const result = await api('/memory/notes', 'POST', {
            folder: '20-Research', title, body,
            meta: { kind: 'research_finding', project_id: s(d.project), source_ids: [s(d.id)] },
            origin: 'hermes_research',
        }) as Rec;
        setStatus(`Saved to vault: ${s(result.path)} (revision ${s(result.revision)}) — verified by the memory service.`);
    } catch (e) {
        setStatus(`Could not save to vault: ${s(e)}`, true);
    }
}

/** Run a session query across sources, findings, questions and vault notes. */
async function runSession(query: string): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        lastQuery = query.trim();
        loadError = '';
        if (!lastQuery) { findings = []; questions = []; render(openExternal, openVaultNote, promoteFinding); setStatus(''); inFlight = null; return; }
        setStatus(`Searching the library, work graph and vault for “${lastQuery}”…`);
        try {
            const [disc, cur] = await Promise.all([
                api('/discoveries').catch(e => { loadError = s(e); return []; }),
                api('/curiosity').catch(e => { loadError = s(e); return []; }),
            ]);
            const q = lastQuery.toLowerCase();
            const allDisc = list<Discovery>(disc);
            const allCur = list<Curiosity>(cur);
            // Findings/questions are the work graph's own records: the session
            // view filters them by the topic, showing everything when no
            // record matches rather than pretending the topic has no work.
            findings = allDisc.filter(d => `${s(d.note)} ${s(d.rationale)} ${s(d.project)}`.toLowerCase().includes(q));
            questions = allCur.filter(c => `${s(c.question)} ${s(c.rationale)} ${s(c.category)}`.toLowerCase().includes(q));
            if (!findings.length && allDisc.length) findings = allDisc;
            if (!questions.length && allCur.length) questions = allCur;
            setStatus(`Session “${lastQuery}” · ${findings.length} finding(s) · ${questions.length} open question(s)${loadError ? ` · ${loadError}` : ''}`, !!loadError);
        } catch (e) {
            setStatus(`Session search failed: ${s(e)}`, true);
        }
        render(openExternal, openVaultNote, promoteFinding);
        inFlight = null;
    })();
    return inFlight;
}

function openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
}

/** Opening a vault note stays in ONE memory store: the Knowledge surface owns
 *  note detail, so Research hands over the note id to it (spec §7). */
function openVaultNote(noteId: string): void {
    if (!noteId) return;
    const input = $<HTMLInputElement>('vault-query');
    if (input) input.value = '';
    // Route through the Knowledge workspace and ask it to show the note.
    window.dispatchEvent(new CustomEvent('hermes:open-note', { detail: { note_id: noteId } }));
}

function boot(): void {
    const panel = $('workspace-research');
    if (!panel) return;
    $('research-session-form')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const input = $('research-query') as HTMLInputElement | null;
        void runSession(input?.value ?? '');
    });
    // Refresh the work-graph slices whenever the workspace becomes visible —
    // findings and questions are live states, not cached promises.
    onNavigationChange(nav => {
        if (nav.workspace !== 'research') return;
        if (!lastQuery) {
            // First visit: show the real work-graph records without a filter.
            void runSession('');
            return;
        }
        void runSession(lastQuery);
    });
}

boot();

export { runSession as runResearchSession, render as renderResearch, promoteFinding, openVaultNote, factCard, findingCard, questionCard, noteCard, empty };
