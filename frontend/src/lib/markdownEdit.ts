/**
 * Pure Markdown editing for the note body: every function takes the text and
 * the selection and returns one replacement — a range, the text to put there,
 * and where the selection goes after. One replacement per action is what lets
 * the editor apply it with `execCommand('insertText')`, which the browser
 * records as a single step on the textarea's own undo stack.
 *
 * Nothing here touches the DOM, so it can be reasoned about (and tested) on
 * strings alone.
 */

import { type CalloutType, NOTE_COLOR_ALT, type NoteColor } from './noteFormat';

export type TextState = { value: string; start: number; end: number };

export type TextEdit = {
  /** Replace `value.slice(from, to)` with `text`… */
  from: number;
  to: number;
  text: string;
  /** …then select this range, in the new text. */
  selStart: number;
  selEnd: number;
};

/* ---- Lines ---- */

/**
 * One line split into what the line-level buttons work on: the indent, a
 * quote prefix, a block marker, and the rest. `prefix` is everything before
 * `rest`, so a line is always `prefix + rest`.
 */
export type LineInfo = {
  indent: string;
  quote: string;
  kind: 'none' | 'heading' | 'bullet' | 'ordered' | 'task';
  /** The marker as written: `# `, `- `, `12. `, `- [ ] `. */
  marker: string;
  level: number;
  bullet: string;
  number: number;
  delim: string;
  checked: boolean;
  rest: string;
};

const QUOTE = /^(?:>[ ]?)+/;
const HEADING = /^(#{1,6})[ \t]+/;
const TASK = /^([-*+])[ \t]+\[([ xX])\][ \t]+/;
const BULLET = /^([-*+])[ \t]+/;
const ORDERED = /^(\d{1,9})([.)])[ \t]+/;
/* A marker with nothing after it yet — "- " typed, or the Enter helper's
   fresh item — still counts, so Enter on it ends the list. */
const TASK_BARE = /^([-*+])[ \t]+\[([ xX])\][ \t]*$/;
const BULLET_BARE = /^([-*+])[ \t]*$/;
const ORDERED_BARE = /^(\d{1,9})([.)])[ \t]*$/;

export function parseLine(line: string): LineInfo {
  const info: LineInfo = {
    indent: '',
    quote: '',
    kind: 'none',
    marker: '',
    level: 0,
    bullet: '-',
    number: 0,
    delim: '.',
    checked: false,
    rest: line,
  };
  let rest = line;
  const indent = /^[ \t]*/.exec(rest)![0];
  rest = rest.slice(indent.length);
  info.indent = indent;
  const quote = QUOTE.exec(rest);
  if (quote) {
    info.quote = quote[0];
    rest = rest.slice(quote[0].length);
    /* Indentation inside a quote belongs to what is quoted. */
    const inner = /^[ \t]*/.exec(rest)![0];
    info.quote += inner;
    rest = rest.slice(inner.length);
  }
  let m: RegExpExecArray | null;
  if ((m = HEADING.exec(rest))) {
    info.kind = 'heading';
    info.level = m[1].length;
  } else if ((m = TASK.exec(rest) ?? TASK_BARE.exec(rest))) {
    info.kind = 'task';
    info.bullet = m[1];
    info.checked = m[2] !== ' ';
  } else if ((m = BULLET.exec(rest) ?? (rest.length > 0 ? BULLET_BARE.exec(rest) : null))) {
    /* A lone "-" is just a dash until a space follows it. */
    if (rest.length === 1) {
      m = null;
    } else {
      info.kind = 'bullet';
      info.bullet = m[1];
    }
  } else if ((m = ORDERED.exec(rest) ?? ORDERED_BARE.exec(rest))) {
    info.kind = 'ordered';
    info.number = Number(m[1]);
    info.delim = m[2];
  }
  if (m && info.kind !== 'none') {
    info.marker = m[0];
    rest = rest.slice(m[0].length);
  }
  info.rest = rest;
  return info;
}

function isList(info: LineInfo): boolean {
  return info.kind === 'bullet' || info.kind === 'ordered' || info.kind === 'task';
}

/** Width of an indent, counting a tab as four columns as CommonMark does. */
function width(indent: string): number {
  let w = 0;
  for (const ch of indent) w += ch === '\t' ? 4 - (w % 4) : 1;
  return w;
}

/** Where a list item's text starts, relative to its indent: 2 under "- ", 3 under "1. ". */
function contentColumn(info: LineInfo): number {
  if (info.kind === 'task') return info.bullet.length + 1;
  if (info.kind === 'bullet') return info.bullet.length + 1;
  if (info.kind === 'ordered') return String(info.number).length + info.delim.length + 1;
  return 2;
}

type LineSpan = { start: number; end: number; text: string };

/** The whole lines the selection touches. A selection ending at the very start
 *  of a line does not include that line — the usual editor convention. */
function selectedLines(state: TextState): { from: number; to: number; lines: LineSpan[] } {
  const { value } = state;
  let { start, end } = state;
  if (end > start && value[end - 1] === '\n') end -= 1;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end);
  if (to === -1) to = value.length;
  const lines: LineSpan[] = [];
  let pos = from;
  for (const text of value.slice(from, to).split('\n')) {
    lines.push({ start: pos, end: pos + text.length, text });
    pos += text.length + 1;
  }
  return { from, to, lines };
}

