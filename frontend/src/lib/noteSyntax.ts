import {
  CALLOUT_MARKER,
  NOTE_COLOR_ALT,
  TOGGLE_OPEN,
  calloutTypeOf,
  isNoteColor,
} from './noteFormat';

/**
 * The parser side of the note-only syntax (see `noteFormat.ts`): micromark
 * extensions for what has to be tokenised — `==`, `++` and the `:::` fence
 * lines — and mdast transforms for what can be read off the parsed tree.
 *
 * Tokenising `==` and `++` the way GFM tokenises `~~` means the usual rules
 * come for free: nothing inside code is touched (code spans are tokenised
 * first), `\==` is an escape, and they nest with bold and italic. On top of
 * GFM's rules a letter or digit on the outside stops them, as with `_`, so
 * `x==y`, `C++` and `a++b++c` stay text.
 *
 * Imported only by MarkdownView, which is its own lazy chunk.
 */

/* ---- Minimal shapes of what micromark and mdast-util-from-markdown hand
   us. Kept local: those packages are dependencies of react-markdown, not of
   this app, so their types are not imported. ---- */

type Code = number | null;
type Point = { line: number; column: number; offset: number; _index?: number; _bufferIndex?: number };
type Token = { type: string; start: Point; end: Point; _open?: boolean; _close?: boolean };
type Event = ['enter' | 'exit', Token, TokenizeContext];
type State = (code: Code) => State | undefined;
type Effects = {
  enter: (type: string) => Token;
  exit: (type: string) => Token;
  consume: (code: Code) => void;
};
type Resolver = (events: Event[], context: TokenizeContext) => Event[];
type Construct = {
  name: string;
  tokenize: (this: TokenizeContext, effects: Effects, ok: State, nok: State) => State;
  resolveAll?: Resolver;
};
type TokenizeContext = {
  previous: Code;
  events: Event[];
  parser: { constructs: { insideSpan: { null?: Construct[] } } };
};
type FromMarkdownContext = {
  enter: (node: unknown, token: Token) => void;
  exit: (token: Token) => void;
  stack: { value?: string }[];
  sliceSerialize: (token: Token) => string;
};

export type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  children?: MdNode[];
  position?: { start: Point; end: Point };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  [key: string]: unknown;
};

/* Codes micromark uses for line endings, tab and virtual spaces. */
const isLineEnd = (code: Code) => code === null || code === -5 || code === -4 || code === -3;
const isSpace = (code: Code) => code === -2 || code === -1 || code === 32;

/** 1 for whitespace (and the edges of the text), 2 for punctuation, else a
 *  letter or digit — micromark's own grouping. */
function classify(code: Code): 1 | 2 | undefined {
  if (code === null || code < 0 || code === 32) return 1;
  const ch = String.fromCodePoint(code);
  if (/\s/u.test(ch)) return 1;
  if (/[\p{P}\p{S}]/u.test(ch)) return 2;
  return undefined;
}

function resolveAllWith(constructs: Construct[], events: Event[], context: TokenizeContext): Event[] {
  const called: Resolver[] = [];
  let out = events;
  for (const construct of constructs) {
    const resolve = construct.resolveAll;
    if (resolve && !called.includes(resolve)) {
      out = resolve(out, context);
      called.push(resolve);
    }
  }
  return out;
}

/* ---- `==highlight==` and `++underline++` ---- */

/**
 * A double-marker span, after micromark-extension-gfm-strikethrough: runs of
 * exactly two markers become temporary sequences, and pairs of them are
 * matched once the whole paragraph is tokenised.
 */
