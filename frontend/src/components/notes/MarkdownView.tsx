import type { Element as HastElement, Nodes as HastNodes, Root as HastRoot } from 'hast';
import type { Paragraph, Root as MdRoot, RootContent } from 'mdast';
import { createContext, MouseEvent, useContext, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown, { Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Processor } from 'unified';

import { classifyEmbed, Embed, shortenUrl } from '../../lib/embeds';
import { isAllowedUrl } from '../../lib/markdownEdit';
import { NoteEmbed, Picture } from './NoteEmbeds';

/**
 * A note's body, rendered. This module is its own chunk — the parser is most
 * of its weight — so the Notes list and every other page never load it.
 *
 * Safe by construction: `react-markdown` builds React elements and never sets
 * innerHTML, the HTML syntax is switched off in the parser (so `<b>` is shown
 * as the four characters it is), and only http, https and mailto addresses
 * become links or anything else that leaves the page.
 *
 * A link alone on its line becomes an embed — a YouTube card, a picture or a
 * website card (see `remarkEmbeds`); in a sentence it stays a link.
 */
export default function MarkdownView({
  source,
  onToggleTask,
  onEdit,
}: {
  source: string;
  /** Flip the checkbox of the list item that starts at this source offset.
   *  Absent while a save conflict is open, which disables the boxes. */
  onToggleTask?: (offset: number) => void;
  /** A tap on the text: where in the source it was, and where on screen. */
  onEdit: (offset: number | null, clientY: number) => void;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);

  const components = useMemo<Components>(
    () => ({
      a({ href, children, node, ...rest }) {
        if (!href || !isAllowedUrl(href)) return <span className="md-link-off">{children}</span>;
        const only = node?.children.length === 1 ? node.children[0] : null;
        const text = only?.type === 'text' ? only.value : null;
        const bare = text !== null && isBareUrl(text, href);
        return (
          <a {...rest} href={href} className="md-link" target="_blank" rel="noopener noreferrer" title={href}>
            {bare ? shortenUrl(href) : children}
          </a>
        );
      },
      img({ src, alt }) {
        /* `urlTransform` has already blanked anything but http, https and
           mailto; Picture loads https only and links the rest. */
        const url = typeof src === 'string' ? src : '';
        if (!url || !isAllowedUrl(url)) return <span className="md-link-off">{alt}</span>;
        return <Picture url={url} alt={alt ?? ''} />;
      },
      div({ node, children, className, ...rest }) {
        const embed = node ? embedOf(node) : null;
        if (embed) {
          return (
            <div {...rest} className="md-embed">
              <NoteEmbed embed={embed} alt={String(node?.properties.dataEmbedAlt ?? '')} />
            </div>
          );
        }
        return (
          <div {...rest} className={className}>
            {children}
          </div>
        );
      },
      li({ node, children, className, ...rest }) {
        return (
          <TaskOffset.Provider value={node?.position?.start.offset ?? -1}>
            <li {...rest} className={className}>
              {children}
            </li>
          </TaskOffset.Provider>
        );
      },
      input({ type, checked }) {
        if (type !== 'checkbox') return null;
        return <TaskBox checked={Boolean(checked)} onToggle={onToggleTask} label={t('notes.taskToggle')} lockedLabel={t('notes.taskLocked')} />;
      },
      table({ children, className }) {
        /* A wide table scrolls inside its own strip, never the page. */
        return (
          <div className="md-table-scroll">
            <table className={className}>{children}</table>
          </div>
        );
      },
    }),
    [onToggleTask, t],
  );

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    /* A click in the picture lightbox bubbles here through React's portal
       but is not on the note. */
    if (!rootRef.current?.contains(target)) return;
    /* Links, checkboxes and embeds do their own thing; text being selected
       to copy is not a tap. */
    if (target.closest('a, input, button, iframe, .md-embed, .md-picture')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && rootRef.current?.contains(selection.anchorNode)) return;
    let block = target.closest<HTMLElement>('[data-src]');
    /* Between blocks: the last one starting above the tap. */
    if (!block && rootRef.current) {
      for (const child of rootRef.current.querySelectorAll<HTMLElement>(':scope > [data-src]')) {
        if (child.getBoundingClientRect().top <= event.clientY) block = child;
      }
    }
    if (!block) {
      onEdit(null, event.clientY);
      return;
    }
    const start = Number(block.dataset.src);
    onEdit(Number.isFinite(start) ? caretInSource(source, block, start, event.clientX, event.clientY) : null, event.clientY);
  }

  return (
    <div ref={rootRef} className="md" onClick={onClick}>
      {source.trim() ? (
        <Markdown
          remarkPlugins={[remarkNoteSyntax, remarkGfm, remarkBreaks, remarkEmbeds, remarkBlankLines]}
          rehypePlugins={[rehypeSourceOffsets]}
          urlTransform={(url) => (isAllowedUrl(url) ? url : '')}
          components={components}
        >
          {source}
        </Markdown>
      ) : (
        <p className="md-empty">{t('notes.readEmpty')}</p>
      )}
    </div>
  );
}

