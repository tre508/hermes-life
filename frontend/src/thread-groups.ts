/**
 * Chat audit §6 — grouping and filtering for the conversation-history column.
 *
 * Pure and clock-injectable, so the same functions the sidebar renders through
 * can be driven by a state harness (`frontend/harness/thread-sidebar.html`) and
 * by unit tests. The evaluation gate blanks data-dependent UI in a headless
 * load, so a fixture fed synthetic threads is the only way to inspect the list
 * states at all.
 */
export interface ThreadLike {
    id: string;
    title?: string | null;
    updated_at: string;
}

/**
 * Day label for a thread's last activity, relative to `now`.
 *
 * Buckets are counted in whole CALENDAR days off local midnight, not in elapsed
 * hours: a thread touched at 23:50 must read "Yesterday" at 00:10, not "Today".
 */
export function dayBucket(iso: string, now: Date = new Date()): string {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return 'Earlier';
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const back = Math.round((midnight.getTime() - day.getTime()) / 86400000);
    if (back <= 0) return 'Today';
    if (back === 1) return 'Yesterday';
    if (back < 7) return 'This week';
    return day.toLocaleDateString(undefined, day.getFullYear() === now.getFullYear()
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Case-insensitive title search. A blank query keeps everything, in order. */
export function filterThreads<T extends ThreadLike>(list: T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(t => (t.title || '').toLowerCase().includes(q));
}

/**
 * Group a filtered list into ordered day buckets.
 *
 * Assumes `list` arrives newest-first (the order `/api/conversations` returns),
 * so buckets come out in recency order and no sorting is needed here.
 */
export function groupThreads<T extends ThreadLike>(
    list: T[], query = '', now: Date = new Date(),
): { bucket: string; threads: T[] }[] {
    const out: { bucket: string; threads: T[] }[] = [];
    for (const t of filterThreads(list, query)) {
        const bucket = dayBucket(t.updated_at, now);
        const last = out[out.length - 1];
        if (last && last.bucket === bucket) last.threads.push(t);
        else out.push({ bucket, threads: [t] });
    }
    return out;
}