function markSyntax(marker: number, name: string) {
  const temporary = `${name}SequenceTemporary`;
  const sequence = `${name}Sequence`;
  const textType = `${name}Text`;
  const length = (token: Token) => token.end.offset - token.start.offset;

  const resolveAll: Resolver = (events, context) => {
    let index = -1;
    while (++index < events.length) {
      const closing = events[index];
      if (closing[0] !== 'enter' || closing[1].type !== temporary || !closing[1]._close) continue;
      let open = index;
      while (open--) {
        const opening = events[open];
        if (
          opening[0] === 'exit' &&
          opening[1].type === temporary &&
          opening[1]._open &&
          length(closing[1]) === length(opening[1])
        ) {
          closing[1].type = sequence;
          opening[1].type = sequence;
          const group: Token = { type: name, start: { ...opening[1].start }, end: { ...closing[1].end } };
          const text: Token = { type: textType, start: { ...opening[1].end }, end: { ...closing[1].start } };
          const next: Event[] = [
            ['enter', group, context],
            ['enter', opening[1], context],
            ['exit', opening[1], context],
            ['enter', text, context],
          ];
          const insideSpan = context.parser.constructs.insideSpan.null;
          const inner = events.slice(open + 1, index);
          next.push(...(insideSpan ? resolveAllWith(insideSpan, inner, context) : inner));
          next.push(
            ['exit', text, context],
            ['enter', closing[1], context],
            ['exit', closing[1], context],
            ['exit', group, context],
          );
          events.splice(open - 1, index - open + 3, ...next);
          index = open + next.length - 2;
          break;
        }
      }
    }
    for (const event of events) if (event[1].type === temporary) event[1].type = 'data';
    return events;
  };

  const construct: Construct = {
    name,
    resolveAll,
    tokenize(effects, ok, nok) {
      const previous = this.previous;
      const events = this.events;
      let size = 0;
      const more: State = (code) => {
        const before = classify(previous);
        if (code === marker) {
          if (size > 1) return nok(code);
          effects.consume(code);
          size += 1;
          return more;
        }
        if (size < 2) return nok(code);
        const token = effects.exit(temporary);
        const after = classify(code);
        /* GFM's flanking rule, plus: never inside a word. */
        token._open = (!after || (after === 2 && Boolean(before))) && Boolean(before);
        token._close = (!before || (before === 2 && Boolean(after))) && Boolean(after);
        return ok(code);
      };
      return (code) => {
        if (previous === marker && events[events.length - 1]?.[1].type !== 'characterEscape') return nok(code);
        effects.enter(temporary);
        return more(code);
      };
    },
  };

  return {
    text: { [marker]: construct },
    insideSpan: { null: [construct] },
    attentionMarkers: { null: [marker] },
  };
}

/* ---- `:::toggle Title` and `:::` ---- */

/**
 * One line, a block of its own: `:::` alone, or `:::toggle` with an
 * optional title. Being a flow construct, it ends a paragraph above it and
 * cannot be swallowed as a lazy line of a list or quote — which is what
 * makes the toggle reliable whatever sits just inside it. Anything else
 * starting with `:::` fails here and stays text.
 */
const fenceConstruct: Construct = {
  name: 'noteFence',
  tokenize(effects, ok, nok) {
    const word = 'toggle';
    let colons = 0;
    let matched = 0;
    const done: State = (code) => {
      effects.exit('noteFence');
      return ok(code);
    };
    const title: State = (code) => {
      if (isLineEnd(code)) return done(code);
      effects.consume(code);
      return title;
    };
    const keyword: State = (code) => {
      if (matched === word.length) {
        if (isLineEnd(code)) return done(code);
        if (isSpace(code)) {
          effects.consume(code);
          return title;
        }
        return nok(code);
      }
      if (code !== word.charCodeAt(matched)) return nok(code);
      effects.consume(code);
      matched += 1;
      return keyword;
    };
    const trailing: State = (code) => {
      if (isLineEnd(code)) return done(code);
      if (isSpace(code)) {
        effects.consume(code);
        return trailing;
      }
      return nok(code);
    };
    const afterColons: State = (code) => {
      if (isLineEnd(code)) return done(code);
      if (isSpace(code)) {
        effects.consume(code);
        return trailing;
      }
      if (code === word.charCodeAt(0)) return keyword(code);
      return nok(code);
    };
    const colon: State = (code) => {
      if (code === 58) {
        if (colons === 3) return nok(code);
        effects.consume(code);
        colons += 1;
        return colon;
      }
      return colons === 3 ? afterColons(code) : nok(code);
    };
    return (code) => {
      effects.enter('noteFence');
      return colon(code);
    };
  },
};

const fenceSyntax = { flow: { 58: fenceConstruct } };

/* ---- Into mdast ---- */