/**
 * Rewrites the prefix of each selected line — every line-level action only
 * ever changes what comes before the text — and carries the selection along
 * with the text it was on.
 */
function rewritePrefixes(
  state: TextState,
  lines: LineSpan[],
  from: number,
  to: number,
  next: (info: LineInfo, index: number) => string,
): TextEdit {
  const out: string[] = [];
  const shifts: { oldStart: number; oldPrefix: number; newStart: number; newPrefix: number }[] = [];
  let newPos = from;
  lines.forEach((line, index) => {
    const info = parseLine(line.text);
    const oldPrefix = line.text.length - info.rest.length;
    const prefix = next(info, index);
    out.push(prefix + info.rest);
    shifts.push({ oldStart: line.start, oldPrefix, newStart: newPos, newPrefix: prefix.length });
    newPos += prefix.length + info.rest.length + 1;
  });
  const map = (pos: number) => {
    let shift = shifts[0];
    for (const s of shifts) if (s.oldStart <= pos) shift = s;
    const offset = pos - shift.oldStart;
    if (offset <= shift.oldPrefix) return shift.newStart + shift.newPrefix;
    return shift.newStart + shift.newPrefix + (offset - shift.oldPrefix);
  };
  const text = out.join('\n');
  return { from, to, text, selStart: map(state.start), selEnd: map(state.end) };
}

/* ---- Line-level actions ---- */

export type BlockKind = 'bullet' | 'ordered' | 'task' | 'quote';

/** The heading level of the line the caret is on, 0 for none. */
export function headingLevelAt(value: string, pos: number): number {
  const from = value.lastIndexOf('\n', pos - 1) + 1;
  let to = value.indexOf('\n', pos);
  if (to === -1) to = value.length;
  const info = parseLine(value.slice(from, to));
  return info.kind === 'heading' && !info.quote ? info.level : 0;
}

/** Plain → H1 → H2 → H3 → plain, for every selected line, decided by the first. */
export function cycleHeading(state: TextState): TextEdit {
  const { from, to, lines } = selectedLines(state);
  const first = parseLine(lines[0].text);
  const current = first.kind === 'heading' ? first.level : 0;
  const level = current >= 3 ? 0 : current + 1;
  return rewritePrefixes(state, lines, from, to, (info) =>
    /* A heading cannot sit inside a list item's marker, so it replaces it. */
    info.quote + (level ? '#'.repeat(level) + ' ' : ''),
  );
}

/** A heading of `level` on every selected line — or plain again when the
 *  first line already is one. */
export function setHeading(state: TextState, level: number): TextEdit {
  const { from, to, lines } = selectedLines(state);
  const first = parseLine(lines[0].text);
  const next = first.kind === 'heading' && first.level === level ? 0 : level;
  return rewritePrefixes(state, lines, from, to, (info) => info.quote + (next ? '#'.repeat(next) + ' ' : ''));
}

/**
 * Bullets, numbers, checkboxes or a quote on every selected line — or off
 * again when every line that has text already has it.
 */
export function toggleBlock(state: TextState, kind: BlockKind): TextEdit {
  const { from, to, lines } = selectedLines(state);
  const infos = lines.map((line) => parseLine(line.text));
  const filled = infos.filter((info) => info.rest.trim() || info.marker || info.quote);
  const subject = filled.length ? filled : infos;

  if (kind === 'quote') {
    const allQuoted = subject.every((info) => info.quote);
    return rewritePrefixes(state, lines, from, to, (info) => {
      const inner = info.marker;
      if (allQuoted) return info.indent + info.quote.replace(/^>[ ]?/, '') + inner;
      return info.indent + '> ' + info.quote + inner;
    });
  }

  const allOn = subject.every((info) => info.kind === kind);
  /* Numbers carry on from an item just above the selection at the same depth. */
  let number = 1;
  const above = from > 0 ? previousLine(state.value, from) : null;
  if (above && above.kind === 'ordered' && kind === 'ordered') {
    number = above.number + 1;
  }
  const counters = new Map<number, number>();

  return rewritePrefixes(state, lines, from, to, (info) => {
    const keep = info.indent + info.quote;
    if (allOn) return keep;
    if (!info.rest.trim() && !info.marker && lines.length > 1) return keep; // leave blank lines blank
    if (kind === 'bullet') return keep + (info.kind === 'bullet' ? info.marker : '- ');
    if (kind === 'task') {
      return keep + (info.kind === 'task' ? info.marker : `${info.kind === 'bullet' ? info.bullet : '-'} [ ] `);
    }
    const depth = width(info.indent);
    const n = counters.has(depth) ? counters.get(depth)! : depth === width(above?.indent ?? '') ? number : 1;
    counters.set(depth, n + 1);
    return `${keep}${n}. `;
  });
}

function previousLine(value: string, lineStart: number): LineInfo | null {
  if (lineStart === 0) return null;
  const end = lineStart - 1;
  const start = value.lastIndexOf('\n', end - 1) + 1;
  return parseLine(value.slice(start, end));
}

/**
 * Indent: the selected lines move under the item above them, by exactly that
 * item's content column — 2 under "- ", 3 under "1. ", 4 under "10. " — which
 * is what CommonMark needs to see a nested list rather than a sibling.
 */
