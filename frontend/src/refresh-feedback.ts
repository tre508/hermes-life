/** HL-UI-STATE-001 criterion 7: one refresh lifecycle, shared by every tab.
 *
 * Clicking Refresh must be visibly distinct from "nothing happened": the button says
 * Refreshing…, a successful no-change poll says Up to date, new data updates the counts and
 * the timestamp, and a failure keeps the previous data and the previous timestamp while
 * reporting a specific error.
 */
export type RefreshPhase = 'idle' | 'loading' | 'ok' | 'unchanged' | 'error';

export interface RefreshOptions {
  /** Fetch the tab's data. Throw to signal failure. */
  load: () => Promise<unknown>;
  /** Store the data when it actually changed. */
  apply: (data: unknown) => void;
  /** Re-render the tab. */
  onChange: () => void;
  /** How many records the payload holds, for the status line. */
  count?: (data: unknown) => number;
  /** Noun used in the status line, e.g. 'goals'. */
  noun?: string;
}

export function digest(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}:${hash.toString(36)}`;
}

export function makeRefresh(options: RefreshOptions) {
  const noun = options.noun || 'records';
  let phase: RefreshPhase = 'idle';
  let error = '';
  let loadedAt = '';
  let checkedAt = '';
  let count = 0;
  let last = '';
  return {
    get phase() { return phase; },
    get error() { return error; },
    /** When the data on screen was last replaced. */
    get loadedAt() { return loadedAt; },
    /** When the last successful response arrived, changed or not. */
    get checkedAt() { return checkedAt; },
    get count() { return count; },
    /** Button label: the click has to look like it did something. */
    label() { return phase === 'loading' ? 'Refreshing…' : 'Refresh'; },
    /** Status line for the current phase. */
    statusText() {
      if (phase === 'error') return `Refresh failed: ${error.replace(/^Error:\s*/, '')} — showing the previous data.`;
      if (phase === 'loading') return `Refreshing…`;
      if (phase === 'unchanged') return `Up to date — no changes · ${count} ${noun}`;
      if (phase === 'ok') return `Updated just now — ${count} ${noun} loaded`;
      return '';
    },
    async run() {
      phase = 'loading';
      error = '';
      options.onChange();
      try {
        const data = await options.load();
        const key = digest(data);
        checkedAt = new Date().toISOString();
        if (options.count) count = options.count(data);
        if (key !== last) {
          last = key;
          options.apply(data);
          loadedAt = new Date().toISOString();
          phase = 'ok';
        } else {
          phase = 'unchanged';
        }
      } catch (e) {
        // Data and timestamp are deliberately left untouched on failure.
        phase = 'error';
        error = String(e);
      }
      options.onChange();
    },
  };
}