const marksFromMarkdown = {
  canContainEols: ['noteMark'],
  enter: {
    noteHighlight(this: FromMarkdownContext, token: Token) {
      this.enter(
        {
          type: 'noteMark',
          kind: 'highlight',
          children: [],
          data: { hName: 'mark', hProperties: { className: ['md-hl', 'md-hl-yellow'] } },
        },
        token,
      );
    },
    noteUnderline(this: FromMarkdownContext, token: Token) {
      this.enter(
        { type: 'noteMark', kind: 'underline', children: [], data: { hName: 'u', hProperties: { className: ['md-u'] } } },
        token,
      );
    },
    noteFence(this: FromMarkdownContext, token: Token) {
      this.enter({ type: 'noteFence', value: '' }, token);
    },
  },
  exit: {
    noteHighlight(this: FromMarkdownContext, token: Token) {
      this.exit(token);
    },
    noteUnderline(this: FromMarkdownContext, token: Token) {
      this.exit(token);
    },
    noteFence(this: FromMarkdownContext, token: Token) {
      const node = this.stack[this.stack.length - 1];
      node.value = this.sliceSerialize(token);
      this.exit(token);
    },
  },
};

/** The parser half: register the tokenisers and how they become nodes. */
export function remarkNoteTokens(this: { data: () => unknown }) {
  const data = this.data() as Record<string, unknown[] | undefined>;
  (data.micromarkExtensions ??= []).push(markSyntax(61, 'noteHighlight'), markSyntax(43, 'noteUnderline'), fenceSyntax);
  (data.fromMarkdownExtensions ??= []).push(marksFromMarkdown);
}

/* ---- Tree transforms ---- */

export type NoteExtrasOptions = {
  /** Shown for a toggle written without a title. */
  untitledToggle: string;
};

/**
 * Toggles, callouts and colours, read off the parsed tree. Runs before
 * remark-breaks, while every text node still has its source position.
 */
export function remarkNoteExtras(options: NoteExtrasOptions) {
  return (tree: MdNode, file: { value?: unknown }) => {
    const source = String(file?.value ?? '');
    groupToggles(tree, options);
    walk(tree, (node) => {
      if (node.type === 'blockquote') applyCallout(node);
    });
    walk(tree, (node) => {
      if (!node.children || SKIP_INLINE.has(node.type)) return;
      if (node.children.some((child) => child.type === 'text' || PHRASING.has(child.type))) {
        resolveHighlightColours(node);
        colourSpans(node, source);
      }
    });
  };
}

const SKIP_INLINE = new Set(['link', 'linkReference', 'code', 'inlineCode']);
const PHRASING = new Set(['emphasis', 'strong', 'delete', 'noteMark', 'inlineCode', 'break']);

function walk(node: MdNode, visit: (node: MdNode) => void) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

function text(value: string): MdNode {
  return { type: 'text', value };
}

/** Text written as `node` stands in the source, for a fence that is not used. */
function fenceAsParagraph(node: MdNode): MdNode {
  return { type: 'paragraph', children: [text(String(node.value ?? '').trim())], position: node.position };
}

/**
 * Pairs `:::toggle` with the next `:::` among the same siblings — nested
 * pairs nest — and moves what is between them into a `<details>`. A fence
 * left without a partner is shown as the text it is, as it was before.
 */
function groupToggles(parent: MdNode, options: NoteExtrasOptions) {
  if (!parent.children) return;
  for (const child of parent.children) if (child.type !== 'noteFence') groupToggles(child, options);
  if (!parent.children.some((child) => child.type === 'noteFence')) return;

  type Frame = { open: MdNode; children: MdNode[] };
  const root: MdNode[] = [];
  const frames: Frame[] = [];
  const target = () => (frames.length ? frames[frames.length - 1].children : root);

  for (const child of parent.children) {
    if (child.type !== 'noteFence') {
      target().push(child);
      continue;
    }
    const opening = TOGGLE_OPEN.exec(String(child.value ?? ''));
    if (opening) {
      frames.push({ open: child, children: [] });
      continue;
    }
    const frame = frames.pop();
    if (!frame) {
      root.push(fenceAsParagraph(child));
      continue;
    }
    const title = (TOGGLE_OPEN.exec(String(frame.open.value ?? ''))?.[1] ?? '').trim();
    const start = frame.open.position?.start;
    const end = child.position?.end;
    target().push({
      type: 'noteToggle',
      position: start && end ? { start, end } : undefined,
      data: { hName: 'details', hProperties: { className: ['md-toggle'] } },
      children: [
        {
          type: 'noteToggleTitle',
          data: { hName: 'summary', hProperties: { className: ['md-toggle-title'] } },
          children: [text(title || options.untitledToggle)],
        },
        { type: 'noteToggleBody', data: { hName: 'div', hProperties: { className: ['md-toggle-body'] } }, children: frame.children },
      ],
    });
  }
  /* Opened but never closed: the opener is text, its content stays put. */
  while (frames.length) {
    const frame = frames.pop()!;
    target().push(fenceAsParagraph(frame.open), ...frame.children);
  }
  parent.children = root;
}