export function indentLines(state: TextState): TextEdit {
  const { from, to, lines } = selectedLines(state);
  const first = parseLine(lines[0].text);
  const firstWidth = width(first.indent);

  /* The would-be parent: the nearest list line above at the same depth. */
  let parent: LineInfo | null = null;
  let pos = from;
  while (pos > 0) {
    const end = pos - 1;
    const start = state.value.lastIndexOf('\n', end - 1) + 1;
    const info = parseLine(state.value.slice(start, end));
    pos = start;
    if (!info.rest.trim() && !info.marker) break; // a blank line ends the list
    if (!isList(info)) continue;
    const w = width(info.indent);
    if (w === firstWidth) {
      parent = info;
      break;
    }
    if (w < firstWidth) break;
  }
  const delta = parent ? contentColumn(parent) : isList(first) ? contentColumn(first) : 2;
  const pad = ' '.repeat(delta);

  return rewritePrefixes(state, lines, from, to, (info, index) => {
    if (!info.rest.trim() && !info.marker && !info.quote) return info.indent;
    let marker = info.marker;
    /* The first item of a new nested numbered list starts at 1. */
    if (index === 0 && info.kind === 'ordered' && parent) marker = `1${info.delim} `;
    return pad + info.indent + info.quote + marker;
  });
}

/** Outdent: back to the depth of the parent item, or to the left edge. */
export function outdentLines(state: TextState): TextEdit {
  const { from, to, lines } = selectedLines(state);
  const first = parseLine(lines[0].text);
  const firstWidth = width(first.indent);
  let target = 0;
  let pos = from;
  while (pos > 0) {
    const end = pos - 1;
    const start = state.value.lastIndexOf('\n', end - 1) + 1;
    const info = parseLine(state.value.slice(start, end));
    pos = start;
    if (!info.rest.trim() && !info.marker) break;
    if (!isList(info)) continue;
    const w = width(info.indent);
    if (w < firstWidth) {
      target = w;
      break;
    }
  }
  const delta = firstWidth - target || Math.min(firstWidth, 2);
  return rewritePrefixes(state, lines, from, to, (info) => {
    const expanded = info.indent.replace(/\t/g, '    ');
    const remove = Math.min(delta, expanded.length);
    return expanded.slice(remove) + info.quote + info.marker;
  });
}

/** True when every selected line is a list item — when Tab should indent. */
export function selectionIsList(state: TextState): boolean {
  const { lines } = selectedLines(state);
  return lines.every((line) => isList(parseLine(line.text)));
}

/* ---- Inline actions ---- */

export type InlineKind = 'bold' | 'italic' | 'strike' | 'code' | 'underline';

const INLINE_MARK: Record<InlineKind, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
  underline: '++',
};

/** How many of `ch` run back from `pos` (exclusive) / forward from `pos`. */
function runBefore(value: string, pos: number, ch: string): number {
  let n = 0;
  while (pos - n - 1 >= 0 && value[pos - n - 1] === ch) n += 1;
  return n;
}
function runAfter(value: string, pos: number, ch: string): number {
  let n = 0;
  while (pos + n < value.length && value[pos + n] === ch) n += 1;
  return n;
}

/** Whether `mark` sits on both sides of `start..end`. `*` needs care: `**x**`
 *  is bold, not italic, and `***x***` is both. */
function surrounded(value: string, start: number, end: number, mark: string): boolean {
  const ch = mark[0];
  const before = runBefore(value, start, ch);
  const after = runAfter(value, end, ch);
  if (ch === '*') {
    if (mark === '*') return before % 2 === 1 && after % 2 === 1;
    return before >= 2 && after >= 2;
  }
  return before >= mark.length && after >= mark.length;
}

/**
 * A selection that starts on a line's block marker (`## `, `- `, `> `,
 * `1. `, `- [ ] `) starts after it instead: a mark around the marker would
 * turn the heading or list item back into plain text.
 */
function pastLinePrefix(value: string, start: number, end: number): number {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', lineStart);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  const prefixEnd = lineStart + line.length - parseLine(line).rest.length;
  return start < prefixEnd && prefixEnd < end ? prefixEnd : start;
}

/**
 * Wrap the selection in `**`, `*`, `~~` or a backtick — or unwrap it when it
 * already is. With nothing selected, a placeholder goes in, selected, so the
 * next keystroke replaces it. A selection across lines gets a fenced code
 * block for Code, and each line wrapped on its own otherwise, since inline
 * marks cannot span paragraphs.
 */
