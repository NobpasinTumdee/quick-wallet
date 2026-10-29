import type { Element as HastElement, Nodes as HastNodes, Root as HastRoot } from 'hast';
import type { Paragraph, Root as MdRoot, RootContent } from 'mdast';
import { createContext, MouseEvent, ReactNode, useContext, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown, { Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type { Processor } from 'unified';

import { isAllowedUrl } from '../../lib/markdownEdit';

/**
 * A note's body, rendered. This module is its own chunk — the parser is most
 * of its weight — so the Notes list and every other page never load it.
 *
 * Safe by construction: `react-markdown` builds React elements and never sets
 * innerHTML, the HTML syntax is switched off in the parser (so `<b>` is shown
 * as the four characters it is), and only http, https and mailto addresses
 * become links or anything else that leaves the page.
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
        /* Notes are text: an image is offered as a link, never loaded. */
        const url = typeof src === 'string' ? src : '';
        if (!url || !isAllowedUrl(url)) return <span className="md-link-off">{alt}</span>;
        return (
          <a href={url} className="md-link" target="_blank" rel="noopener noreferrer" title={url}>
            {alt || shortenUrl(url)}
          </a>
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
    /* Links and checkboxes do their own thing; text being selected to copy
       is not a tap. */
    if (target.closest('a, input, button')) return;
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
          remarkPlugins={[remarkNoteSyntax, remarkGfm, remarkBreaks, remarkBlankLines]}
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

/**
 * A long address made readable: the domain and the start of the path,
 * "…" for the rest. The full address stays in the tooltip.
 */
function shortenUrl(href: string): ReactNode {
  try {
    const url = new URL(href);
    if (url.protocol === 'mailto:') return decodeURIComponent(url.pathname);
    const host = url.hostname.replace(/^www\./, '');
    const path = decodeSafe(`${url.pathname}${url.search}${url.hash}`).replace(/\/$/, '');
    if (!path) return host;
    if ((host + path).length <= 34) return host + path;
    const first = path.split(/[/?#]/).filter(Boolean)[0] ?? '';
    return `${host}/${first.length > 16 ? first.slice(0, 16) : first}…`;
  } catch {
    return href.length > 40 ? `${href.slice(0, 37)}…` : href;
  }
}

function decodeSafe(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}
