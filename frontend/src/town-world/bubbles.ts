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

// ============================================================================
// Event-to-Role Mapping (mirrors town-model.ts but for bubble categories)
// ============================================================================

const RUNTIME_EVENTS = /^hermes\.(text|system|tool_use|tool_result|result)$/;

/**
 * Maps backend event types to bubble categories and target roles.
 * This is the "Bubble Event Adapter" from the architecture diagram.
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
    const toolName = extractToolName(payload);
    const toolTarget = extractToolTarget(payload);
    const role = determineRoleForTool(payload) || 'coordinator';

    return {
      role,
      category: 'tool',
      content: {
        headline: `Using ${toolName}`,
        details: toolTarget,
        toolName,
        toolTarget,
        status: 'running',
        startTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Tool result events
  if (type === 'hermes.tool_result') {
    const toolName = extractToolName(payload);
    const role = determineRoleForTool(payload) || 'coordinator';
    const isError = payload.error || payload.failed || payload.status === 'error';

    return {
      role,
      category: isError ? 'error' : 'success',
      content: {
        headline: isError ? `Failed: ${toolName}` : `Completed: ${toolName}`,
        details: extractResultSummary(payload),
        toolName,
        toolTarget: extractToolTarget(payload),
        status: isError ? 'failed' : 'completed',
        startTime: now,
        endTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Hermes text output (assistant responses)
  if (type === 'hermes.text') {
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (!text.trim()) return null;

    return {
      role: 'coordinator',
      category: 'thought',
      content: {
        headline: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
        details: text,
        status: 'running',
        startTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Hermes result (task completion)
  if (type === 'hermes.result') {
    return {
      role: 'coordinator',
      category: 'success',
      content: {
        headline: 'Task completed',
        details: 'Hermes response finished',
        status: 'completed',
        startTime: now,
        endTime: now,
        taskId,
        sequence,
      },
    };
  }

  // Hermes system events
  if (type === 'hermes.system') {
    return {
      role: 'coordinator',
      category: 'execution',
      content: {
        headline: 'Runtime active',
        status: 'running',
        startTime: now,
        taskId,
        sequence,
      },
    };
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
        details: 'Check the task result',
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
    const activity = mapEventToActivity(type);
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

function extractToolName(payload: Record<string, unknown>): string {
  return (
    (payload.tool_name as string) ||
    (payload.tool as string) ||
    (payload.name as string) ||
    'Hermes tool'
  );
}

function extractToolTarget(payload: Record<string, unknown>): string {
  const inputs = payload.input ?? payload.arguments ?? payload.parameters;
  if (typeof inputs === 'string') return inputs.slice(0, 80);
  if (inputs && typeof inputs === 'object') {
    try {
      return JSON.stringify(inputs).slice(0, 80);
    } catch {
      return String(inputs).slice(0, 80);
    }
  }
  return '';
}

function extractResultSummary(payload: Record<string, unknown>): string {
  if (payload.error) return `Error: ${String(payload.error).slice(0, 100)}`;
  if (payload.output) return String(payload.output).slice(0, 120);
  if (payload.result) return String(payload.result).slice(0, 120);
  return 'Tool finished';
}

function determineRoleForTool(payload: Record<string, unknown>): Role | null {
  const toolName = extractToolName(payload).toLowerCase();

  // Research tools → Sage
  if (/read_file|read|grep|glob|search|docs|doc|web|browse|fetch|arxiv|source|study|cat$|ls$|find/i.test(toolName)) {
    return 'researcher';
  }
  // Development tools → Forge
  if (/write_file|edit|patch|apply|git|compile|build|make|npm|cargo|revision|write/i.test(toolName)) {
    return 'builder';
  }
  // Test tools → Patch
  if (/pytest|test|verify|evaluate|benchmark|ctest|check|lint/i.test(toolName)) {
    return 'tester';
  }
  // Memory tools → Echo
  if (/memory|recall|vault|reflect|personality|lesson|archive|note/i.test(toolName)) {
    return 'archivist';
  }
  // Planning/review tools → Piper/Vale
  if (/plan|goal|formulate|criteria|approve|review/i.test(toolName)) {
    return 'planner';
  }

  return null;
}

function mapWorkflowEventToRole(type: string): Role | null {
  // Coordinator events
  if (/^(task|autonomy|decision|maintenance)\./.test(type)) return 'coordinator';
  // Researcher events
  if (/^(goal|discovery|curiosity|study)\./.test(type)) return 'researcher';
  // Planner events
  if (/^(formulation|investigation)\./.test(type)) return 'planner';
  // Builder events
  if (/^implementation\.(started|revision_|environment_)/.test(type)) return 'builder';
  if (/^implementation\./.test(type)) return 'builder';
  if (/^verification\.(auto_revision_queued|auto_revision_failed)/.test(type)) return 'builder';
  // Tester events
  if (/^implementation\.(evaluated|reevaluation_)/.test(type)) return 'tester';
  if (/^verification\./.test(type)) return 'tester';
  // Reviewer events
  if (/^implementation\.(applied|apply_|review_)/.test(type)) return 'reviewer';
  // Archivist events
  if (/^(memory|reflection|personality)\./.test(type)) return 'archivist';

  return null;
}

function mapEventToActivity(type: string): Activity {
  const tail = type.split('.').pop() || '';
  if (/(started|running)$/.test(tail)) return 'working';
  if (/(failed|error|blocked|interrupted|recovery_required|rolled_back|stopped)$/.test(tail)) return 'failed';
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
  private animationFrame: number | null = null;
  private reducedMotion = false;
  private bubbleElements = new Map<string, HTMLElement>();

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

    // Listen for reduced motion changes
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    mediaQuery.addEventListener('change', () => {
      this.reducedMotion = mediaQuery.matches;
    });

    // Start position update loop
    this.startPositionLoop();
  }

  /** Process a new event and create/update bubbles */
  processEvent(event: {
    type: string;
    payload?: Record<string, unknown>;
    task_id?: string | null;
    sequence?: number;
    timestamp?: string;
  }): void {
    const categorized = categorizeEvent(event);
    if (!categorized) return;

    const { role, category, content } = categorized;
    this.addOrUpdateBubble(role, category, content);
  }

  /** Add or update a bubble for a role */
  private addOrUpdateBubble(role: Role, category: BubbleCategory, content: BubbleContent): void {
    if (!this.overlay) return;

    const roleBubbles = this.bubbles.get(role) || [];
    const existingIndex = roleBubbles.findIndex(b => b.category === category && b.content.toolName === content.toolName);

    let bubble: BubbleState;
    if (existingIndex >= 0) {
      // Update existing bubble
      bubble = roleBubbles[existingIndex];
      bubble.content = { ...bubble.content, ...content };
      bubble.animationState = 'visible';
    } else {
      // Create new bubble
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

      // Enforce max per resident
      if (roleBubbles.length > this.config.maxPerResident) {
        const removed = roleBubbles.pop();
        if (removed) this.dismissBubble(removed.id);
      }
    }

    this.bubbles.set(role, roleBubbles);
    this.addToHistory(bubble);
    this.renderBubble(bubble);
  }

  /** Add bubble to history */
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

      // Handle animation
      if (isNew && !this.reducedMotion) {
        element.classList.add('entering');
        setTimeout(() => element.classList.remove('entering'), this.config.fadeDuration);
      }

      // Schedule dismissal
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

    // Build content
    const icon = this.getCategoryIcon(bubble.category);
    const roleLabel = roleInfo.name;

    element.innerHTML = `
      <div class="town-bubble__pointer"></div>
      <div class="town-bubble__header">
        <span class="town-bubble__icon" aria-hidden="true">${icon}</span>
        <span class="town-bubble__role">${roleLabel}</span>
        <span class="town-bubble__category">${this.getCategoryLabel(bubble.category)}</span>
      </div>
      <div class="town-bubble__content">
        <span class="town-bubble__headline">${this.escapeHtml(bubble.content.headline)}</span>
        ${bubble.content.details ? `<span class="town-bubble__details">${this.escapeHtml(bubble.content.details)}</span>` : ''}
        ${bubble.content.toolName ? `<span class="town-bubble__tool">Tool: <code>${this.escapeHtml(bubble.content.toolName)}</code></span>` : ''}
        ${bubble.content.toolTarget ? `<span class="town-bubble__target">${this.escapeHtml(bubble.content.toolTarget)}</span>` : ''}
      </div>
      ${bubble.content.status ? `<div class="town-bubble__status town-bubble__status--${bubble.content.status}" aria-label="Status: ${bubble.content.status}"></div>` : ''}
    `;

    // Click handler for expanded view
    element.addEventListener('click', () => this.toggleExpand(bubble.id));
    element.addEventListener('mouseenter', () => this.onHover(bubble.id, true));
    element.addEventListener('mouseleave', () => this.onHover(bubble.id, false));

    return element;
  }

  /** Update existing bubble element */
  private updateBubbleElement(element: HTMLElement, bubble: BubbleState): void {
    element.className = `town-bubble town-bubble--${bubble.category} town-bubble--${bubble.role}`;
    element.dataset.category = bubble.category;

    const headline = element.querySelector('.town-bubble__headline');
    if (headline) headline.textContent = bubble.content.headline;

    const details = element.querySelector('.town-bubble__details');
    if (details && bubble.content.details) details.textContent = bubble.content.details;
    else if (details && !bubble.content.details) details.remove();

    const tool = element.querySelector('.town-bubble__tool');
    if (tool && bubble.content.toolName) {
      tool.innerHTML = `Tool: <code>${this.escapeHtml(bubble.content.toolName)}</code>`;
    } else if (tool && !bubble.content.toolName) {
      tool.remove();
    }

    const target = element.querySelector('.town-bubble__target');
    if (target && bubble.content.toolTarget) {
      target.textContent = bubble.content.toolTarget;
    } else if (target && !bubble.content.toolTarget) {
      target.remove();
    }

    const status = element.querySelector('.town-bubble__status');
    if (status && bubble.content.status) {
      status.className = `town-bubble__status town-bubble__status--${bubble.content.status}`;
    }

    // Update accent color
    element.style.setProperty('--bubble-accent', ROSTER[bubble.role].accent);
  }

  /** Position bubble above character's head */
  private positionBubble(element: HTMLElement, role: Role): void {
    if (!this.renderer || !this.host) return;

    const positions = this.renderer.positions();
    const residentPos = positions.find(p => p.role === role);
    if (!residentPos) return;

    // Get canvas rect for coordinate conversion
    const canvas = this.host.querySelector('canvas');
    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = this.overlay!.getBoundingClientRect();

    // Convert renderer's design-space coordinates to screen coordinates
    // The renderer returns positions in DESIGN space (800x425)
    const scaleX = canvasRect.width / 800;
    const scaleY = canvasRect.height / 425;

    // Position above head (head is roughly at y - 2.5 in world units, which projects to screen)
    // The renderer's positions() already gives us screen coordinates in design space
    const x = residentPos.x * scaleX + canvasRect.left - overlayRect.left;
    const y = (residentPos.y - 60) * scaleY + canvasRect.top - overlayRect.top; // Offset above head

    element.style.left = `${Math.round(x)}px`;
    element.style.top = `${Math.round(y)}px`;
    element.style.transform = 'translateX(-50%) translateY(-100%)';
  }

  /** Update all bubble positions (called each frame) */
  private updateAllPositions(): void {
    if (!this.overlay || !this.renderer) return;

    for (const [id, element] of this.bubbleElements) {
      const bubble = this.findBubbleById(id);
      if (bubble && bubble.visible && bubble.animationState !== 'exiting') {
        this.positionBubble(element, bubble.role);
      }
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

  /** Schedule bubble dismissal */
  private scheduleDismissal(bubble: BubbleState): void {
    const duration = bubble.content.status === 'completed' || bubble.content.status === 'failed'
      ? this.config.terminalDuration
      : this.config.defaultDuration;

    setTimeout(() => {
      this.dismissBubble(bubble.id);
    }, duration);
  }

  /** Dismiss a bubble with animation */
  dismissBubble(id: string): void {
    const element = this.bubbleElements.get(id);
    const bubble = this.findBubbleById(id);
    if (!element || !bubble) return;

    bubble.animationState = 'exiting';
    bubble.visible = false;

    if (!this.reducedMotion) {
      element.classList.add('exiting');
      setTimeout(() => this.removeBubbleElement(id), this.config.fadeDuration);
    } else {
      this.removeBubbleElement(id);
    }

    // Remove from role bubbles
    const roleBubbles = this.bubbles.get(bubble.role);
    if (roleBubbles) {
      const index = roleBubbles.findIndex(b => b.id === id);
      if (index >= 0) roleBubbles.splice(index, 1);
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

  /** Toggle expanded view */
  private toggleExpand(id: string): void {
    const bubble = this.findBubbleById(id);
    const element = this.bubbleElements.get(id);
    if (!bubble || !element) return;

    bubble.expanded = !bubble.expanded;
    element.classList.toggle('expanded', bubble.expanded);
  }

  /** Handle hover for expanded preview */
  private onHover(id: string, entering: boolean): void {
    const element = this.bubbleElements.get(id);
    if (!element) return;
    element.classList.toggle('hovered', entering);
  }

  /** Get bubble element with type guard */
  private getBubbleElement(id: string): HTMLElement | null {
    return this.bubbleElements.get(id) ?? null;
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
    switch (category) {
      case 'thought': return 'Thought';
      case 'tool': return 'Tool';
      case 'execution': return 'Executing';
      case 'success': return 'Success';
      case 'error': return 'Error';
      case 'waiting': return 'Waiting';
    }
  }

  /** Escape HTML for safe insertion */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** Get all current bubbles */
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

  /** Clean up */
  destroy(): void {
    this.stopPositionLoop();
    this.bubbleElements.forEach((_, id) => this.removeBubbleElement(id));
    this.bubbles.clear();
    this.history.length = 0;
    this.overlay?.remove();
    this.overlay = null;
    this.host = null;
    this.renderer = null;
  }
}

// ============================================================================
// Utility
// ============================================================================

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}