/** `> [!NOTE]` on a quote's first line makes it a callout box. */
function applyCallout(quote: MdNode) {
  const first = quote.children?.[0];
  const lead = first?.type === 'paragraph' ? first.children?.[0] : null;
  if (!first || !lead || lead.type !== 'text') return;
  const m = CALLOUT_MARKER.exec(String(lead.value));
  const type = m ? calloutTypeOf(m[1]) : null;
  if (!m || !type) return;
  lead.value = String(lead.value).slice(m[0].length);
  if (!lead.value) first.children!.shift();
  /* A soft line break left first after the marker line. */
  if (first.children![0]?.type === 'text' && !String(first.children![0].value).trim() && first.children!.length === 1) {
    first.children!.shift();
  }
  if (!first.children!.length) quote.children!.shift();
  quote.data = { hName: 'div', hProperties: { className: ['md-callout', `md-callout-${type}`] } };
  quote.children!.unshift({
    type: 'noteCalloutTitle',
    data: { hName: 'div', hProperties: { dataCalloutTitle: type } },
    children: [],
  });
}

/**
 * `==[green]text==`: the colour tag inside a highlight. A tag that is not
 * one of the eight names makes the whole thing plain text again, markers
 * and all.
 */
function resolveHighlightColours(parent: MdNode) {
  const out: MdNode[] = [];
  for (const child of parent.children!) {
    if (child.type !== 'noteMark' || child.kind !== 'highlight') {
      out.push(child);
      continue;
    }
    const lead = child.children?.[0];
    const m = lead?.type === 'text' ? /^\[([A-Za-z]+)\]/.exec(String(lead.value)) : null;
    if (!m || !lead) {
      out.push(child);
      continue;
    }
    if (isNoteColor(m[1])) {
      lead.value = String(lead.value).slice(m[0].length);
      if (!lead.value) child.children!.shift();
      child.data = { hName: 'mark', hProperties: { className: ['md-hl', `md-hl-${m[1]}`] } };
      out.push(child);
    } else {
      out.push(text('=='), ...(child.children ?? []), text('=='));
    }
  }
  parent.children = mergeText(out);
}

function mergeText(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === 'text' && last?.type === 'text' && !last.position && !node.position) {
      last.value = String(last.value) + String(node.value);
    } else if (!(node.type === 'text' && node.value === '')) {
      out.push(node);
    }
  }
  return out;
}

/* ---- `[text]{red}` ---- */

/** Which characters of a text node's value were written with a backslash. */
const ESCAPES = new WeakMap<MdNode, boolean[]>();

function escapesOf(node: MdNode, source: string): boolean[] {
  const known = ESCAPES.get(node);
  if (known) return known;
  const value = String(node.value ?? '');
  const out = new Array<boolean>(value.length).fill(false);
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && end !== undefined) {
    /* A node that begins with an escaped character starts after the
       backslash, so look one character back for it. */
    if (start > 0 && source[start - 1] === '\\' && source[start] === value[0] && /[!-/:-@[-`{-~]/.test(value[0] ?? '')) {
      out[0] = true;
    }
    const raw = source.slice(start, end);
    let i = 0;
    for (let j = 0; j < value.length && i < raw.length; j += 1) {
      if (raw[i] === '\\' && raw[i + 1] === value[j] && /[!-/:-@[-`{-~]/.test(value[j])) {
        out[j] = true;
        i += 2;
      } else if (raw[i] === '&' && raw[i] !== value[j]) {
        const semi = raw.indexOf(';', i);
        i = semi === -1 ? i + 1 : semi + 1;
      } else {
        i += 1;
      }
    }
  }
  ESCAPES.set(node, out);
  return out;
}

function sliceText(node: MdNode, from: number, to?: number): MdNode {
  const piece = text(String(node.value).slice(from, to));
  const escapes = ESCAPES.get(node);
  if (escapes) ESCAPES.set(piece, escapes.slice(from, to));
  return piece;
}

const COLOR_TAIL = new RegExp(`^\\]\\{(${NOTE_COLOR_ALT})\\}`);