const TaskOffset = createContext(-1);

function TaskBox({
  checked,
  onToggle,
  label,
  lockedLabel,
}: {
  checked: boolean;
  onToggle?: (offset: number) => void;
  label: string;
  lockedLabel: string;
}) {
  const offset = useContext(TaskOffset);
  const enabled = Boolean(onToggle) && offset >= 0;
  return (
    <input
      type="checkbox"
      className="md-task-box"
      checked={checked}
      disabled={!enabled}
      aria-label={label}
      title={enabled ? undefined : lockedLabel}
      onChange={() => onToggle?.(offset)}
    />
  );
}

/* ---- Plugins ---- */

/**
 * Switches off the parts of Markdown that would change how an old plain-text
 * note looks, or let HTML through:
 * - `htmlFlow` / `htmlText`: tags show as text.
 * - `setextUnderline`: "Total\n---" is a line and a divider, not a heading.
 * - `codeIndented`: four leading spaces are not a code block.
 */
function remarkNoteSyntax(this: Processor) {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push({
    disable: { null: ['htmlFlow', 'htmlText', 'setextUnderline', 'codeIndented'] },
  });
}

/**
 * Markdown folds any run of blank lines into one paragraph break. Plain-text
 * notes used them for spacing, so each extra blank line gets a spacer.
 */
function remarkBlankLines() {
  return (tree: MdRoot) => {
    const out: RootContent[] = [];
    let previous: RootContent | null = null;
    for (const child of tree.children) {
      const end = previous?.position?.end.line;
      const start = child.position?.start.line;
      if (end !== undefined && start !== undefined) {
        const extra = Math.min(start - end - 2, 20);
        for (let i = 0; i < extra; i += 1) {
          const gap: Paragraph = {
            type: 'paragraph',
            children: [],
            data: { hName: 'div', hProperties: { className: ['md-gap'], ariaHidden: 'true' } },
          };
          out.push(gap);
        }
      }
      out.push(child);
      previous = child;
    }
    tree.children = out;
  };
}

/** Each element carries where it starts in the source, so a tap can put the
 *  caret at the block that was tapped and a checkbox knows which `[ ]` it is. */
function rehypeSourceOffsets() {
  return (tree: HastRoot) => {
    const walk = (node: HastNodes) => {
      if (node.type === 'element') {
        const offset = (node as HastElement).position?.start.offset;
        if (offset !== undefined) node.properties.dataSrc = offset;
      }
      if ('children' in node) node.children.forEach(walk);
    };
    walk(tree);
  };
}

/* ---- Embeds ---- */

type MdNode = { type: string; children?: MdNode[]; position?: Paragraph['position']; [key: string]: unknown };

/**
 * Lifts each link that is alone on its line — a bare URL, or a picture —
 * out of its paragraph into a block of its own, marked for the `div`
 * component to render as an embed. The text around it stays paragraphs,
 * positions kept, so tapping them still puts the caret in the right place.
 * A `[label](url)` link, or a URL with words beside it, is left alone.
 */
function remarkEmbeds() {
  return (tree: MdRoot) => liftEmbeds(tree as unknown as MdNode);
}

function liftEmbeds(parent: MdNode) {
  if (!parent.children) return;
  const out: MdNode[] = [];
  for (const child of parent.children) {
    if (child.type === 'paragraph') out.push(...splitParagraph(child));
    else {
      liftEmbeds(child);
      out.push(child);
    }
  }
  parent.children = out;
}

