/**
 * Human-readable rendering of tool activity for the chat transcript.
 *
 * The chat used to print the raw tool payload — `{"command":"cd /home/…",
 * "output":"state: failed\\n…"}` — as a JSON blob. That is the event wire format,
 * not something a person reads. This module turns a tool call into the one-line
 * statement the Hermes CLI shows (`$ cd /x && ls`, `read hermes_life/app.py`,
 * `search "chat_task_models" in hermes_life/`) plus a short result summary, with
 * the full output left available behind a disclosure.
 *
 * Pure and dependency-free so the sidebar-style fixture
 * (frontend/harness/trace-display.html) and the unit tests drive the SAME
 * functions the transcript renders through.
 */

export interface ToolAction {
    /** Leading glyph for the action line. */
    icon: string;
    /** The human-readable statement, always single-line and trimmed. */
    text: string;
    /** The tool's name as a short pill label (e.g. "terminal", "read file"). */
    name: string;
}

const TOOL_ICON = '⏺';

/** Tool arguments arrive as an object, a JSON string, or nothing at all. */
export function parseArgs(raw: unknown): Record<string, unknown> | null {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const v = JSON.parse(raw);
            if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch { /* not JSON — fall through */ }
    }
    return null;
}

/** `read_file` -> `read file`, so an unmapped tool still reads as English. */
export function humanise(label: string): string {
    return (label || 'tool').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const oneLine = (s: string, max = 160): string => {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** First non-empty line of a possibly-multiline string. */
const firstLine = (v: unknown): string => str(v).split('\n').map(l => l.trim()).find(Boolean) || '';

/**
 * Turn a tool call into the statement the CLI would print.
 *
 * `name` is the tool's identity — rendered as a small pill so the statement
 * (path, query, command) reads as the machine's line, visually distinct from
 * the reasoning prose above it.
 *
 * Unknown tools degrade to their humanised name plus whatever locator the
 * payload carries, so a new tool is never rendered as a wall of JSON.
 */
export function toolAction(label: string, rawArgs: unknown): ToolAction {
    const a = parseArgs(rawArgs) || {};
    const key = humanise(label).toLowerCase().replace(/\s+/g, '');
    const pick = (...keys: string[]): string => {
        for (const k of keys) { const v = a[k]; if (typeof v === 'string' && v) return v; }
        return '';
    };
    const path = pick('path', 'file_path', 'filename', 'file', 'target');
    const query = pick('pattern', 'query', 'q', 'regex');
    const url = pick('url', 'href') || (Array.isArray(a.urls) ? str((a.urls as unknown[])[0]) : '');

    const shell = pick('command', 'cmd', 'script', 'code');
    if (['terminal', 'bash', 'shell', 'exec', 'run', 'runcommand', 'execute'].includes(key)) {
        return { icon: '$', name: 'terminal', text: oneLine(shell || firstLine(a.code) || humanise(label)) };
    }
    if (['readfile', 'read', 'cat', 'openfile', 'view'].includes(key)) {
        const limit = typeof a.limit === 'number' ? ` (first ${a.limit} lines)` : '';
        return { icon: TOOL_ICON, name: 'read file', text: `${oneLine(path || '(unknown path)', 120)}${limit}` };
    }
    if (['writefile', 'write', 'create', 'savefile'].includes(key)) {
        return { icon: TOOL_ICON, name: 'write file', text: oneLine(path || '(unknown path)', 120) };
    }
    if (['patch', 'edit', 'editfile', 'applypatch', 'strreplace', 'replace'].includes(key)) {
        return { icon: TOOL_ICON, name: 'edit file', text: oneLine(path || '(unknown path)', 120) };
    }
    if (['grep', 'searchfiles', 'search', 'find', 'glob'].includes(key)) {
        const where = path || str(a.file_glob) || '';
        return { icon: TOOL_ICON, name: 'search files', text: `"${oneLine(query || '(blank)')}"${where ? ` in ${oneLine(where, 80)}` : ''}` };
    }
    if (['websearch', 'searchweb'].includes(key)) {
        return { icon: TOOL_ICON, name: 'web search', text: `"${oneLine(query || '(blank)')}"` };
    }
    if (['webextract', 'fetch', 'browse', 'readurl', 'http'].includes(key)) {
        return { icon: TOOL_ICON, name: 'fetch page', text: oneLine(url || '(no url)', 140) };
    }
    if (['browserexec', 'browser'].includes(key)) {
        // browser_exec carries a script whose first line is a comment stating the intent
        const intent = firstLine(str(a.code).replace(/^#\s*/gm, '# ')).replace(/^#\s*/, '')
            || firstLine(shell).replace(/^#\s*/, '');
        return { icon: TOOL_ICON, name: 'browser', text: oneLine(intent || 'driving the browser', 130) };
    }
    if (['todolist', 'plan', 'task'].includes(key)) return { icon: TOOL_ICON, name: 'plan', text: 'the remaining steps' };
    if (['imagegenerate', 'imagegen'].includes(key)) return { icon: TOOL_ICON, name: 'image gen', text: query ? oneLine(query, 90) : 'an image' };
    if (['delegatetask', 'delegate', 'subagent'].includes(key)) {
        const goal = pick('goal', 'prompt', 'task');
        return { icon: TOOL_ICON, name: 'delegate', text: goal ? oneLine(goal, 110) : 'to a subagent' };
    }
    // Unknown tool: name it and show whatever locator it carries.
    const hint = path || query || url || oneLine(shell, 90);
    return { icon: TOOL_ICON, name: humanise(label), text: hint ? oneLine(hint, 120) : '' };
}

/**
 * A result is a failure when it LEADS with an error, or carries a real
 * traceback — not merely because the word "error" appears somewhere. Search
 * results that discuss errors must still read as results.
 */
const ERRORISH = /^(error|failed|failure|traceback|exception|no such|operationalerror|syntaxerror|cannot|unable|fatal)\b/i;
const TRACEBACK = /Traceback \(most recent call last\)/;

/**
 * One readable line describing what came back — the CLI summarises a result
 * rather than dumping it. Full text stays available behind a disclosure.
 */
export function resultSummary(text: string): string {
    const body = (text ?? '').replace(/\r/g, '');
    const lines = body.split('\n').filter(l => l.trim());
    if (!lines.length) return 'no output';
    const first = oneLine(lines[0], 150);
    const failed = lines.slice(0, 5).some(l => ERRORISH.test(l.trim())) || TRACEBACK.test(body);
    const tail = lines.length > 1 ? ` · ${lines.length} lines` : '';
    return (failed ? 'failed · ' : '') + first + tail;
}

/** True when a result carries more than the summary line, so a disclosure is worth showing. */
export function hasMoreDetail(text: string): boolean {
    const body = text ?? '';
    const lines = body.split('\n').filter(l => l.trim());
    // Plain string length on purpose: Buffer is Node-only and this runs in the
    // browser too (it threw a ReferenceError the first time the harness ran).
    return lines.length > 1 || body.length > 200;
}

/** `0.4s` / `1.2s` / `3m 5s` — the CLI prints a duration next to each call. */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s % 60)}s`;
}
