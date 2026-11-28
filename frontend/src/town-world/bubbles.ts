/**
 * UI-VIS-007: Real-time activity bubble system.
 *
 * Displays Hermes's execution process directly above the relevant 3D resident.
 * Bubbles show actual runtime information from WebSocket events, not invented content.
 *
 * Architecture:
 *   WebSocket Event Stream → BubbleEventAdapter → BubbleController → Screen-Space Overlay
 *
 * The overlay uses HTML/CSS for typography, wrapping, accessibility, and interaction.
 * It tracks each resident's projected head position via Three.js world-to-screen projection.
 */

import type { Role, Activity, LocationId } from '../town-model';
import { ROLES, ROSTER } from '../town-model';
import type { TownRenderer, RendererPoint } from '../town-renderer';

// ============================================================================
// Types
// ============================================================================

export type BubbleCategory = 'thought' | 'tool' | 'execution' | 'success' | 'error' | 'waiting';

export interface BubbleContent {
  /** Optional anchor: ties a tool_use bubble to its matching tool_result. */
  id?: string;
  /** Short headline for the default view */
  headline: string;
  /** Optional expanded details for hover/click */
  details?: string;
  /** Tool name if this is a tool-call bubble */
  toolName?: string;
  /** Relevant arguments/target for tool calls */
  toolTarget?: string;
  /** Execution status */
  status?: 'running' | 'completed' | 'failed' | 'blocked';
  /** Start timestamp */
  startTime?: number;
  /** End timestamp */
  endTime?: number;
  /** Associated task ID */
  taskId?: string;
  /** Event sequence number */
  sequence?: number;
  /**
   * Functional category of a tool call (research/testing/memory/review/
   * planning/development). UI-VIS-007 §3: this describes WHAT KIND of work
   * the tool performs, NOT which resident executed it — every `hermes.*`
   * event is executed by Hermes the coordinator, so the bubble's role must
   * never be inferred from the tool name.
   */
  functionalCategory?: string;
  /** Internal: streaming text fragment for accumulation (not persisted) */
  _streamFragment?: string;
}

export interface BubbleState {
  role: Role;
  category: BubbleCategory;
  content: BubbleContent;
  /** Unique ID for this bubble instance */
  id: string;
  /** When this bubble was created */
  createdAt: number;
  /** Whether the bubble is currently visible */
  visible: boolean;
  /** Whether the bubble is expanded (hover/click) */
  expanded: boolean;
  /** Animation state */
  animationState: 'entering' | 'visible' | 'exiting' | 'hidden';
}

