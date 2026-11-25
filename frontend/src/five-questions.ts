/** Spec §10 — the five operational questions as uniform card lines.
 *
 * Every selection surface (room, resident, task, goal, discovery, plan,
 * build, project, attention item) answers the same questions with the same
 * labels:
 *
 *   Status    — what is Hermes working on (record + derived lifecycle state)
 *   Why       — why is it happening (owning goal / project / work origin)
 *   Evidence  — what actually happened (chain stage, records, sources)
 *   Decision needed — what requires my decision (only when one is pending)
 *   Next      — what can I do next (each card's own action buttons)
 *
 * Presentation may differ between views; the ANSWERS may not contradict one
 * another. Each card draws these lines from the same records its host view
 * renders — never from a second truth. The Attention Center's item cards
 * already carried the full set (Why / Evidence / Authority / Next action)
 * and are the reference implementation.
 */

export const FQ = {
    status: 'Status',
    why: 'Why',
    evidence: 'Evidence',
    decision: 'Decision needed',
} as const;

export type FqQuestion = typeof FQ[keyof typeof FQ];

/** One uniform question line: `Question: answer`, tagged with its question
 *  so tests and styles can key off the contract rather than prose. */
export function fqLine(question: FqQuestion, text: string): HTMLParagraphElement {
    const p = document.createElement('p');
    p.className = 'fq-line';
    p.dataset.question = question;
    const label = document.createElement('strong');
    label.textContent = `${question}: `;
    p.append(label, document.createTextNode(text));
    return p;
}