export function toggleInline(state: TextState, kind: InlineKind, placeholder: string): TextEdit {
  const { value } = state;
  const mark = INLINE_MARK[kind];
  let { start, end } = state;

  /* A double-click on Windows takes the trailing space too; wrapping it would
     leave "**word **", which is not bold. */
  while (end > start && /\s/.test(value[end - 1])) end -= 1;
  while (start < end && /\s/.test(value[start])) start += 1;
  start = pastLinePrefix(value, start, end);
  const selected = value.slice(start, end);

  if (kind === 'code' && selected.includes('\n')) return toggleFence(state);

  if (selected.includes('\n')) {
    const { from, to, lines } = selectedLines(state);
    const allOn = lines.every((line) => {
      const info = parseLine(line.text);
      const body = info.rest;
      return !body.trim() || (body.startsWith(mark) && body.endsWith(mark) && body.length >= mark.length * 2);
    });
    return rewriteRests(lines, from, to, (rest) => {
      if (!rest.trim()) return rest;
      if (allOn) return rest.slice(mark.length, rest.length - mark.length);
      return mark + rest + mark;
    });
  }

  if (start === end && !selected) {
    /* Inside an empty pair the caret just left behind ("**|**"): take it away. */
    if (value.slice(start - mark.length, start) === mark && value.slice(start, start + mark.length) === mark) {
      return { from: start - mark.length, to: start + mark.length, text: '', selStart: start - mark.length, selEnd: start - mark.length };
    }
    const text = mark + placeholder + mark;
    return { from: start, to: end, text, selStart: start + mark.length, selEnd: start + mark.length + placeholder.length };
  }

  /* The selection includes the marks themselves. */
  if (
    selected.length >= mark.length * 2 &&
    selected.startsWith(mark) &&
    selected.endsWith(mark) &&
    !(mark === '*' && selected.startsWith('**') && !selected.startsWith('***'))
  ) {
    const inner = selected.slice(mark.length, selected.length - mark.length);
    return { from: start, to: end, text: inner, selStart: start, selEnd: start + inner.length };
  }

  /* The marks sit just outside the selection. */
  if (surrounded(value, start, end, mark)) {
    return {
      from: start - mark.length,
      to: end + mark.length,
      text: selected,
      selStart: start - mark.length,
      selEnd: end - mark.length,
    };
  }

  return {
    from: start,
    to: end,
    text: mark + selected + mark,
    selStart: start + mark.length,
    selEnd: end + mark.length,
  };
}

function rewriteRests(
  lines: LineSpan[],
  from: number,
  to: number,
  next: (rest: string) => string,
): TextEdit {
  const out = lines.map((line) => {
    const info = parseLine(line.text);
    const prefix = line.text.slice(0, line.text.length - info.rest.length);
    return prefix + next(info.rest);
  });
  const text = out.join('\n');
  return { from, to, text, selStart: from, selEnd: from + text.length };
}

/** A fenced code block around the selected lines, or the fences taken away. */
function toggleFence(state: TextState): TextEdit {
  const { value } = state;
  const { from, to } = selectedLines(state);
  const prevEnd = from - 1;
  const prevStart = prevEnd > 0 ? value.lastIndexOf('\n', prevEnd - 1) + 1 : 0;
  const nextStart = to + 1;
  let nextEnd = value.indexOf('\n', nextStart);
  if (nextEnd === -1) nextEnd = value.length;
  const prev = from > 0 ? value.slice(prevStart, prevEnd) : null;
  const next = to < value.length ? value.slice(nextStart, nextEnd) : null;
  const inner = value.slice(from, to);

  if (prev !== null && next !== null && /^\s*```/.test(prev) && /^\s*```\s*$/.test(next)) {
    return { from: prevStart, to: nextEnd, text: inner, selStart: prevStart, selEnd: prevStart + inner.length };
  }
  const text = '```\n' + inner + '\n```';
  return { from, to, text, selStart: from + 4, selEnd: from + 4 + inner.length };
}