function colourNode(name: string, children: MdNode[]): MdNode {
  return {
    type: 'noteColor',
    data: { hName: 'span', hProperties: { className: ['md-c', `md-c-${name}`] } },
    children: children.filter((child) => !(child.type === 'text' && !child.value)),
  };
}

/**
 * Finds `[` … `]{name}` among a parent's children: within one text node, or
 * across bold, italic and the like between two text nodes. Never across a
 * link. An escaped `\[` or a name not on the list leaves it as text.
 */
function colourSpans(parent: MdNode, source: string) {
  const kids = parent.children!;
  let i = 0;
  while (i < kids.length) {
    const node = kids[i];
    if (node.type !== 'text') {
      i += 1;
      continue;
    }
    const value = String(node.value);
    const escapes = escapesOf(node, source);
    let replaced = false;

    for (let p = value.indexOf('['); p !== -1 && !replaced; p = value.indexOf('[', p + 1)) {
      if (escapes[p]) continue;
      /* Same text node: the nearest `]` with no `[` in between. */
      const close = nextBracket(value, escapes, p + 1);
      if (close && close.char === ']') {
        const tail = COLOR_TAIL.exec(value.slice(close.index));
        if (tail && close.index > p + 1) {
          const after = close.index + tail[0].length;
          kids.splice(
            i,
            1,
            sliceText(node, 0, p),
            colourNode(tail[1], [sliceText(node, p + 1, close.index)]),
            sliceText(node, after),
          );
          i += 2;
          replaced = true;
        }
        continue;
      }
      if (close) continue;
      /* Across siblings: phrasing in between, the `]{name}` in a later text. */
      for (let j = i + 1; j < kids.length; j += 1) {
        const other = kids[j];
        if (other.type === 'link' || other.type === 'linkReference' || other.type === 'image') break;
        if (other.type !== 'text') continue;
        const otherValue = String(other.value);
        const found = nextBracket(otherValue, escapesOf(other, source), 0);
        if (!found || found.char === '[') break;
        const tail = COLOR_TAIL.exec(otherValue.slice(found.index));
        if (!tail) break;
        const inner = [sliceText(node, p + 1), ...kids.slice(i + 1, j), sliceText(other, 0, found.index)];
        kids.splice(
          i,
          j - i + 1,
          sliceText(node, 0, p),
          colourNode(tail[1], inner),
          sliceText(other, found.index + tail[0].length),
        );
        i += 2;
        replaced = true;
        break;
      }
    }
    if (!replaced) i += 1;
  }
  parent.children = kids.filter((child) => !(child.type === 'text' && child.value === ''));
}

function nextBracket(value: string, escapes: boolean[], from: number): { index: number; char: string } | null {
  for (let k = from; k < value.length; k += 1) {
    if ((value[k] === '[' || value[k] === ']') && !escapes[k]) return { index: k, char: value[k] };
  }
  return null;
}

/* ---- Headings: anchors and contents ---- */

export type TocEntry = { id: string; depth: number; text: string };

function plainText(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return String(node.value ?? '');
  return (node.children ?? []).map(plainText).join('');
}

/** Letters and digits of any script (Thai keeps its vowel marks), dashed. */
export function headingSlug(textValue: string): string {
  const slug = textValue
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return slug || 'section';
}

/**
 * Every heading gets an id from its text — `h-` first, so it can never be
 * one the app uses — numbered when two match. With three or more headings
 * at the top level, a contents box goes first. Headings inside a toggle are
 * hidden until it opens, so they are not listed.
 */
export function remarkHeadingsToc() {
  return (tree: MdNode) => {
    const used = new Map<string, number>();
    const entries: TocEntry[] = [];
    const visit = (node: MdNode, topLevel: boolean) => {
      if (node.type === 'heading') {
        const label = plainText(node).trim();
        const base = `h-${headingSlug(label)}`;
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        const id = count ? `${base}-${count + 1}` : base;
        node.data = { ...node.data, hProperties: { ...(node.data?.hProperties ?? {}), id } };
        if (topLevel && label) entries.push({ id, depth: node.depth ?? 1, text: label });
        return;
      }
      node.children?.forEach((child) => visit(child, false));
    };
    tree.children?.forEach((child) => visit(child, true));
    if (entries.length >= 3) {
      tree.children?.unshift({
        type: 'noteToc',
        data: { hName: 'nav', hProperties: { dataToc: JSON.stringify(entries) } },
        children: [],
      });
    }
  };
}