function splitParagraph(paragraph: MdNode): MdNode[] {
  const lines: MdNode[][] = [[]];
  for (const node of paragraph.children ?? []) {
    if (node.type === 'break') lines.push([]);
    else lines[lines.length - 1].push(node);
  }
  const embedOfLine = (line: MdNode[]) => {
    const solid = line.filter((node) => !(node.type === 'text' && !String(node.value).trim()));
    if (solid.length !== 1) return null;
    const node = solid[0];
    const url = String(node.url ?? '');
    if (node.type === 'image') {
      /* A picture by Markdown is a picture whatever its extension. */
      return /^https:/i.test(url) ? { url, alt: String(node.alt ?? ''), image: true, node } : null;
    }
    if (node.type !== 'link') return null;
    const only = node.children?.length === 1 ? node.children[0] : null;
    if (only?.type !== 'text' || !isBareUrl(String(only.value), url)) return null;
    return classifyEmbed(url) ? { url, alt: '', image: false, node } : null;
  };
  if (!lines.some((line) => embedOfLine(line))) return [paragraph];

  const out: MdNode[] = [];
  let pending: MdNode[][] = [];
  /* remark-breaks leaves the text it splits without positions, so each
     piece is placed from what is known: it starts where the paragraph or the
     embed before it ended, and ends where the next embed starts. */
  type Point = NonNullable<Paragraph['position']>['start'];
  let cursor: Point | undefined = paragraph.position?.start;
  const flush = (until: Point | undefined) => {
    const kept = pending.filter((line) => line.length);
    if (kept.length) {
      const children = kept.flatMap((line, index) => (index ? [{ type: 'break' } as MdNode, ...line] : line));
      const lastLine = kept[kept.length - 1];
      const start = kept[0][0].position?.start ?? cursor;
      const end = lastLine[lastLine.length - 1].position?.end ?? until;
      out.push({ type: 'paragraph', children, position: start && end ? { start, end } : undefined });
    }
    pending = [];
  };
  for (const line of lines) {
    const found = embedOfLine(line);
    if (!found) {
      pending.push(line);
      continue;
    }
    const at = found.node.position;
    flush(at ? { line: at.start.line - 1, column: 1, offset: (at.start.offset ?? 1) - 1 } : undefined);
    if (at?.end.offset !== undefined) cursor = { line: at.end.line + 1, column: 1, offset: at.end.offset + 1 };
    out.push({
      type: 'paragraph',
      children: [],
      position: found.node.position,
      data: {
        hName: 'div',
        hProperties: { dataEmbedUrl: found.url, dataEmbedAlt: found.alt, dataEmbedImage: found.image ? 'true' : 'false' },
      },
    });
  }
  flush(paragraph.position?.end);
  return out;
}

/** The embed a `div` stands for, from the marks `remarkEmbeds` left on it. */
function embedOf(node: HastElement): Embed | null {
  const url = node.properties.dataEmbedUrl;
  if (typeof url !== 'string' || !url) return null;
  if (node.properties.dataEmbedImage === 'true') return { kind: 'image', url };
  return classifyEmbed(url);
}

/* ---- Tap to caret ---- */

/**
 * Where in the source a tap at (x, y) inside `block` was. The rendered text
 * has no markers, so this takes the few characters just before the tap
 * point and finds them in the source after the block's start; when that
 * fails (the snippet crossed a `**`, say) the block's start is close enough.
 */
function caretInSource(source: string, block: HTMLElement, blockStart: number, x: number, y: number): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) ({ offsetNode: node, offset } = pos);
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !block.contains(node)) return blockStart;
  const range = document.createRange();
  range.setStart(block, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return blockStart;
  }
  const before = range.toString();
  const line = before.slice(before.lastIndexOf('\n') + 1);
  const snippet = line.slice(-12);
  if (!snippet.trim()) {
    /* At the start of a rendered line: find that line's start instead. */
    const lines = before.split('\n').length - 1;
    let at = blockStart;
    for (let i = 0; i < lines; i += 1) {
      const next = source.indexOf('\n', at);
      if (next === -1) return blockStart;
      at = next + 1;
    }
    return at;
  }
  const found = source.indexOf(snippet, blockStart);
  return found === -1 || found - blockStart > before.length * 2 + 200 ? blockStart : found + snippet.length;
}

/* ---- Links ---- */

/** The link text is just the address (an autolinked URL or email). */
function isBareUrl(text: string, href: string): boolean {
  return text === href || `http://${text}` === href || `https://${text}` === href || `mailto:${text}` === href;
}