/** A fenced code block with a placeholder, for Code on an empty line. */
export function insertCodeBlock(state: TextState, placeholder: string): TextEdit {
  const { value, start, end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const needsBreak = start > lineStart;
  const before = needsBreak ? '\n' : '';
  const text = `${before}\`\`\`\n${placeholder}\n\`\`\``;
  const at = start + before.length + 4;
  return { from: start, to: end, text, selStart: at, selEnd: at + placeholder.length };
}

/** Code block: around the selected lines, or a new one with a placeholder. */
export function codeBlockAction(state: TextState, placeholder: string): TextEdit {
  if (state.start !== state.end) return toggleFence(state);
  const { value, start } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', start);
  if (lineEnd === -1) lineEnd = value.length;
  /* On a line with text, the block goes on the next line. */
  if (value.slice(lineStart, lineEnd).trim()) {
    return insertBlock({ value, start: lineEnd, end: lineEnd }, '```\n' + placeholder + '\n```');
  }
  return insertCodeBlock(state, placeholder);
}

/** Code: inline on a line with text or a selection, a block on an empty line. */
export function codeAction(state: TextState, inlinePlaceholder: string, blockPlaceholder: string): TextEdit {
  const { value, start, end } = state;
  if (start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;
    if (!value.slice(lineStart, lineEnd).trim()) return insertCodeBlock(state, blockPlaceholder);
  }
  return toggleInline(state, 'code', inlinePlaceholder);
}

/* ---- Insertions ---- */

/** A divider on a line of its own after the caret's line. */
export function insertDivider(state: TextState): TextEdit {
  const { value, end } = state;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  const lineStart = value.lastIndexOf('\n', lineEnd - 1) + 1;
  const lineEmpty = !value.slice(lineStart, lineEnd).trim();
  /* The caret lands on the line after the divider, adding one at the very end. */
  const atEnd = lineEnd === value.length;
  const from = lineEmpty ? lineStart : lineEnd;
  const text = (lineEmpty ? '---' : '\n---') + (atEnd ? '\n' : '');
  const caret = from + (lineEmpty ? 4 : 5);
  return { from, to: lineEnd, text, selStart: caret, selEnd: caret };
}

/** `[label](url)`, or the bare URL when there is no label. */
export function insertLink(state: TextState, label: string, url: string): TextEdit {
  const safeUrl = url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  const cleanLabel = label.replace(/\n+/g, ' ').trim().replace(/([[\]\\])/g, '\\$1');
  let text: string;
  if (cleanLabel) text = `[${cleanLabel}](${safeUrl})`;
  else if (/^mailto:/i.test(safeUrl)) text = `[${safeUrl.slice(7)}](${safeUrl})`;
  else text = safeUrl;
  return { from: state.start, to: state.end, text, selStart: state.start + text.length, selEnd: state.start + text.length };
}

/* ---- Enter ---- */

/**
 * Enter on a list or quote line carries it on: the next bullet, the next
 * number, a fresh unchecked box. Enter on an item with nothing in it ends the
 * list instead, leaving an empty line. Null when Enter should do what it
 * always does.
 */
export function continueOnEnter(state: TextState): TextEdit | null {
  const { value, start, end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', start);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd);
  const info = parseLine(line);
  const prefixLen = line.length - info.rest.length;
  if (!isList(info) && !info.quote) return null;
  if (info.kind === 'heading') return null;
  /* The caret is inside the marker itself: leave Enter alone. */
  if (start - lineStart < prefixLen) return null;

  if (!info.rest.trim() && end === start) {
    /* An empty item: end the list (or the quote) here. */
    return { from: lineStart, to: lineEnd, text: '', selStart: lineStart, selEnd: lineStart };
  }

  let marker = '';
  if (info.kind === 'bullet') marker = `${info.bullet} `;
  else if (info.kind === 'task') marker = `${info.bullet} [ ] `;
  else if (info.kind === 'ordered') marker = `${info.number + 1}${info.delim} `;
  const text = '\n' + info.indent + info.quote + marker;
  return { from: start, to: end, text, selStart: start + text.length, selEnd: start + text.length };
}

/* ---- Checkboxes in the reading view ---- */

const TASK_AT = /^([-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/;

/**
 * Flips the `[ ]` / `[x]` of the list item that starts at `offset` — the
 * source position the renderer reports for it. Only that one character
 * changes. Null when the text there is not a checkbox item after all, which
 * leaves the note alone rather than guessing.
 */
export function toggleTaskAt(value: string, offset: number): string | null {
  const m = TASK_AT.exec(value.slice(offset, offset + 40));
  if (!m) return null;
  const at = offset + m[0].length - 2;
  const next = value[at] === ' ' ? 'x' : ' ';
  return value.slice(0, at) + next + value.slice(at + 1);
}

/* ---- Links ---- */

const ALLOWED_SCHEME = /^(https?:|mailto:)/i;

/** True for the only kinds of link a note may open. */
export function isAllowedUrl(url: string): boolean {
  return ALLOWED_SCHEME.test(url.trim());
}

/**
 * What the user typed into the link dialog, as a URL a note may hold — or
 * null. A bare "example.com" gets `https://`, a bare address gets `mailto:`,
 * and any other scheme (`javascript:`, `data:`, `ftp:`) is refused.
 */
export function normaliseUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url || /\s/.test(url)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (/^[^@/]+@[^@/]+\.[^@/]+$/.test(url)) url = `mailto:${url}`;
    else url = `https://${url.replace(/^\/+/, '')}`;
  }
  if (!ALLOWED_SCHEME.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'mailto:') return parsed.pathname.includes('@') ? url : null;
    if (!parsed.hostname || !(parsed.hostname.includes('.') || parsed.hostname === 'localhost')) return null;
    return url;
  } catch {
    return null;
  }
}

/** Pasted text that is a single link and nothing else. */
export function pastedUrl(text: string): string | null {
  const url = text.trim();
  if (!/^(https?:\/\/|mailto:)\S+$/i.test(url)) return null;
  return normaliseUrl(url);
}

/* ---- Blocks ---- */

/**
 * `text` on a line of its own with a blank line either side — added only
 * where there is not one already — and the caret on the line after it.
 */
export function insertBlock(state: TextState, text: string): TextEdit {
  const { value, start, end } = state;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = lead + text + trail;
  let caret = start + inserted.length;
  if (!trail) caret += 2;
  else if (trail === '\n' && after) caret += 1;
  return { from: start, to: end, text: inserted, selStart: caret, selEnd: caret };
}

/* ---- Colour and highlight ---- */

export type ColorKind = 'color' | 'highlight';

/** `[text]{red}` / `==text==` / `==[green]text==` around `text`. */
function wrapColor(kind: ColorKind, color: NoteColor, text: string): { text: string; lead: number } {
  if (kind === 'color') return { text: `[${text}]{${color}}`, lead: 1 };
  if (color === 'yellow') return { text: `==${text}==`, lead: 2 };
  const lead = `==[${color}]`;
  return { text: `${lead}${text}==`, lead: lead.length };
}

const COLOR_SPAN = new RegExp(`\\[([^\\[\\]\\n]*)\\]\\{(${NOTE_COLOR_ALT})\\}`, 'g');
const HIGHLIGHT_SPAN = new RegExp(`==(?:\\[(${NOTE_COLOR_ALT})\\])?([^\\n]*?)==`, 'g');

type Span = { from: number; to: number; innerFrom: number; inner: string; color: NoteColor };

/** The coloured (or highlighted) span on the selection's line that holds the
 *  whole selection, if there is one. */
function spanAround(state: TextState, kind: ColorKind): Span | null {
  const { value, start, end } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', start);
  if (lineEnd === -1) lineEnd = value.length;
  if (end > lineEnd) return null;
  const line = value.slice(lineStart, lineEnd);
  const pattern = new RegExp(kind === 'color' ? COLOR_SPAN : HIGHLIGHT_SPAN);
  for (const m of line.matchAll(pattern)) {
    const from = lineStart + (m.index ?? 0);
    const to = from + m[0].length;
    if (from > start || to < end) continue;
    if (kind === 'color') {
      return { from, to, innerFrom: from + 1, inner: m[1], color: m[2] as NoteColor };
    }
    const color = (m[1] as NoteColor | undefined) ?? 'yellow';
    const lead = m[1] ? 2 + m[1].length + 2 : 2;
    return { from, to, innerFrom: from + lead, inner: m[2], color };
  }
  return null;
}

/**
 * Text colour or highlight on the selection. On text that already has one
 * the colour is swapped, never nested; `null` takes it off. With nothing
 * selected, a placeholder goes in selected. Across lines, each line with
 * text is done on its own, since the marks cannot span lines.
 */
export function applyColor(state: TextState, kind: ColorKind, color: NoteColor | null, placeholder: string): TextEdit {
  const { value } = state;
  const noop: TextEdit = { from: state.start, to: state.start, text: '', selStart: state.start, selEnd: state.end };

  if (value.slice(state.start, state.end).includes('\n')) {
    const { from, to, lines } = selectedLines(state);
    return rewriteRests(lines, from, to, (rest) => {
      if (!rest.trim()) return rest;
      const whole = spanAround({ value: rest, start: 0, end: rest.length }, kind);
      const exact = whole && whole.from === 0 && whole.to === rest.length ? whole : null;
      const inner = exact ? exact.inner : rest;
      return color ? wrapColor(kind, color, inner).text : inner;
    });
  }

  const span = spanAround(state, kind);
  if (span) {
    const selStart = Math.max(state.start, span.innerFrom) - span.innerFrom;
    const selEnd = Math.min(state.end, span.innerFrom + span.inner.length) - span.innerFrom;
    if (!color) {
      return { from: span.from, to: span.to, text: span.inner, selStart: span.from + selStart, selEnd: span.from + selEnd };
    }
    const next = wrapColor(kind, color, span.inner);
    return {
      from: span.from,
      to: span.to,
      text: next.text,
      selStart: span.from + next.lead + selStart,
      selEnd: span.from + next.lead + selEnd,
    };
  }
  if (!color) return noop;

  let { start, end } = state;
  while (end > start && /\s/.test(value[end - 1])) end -= 1;
  while (start < end && /\s/.test(value[start])) start += 1;
  start = pastLinePrefix(value, start, end);
  const inner = start === end ? placeholder : value.slice(start, end);
  const next = wrapColor(kind, color, inner);
  return {
    from: start,
    to: end,
    text: next.text,
    selStart: start + next.lead,
    selEnd: start + next.lead + inner.length,
  };
}

/** True when the selection sits inside text that already has this kind. */
export function hasColor(state: TextState, kind: ColorKind): boolean {
  return spanAround(state, kind) !== null;
}

/* ---- Clear formatting ---- */

const OUTER_PAIRS: [RegExp, RegExp][] = [
  [new RegExp(`==\\[(?:${NOTE_COLOR_ALT})\\]$`), /^==/],
  [/\[$/, new RegExp(`^\\]\\{(?:${NOTE_COLOR_ALT})\\}`)],
  [/\*\*$/, /^\*\*/],
  [/__$/, /^__/],
  [/~~$/, /^~~/],
  [/\+\+$/, /^\+\+/],
  [/==$/, /^==/],
  [/\*$/, /^\*/],
  [/_$/, /^_/],
  [/`$/, /^`/],
];

/** Every inline mark taken out of one line's text. */
export function stripInlineMarks(text: string): string {
  let out = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const before = out;
    out = out
      .replace(new RegExp(`\\[([^\\[\\]\\n]*)\\]\\{(?:${NOTE_COLOR_ALT})\\}`, 'g'), '$1')
      .replace(new RegExp(`==\\[(?:${NOTE_COLOR_ALT})\\]`, 'g'), '==')
      .replace(/==(?=\S)(.*?\S)==/g, '$1')
      .replace(/\+\+(?=\S)(.*?\S)\+\+/g, '$1')
      .replace(/~~(?=\S)(.*?\S)~~/g, '$1')
      .replace(/(\*\*|__)(?=\S)(.*?\S)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2')
      .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1');
    if (out === before) break;
  }
  return out;
}

/**
 * Bold, italic, strike, code, underline, colour and highlight taken off the
 * selection — and off marks wrapped right around it. With nothing selected,
 * the caret's line. Line prefixes (lists, quotes, headings) stay.
 */
export function clearFormatting(state: TextState): TextEdit {
  const { value } = state;
  let { start, end } = state;
  if (start === end) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = value.length;
    start = lineStart;
    end = lineEnd;
  } else {
    for (let grow = 0; grow < 8; grow += 1) {
      const before = value.slice(Math.max(0, start - 20), start);
      const after = value.slice(end, end + 20);
      const pair = OUTER_PAIRS.find(([open, close]) => open.test(before) && close.test(after));
      if (!pair) break;
      start -= pair[0].exec(before)![0].length;
      end += pair[1].exec(after)![0].length;
    }
  }
  const { from, to } = selectedLines({ value, start, end });
  /* Only the selected part of the first and last line is cleaned. */
  const head = value.slice(from, start);
  const tail = value.slice(end, to);
  const middle = value.slice(start, end);
  const cleaned = middle
    .split('\n')
    .map((line, index) => {
      if (index === 0 && head) return stripInlineMarks(line);
      const info = parseLine(line);
      const prefix = line.slice(0, line.length - info.rest.length);
      return prefix + stripInlineMarks(info.rest);
    })
    .join('\n');
  const text = head + cleaned + tail;
  return { from, to, text, selStart: from + head.length, selEnd: from + head.length + cleaned.length };
}

/* ---- Callouts ---- */

/**
 * The selected lines as a callout: `> [!NOTE]` above them and each quoted.
 * On a callout already, only its type changes. On an empty line, a callout
 * with a placeholder, selected. A blank line follows when text does, or
 * that text would be read as part of the box.
 */
export function insertCallout(state: TextState, type: CalloutType, placeholder: string): TextEdit {
  const { value } = state;
  const { from, to, lines } = selectedLines(state);
  const marker = `> [!${type.toUpperCase()}]`;

  /* Already a callout: swap its type. */
  let probe = from;
  while (probe > 0) {
    const prevEnd = probe - 1;
    const prevStart = value.lastIndexOf('\n', prevEnd - 1) + 1;
    const prev = value.slice(prevStart, prevEnd);
    if (!/^\s*>/.test(prev)) break;
    probe = prevStart;
  }
  const firstEnd = value.indexOf('\n', probe) === -1 ? value.length : value.indexOf('\n', probe);
  const first = value.slice(probe, firstEnd);
  const current = /^(\s*>\s*)\[!(note|tip|important|warning|caution)\]/i.exec(first);
  if (current && /^\s*>/.test(lines[0].text)) {
    const at = probe + current[1].length;
    const old = current[0].length - current[1].length;
    const text = `[!${type.toUpperCase()}]`;
    const shift = text.length - old;
    return { from: at, to: at + old, text, selStart: state.start + shift, selEnd: state.end + shift };
  }

  const nextStart = to + 1;
  const nextEnd = value.indexOf('\n', nextStart) === -1 ? value.length : value.indexOf('\n', nextStart);
  const needsGap = to < value.length && value.slice(nextStart, nextEnd).trim() !== '';
  const gap = needsGap ? '\n' : '';
  const empty = lines.every((line) => !line.text.trim());

  if (empty) {
    const text = `${marker}\n> ${placeholder}${gap}`;
    const at = from + marker.length + 3;
    return { from, to, text, selStart: at, selEnd: at + placeholder.length };
  }
  const body = lines.map((line) => (line.text.trim() ? `> ${line.text}` : '>')).join('\n');
  const text = `${marker}\n${body}${gap}`;
  const caret = from + marker.length + 1 + body.length;
  return { from, to, text, selStart: caret, selEnd: caret };
}

/* ---- Toggles ---- */

/**
 * A collapsible block around the selected lines. Several lines: the first
 * is the title. One line, or the caret's line: it is the title and a
 * placeholder is the hidden part. An empty line: placeholders for both,
 * the title selected.
 */
export function insertToggle(state: TextState, titlePlaceholder: string, bodyPlaceholder: string): TextEdit {
  const { from, to, lines } = selectedLines(state);
  const indent = parseLine(lines[0].text).indent;
  const filled = lines.filter((line) => line.text.trim());
  const open = `${indent}:::toggle `;
  const close = `${indent}:::`;

  if (!filled.length) {
    const text = `${open}${titlePlaceholder}\n${indent}${bodyPlaceholder}\n${close}`;
    return { from, to, text, selStart: from + open.length, selEnd: from + open.length + titlePlaceholder.length };
  }
  const title = parseLine(lines[0].text).rest.trim() || titlePlaceholder;
  if (lines.length === 1) {
    const text = `${open}${title}\n${indent}${bodyPlaceholder}\n${close}`;
    const at = from + open.length + title.length + 1 + indent.length;
    return { from, to, text, selStart: at, selEnd: at + bodyPlaceholder.length };
  }
  const body = lines
    .slice(1)
    .map((line) => line.text)
    .join('\n');
  const text = `${open}${title}\n${body}\n${close}`;
  const caret = from + open.length + title.length + 1 + body.length;
  return { from, to, text, selStart: caret, selEnd: caret };
}

/* ---- Tables ---- */

/**
 * A table `rows` × `cols` — the header row counted in `rows` — on lines of
 * its own, with the first header cell selected.
 */
export function insertTable(state: TextState, rows: number, cols: number, columnLabel: (n: number) => string): TextEdit {
  const r = Math.max(2, Math.min(rows, 20));
  const c = Math.max(1, Math.min(cols, 10));
  const header = Array.from({ length: c }, (_, i) => columnLabel(i + 1));
  const lines = [
    `| ${header.join(' | ')} |`,
    `|${' --- |'.repeat(c)}`,
    ...Array.from({ length: r - 1 }, () => `|${'   |'.repeat(c)}`),
  ];
  const edit = insertBlock(state, lines.join('\n'));
  const tableStart = edit.from + edit.text.indexOf('| ') + 2;
  return { ...edit, selStart: tableStart, selEnd: tableStart + header[0].length };
}

const TABLE_ROW = /^\s*\|/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

type Cell = { from: number; to: number };

function cellsOf(line: string, offset: number): Cell[] {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '|' && line[i - 1] !== '\\') pipes.push(i);
  }
  const trimmedEnd = line.replace(/\s+$/, '').length;
  if (!pipes.length || pipes[pipes.length - 1] < trimmedEnd - 1) pipes.push(trimmedEnd);
  const cells: Cell[] = [];
  for (let k = 0; k + 1 < pipes.length; k += 1) cells.push({ from: offset + pipes[k] + 1, to: offset + pipes[k + 1] });
  return cells;
}