export interface BubbleConfig {
  /** Maximum bubbles per resident */
  maxPerResident: number;
  /** Default display duration in ms */
  defaultDuration: number;
  /** Duration for success/error bubbles */
  terminalDuration: number;
  /** Fade animation duration */
  fadeDuration: number;
  /** Maximum history entries to keep */
  maxHistory: number;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: BubbleConfig = {
  maxPerResident: 1,
  defaultDuration: 8000,
  terminalDuration: 5000,
  fadeDuration: 300,
  maxHistory: 100,
};

/** HA-034 (§9 "hover OR click exposes details"): hover reveals the same
 *  detail block after this delay — short enough to feel direct, long enough
 *  that pointer sweeps don't flap the view. */
const HOVER_REVEAL_DELAY = 250;

// ============================================================================
// Event-to-Role Mapping (mirrors town-model.ts but for bubble categories)
// ============================================================================

const RUNTIME_EVENTS = /^hermes\.(text|system|tool_use|tool_result|result)$/;

/** D11 (review.md): redact sensitive FIELD VALUES from tool payloads before
 *  anything reaches a bubble. Matches key=value / key: value / "key":"value"
 *  shapes with a sensitive key and replaces the value with ••••. Applied only
 *  to payload-derived strings (targets, args, result summaries) — never to
 *  Hermes's own streamed text, which is the answer, not a payload field.
 *  HA-015: unquoted values run to a safe delimiter (escaped quote, the old
 *  ,;&"')]} set) or end of LINE — a first-token-only value leaked
 *  `password=hello world and more`'s tail. */
const SCHEME_CRED = /\b(basic|bearer|digest)\s+([A-Za-z0-9._~+/=-]{8,})/gi;
const SENSITIVE_KEY =
  /((?:pass(?:word)?|secret|token|api[-_ ]?key|authorization|credential|bearer)["']?\s*[:=]\s*)(?:(basic|bearer|digest)\s+)?("[^"]*"|'[^']*'|[^\r\n]*?(?=[ \t]*(?:\\["']|[,;|&"'\])}])|\r?\n|$))/gi;
export function redactSensitive(text: string): string {
  if (!text) return text;
  return text
    // Scheme-prefixed credentials FIRST ("Bearer <token>", "Basic <token>")
    // — otherwise the key=value pass consumes the scheme word as the value
    // and the real token survives.
    .replace(SCHEME_CRED, (_m, scheme: string) => `${scheme} ••••`)
    // HA-015: keep the scheme word ("Basic ••••") — only the credential is
    // a value; the scheme label is structure.
    .replace(SENSITIVE_KEY, (_m, key: string, scheme?: string) =>
      `${key}${scheme ? `${scheme} ` : ''}••••`);
}

/** Live payloads observed on the wire use `payload.name`; older records and
 *  tests sometimes use `payload.tool_name`. Read either, with the live field
 *  first because that's the dominant shape in production. */
function toolNameFrom(payload: Record<string, unknown>): string {
  const raw =
    (payload.name as string) ??
    (payload.tool_name as string) ??
    (payload.tool as string) ??
    '';
  return raw ? String(raw) : 'tool';
}

/** The LLM provider hands back a textual record of what was actually drawn
 *  from user-visible output. We never invent a target — if the payload has
 *  no recognisable input or argument fields, we leave it blank. */
function toolTargetFrom(payload: Record<string, unknown>): string {
  const inputs = payload.input ?? payload.arguments ?? payload.parameters ?? payload.args;
  if (typeof inputs === 'string') return inputs.slice(0, 140);
  if (inputs && typeof inputs === 'object') {
    try {
      const s = JSON.stringify(inputs);
      return s.length > 140 ? s.slice(0, 137) + '…' : s;
    } catch {
      return String(inputs).slice(0, 140);
    }
  }
  // Last-resort: a single field like `command`, `path`, `prompt` is the most
  // legible target a caller can surface.
  const interesting = (payload.command as string) ?? (payload.path as string) ?? (payload.prompt as string);
  return interesting ? String(interesting).slice(0, 140) : '';
}

/** Generate a meaningful, deterministic headline for a tool call from its
 *  payload. Never invents intent or reasoning — only formats what the
 *  runtime actually provided. */
function toolHeadlineFrom(toolName: string, payload: Record<string, unknown>): string {
  const target = toolTargetFrom(payload);
  const lower = toolName.toLowerCase();
  const input = (payload.input as Record<string, unknown>) || {};

  // Terminal/shell: show the actual command
  if (lower === 'terminal' || lower === 'bash' || lower === 'shell' || lower === 'exec') {
    const cmd = (payload.command as string) ?? (input.command as string) ?? '';
    if (cmd) {
      const short = cmd.trim().split(/\s+/)[0]; // first word (e.g., pytest, git, npm)
      const rest = cmd.trim().slice(short.length).trim();
      return `Running: ${short}${rest ? ' ' + rest.slice(0, 80) : ''}`;
    }
    return `Running terminal`;
  }

  // File reads: "Reading <path>"
  if (lower === 'read_file' || lower === 'cat' || lower === 'read') {
    const path = (payload.path as string) ?? (input.path as string) ?? target;
    return path ? `Reading ${path}` : 'Reading file';
  }

  // File writes/edits: "Writing <path>" / "Editing <path>"
  if (lower === 'write_file' || lower === 'write') {
    const path = (payload.path as string) ?? (input.path as string) ?? target;
    return path ? `Writing ${path}` : 'Writing file';
  }
  if (lower === 'edit_file' || lower === 'edit' || lower === 'patch') {
    const path = (payload.path as string) ?? (input.path as string) ?? target;
    return path ? `Editing ${path}` : 'Editing file';
  }

  // Search/grep: "Searching for <pattern>"
  if (lower === 'grep' || lower === 'search' || lower === 'glob' || lower === 'find') {
    const pattern = (payload.pattern as string) ?? (input.pattern as string) ?? target;
    return pattern ? `Searching for ${pattern}` : `Running ${toolName}`;
  }

  // List/ls: "Listing <path>"
  if (lower === 'ls' || lower === 'list' || lower === 'dir') {
    const path = (payload.path as string) ?? (input.path as string) ?? target;
    return path ? `Listing ${path}` : 'Listing directory';
  }

  // Test tools: "Testing <target>"
  if (lower === 'pytest' || lower === 'test' || lower === 'verify' || lower === 'lint' || lower === 'check') {
    const args = (payload.args as string[]) ?? (input.args as string[]) ?? [];
    const targetStr = Array.isArray(args) && args.length ? args.join(' ') : target;
    return targetStr ? `Testing ${targetStr}` : `Running ${toolName}`;
  }

  // Git: "Git <subcommand>"
  if (lower === 'git') {
    const sub = (payload.subcommand as string) ?? (input.subcommand as string) ?? ((payload.args as string[]) ?? [])[0] ?? '';
    return sub ? `Git ${sub}` : 'Running git';
  }

  // Web/browser: "Browsing <url>" or "Fetching <url>"
  if (lower === 'browse' || lower === 'web' || lower === 'fetch' || lower === 'http' || lower === 'web_search') {
    const url = (payload.url as string) ?? (input.url as string) ?? target;
    return url ? `Browsing ${url}` : `Running ${toolName}`;
  }

  // Memory/vault: "Recalling <query>" or "Storing memory"
  if (lower === 'memory' || lower === 'recall' || lower === 'vault' || lower === 'archive') {
    const query = (payload.query as string) ?? (input.query as string) ?? target;
    return query ? `Recalling ${query}` : `Running ${toolName}`;
  }

  // Generic fallback: use the tool target if available
  if (target) {
    return `${toolName} ${target}`.slice(0, 120);
  }

  return `Using ${toolName}`;
}

function resultSummaryFrom(payload: Record<string, unknown>): string {
  // Payload conventions, in observed order: `output` (string), `result`
  // (object or string), `content`, `error`/`is_error`.
  const isError = payload.is_error === true || payload.error || payload.failed === true;
  if (isError) {
    const msg = String(payload.error ?? payload.output ?? payload.message ?? 'Tool failed').slice(0, 160);
    return `Error: ${msg}`;
  }
  const out = payload.output ?? payload.result ?? payload.content;
  if (typeof out === 'string') return out.length > 160 ? out.slice(0, 157) + '…' : out;
  try {
    const s = JSON.stringify(out);
    return s.length > 160 ? s.slice(0, 157) + '…' : s;
  } catch {
    return String(out).slice(0, 160) || 'Tool finished';
  }
}

/**
 * Maps backend event types to bubble categories and target roles.
 * This is the "Bubble Event Adapter" from the architecture diagram.
 *
 * Returns `null` when the event carries no user-visible activity — never
 * fabricates content.
 */
export function categorizeEvent(event: {
  type: string;
  payload?: Record<string, unknown>;
  task_id?: string | null;
  sequence?: number;
  timestamp?: string;
}): { role: Role; category: BubbleCategory; content: BubbleContent } | null {
  const type = event.type;
  const payload = event.payload || {};
  const taskId = event.task_id || undefined;
  const sequence = event.sequence;
  const now = Date.now();

  // Tool use events
  if (type === 'hermes.tool_use') {
    const toolName = toolNameFrom(payload);
    const toolTarget = toolTargetFrom(payload);
    // §3: hermes.* events are executed by Hermes the coordinator. The tool
    // name determines only the functional category (shown as a secondary
    // tag), never the anchoring role.
    const role: Role = 'coordinator';
    const functionalCategory = determineFunctionalCategoryForTool(toolName);
    // tool_call_id ties the result back to this exact call so the matching
    // hermes.tool_result can update this bubble instead of stacking on top.
    const id = typeof payload.tool_call_id === 'string' ? payload.tool_call_id : undefined;

    return {
      role,
      category: 'tool',
      content: {
        id,
        headline: redactSensitive(toolHeadlineFrom(toolName, payload)),
        details: toolTarget ? redactSensitive(toolTarget) : undefined,
        toolName,
        toolTarget: redactSensitive(toolTarget),
        functionalCategory,
        status: 'running',
        startTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Tool result events
  if (type === 'hermes.tool_result') {
    const toolName = toolNameFrom(payload);
    const toolTarget = toolTargetFrom(payload);
    // §3: same rule as tool_use — role is always the coordinator; the tool
    // name only classifies the functional category.
    const role: Role = 'coordinator';
    const functionalCategory = determineFunctionalCategoryForTool(toolName);
    const isError = payload.is_error === true || payload.error || payload.failed === true;
    const id = typeof payload.tool_call_id === 'string' ? payload.tool_call_id : undefined;

    // For results, show the outcome. If we have a tool_call_id, the controller
    // will merge this with the original tool_use bubble, preserving the original
    // headline and target. The result's own headline summarizes the outcome.
    const resultSummary = resultSummaryFrom(payload);
    const headline = isError
      ? `Failed: ${toolName}`
      : (id ? `${toolName} returned` : `Completed: ${toolName}`);

    return {
      role,
      category: isError ? 'error' : 'success',
      content: {
        id,
        headline,
        details: resultSummary ? redactSensitive(resultSummary) : undefined,
        toolName,
        toolTarget: redactSensitive(toolTarget),
        functionalCategory,
        status: isError ? 'failed' : 'completed',
        startTime: now,
        endTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Hermes text output (assistant streamed response). One stable bubble per
  // task accumulates the latest text fragment.
  if (type === 'hermes.text') {
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) return null;

    // For streaming, we return the fragment. The controller merges fragments
    // for the same task by appending to the existing bubble's details.
    // The headline shows the latest fragment (truncated), details hold the
    // accumulated full text.
    return {
      role: 'coordinator',
      category: 'thought',
      content: {
        headline: text.length > 120 ? text.slice(0, 117) + '…' : text,
        details: text, // Single fragment; controller will accumulate
        status: 'running',
        startTime: now,
        taskId,
        sequence,
        // Mark this as a streaming fragment for accumulation
        _streamFragment: text,
      },
    };
  }

  // Final assistant answer (task response). The live payload carries the
  // complete response text; surface the first line as the headline so a
  // watcher sees what Hermes actually delivered, not just "Task completed".
  if (type === 'hermes.result') {
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    const exit = payload.exit_code;
    const headline = text
      ? (text.split(/\r?\n/).find(l => l.trim()) || text).slice(0, 120)
      : 'Task completed';
    return {
      role: 'coordinator',
      category: 'success',
      content: {
        headline: headline + (text.length > 120 ? '…' : ''),
        details: text.slice(0, 800) || (exit === 0 ? 'Result delivered cleanly' : `Result exit_code=${String(exit)}`),
        status: exit === 0 || exit === undefined ? 'completed' : 'failed',
        startTime: now,
        endTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Hermes system events — most are SDK init/heartbeat (not user-visible
  // activity). Surfacing "Runtime active" on every reconnect would be noise,
  // so we only keep the adapter handle but return null.
  if (type === 'hermes.system') {
    return null;
  }

  // Task lifecycle events
  if (type === 'task.queued') {
    return {
      role: 'coordinator',
      category: 'waiting',
      content: {
        headline: 'Task queued',
        details: 'Waiting to start',
        status: 'running',
        startTime: now,
        taskId,
        sequence,
      },
    };
  }

  if (type === 'task.started') {
    return {
      role: 'coordinator',
      category: 'execution',
      content: {
        headline: 'Task started',
        details: 'Hermes is working',
        status: 'running',
        startTime: now,
        taskId,
        sequence,
      },
    };
  }

  if (type === 'task.completed') {
    return {
      role: 'coordinator',
      category: 'success',
      content: {
        headline: 'Task completed',
        details: 'Result available',
        status: 'completed',
        startTime: now,
        endTime: now,
        taskId,
        sequence,
      },
    };
  }

  if (type === 'task.failed') {
    return {
      role: 'coordinator',
      category: 'error',
      content: {
        headline: 'Task failed',
        details: 'See the task record for the error',
        status: 'failed',
        startTime: now,
        endTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Workflow events (map to appropriate roles)
  const workflowRole = mapWorkflowEventToRole(type);
  if (workflowRole) {
    const activity = mapEventToActivity(type, payload);
    const category = activityToCategory(activity);
    const label = formatEventLabel(type, payload);

    return {
      role: workflowRole,
      category,
      content: {
        headline: label,
        status: activity === 'working' ? 'running' : activity === 'completed' ? 'completed' : activity === 'failed' ? 'failed' : 'running',
        startTime: now,
        endTime: activity !== 'working' ? now : undefined,
        taskId,
        sequence,
      },
    };
  }

  return null;
}

/** When a follow-up event arrives for the same bubble (e.g. hermes.tool_result
 *  after hermes.tool_use), preserve any earlier detail/target fields the new
 *  payload doesn't carry — a result event usually lacks the input arguments
 *  the original tool_use provided, so the file path / command would otherwise
 *  disappear from the result bubble. Empty strings count as "absent", not
 *  "set to empty", so they never clobber prior context.
 *
 *  For streaming hermes.text fragments, append the new fragment to the
 *  accumulated details so the full commentary builds up coherently.
 *
 *  For tool_result merging into tool_use (same tool_call_id), preserve the
 *  original meaningful headline and toolTarget from the tool_use bubble.
 *  HA-016: the anchor id belongs to the bubble created for the call — a
 *  merged follow-up must never overwrite it or concurrent same-tool calls
 *  lose their call/result correlation. */
export function mergeContent(oldC: BubbleContent, fresh: BubbleContent): BubbleContent {
  const merged: Record<string, unknown> = { ...oldC };
  for (const k of Object.keys(fresh) as (keyof BubbleContent)[]) {
    const v = fresh[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v === '') continue;
    if (k === 'id' && oldC.id) continue;

    // Special handling for streaming text fragments: append to accumulated details
    if (k === 'details' && typeof v === 'string' && fresh._streamFragment) {
      const existing = merged.details as string | undefined;
      const fragment = fresh._streamFragment as string;
      // Avoid duplicating in several cases:
      // 1. Fragment already at the end (incremental delta already applied)
      // 2. Existing content is a prefix of fragment (cumulative snapshot)
      // 3. Fragment is a prefix of existing (redundant delta)
      // 4. Fragment equals existing (duplicate)
      let shouldAppend = true;
      if (existing) {
        if (existing.endsWith(fragment) ||
            fragment.startsWith(existing) ||
            existing.startsWith(fragment) ||
            existing === fragment) {
          shouldAppend = false;
        }
      }
      if (shouldAppend) {
        merged[k] = (existing ? existing + fragment : fragment).slice(0, 4000); // Cap at 4KB
      } else {
        // For cumulative snapshots, use the full fragment as it's more complete
        merged[k] = fragment.startsWith(existing || '') ? fragment : (existing || fragment);
      }
      // Update headline to show the latest fragment (truncated)
      merged.headline = fragment.length > 120 ? fragment.slice(0, 117) + '…' : fragment;
      continue;
    }

    // Special handling for tool_result merging into tool_use: preserve original
    // headline and toolTarget from the tool_use bubble. The tool_result brings
    // status, endTime, and result details, but should not overwrite the
    // meaningful headline (e.g., "Reading backend/research.py") with a generic
    // one (e.g., "read_file returned").
    if (k === 'headline' && fresh.status && (fresh.status === 'completed' || fresh.status === 'failed')) {
      // This is a tool_result updating a tool_use bubble - keep the original headline
      continue;
    }
    if (k === 'toolTarget' && fresh.status && (fresh.status === 'completed' || fresh.status === 'failed')) {
      // Preserve original toolTarget from tool_use
      continue;
    }
    if (k === 'toolName' && fresh.status && (fresh.status === 'completed' || fresh.status === 'failed')) {
      // Preserve original toolName from tool_use
      continue;
    }
    if (k === 'startTime' && fresh.status && (fresh.status === 'completed' || fresh.status === 'failed')) {
      // Preserve original startTime from tool_use
      continue;
    }

    merged[k] = v;
  }
  return merged as unknown as BubbleContent;
}

function determineFunctionalCategoryForTool(toolName: string): string | undefined {
  const lower = (toolName || '').toLowerCase();

  // Research tools → research
  if (/read_file|read_file|grep|glob|search|docs?|web|browse|fetch|arxiv|source|study|^cat$|^ls$|find|read_\b/.test(lower)) {
    return 'research';
  }
  // Test tools → testing (before dev: `verify_build` is verification, not a build)
  if (/pytest|^test|verify|evaluate|benchmark|ctest|check|^lint/.test(lower)) {
    return 'testing';
  }
  // Memory tools → memory
  if (/memory|recall|vault|reflect|personality|lesson|archive|^note/.test(lower)) {
    return 'memory';
  }
  // Review / approval tools → review. Before planning so `approve_plan`
  // classifies as review, not planning.
  if (/review|approve|reject/.test(lower)) {
    return 'review';
  }
  // Planning tools → planning. Before dev so `compile_criteria` (plan
  // preparation) stays planning rather than development's `compile`.
  if (/plan|goal|formulate|criteria/.test(lower)) {
    return 'planning';
  }
  // Development tools → development
  if (/write_file|edit|patch(\b|$)|apply|git|compile|build|make|npm|cargo|revision|write_|create/.test(lower)) {
    return 'development';
  }

  return undefined;
}

function mapWorkflowEventToRole(type: string): Role | null {
  // Coordinator events
  if (/^(task|autonomy|decision|maintenance)\./.test(type)) return 'coordinator';
  // Researcher events
  if (/^(goal|discovery|curiosity|study)\./.test(type)) return 'researcher';
  // Planner events
  if (/^(formulation|investigation)\./.test(type)) return 'planner';

  // Implementation events route to different residents based on the stage
  // (spec §3: ONLY the executing category changes; the bubble still belongs
  // to Hermes when no specialist reads it).
  // Builder-specific stages
  if (/^implementation\.(started|environment_|revision_started|revision_completed|revision_failed)\./.test(type)) return 'builder';
  if (/^implementation\.(applied|apply_)/.test(type)) return 'builder';
  if (/^verification\.(auto_revision_queued|auto_revision_failed)/.test(type)) return 'builder';
  // Review stages
  if (/^implementation\.review_/.test(type)) return 'reviewer';
  // Tester stages
  if (/^implementation\.(evaluated|reevaluation_)/.test(type)) return 'tester';
  if (/^verification\./.test(type)) return 'tester';
  // Any remaining implementation.* event (e.g. implementation.failed) is
  // still reported by the implementation phase and lands on the builder
  // character — the verifier / reviewer still claim their own suffixes.
  if (/^implementation\./.test(type)) return 'builder';

  // Archivist events
  if (/^(memory|reflection|personality)\./.test(type)) return 'archivist';

  return null;
}

function mapEventToActivity(type: string, payload: Record<string, unknown> = {}): Activity {
  // A few event types encode their state in the payload instead of the
  // suffix (`implementation.evaluated`, `verification.*` carry `state` /
  // `disposition`). Read them first so callers see the actual outcome
  // rather than a default "unknown"-shaped execution category.
  const candidateState = (payload.state as string) ?? (payload.disposition as string) ?? (payload.status as string);
  if (candidateState) {
    const norm = candidateState.toLowerCase();
    if (/pass|verified|success|completed|accepted|corrected|applied|ready|recorded|hydrated/.test(norm)) return 'completed';
    if (/fail|cancel|interrupt|reject|rolled_back|stopped|error|blocked/.test(norm)) return 'failed';
    if (/queue|requested|pending|enabled|selected|reopened|retry/.test(norm)) return 'queued';
  }

  const tail = type.split('.').pop() || '';
  if (/(started|running)$/.test(tail)) return 'working';
  if (/(failed|error|blocked|interrupted|recovery_required|rolled_back|stopped|evaluated)$/.test(tail)) return 'failed';
  if (/(queued|requested|created|proposed|selected|enabled|reopened|retry|pending)$/.test(tail)) return 'queued';
  if (/(completed|summary|recorded|decided|applied|compiled|ready|passed|corrected|pruned|deleted|resumed|hydrated)$/.test(tail)) return 'completed';
  return 'unknown';
}

function activityToCategory(activity: Activity): BubbleCategory {
  switch (activity) {
    case 'working': return 'execution';
    case 'queued': return 'waiting';
    case 'completed': return 'success';
    case 'failed':
    case 'blocked': return 'error';
    default: return 'execution';
  }
}

function formatEventLabel(type: string, payload: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    'task.queued': 'Task queued',
    'task.started': 'Running the requested task',
    'task.completed': 'Task finished',
    'task.failed': 'Task failed',
    'goal.queued': 'Investigation queued',
    'goal.selected': 'Chose the next goal',
    'discovery.scan_completed': 'Project scan finished',
    'discovery.proposed': 'Finding proposed',
    'curiosity.investigation_requested': 'Curiosity question promoted',
    'formulation.started': 'Formulating a proposal',
    'formulation.proposed': 'Proposal drafted',
    'investigation.plan_started': 'Writing the investigation plan',
    'investigation.plan_completed': 'Plan drafted',
    'investigation.plan_approved': 'Plan approved',
    'implementation.started': 'Implementing in the isolated workspace',
    'implementation.environment_ready': 'Workspace prepared',
    'implementation.evaluated': 'Candidate evaluated',
    'implementation.failed': 'Build failed',
    'implementation.review_decided': 'Review decision recorded',
    'implementation.revision_queued': 'Revision queued',
    'implementation.revision_started': 'Revising the candidate',
    'implementation.revision_completed': 'Revision finished',
    'implementation.revision_failed': 'Revision failed',
    'implementation.applied': 'Applied to the host project',
    'implementation.apply_blocked': 'Host apply blocked',
    'verification.started': 'Verifying acceptance criteria',
    'verification.completed': 'Verification finished',
    'verification.failed': 'Verification failed',
    'verification.criteria_compiled': 'Criteria compiled',
    'memory.extraction_summary': 'Memory extracted',
    'memory.extraction_failed': 'Memory extraction failed',
    'reflection.recorded': 'Reflection recorded',
    'personality.profile_corrected': 'Profile corrected',
  };

  const base = labels[type] || type.split('.').pop()!.replace(/_/g, ' ');
  const project = typeof payload.project === 'string' && payload.project ? ` · ${payload.project}` : '';
  return base + project;
}

// ============================================================================
// Bubble Controller
// ============================================================================

export class BubbleController {
  private config: BubbleConfig;
  private bubbles = new Map<Role, BubbleState[]>();
  private history: BubbleState[] = [];
  private renderer: TownRenderer | null = null;
  private host: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  /** Reduced-motion media listener — disposed in destroy() (§13). */
  private mediaQuery: MediaQueryList | null = null;
  private mediaHandler: (() => void) | null = null;
  private animationFrame: number | null = null;
  private reducedMotion = false;
  private bubbleElements = new Map<string, HTMLElement>();
  /** Per-bubble dismissal timers, keyed by bubble id. Cancelled when the
   *  same bubble is updated so a quick stream of events doesn't dismiss
   *  the bubble early (UI-VIS-007 §10, "completed" replaces "running"). */
  private timers = new Map<string, number>();
  // HA-034 (§9): hover reveals the detail block after a short delay —
  // transient per-bubble timers and a reveal set, so leaving the pointer
  // re-hides only the hover reveal (never a click-expanded view).
  private hoverTimers = new Map<string, number>();
  private hoverRevealed = new Set<string>();
  // D10 (review.md): bubbles beyond maxPerResident are QUEUED + SUMMARIZED,
  // never silently discarded. Per-resident overflow counter + recent samples;
  // shown on the primary bubble as "+N more" and listed in the expanded view.
  // Cleared when the resident's bubbles drain to zero.
  private overflow = new Map<Role, { count: number; samples: string[] }>();
  /** Set on first event; used to ignore re-delivered events when the
   *  websocket reconnects and replays historical records. Resets when an
   *  explicit task boundary is observed. */
  private lastSequence = 0;

  constructor(config: Partial<BubbleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.reducedMotion = prefersReducedMotion();
  }

  /** Initialize the bubble overlay attached to the game container */
  initialize(host: HTMLElement, renderer: TownRenderer): void {
    this.host = host;
    this.renderer = renderer;

    // Create overlay container
    this.overlay = document.createElement('div');
    this.overlay.id = 'town-bubbles';
    this.overlay.className = 'town-bubbles';
    this.overlay.setAttribute('aria-live', 'polite');
    this.overlay.setAttribute('aria-label', 'Agent activity bubbles');
    host.appendChild(this.overlay);

    // Listen for reduced motion changes (handler removed in destroy())
    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.mediaHandler = () => {
      this.reducedMotion = this.mediaQuery?.matches ?? false;
    };
    this.mediaQuery.addEventListener('change', this.mediaHandler);

    // The renderer appends its <canvas> synchronously inside
    // createTownRenderer(); the position loop reads getBoundingClientRect()
    // each frame, so a missing canvas just resolves to a 0×0 rect until the
    // renderer's own resize() call lands. We kick off the loop immediately
    // and let it self-correct.
    this.startPositionLoop();
  }

  /** Process a new event and create/update bubbles. */
  processEvent(event: {
    type: string;
    payload?: Record<string, unknown>;
    task_id?: string | null;
    sequence?: number;
    timestamp?: string;
    /** Set by the shell for /api/events replays (page load). Historic events
     *  advance the watermark but must never replay as new execution (§14). */
    historical?: boolean;
  }): void {
    try {
      // Sequence de-dup. The backend hands us `?after=N` on reconnect so we
      // ignore anything we've already seen (§11 / acceptance 13).
      if (typeof event.sequence === 'number') {
        if (event.sequence <= this.lastSequence) return;
        this.lastSequence = event.sequence;
      }

      // Historic replay (page-load /api/events tail): the watermark above is
      // already advanced, so a later live re-delivery is still deduped — but
      // the historic event itself must not render as execution (§14).
      if (event.historical) return;

      const categorized = categorizeEvent(event);
      if (!categorized) return;

      // A new task lifecycle resets the per-task text accumulator so the
      // stream-coalesced thought bubble from a previous task doesn't
      // surface under the new task's head.
      if (event.type === 'task.queued' || event.type === 'task.started') {
        this.resetPerTaskBubbles(event.task_id || null);
      }

      const { role, category, content } = categorized;
      this.addOrUpdateBubble(role, category, content, event.task_id || null);
    } catch (err) {
      // A malformed event must never kill the overlay: log and continue.
      console.warn('bubble: failed to process event', event?.type, err);
    }
  }

  /** Drop per-task thought bubbles when a new task begins, so the old
   * coordinator stream doesn't bleed into the new head. Tool and lifecycle
   * bubbles stay — they're useful context for the running task. */
  private resetPerTaskBubbles(taskId: string | null) {
    if (!taskId) return;
    const drop: string[] = [];
    for (const role of this.bubbles.keys()) {
      const next: BubbleState[] = [];
      for (const b of this.bubbles.get(role) || []) {
        if (b.content.taskId === taskId && b.category === 'thought') {
          drop.push(b.id);
        } else {
          next.push(b);
        }
      }
      this.bubbles.set(role, next);
    }
    for (const id of drop) {
      const el = this.bubbleElements.get(id);
      if (el) {
        el.classList.add('exiting');
        window.setTimeout(() => this.removeBubbleElement(id), this.config.fadeDuration);
      }
      this.timers.delete(id);
      this.hoverTimers.delete(id);
      this.hoverRevealed.delete(id);
    }
  }

  /** Add or update a bubble for a role.
   *  State mutation and history recording are pure (run headless in tests);
   *  only the DOM work at the bottom is gated on the overlay existing. */
  private addOrUpdateBubble(role: Role, category: BubbleCategory, content: BubbleContent, taskId: string | null) {
    const roleBubbles = this.bubbles.get(role) || [];

    // Two matching strategies (HA-016):
    //  1. A tool_use / tool_result pair that shares a tool_call_id updates
    //     the existing bubble instead of stacking.
    //  2. The streamed thought bubble per task (same role+category+taskId).
    // Concurrent calls of the SAME tool carry distinct tool_call_ids and must
    // stay distinct bubbles — merging by category+toolName collapsed them and
    // orphaned the first result. `maxPerResident` + the overflow queue (D10)
    // bound the stack instead.
    let existingIndex = -1;
    if (content.id) {
      existingIndex = roleBubbles.findIndex(b => b.content.id === content.id);
    }
    if (existingIndex === -1 && category === 'thought' && taskId) {
      existingIndex = roleBubbles.findIndex(b => b.category === 'thought' && b.content.taskId === taskId);
    }

    let bubble: BubbleState;
    if (existingIndex >= 0) {
      bubble = roleBubbles[existingIndex];
      bubble.content = mergeContent(bubble.content, content);
      bubble.animationState = 'visible';
    } else {
      bubble = {
        id: `${role}-${category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        category,
        content,
        createdAt: Date.now(),
        visible: true,
        expanded: false,
        animationState: 'entering',
      };
      roleBubbles.unshift(bubble);

      // Enforce max per resident. The slot we just took is at index 0; older
      // entries are NOT discarded silently (review.md D10): they're queued
      // per-resident and summarized on the primary bubble ("+N more"), with
      // the sample headlines listed in the expanded view.
      while (roleBubbles.length > this.config.maxPerResident) {
        const removed = roleBubbles.pop();
        if (removed) {
          const rec = this.overflow.get(role) || { count: 0, samples: [] };
          rec.count += 1;
          const sample = removed.content.headline || removed.category;
          rec.samples.unshift((removed.category === 'error' ? '✗ ' : '') + sample);
          if (rec.samples.length > 5) rec.samples.length = 5;
          this.overflow.set(role, rec);
          this.timers.delete(removed.id);
          const el = this.bubbleElements.get(removed.id);
          if (el) {
            el.classList.add('exiting');
            window.setTimeout(() => this.removeBubbleElement(removed.id), this.config.fadeDuration);
          }
        }
      }
    }

    this.bubbles.set(role, roleBubbles);
    this.addToHistory(bubble);
    if (!this.overlay) return;
    this.renderBubble(bubble);
  }

  /** Add bubble to history (presentation cache, not authoritative storage). */
  private addToHistory(bubble: BubbleState): void {
    this.history.unshift({ ...bubble });
    if (this.history.length > this.config.maxHistory) {
      this.history.pop();
    }
  }

  /** Render a bubble to the DOM */
  private renderBubble(bubble: BubbleState): void {
    if (!this.overlay) return;

    let element = this.bubbleElements.get(bubble.id);
    const isNew = !element;

    if (isNew) {
      element = this.createBubbleElement(bubble);
      this.bubbleElements.set(bubble.id, element);
      this.overlay.appendChild(element);
    } else if (element) {
      this.updateBubbleElement(element, bubble);
    }

    // Position the bubble
    if (element) {
      this.positionBubble(element, bubble.role);

      // Entry animation, only once.
      if (isNew && !this.reducedMotion) {
        element.classList.add('entering');
        window.setTimeout(() => element.classList.remove('entering'), this.config.fadeDuration);
      }

      // Cancel any stale dismissal timer and re-arm so this update doesn't
      // get cut off by the previous event's schedule.
      this.scheduleDismissal(bubble);
    }
  }

  /** Create the bubble DOM element */
  private createBubbleElement(bubble: BubbleState): HTMLElement {
    const element = document.createElement('div');
    element.className = `town-bubble town-bubble--${bubble.category} town-bubble--${bubble.role}`;
    element.dataset.bubbleId = bubble.id;
    element.dataset.role = bubble.role;
    element.dataset.category = bubble.category;

    const roleInfo = ROSTER[bubble.role];
    const accentColor = roleInfo.accent;

    // Set custom property for accent color
    element.style.setProperty('--bubble-accent', accentColor);

    // Build content. The default layout preserves the spec's shape: pointer,
    // header (icon + role + category), content (headline + details + tool),
    // and a status indicator dot in the corner.
    const icon = this.getCategoryIcon(bubble.category);
    const roleLabel = roleInfo.name;
    const roleTitle = roleInfo.title;

    const parts: string[] = [];
    parts.push('<div class="town-bubble__pointer"></div>');
    parts.push('<div class="town-bubble__header">');
    parts.push(`<span class="town-bubble__icon" aria-hidden="true">${icon}</span>`);
    parts.push(`<span class="town-bubble__role" title="${this.escapeHtml(roleTitle)}">${this.escapeHtml(roleLabel)}</span>`);
    parts.push(`<span class="town-bubble__category">${this.getCategoryLabel(bubble.category)}</span>`);
    // §3 functional category: a secondary tag describing the KIND of work
    // (e.g. "development"), never a resident identity. Populated in
    // updateBubbleElement because a tool_result merge can add it later.
    parts.push('<span class="town-bubble__functional" hidden></span>');
    parts.push('</div>');
    parts.push('<div class="town-bubble__content">');
    parts.push(`<span class="town-bubble__headline"></span>`);
    if (bubble.content.details) {
      parts.push('<span class="town-bubble__details" hidden></span>');
    }
    if (bubble.content.toolName) {
      parts.push(`<span class="town-bubble__tool"></span>`);
    }
    if (bubble.content.toolTarget) {
      parts.push('<span class="town-bubble__target"></span>');
    }
    parts.push('</div>');
    // D10: queued/summarized overflow — one muted line on the primary bubble;
    // the expanded view lists the samples.
    parts.push('<span class="town-bubble__overflow" hidden></span>');
    if (bubble.content.startTime) {
      // §9 expanded tool-call details: start/completion times are metadata of
      // the expanded view, populated in updateBubbleElement.
      parts.push('<span class="town-bubble__times" hidden></span>');
    }
    if (bubble.content.status) {
      parts.push(`<div class="town-bubble__status town-bubble__status--${bubble.content.status}" aria-label="Status: ${bubble.content.status}"></div>`);
    }
    parts.push('<span class="town-bubble__expand" aria-hidden="true">more ▾</span>');
    // §9 navigation: a real button so the nav affordance is a distinct
    // target — bubble body toggles expansion, button routes to the record.
    parts.push('<button type="button" class="town-bubble__nav" hidden>Open in Results →</button>');

    element.innerHTML = parts.join('');

    // Populate the text-only spans via textContent so the values are safe
    // regardless of input.
    this.updateBubbleElement(element, bubble);

    const navButton = element.querySelector('.town-bubble__nav') as HTMLButtonElement | null;
    navButton?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (bubble.content.taskId) this.navigateToTask(bubble.content.taskId);
    });
    // Click on the bubble body toggles the expanded details (§9: hover OR
    // click reveals additional information — click is the reliable trigger;
    // hover highlights). The nav button is revealed once a task id exists.
    element.addEventListener('click', () => {
      this.toggleExpand(bubble.id);
      if (bubble.content.taskId) navButton?.removeAttribute('hidden');
      // §4.3.3: the inspector shows this event. Content was redacted at creation.
      window.dispatchEvent(new CustomEvent('hermes:bubble-select', {
        detail: { id: bubble.id, role: bubble.role, category: bubble.category, createdAt: bubble.createdAt, content: { ...bubble.content } },
      }));
    });
    element.addEventListener('mouseenter', () => this.onHover(bubble.id, true));
    element.addEventListener('mouseleave', () => this.onHover(bubble.id, false));

    return element;
  }

  /** Update existing bubble element — text-only, no innerHTML rebuild. */
  private updateBubbleElement(element: HTMLElement, bubble: BubbleState): void {
    element.className = `town-bubble town-bubble--${bubble.category} town-bubble--${bubble.role}`;
    element.dataset.category = bubble.category;

    // §3: show the functional category tag when present, hide otherwise
    // (the span always exists in the DOM; only its content/visibility vary).
    const functional = element.querySelector('.town-bubble__functional') as HTMLElement | null;
    if (functional) {
      if (bubble.content.functionalCategory) {
        functional.textContent = bubble.content.functionalCategory;
        functional.hidden = false;
      } else {
        functional.hidden = true;
        functional.textContent = '';
      }
    }

    const headline = element.querySelector('.town-bubble__headline');
    if (headline) headline.textContent = bubble.content.headline;

    const details = element.querySelector('.town-bubble__details') as HTMLElement | null;
    if (details) {
      if (bubble.content.details) {
        details.textContent = bubble.content.details;
        details.hidden = !this.detailOpen(bubble);
      } else {
        details.remove();
      }
    }

    const tool = element.querySelector('.town-bubble__tool');
    if (tool) {
      if (bubble.content.toolName) {
        tool.textContent = `Tool: ${bubble.content.toolName}`;
      } else {
        tool.remove();
      }
    }

    const target = element.querySelector('.town-bubble__target');
    if (target) {
      if (bubble.content.toolTarget) {
        target.textContent = bubble.content.toolTarget;
      } else {
        target.remove();
      }
    }

    const status = element.querySelector('.town-bubble__status');
    if (status && bubble.content.status) {
      status.className = `town-bubble__status town-bubble__status--${bubble.content.status}`;
      status.setAttribute('aria-label', `Status: ${bubble.content.status}`);
    } else if (status && !bubble.content.status) {
      status.remove();
    }

    // §9 expanded metadata: start and completion times. The start survives a
    // tool_use → tool_result merge; the end exists only once a result lands.
    const times = element.querySelector('.town-bubble__times') as HTMLElement | null;
    if (times) {
      const start = bubble.content.startTime;
      const end = bubble.content.endTime;
      if (start && end) {
        const fmt = (t: number) => new Date(t).toLocaleTimeString();
        times.textContent = `Started ${fmt(start)} · Finished ${fmt(end)}`;
      } else if (start) {
        times.textContent = `Started ${new Date(start).toLocaleTimeString()}`;
      }
      times.hidden = !this.detailOpen(bubble);
    }

    // D10: queued/summarized overflow. The compact line always shows the count
    // when non-zero; the expanded view appends the sample headlines.
    const queued = element.querySelector('.town-bubble__overflow') as HTMLElement | null;
    if (queued) {
      const rec = this.overflow.get(bubble.role);
      if (rec && rec.count > 0) {
        queued.textContent = `+${rec.count} more queued event${rec.count === 1 ? '' : 's'}`;
        queued.hidden = false;
        if (bubble.expanded) {
          const list = document.createElement('div');
          list.className = 'town-bubble__overflow-list';
          for (const s of rec.samples) {
            const line = document.createElement('div');
            line.className = 'town-bubble__overflow-item';
            line.textContent = s;
            list.appendChild(line);
          }
          queued.appendChild(list);
        }
      } else {
        queued.hidden = true;
        queued.textContent = '';
      }
    }

    // Update accent color — for hermes.* tool events the role is always the
    // coordinator (§3), so the accent stays Hermes's teal across the
    // tool_use → tool_result merge.
    element.style.setProperty('--bubble-accent', ROSTER[bubble.role].accent);
  }

  /** Helper used when a resident walks off-screen: fade the bubble rather than
   *  leave it pinned to its last known coords. The base setOpacity handles
   *  '0' → '' (clear) and any numeric value without flicker. */
  private setBubbleHidden(element: HTMLElement, hidden: boolean): void {
    element.style.opacity = hidden ? '0' : '';
  }

  /** Position bubble above character's head, clamped to the canvas. */
  private positionBubble(element: HTMLElement, role: Role): void {
    if (!this.renderer || !this.host) return;

    const positions = this.renderer.positions();
    const residentPos = positions.find(p => p.role === role);
    if (!residentPos) {
      // If the resident isn't visible right now, fade the bubble rather than
      // bleed off the canvas. The bubble stays attached so the running state
      // isn't lost when the resident walks back into view.
      this.setBubbleHidden(element, true);
      return;
    }
    this.setBubbleHidden(element, false);

    const canvas = this.host.querySelector('canvas');
    const overlay = this.overlay;
    if (!canvas || !overlay) return;
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();

    // Convert renderer's design-space coords (800x425) to overlay pixels.
    const scaleX = canvasRect.width / 800;
    const scaleY = canvasRect.height / 425;

    // Phase 5: use the animated resident's world-projected head, not a
    // hard-coded pixel lift (which fails when the eight-room camera changes).
    // Static renderers and earlier compatible renderers use a bounded fallback.
    const anchorX = residentPos.headX ?? residentPos.x;
    const anchorY = residentPos.headY ?? (residentPos.y - 58);
    let x = anchorX * scaleX + canvasRect.left - overlayRect.left;
    let y = (anchorY - 8) * scaleY + canvasRect.top - overlayRect.top;

    // Clamp so the bubble stays inside the canvas. We allow a small margin
    // so the bubble's own translateX(-50%) doesn't push it past the edge.
    // HA-033: measure the live element — bubbles.css allows 200-320px wide
    // (400-500px expanded) — instead of trusting stale half-width constants.
    const margin = 8;
    const halfW = (element.offsetWidth || 220) / 2;
    if (canvasRect.width < halfW * 2 + margin * 2) {
      element.style.maxWidth = `${Math.max(120, canvasRect.width - margin * 2)}px`;
      x = canvasRect.width / 2;
    } else {
      element.style.maxWidth = '';
      x = Math.max(halfW + margin, Math.min(canvasRect.width - halfW - margin, x));
    }
    // y is the bubble's anchor point (after translateY(-100%) the bubble
    // body sits above this y). Keep the MEASURED body — not a 110px guess —
    // inside the canvas so it never bleeds past the top.
    y = clampAnchorTop(y, element.offsetHeight || 110, canvasRect.height, margin);

    element.style.left = `${Math.round(x)}px`;
    element.style.top = `${Math.round(y)}px`;
    element.style.transform = 'translateX(-50%) translateY(-100%)';
  }

  /** Update all bubble positions (called each animation frame). */
  private updateAllPositions(): void {
    if (!this.overlay || !this.renderer) return;
    // Skip work when the host/canvas are hidden — the loop continues to run
    // so resume is instant.
    if (document.hidden) return;

    for (const [id, element] of this.bubbleElements) {
      const bubble = this.findBubbleById(id);
      if (bubble && bubble.visible && bubble.animationState !== 'exiting') {
        this.positionBubble(element, bubble.role);
      }
    }
    this.resolveOverlaps();
  }

  /** §7/§8: bubbles of different residents must not cover one another. After
   *  each bubble has been anchored to its resident, nudge any later (lower
   *  priority = newer) bubble upward so it stacks above the one it collides
   *  with. Bounded work: at most one bubble per resident (≤7 rects), one
   *  layout read per frame only when two or more bubbles are visible. */
  private resolveOverlaps(): void {
    const overlay = this.overlay;
    if (!overlay || this.bubbleElements.size < 2) return;
    const rects: Array<{
      id: string; left: number; top: number; width: number; height: number; createdAt: number;
    }> = [];
    for (const [id, element] of this.bubbleElements) {
      const bubble = this.findBubbleById(id);
      if (!bubble || !bubble.visible || bubble.animationState === 'exiting') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      rects.push({ id, left: rect.left, top: rect.top, width: rect.width, height: rect.height, createdAt: bubble.createdAt });
    }
    if (rects.length < 2) return;
    rects.sort((a, b) => a.createdAt - b.createdAt);
    // HA-033: bound the plan by the overlay (same space as the rects) so a
    // nudge can never push a body past the top — stacking flips downward
    // when the space above is exhausted.
    const margin = 8;
    const oRect = overlay.getBoundingClientRect();
    const bounds = { top: oRect.top + margin, bottom: oRect.bottom - margin };
    const plan = planOverlapAdjustments(rects, margin, bounds);
    for (const { id, deltaTop } of plan) {
      const element = this.bubbleElements.get(id);
      if (!element) continue;
      const current = parseFloat(element.style.top);
      if (Number.isNaN(current)) continue;
      // Re-clamp the final anchor against the overlay height: the plan is
      // pure geometry and can't see the body's live offsetHeight.
      const top = clampAnchorTop(current + deltaTop, element.offsetHeight, oRect.height, margin);
      element.style.top = `${Math.round(top)}px`;
    }
  }

  /** Find bubble by ID across all roles */
  private findBubbleById(id: string): BubbleState | undefined {
    for (const bubbles of this.bubbles.values()) {
      const found = bubbles.find(b => b.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /** Start the position update loop */
  private startPositionLoop(): void {
    const tick = () => {
      this.updateAllPositions();
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  /** Stop the position update loop */
  stopPositionLoop(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /** Schedule (or replace) a bubble's dismissal timer. */
  private scheduleDismissal(bubble: BubbleState): void {
    const existing = this.timers.get(bubble.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const duration = bubble.content.status === 'completed' || bubble.content.status === 'failed'
      ? this.config.terminalDuration
      : this.config.defaultDuration;

    const handle = window.setTimeout(() => {
      this.timers.delete(bubble.id);
      this.dismissBubble(bubble.id);
    }, duration);
    this.timers.set(bubble.id, handle);
  }

  /** Dismiss a bubble with animation */
  dismissBubble(id: string): void {
    const bubble = this.findBubbleById(id);
    if (!bubble) return;
    const element = this.bubbleElements.get(id);

    // Cancel the dismissal timer (idempotent — may already have fired).
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(id);
    }
    const hover = this.hoverTimers.get(id);
    if (hover !== undefined) {
      sooner(hover);
      this.hoverTimers.delete(id);
    }
    this.hoverRevealed.delete(id);

    bubble.animationState = 'exiting';
    bubble.visible = false;

    // D10 fix: dismissal works on the STATE even when no DOM element exists
    // (a headless/offscreen controller still owns its bubble list) — without
    // this, programmatic dismissal silently leaked the records.
    if (element) {
      if (!this.reducedMotion) {
        element.classList.add('exiting');
        window.setTimeout(() => this.removeBubbleElement(id), this.config.fadeDuration);
      } else {
        this.removeBubbleElement(id);
      }
    }

    // Remove from role bubbles
    const roleBubbles = this.bubbles.get(bubble.role);
    if (roleBubbles) {
      const index = roleBubbles.findIndex(b => b.id === id);
      if (index >= 0) roleBubbles.splice(index, 1);
      // D10: when a resident's bubbles drain to zero, its queued summary has
      // nothing to attach to anymore — clear it rather than leak it.
      if (roleBubbles.length === 0) this.overflow.delete(bubble.role);
    }
  }

  /** Remove bubble element from DOM */
  private removeBubbleElement(id: string): void {
    const element = this.bubbleElements.get(id);
    if (element) {
      element.remove();
      this.bubbleElements.delete(id);
    }
  }

  /** Toggle expanded view (click). State-first so a headless controller
   *  still tracks the view (like dismissBubble, D10). */
  private toggleExpand(id: string): void {
    const bubble = this.findBubbleById(id);
    if (!bubble) return;

    bubble.expanded = !bubble.expanded;
    this.syncExpansion(id);
    const expand = this.bubbleElements.get(id)?.querySelector('.town-bubble__expand');
    if (expand) expand.textContent = bubble.expanded ? 'less ▴' : 'more ▾';
  }

  /** §9: the detail block is open when clicked OR hover-revealed (HA-034). */
  private detailOpen(bubble: BubbleState): boolean {
    return bubble.expanded || this.hoverRevealed.has(bubble.id);
  }

  /** Reveal/hide the §9 detail block — the single path behind click and
   *  hover so both expose exactly the same metadata. */
  private syncExpansion(id: string): void {
    const bubble = this.findBubbleById(id);
    if (!bubble) return;
    const open = this.detailOpen(bubble);
    const element = this.bubbleElements.get(id);
    if (!element) return;
    element.classList.toggle('expanded', open);
    const details = element.querySelector('.town-bubble__details') as HTMLElement | null;
    if (details) details.hidden = !open;
    const times = element.querySelector('.town-bubble__times') as HTMLElement | null;
    if (times) times.hidden = !open;
  }

  /** Dispatch to the existing Activity workspace with the chosen task id. */
  private navigateToTask(taskId: string): void {
    if (!taskId) return;
    window.dispatchEvent(new CustomEvent('hermes:open-task', { detail: { id: taskId } }));
  }

  /** HA-034 (§9 "hover OR click exposes details"): hover reveals the same
   *  detail block click shows, after HOVER_REVEAL_DELAY so pointer sweeps
   *  don't flap the view. The reveal is transient — leaving re-hides it but
   *  never collapses a click-expanded bubble. */
  private onHover(id: string, entering: boolean): void {
    const element = this.bubbleElements.get(id);
    if (element) element.classList.toggle('hovered', entering);
    const pending = this.hoverTimers.get(id);
    if (pending !== undefined) {
      sooner(pending);
      this.hoverTimers.delete(id);
    }
    if (!entering) {
      this.hoverRevealed.delete(id);
      this.syncExpansion(id);
      return;
    }
    this.hoverTimers.set(id, later(() => {
      this.hoverTimers.delete(id);
      this.hoverRevealed.add(id);
      this.syncExpansion(id);
    }, HOVER_REVEAL_DELAY));
  }

  /** Get icon for category */
  private getCategoryIcon(category: BubbleCategory): string {
    switch (category) {
      case 'thought': return '💭';
      case 'tool': return '⚙';
      case 'execution': return '⚡';
      case 'success': return '✓';
      case 'error': return '✗';
      case 'waiting': return '⏳';
    }
  }

  /** Get label for category */
  private getCategoryLabel(category: BubbleCategory): string {
    return CATEGORY_LABELS[category];
  }

  /** Escape HTML for safe insertion, including in attribute context (the
   *  quote entities matter for title="…"). Only used for static template
   *  strings (role labels, category labels, role titles) — bubble content is
   *  written with textContent in updateBubbleElement. */
  private escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]!));
  }

  /** Get a snapshot of all current bubbles (used in tests and for diagnostics). */
  getBubbles(): BubbleState[] {
    const all: BubbleState[] = [];
    for (const bubbles of this.bubbles.values()) {
      all.push(...bubbles);
    }
    return all;
  }

  /** Get history */
  getHistory(): BubbleState[] {
    return [...this.history];
  }

  /** Render the §11 recent-bubble history into a host element. Presentation
   *  cache only — Activity/Results remain the authoritative record. */
  renderHistoryInto(host: HTMLElement, limit = 20): void {
    host.replaceChildren();
    const rows = formatHistoryRows(this.history, limit);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'town-bubble-history__empty';
      empty.textContent = 'No bubble activity recorded yet this session.';
      host.append(empty);
      return;
    }
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'town-bubble-history__row';
      const time = document.createElement('span');
      time.className = 'town-bubble-history__time';
      time.textContent = row.time;
      const role = document.createElement('strong');
      role.textContent = `${row.roleName} · ${row.categoryLabel}`;
      role.title = row.roleTitle;
      const detail = document.createElement('span');
      detail.className = 'town-bubble-history__detail';
      detail.textContent = [row.tool, row.headline, row.status].filter(Boolean).join(' — ');
      item.append(time, role, detail);
      if (row.taskId) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'town-bubble-history__open';
        open.textContent = `task ${row.taskId.slice(0, 8)}`;
        open.addEventListener('click', () => this.navigateToTask(row.taskId!));
        item.append(open);
      }
      host.append(item);
    }
  }

  /** Clean up */
  destroy(): void {
    this.stopPositionLoop();
    if (this.mediaQuery && this.mediaHandler) {
      this.mediaQuery.removeEventListener('change', this.mediaHandler);
    }
    this.mediaQuery = null;
    this.mediaHandler = null;
    this.bubbleElements.forEach((_, id) => this.removeBubbleElement(id));
    this.bubbles.clear();
    this.history.length = 0;
    for (const handle of this.timers.values()) window.clearTimeout(handle);
    this.timers.clear();
    for (const handle of this.hoverTimers.values()) sooner(handle);
    this.hoverTimers.clear();
    this.hoverRevealed.clear();
    this.overlay?.remove();
    this.overlay = null;
    this.host = null;
    this.renderer = null;
  }
}

// ============================================================================
// Utility
// ============================================================================

export const CATEGORY_LABELS: Record<BubbleCategory, string> = {
  thought: 'Thought',
  tool: 'Tool',
  execution: 'Executing',
  success: 'Success',
  error: 'Error',
  waiting: 'Waiting',
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** window timers in the browser, global timers headless — the HA-034 hover
 *  path must run without a document. */
function later(fn: () => void, ms: number): number {
  const host = typeof window !== 'undefined' ? window : globalThis;
  return host.setTimeout(fn, ms) as unknown as number;
}
function sooner(handle: number): void {
  const host = typeof window !== 'undefined' ? window : globalThis;
  host.clearTimeout(handle);
}

/** One inspectable row of the §11 presentation cache. Pure so tests can run
 *  headless; renderHistoryInto only turns these into DOM. */
export interface HistoryRowDescriptor {
  time: string;
  roleName: string;
  roleTitle: string;
  categoryLabel: string;
  tool?: string;
  headline: string;
  status?: string;
  taskId?: string;
}

/** Format the most recent `limit` history entries for display (§11). */
export function formatHistoryRows(history: BubbleState[], limit = 20): HistoryRowDescriptor[] {
  return history.slice(0, Math.max(1, limit)).map(b => ({
    time: new Date(b.createdAt).toLocaleTimeString(),
    roleName: ROSTER[b.role].name,
    roleTitle: ROSTER[b.role].title,
    categoryLabel: CATEGORY_LABELS[b.category],
    tool: b.content.toolName,
    headline: b.content.headline,
    status: b.content.status,
    taskId: b.content.taskId,
  }));
}

/**
 * Plan vertical adjustments so overlapping bubbles stack above each other
 * instead of covering one another (§7/§8). `items` arrive in priority order
 * (oldest/highest priority first — each keeps its anchor position); every
 * later item that intersects an already-placed one is moved to sit just
 * above it. Pure geometry so tests can run headless.
 *
 * HA-033: optional `bounds` (same coordinate space as `items`) keep nudged
 * bodies inside the overlay — stacking flips DOWNWARD when the space above
 * runs out, and the final top is re-clamped to the bounds.
 */
export function planOverlapAdjustments(
  items: Array<{ id: string; left: number; top: number; width: number; height: number }>,
  margin = 8,
  bounds?: { top: number; bottom: number },
): Array<{ id: string; deltaTop: number }> {
  const adjusted = new Map<string, number>();
  const placed: Array<{ id: string; left: number; top: number; width: number; height: number }> = [];
  for (const item of items) {
    let top = item.top + (adjusted.get(item.id) ?? 0);
    for (const p of placed) {
      const pTop = p.top + (adjusted.get(p.id) ?? 0);
      const horizontalOverlap =
        item.left < p.left + p.width + margin &&
        p.left < item.left + item.width + margin;
      const verticalOverlap =
        top < pTop + p.height + margin &&
        pTop < top + item.height + margin;
      if (horizontalOverlap && verticalOverlap) {
        // Sit fully above the colliding (higher-priority) bubble — or below
        // it when the overlay top has no room left (HA-033).
        const above = pTop - item.height - margin;
        if (bounds && above < bounds.top) {
          top = Math.min(pTop + p.height + margin, bounds.bottom - item.height);
        } else {
          top = above;
        }
      }
    }
    if (bounds) top = Math.max(bounds.top, Math.min(bounds.bottom - item.height, top));
    adjusted.set(item.id, top - item.top);
    placed.push(item);
  }
  return [...adjusted.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([id, deltaTop]) => ({ id, deltaTop }));
}

/**
 * Clamp a bubble's anchor `top` (the body renders translateY(-100%) above
 * it) so the measured body stays inside an overlay of `height`. HA-033:
 * driven by the live offsetHeight — bubbles.css allows up to 500px expanded,
 * far past the old 110px constant. Pure so the geometry is testable headless.
 */
export function clampAnchorTop(top: number, bodyHeight: number, height: number, margin = 8): number {
  return Math.max(bodyHeight + margin, Math.min(height - margin, top));
}