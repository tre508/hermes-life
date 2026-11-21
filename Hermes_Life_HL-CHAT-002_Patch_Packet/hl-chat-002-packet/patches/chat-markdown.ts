/** HL-CHAT-002: safe, dependency-free Markdown-to-DOM for user-visible Hermes responses.
 * Never assigns model output to innerHTML, and never executes HTML from model text.
 * Streaming may contain incomplete fences/markup; re-rendering is idempotent.
 */
function inline(parent: HTMLElement, text: string): void {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    parent.append(document.createTextNode(text.slice(last, match.index)));
    const token = match[0]; let element: HTMLElement;
    if (token.startsWith('`')) { element = document.createElement('code'); element.textContent = token.slice(1, -1); }
    else if (token.startsWith('**')) { element = document.createElement('strong'); element.textContent = token.slice(2, -2); }
    else if (token.startsWith('*')) { element = document.createElement('em'); element.textContent = token.slice(1, -1); }
    else {
      const parts = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      element = document.createElement('a'); element.textContent = parts?.[1] ?? token;
      (element as HTMLAnchorElement).href = parts?.[2] ?? '#';
      (element as HTMLAnchorElement).target = '_blank';
      (element as HTMLAnchorElement).rel = 'noopener noreferrer';
    }
    parent.append(element); last = pattern.lastIndex;
  }
  parent.append(document.createTextNode(text.slice(last)));
}

export function renderHermesMarkdown(target: HTMLElement, source: string): void {
  target.replaceChildren();
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```([\w.+-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || 'text'; const codeLines: string[] = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) codeLines.push(lines[i++]);
      if (i < lines.length) i++;
      const wrapper = document.createElement('section'); wrapper.className = 'hc-code';
      const head = document.createElement('div'); head.className = 'hc-code-head';
      const label = document.createElement('span'); label.textContent = lang;
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy code';
      const code = codeLines.join('\n');
      copy.addEventListener('click', () => void navigator.clipboard.writeText(code));
      head.append(label, copy);
      const pre = document.createElement('pre'); const content = document.createElement('code');
      content.textContent = code; content.className = 'language-' + lang.replace(/[^\w-]/g, '');
      pre.append(content); wrapper.append(head, pre); target.append(wrapper); continue;
    }
    if (!line.trim()) { i++; continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const h = document.createElement('h' + Math.min(heading[1].length + 1, 6));
      inline(h, heading[2]); target.append(h); i++; continue;
    }
    if (/^\s*([-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length && /^\s*([-*+] |\d+\. )/.test(lines[i]) && /^\s*\d+\. /.test(lines[i]) === ordered) {
        const item = document.createElement('li'); inline(item, lines[i].replace(/^\s*(?:[-*+] |\d+\. )/, ''));
        list.append(item); i++;
      }
      target.append(list); continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const q = document.createElement('blockquote'); const parts: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) parts.push(lines[i++].replace(/^\s*>\s?/, ''));
      inline(q, parts.join(' ')); target.append(q); continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*\|/.test(lines[i + 1])) {
      const tableWrap = document.createElement('div'); tableWrap.className = 'hc-table-scroll';
      const table = document.createElement('table');
      const cells = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map(v => v.trim());
      const row = document.createElement('tr');
      cells(line).forEach(t => { const th = document.createElement('th'); inline(th, t); row.append(th); });
      const thead = document.createElement('thead'); thead.append(row); table.append(thead); i += 2;
      const tbody = document.createElement('tbody');
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        const tr = document.createElement('tr'); cells(lines[i++]).forEach(t => { const td = document.createElement('td'); inline(td, t); tr.append(td); }); tbody.append(tr);
      }
      table.append(tbody); tableWrap.append(table); target.append(tableWrap); continue;
    }
    if (/^\s*---+\s*$/.test(line)) { target.append(document.createElement('hr')); i++; continue; }
    const paragraph: string[] = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(?:\s*```|#{1,6}\s|\s*[-*+] |\s*\d+\. |\s*>|\s*\|.+\|\s*$)/.test(lines[i])) paragraph.push(lines[i++]);
    const p = document.createElement('p'); inline(p, paragraph.join(' ')); target.append(p);
  }
}