/**
 * Tab inside a table: the next cell (Shift+Tab: the one before), its text
 * selected. Tab in the last cell adds a row. Null when the caret is not in
 * a table, so Tab keeps its usual job.
 */
export function moveTableCell(state: TextState, back: boolean): TextEdit | null {
  const { value, start } = state;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', start);
  if (lineEnd === -1) lineEnd = value.length;
  if (!TABLE_ROW.test(value.slice(lineStart, lineEnd))) return null;

  /* The block of table lines around the caret. */
  let blockStart = lineStart;
  while (blockStart > 0) {
    const prevStart = value.lastIndexOf('\n', blockStart - 2) + 1;
    if (!TABLE_ROW.test(value.slice(prevStart, blockStart - 1))) break;
    blockStart = prevStart;
  }
  let blockEnd = lineEnd;
  while (blockEnd < value.length) {
    const nextEnd = value.indexOf('\n', blockEnd + 1) === -1 ? value.length : value.indexOf('\n', blockEnd + 1);
    if (!TABLE_ROW.test(value.slice(blockEnd + 1, nextEnd))) break;
    blockEnd = nextEnd;
  }
  const rows: { start: number; text: string }[] = [];
  let pos = blockStart;
  for (const text of value.slice(blockStart, blockEnd).split('\n')) {
    rows.push({ start: pos, text });
    pos += text.length + 1;
  }
  if (!rows.some((row) => TABLE_DELIMITER.test(row.text))) return null;

  const cells = rows.filter((row) => !TABLE_DELIMITER.test(row.text)).flatMap((row) => cellsOf(row.text, row.start));
  const here = cells.findIndex((cell) => start >= cell.from && start <= cell.to);
  if (here === -1) return null;
  const select = (cell: Cell): TextEdit => {
    const raw = value.slice(cell.from, cell.to);
    const lead = raw.length - raw.trimStart().length;
    const content = raw.trim();
    const at = content ? cell.from + lead : cell.from + Math.min(1, raw.length);
    return { from: start, to: start, text: '', selStart: at, selEnd: at + content.length };
  };
  if (back) return here > 0 ? select(cells[here - 1]) : { from: start, to: start, text: '', selStart: start, selEnd: state.end };
  if (here + 1 < cells.length) return select(cells[here + 1]);

  /* Past the last cell: a new row like the last one. */
  const lastRow = rows[rows.length - 1];
  const count = cellsOf(lastRow.text, 0).length || 1;
  const row = `\n|${'   |'.repeat(count)}`;
  const at = blockEnd + 3;
  return { from: blockEnd, to: blockEnd, text: row, selStart: at, selEnd: at };
}

/* ---- Plain insertion ---- */

/** `text` in place of the selection, the caret after it. */
export function insertText(state: TextState, text: string): TextEdit {
  const caret = state.start + text.length;
  return { from: state.start, to: state.end, text, selStart: caret, selEnd: caret };
}

/** `edit` applied to `value`. */
export function applyTextEdit(value: string, edit: TextEdit): string {
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

/**
 * Two edits — the second worked out on the text the first leaves — as one,
 * so the browser records them as a single undo step. The replacement is the
 * changed stretch between what is common at both ends.
 */
export function chainEdits(state: TextState, first: TextEdit, second: (next: TextState) => TextEdit): TextEdit {
  const middle = applyTextEdit(state.value, first);
  const then = second({ value: middle, start: first.selStart, end: first.selEnd });
  const final = applyTextEdit(middle, then);
  const before = state.value;
  let head = 0;
  const max = Math.min(before.length, final.length);
  while (head < max && before[head] === final[head]) head += 1;
  let tail = 0;
  while (tail < max - head && before[before.length - 1 - tail] === final[final.length - 1 - tail]) tail += 1;
  return {
    from: head,
    to: before.length - tail,
    text: final.slice(head, final.length - tail),
    selStart: then.selStart,
    selEnd: then.selEnd,
  };
}

/* ---- The slash menu ---- */

/** Whether `pos` is inside a fenced code block. */
function insideFence(value: string, pos: number): boolean {
  let open = false;
  let at = 0;
  while (at < pos) {
    const end = value.indexOf('\n', at);
    const lineEnd = end === -1 ? value.length : end;
    if (lineEnd >= pos) break;
    if (/^\s{0,3}(```|~~~)/.test(value.slice(at, lineEnd))) open = !open;
    at = lineEnd + 1;
  }
  return open;
}

/**
 * The `/word` being typed just before the caret, if it should open the
 * slash menu: the `/` at the start of a line or after a space, nothing but
 * letters after it, and not in code. A `/` inside an address follows a
 * letter or `:`, so it never qualifies.
 */
export function slashTrigger(value: string, caret: number): { start: number; query: string } | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const before = value.slice(lineStart, caret);
  const m = /(^|\s)\/([^\s/]{0,24})$/.exec(before);
  if (!m) return null;
  const start = lineStart + (m.index ?? 0) + m[1].length;
  const ticks = (value.slice(lineStart, start).match(/`/g) ?? []).length;
  if (ticks % 2 === 1 || insideFence(value, lineStart)) return null;
  return { start, query: m[2] };
}
