import {
  ClipboardEvent,
  ForwardedRef,
  KeyboardEvent,
  Suspense,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { lazyWithRetry } from '../../lib/lazyWithRetry';
import {
  TextEdit,
  TextState,
  applyColor,
  chainEdits,
  clearFormatting,
  codeAction,
  codeBlockAction,
  continueOnEnter,
  cycleHeading,
  hasColor,
  headingLevelAt,
  indentLines,
  insertBlock,
  insertCallout,
  insertDivider,
  insertLink,
  insertTable,
  insertText,
  insertToggle,
  moveTableCell,
  outdentLines,
  pastedUrl,
  selectionIsList,
  setHeading,
  slashTrigger,
  toggleBlock,
  toggleInline,
  toggleTaskAt,
} from '../../lib/markdownEdit';
import { toast } from '../../lib/toast';
import { useSettings } from '../../state/SettingsContext';
import { Note } from '../../types';
import { NoteBodySkeleton } from '../skeleton/pageSkeletons';
import { EmbedDialog } from './EmbedDialog';
import { LinkDialog, LinkTab } from './LinkDialog';
import { FormatCommand, HistoryState, MOD_IS_META, NoteFormatBar } from './NoteFormatBar';
import { SlashItem, SlashMenu, filterSlashItems } from './SlashMenu';
/* The editor's and reader's styles travel with the field, so a page other
   than Notes (Planning's card sheet) gets them too. */
import './notes.css';

/* The Markdown parser is the heavy part of a note, so it loads on its own —
   only when a body is shown to read. */
const MarkdownView = lazyWithRetry(() => import('./MarkdownView'));

export type MarkdownMode = 'read' | 'edit';

/** Commands that open a dialog rather than change the text. */
const DIALOG_ACTIONS = new Set(['link', 'embed', 'noteLink']);

/** Whether the browser can undo and redo a textarea's typing on request. */
function historySupport(command: 'undo' | 'redo'): HistoryState {
  try {
    return typeof document.queryCommandSupported === 'function' && document.queryCommandSupported(command)
      ? 'ok'
      : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

export interface MarkdownFieldHandle {
  /** Into the editor with the caret at `offset` (null: the end), lined up with `clientY`. */
  startEditing: (offset: number | null, clientY: number | null) => void;
  /** The Edit button: the caret goes to the first block below `top` (a toolbar's bottom). */
  editFromTop: (top: number) => void;
  stopEditing: () => void;
  focus: () => void;
  /** The reading view's element, while reading. */
  readNode: () => HTMLDivElement | null;
}

export interface MarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
  mode: MarkdownMode;
  onModeChange: (mode: MarkdownMode) => void;
  max: number;
  placeholder: string;
  ariaLabel: string;
  /** Whether a linked note still exists, for the reading view's note links. */
  noteExists: (id: string) => boolean;
  /** Notes for the Link dialog's Note tab. */
  otherNotes: Note[];
  /** The note being edited, left out of the Link dialog's list. */
  currentNoteId?: string | null;
  /** Checkboxes in the reading view can't be ticked (a save conflict is open). */
  tasksDisabled?: boolean;
  /** Anything else that changes the textarea's width or font (it re-measures its height). */
  layoutKey?: unknown;
  bodyClassName?: string;
  readClassName?: string;
  skeletonPage?: string;
  rows?: number;
}

/**
 * A Markdown body: the Notes editor's textarea with its format bar, slash
 * menu, link and embed dialogs, and the rendered reading view. Notes uses it
 * for a note's body; Planning for a card's description. It owns no saving —
 * `value` in, `onChange` out — and the parent owns the read/edit mode.
 *
 * The body grows with its text, so whatever scrolls around it (the page, or
 * a sheet's body) is the one scroll a phone keyboard keeps the caret in.
 */
export const MarkdownField = forwardRef(function MarkdownField(
  {
    value,
    onChange,
    mode,
    onModeChange,
    max,
    placeholder,
    ariaLabel,
    noteExists,
    otherNotes,
    currentNoteId = null,
    tasksDisabled = false,
    layoutKey,
    bodyClassName = 'note-body',
    readClassName = 'note-read',
    skeletonPage = 'note-editor',
    rows = 12,
  }: MarkdownFieldProps,
  ref: ForwardedRef<MarkdownFieldHandle>,
) {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const [bodyFocused, setBodyFocused] = useState(false);
  const [headingLevel, setHeadingLevel] = useState(0);
  const [link, setLink] = useState<{ start: number; end: number; text: string; tab: LinkTab } | null>(null);
  /* Where the Embed dialog's result goes, kept while the dialog has focus. */
  const [embedAt, setEmbedAt] = useState<{ start: number; end: number } | null>(null);
  const [history, setHistory] = useState<{ undo: HistoryState; redo: HistoryState }>(() => ({
    undo: historySupport('undo'),
    redo: historySupport('redo'),
  }));

  /* Stable for the reading view, which rebuilds its renderers when it changes. */
  const existsRef = useRef(noteExists);
  existsRef.current = noteExists;
  const linkedNoteExists = useCallback((id: string) => existsRef.current(id), []);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const readRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, mode, layoutKey]);

  /* ---- Switching between reading and writing ---- */

  /**
   * Into the editor with the caret at `offset`, the start of the block that
   * was tapped. Whatever scrolls is scrolled so that line sits where the
   * finger was. The switch is flushed inside the tap so `focus()` still
   * counts as the user's own gesture, which iOS needs before it will open
   * the keyboard.
   */
  function startEditing(offset: number | null, clientY: number | null) {
    const scroller = scrollerOf(readRef.current ?? bodyRef.current);
    const before = scroller ? scroller.scrollTop : window.scrollY;
    flushSync(() => onModeChange('edit'));
    const el = bodyRef.current;
    if (!el) return;
    const pos = Math.max(0, Math.min(offset ?? el.value.length, el.value.length));
    el.focus({ preventScroll: true });
    el.setSelectionRange(pos, pos);
    if (scroller) scroller.scrollTop = before;
    else window.scrollTo(0, before);
    if (clientY !== null) {
      const caret = caretClientRect(el, pos).top;
      scrollBy(el, caret - clientY + lineHeight(el) / 2);
    }
    setHeadingLevel(headingLevelAt(el.value, pos));
  }

  function editFromTop(top: number) {
    const blocks = readRef.current?.querySelectorAll<HTMLElement>('.md > [data-src], .md li[data-src]') ?? [];
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.bottom > top) {
        startEditing(Number(block.dataset.src), Math.max(rect.top, top));
        return;
      }
    }
    startEditing(null, null);
  }

  function stopEditing() {
    bodyRef.current?.blur();
    setSlash(null);
    onModeChange('read');
  }

  useImperativeHandle(ref, () => ({
    startEditing,
    editFromTop,
    stopEditing,
    focus: () => bodyRef.current?.focus(),
    readNode: () => readRef.current,
  }));

  /* ---- Formatting ---- */

  const syncHeading = useCallback(() => {
    const el = bodyRef.current;
    if (el) setHeadingLevel(headingLevelAt(el.value, el.selectionStart));
  }, []);

  /**
   * One replacement, applied the way typing would be, so Ctrl+Z / shake to
   * undo takes it back as one step. `insertText` is what keeps the browser's
   * undo stack; where it is refused, the text is changed directly and an
   * `input` event tells React, at the cost of that one undo step.
   */
  function applyEdit(edit: TextEdit) {
    const el = bodyRef.current;
    if (!el) return;
    if (el.value.length - (edit.to - edit.from) + edit.text.length > max) {
      toast.error(t('notes.limitReached'));
      return;
    }
    el.focus({ preventScroll: true });
    el.setSelectionRange(edit.from, edit.to);
    let done = false;
    try {
      done = edit.text
        ? document.execCommand('insertText', false, edit.text)
        : edit.from === edit.to || document.execCommand('delete', false);
    } catch {
      done = false;
    }
    if (!done) {
      el.setRangeText(edit.text, edit.from, edit.to, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.setSelectionRange(edit.selStart, edit.selEnd);
    syncHeading();
    keepCaretAboveDock();
  }

  function currentState(): TextState | null {
    const el = bodyRef.current;
    return el ? { value: el.value, start: el.selectionStart, end: el.selectionEnd } : null;
  }

  /**
   * The browser's own undo and redo — the same history Ctrl+Z walks, which
   * every edit here joins through `insertText`. When the browser will not do
   * it, the button is greyed out with the reason; there is deliberately no
   * second history of our own that could disagree with the first.
   */
  function runHistory(command: 'undo' | 'redo') {
    const el = bodyRef.current;
    if (!el || history[command] !== 'ok') return;
    el.focus({ preventScroll: true });
    let done = false;
    try {
      done = document.execCommand(command, false);
    } catch {
      done = false;
    }
    setHistory((current) => ({
      ...current,
      [command]: done ? 'ok' : 'empty',
      /* Undoing makes something to redo, and the other way round. */
      ...(done && current[command === 'undo' ? 'redo' : 'undo'] === 'empty' ? { [command === 'undo' ? 'redo' : 'undo']: 'ok' } : {}),
    }));
    syncHeading();
    keepCaretAboveDock();
  }

  function formatDate(withTime: boolean): string {
    const now = new Date();
    try {
      return withTime
        ? now.toLocaleString(settings.locale, { dateStyle: 'long', timeStyle: 'short' })
        : now.toLocaleDateString(settings.locale, { dateStyle: 'long' });
    } catch {
      return withTime ? now.toLocaleString() : now.toLocaleDateString();
    }
  }

  /** The edit a command makes at `state`; null for the ones that open a dialog. */
  function editFor(command: FormatCommand, state: TextState): TextEdit | null {
    const placeholderText = t('notes.fmtPlaceholder');
    switch (command.action) {
      case 'heading':
        return cycleHeading(state);
      case 'h1':
        return setHeading(state, 1);
      case 'h2':
        return setHeading(state, 2);
      case 'h3':
        return setHeading(state, 3);
      case 'bold':
      case 'italic':
      case 'strike':
      case 'underline':
        return toggleInline(state, command.action, placeholderText);
      case 'code':
        return codeAction(state, placeholderText, t('notes.fmtPlaceholderCode'));
      case 'codeBlock':
        return codeBlockAction(state, t('notes.fmtPlaceholderCode'));
      case 'clear':
        return clearFormatting(state);
      case 'color':
      case 'highlight':
        return applyColor(state, command.action, command.color, placeholderText);
      case 'bullet':
      case 'ordered':
      case 'task':
      case 'quote':
        return toggleBlock(state, command.action);
      case 'indent':
        return indentLines(state);
      case 'outdent':
        return outdentLines(state);
      case 'divider':
        return insertDivider(state);
      case 'callout':
        return insertCallout(state, command.type, placeholderText);
      case 'toggle':
        return insertToggle(state, t('notes.fmtToggleTitle'), t('notes.fmtToggleBody'));
      case 'table':
        return insertTable(state, command.rows, command.cols, (n) => t('notes.fmtColumn', { n }));
      case 'date':
        return insertText(state, formatDate(false));
      case 'dateTime':
        return insertText(state, formatDate(true));
      default:
        return null;
    }
  }

  function openDialog(action: string, state: TextState) {
    if (action === 'embed') {
      setEmbedAt({ start: state.start, end: state.end });
      return;
    }
    const selected = state.value.slice(state.start, state.end);
    setLink({
      start: state.start,
      end: state.end,
      text: selected.includes('\n') ? '' : selected.trim(),
      tab: action === 'noteLink' ? 'note' : 'web',
    });
  }

  function runCommand(command: FormatCommand) {
    if (command.action === 'undo' || command.action === 'redo') return runHistory(command.action);
    const state = currentState();
    if (!state) return;
    if (DIALOG_ACTIONS.has(command.action)) return openDialog(command.action, state);
    const edit = editFor(command, state);
    if (edit) applyEdit(edit);
  }

  function insertLinkNow(label: string, url: string) {
    const at = link;
    /* Closing first hands focus back to the body, where the edit goes. */
    flushSync(() => setLink(null));
    const el = bodyRef.current;
    if (!at || !el) return;
    const end = Math.min(at.end, el.value.length);
    applyEdit(insertLink({ value: el.value, start: Math.min(at.start, end), end }, label, url));
  }

  /** The embed goes on a line of its own, where the reading view looks for it. */
  function insertEmbedNow(markdown: string) {
    const at = embedAt;
    flushSync(() => setEmbedAt(null));
    const el = bodyRef.current;
    if (!at || !el) return;
    const end = Math.min(at.end, el.value.length);
    applyEdit(insertBlock({ value: el.value, start: Math.min(at.start, end), end }, markdown));
  }

  /* ---- The slash menu ---- */

  const slashId = useId().replace(/:/g, '');
  const composingRef = useRef(false);
  const [slash, setSlash] = useState<{
    start: number;
    query: string;
    caret: { top: number; bottom: number; left: number };
  } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const [slashActive, setSlashActive] = useState(0);
  /** A `/` closed with Escape stays closed until the caret leaves it. */
  const dismissedRef = useRef<number | null>(null);
  const slashItems = useMemo(() => (slash ? filterSlashItems(slash.query) : []), [slash]);

  const syncSlash = useCallback(() => {
    const el = bodyRef.current;
    if (!el || composingRef.current || document.activeElement !== el || el.selectionStart !== el.selectionEnd) {
      setSlash(null);
      return;
    }
    const found = slashTrigger(el.value, el.selectionStart);
    if (!found) dismissedRef.current = null;
    if (!found || dismissedRef.current === found.start) {
      setSlash(null);
      return;
    }
    const rect = caretClientRect(el, found.start);
    const line = lineHeight(el);
    const shown = slashRef.current;
    if (!shown || shown.start !== found.start || shown.query !== found.query) setSlashActive(0);
    setSlash({ start: found.start, query: found.query, caret: { top: rect.top, bottom: rect.top + line, left: rect.left } });
  }, []);

  /* Scrolling moves the caret on screen; the menu follows it. Captured on the
     document, so a sheet's own scrolling counts as well as the page's. */
  useEffect(() => {
    if (!slash) return undefined;
    const onMove = () => syncSlash();
    document.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('scroll', onMove, { capture: true });
      window.visualViewport?.removeEventListener('resize', onMove);
    };
  }, [slash, syncSlash]);

  function pickSlash(item: SlashItem) {
    const state = currentState();
    const open = slash;
    setSlash(null);
    if (!state || !open) return;
    /* The `/word` goes, in the same undo step as what replaces it. */
    const remove: TextEdit = { from: open.start, to: state.end, text: '', selStart: open.start, selEnd: open.start };
    if (DIALOG_ACTIONS.has(item.command.action)) {
      applyEdit(remove);
      const after = currentState();
      if (after) openDialog(item.command.action, after);
      return;
    }
    applyEdit(chainEdits(state, remove, (next) => editFor(item.command, next) ?? insertText(next, '')));
  }

  /* ---- Keys ---- */

  function onBodyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    /* Thai, Japanese, any IME: Enter and Tab belong to the composition. */
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const state = currentState();
    if (!state) return;
    const mod = MOD_IS_META ? event.metaKey : event.ctrlKey;

    if (slash) {
      const count = slashItems.length;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismissedRef.current = slash.start;
        setSlash(null);
        return;
      }
      if (count > 0 && !mod && !event.altKey) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setSlashActive((index) => (index + step + count) % count);
          return;
        }
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
          event.preventDefault();
          pickSlash(slashItems[Math.min(slashActive, count - 1)]);
          return;
        }
      }
    }

    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      const action = event.shiftKey
        ? key === 'x'
          ? 'strike'
          : null
        : key === 'b'
          ? 'bold'
          : key === 'i'
            ? 'italic'
            : key === 'u'
              ? 'underline'
              : key === 'k'
                ? 'link'
                : key === 'e'
                  ? 'code'
                  : null;
      if (action) {
        event.preventDefault();
        runCommand({ action });
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      const edit = continueOnEnter(state);
      if (edit) {
        event.preventDefault();
        applyEdit(edit);
      }
      return;
    }
    if (event.key === 'Tab') {
      /* In a table, Tab walks the cells (and adds a row past the last one). */
      const cell = moveTableCell(state, event.shiftKey);
      if (cell) {
        event.preventDefault();
        applyEdit(cell);
        return;
      }
      /* Tab indents list items; anywhere else it moves focus as usual,
         so the page stays usable from the keyboard. */
      if (selectionIsList(state)) {
        event.preventDefault();
        applyEdit(event.shiftKey ? outdentLines(state) : indentLines(state));
      }
    }
  }

  /** A link pasted over selected words links those words. */
  function onBodyPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const state = currentState();
    if (!state || state.start === state.end) return;
    const selected = state.value.slice(state.start, state.end);
    if (selected.includes('\n')) return;
    const url = pastedUrl(event.clipboardData.getData('text/plain'));
    if (!url) return;
    event.preventDefault();
    applyEdit(insertLink(state, selected, url));
  }

  /**
   * With the bar docked above a phone keyboard, the browser only knows to
   * keep the caret above the keyboard — not above the bar. Nudge whatever
   * scrolls when the caret line slips behind it.
   */
  const keepCaretAboveDock = useCallback(() => {
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      const dock = document.querySelector<HTMLElement>('.note-format.is-docked');
      if (!el || !dock || document.activeElement !== el) return;
      const limit = dock.getBoundingClientRect().top - 8;
      const bottom = caretClientRect(el, el.selectionEnd).top + lineHeight(el);
      if (bottom > limit) scrollBy(el, bottom - limit);
    });
  }, []);

  /* The docked bar appears as the keyboard finishes opening. */
  useEffect(() => {
    if (!bodyFocused) return undefined;
    const vv = window.visualViewport;
    vv?.addEventListener('resize', keepCaretAboveDock);
    return () => vv?.removeEventListener('resize', keepCaretAboveDock);
  }, [bodyFocused, keepCaretAboveDock]);

  /* ---- Checkboxes in the reading view ---- */

  const toggleTask = useCallback(
    (offset: number) => {
      const next = toggleTaskAt(value, offset);
      if (next !== null) onChange(next);
    },
    [value, onChange],
  );

  return (
    <>
      {mode === 'edit' ? (
        <>
          <NoteFormatBar
            onCommand={runCommand}
            headingLevel={headingLevel}
            editing={bodyFocused}
            history={history}
            isColored={(kind) => {
              const state = currentState();
              return state ? hasColor(state, kind) : false;
            }}
          />
          <textarea
            ref={bodyRef}
            className={bodyClassName}
            value={value}
            maxLength={max}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-controls={slash ? slashId : undefined}
            aria-expanded={slash ? true : undefined}
            aria-activedescendant={slash && slashItems.length ? `${slashId}-${slashActive}` : undefined}
            rows={rows}
            onChange={(event) => {
              onChange(event.target.value);
              /* New typing gives undo something to take back again. */
              setHistory((current) =>
                current.undo === 'empty' || current.redo === 'empty'
                  ? {
                      undo: current.undo === 'empty' ? 'ok' : current.undo,
                      redo: current.redo === 'empty' ? 'ok' : current.redo,
                    }
                  : current,
              );
              keepCaretAboveDock();
              syncSlash();
            }}
            onKeyDown={onBodyKeyDown}
            onPaste={onBodyPaste}
            onSelect={() => {
              syncHeading();
              syncSlash();
            }}
            onCompositionStart={() => {
              composingRef.current = true;
              setSlash(null);
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
              syncSlash();
            }}
            onFocus={() => setBodyFocused(true)}
            onBlur={() => {
              setBodyFocused(false);
              setSlash(null);
            }}
          />
          {slash && (
            <SlashMenu
              items={slashItems}
              active={Math.min(slashActive, Math.max(0, slashItems.length - 1))}
              caret={slash.caret}
              listId={slashId}
              onPick={pickSlash}
              onHover={setSlashActive}
            />
          )}
        </>
      ) : (
        <div ref={readRef} className={readClassName} aria-label={ariaLabel}>
          <Suspense fallback={<NoteBodySkeleton page={skeletonPage} remember={false} />}>
            <MarkdownView
              source={value}
              noteExists={linkedNoteExists}
              onToggleTask={tasksDisabled ? undefined : toggleTask}
              onEdit={(offset, clientY) => startEditing(offset, clientY)}
            />
          </Suspense>
        </div>
      )}

      <LinkDialog
        open={link !== null}
        initialText={link?.text ?? ''}
        initialTab={link?.tab ?? 'web'}
        notes={otherNotes}
        currentId={currentNoteId}
        onInsert={insertLinkNow}
        onClose={() => setLink(null)}
      />

      <EmbedDialog open={embedAt !== null} onInsert={insertEmbedNow} onClose={() => setEmbedAt(null)} />
    </>
  );
});

/* ---- Scrolling ----
   A body in a sheet scrolls the sheet's body; anywhere else, the page. */

function scrollerOf(el: Element | null): HTMLElement | null {
  return (el?.closest('.modal-body') as HTMLElement | null) ?? null;
}

function scrollBy(el: Element, dy: number): void {
  const scroller = scrollerOf(el);
  if (scroller) scroller.scrollTop += dy;
  else window.scrollBy(0, dy);
}

/* ---- Caret geometry ----
   A textarea does not say where its caret is on screen, so a hidden copy
   with the same box and font lays the text out up to the caret and reports
   where that ends. */

const MIRRORED = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'text-indent',
  'tab-size',
  'overflow-wrap',
  'word-break',
  'white-space',
];

/** Where the caret at `pos` is drawn, in viewport coordinates (top of its line). */
function caretClientRect(el: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement('div');
  for (const name of MIRRORED) mirror.style.setProperty(name, style.getPropertyValue(name));
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.height = 'auto';
  mirror.style.overflow = 'hidden';
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  mirror.remove();
  const box = el.getBoundingClientRect();
  return { top: box.top + top - el.scrollTop, left: box.left + left - el.scrollLeft };
}

function lineHeight(el: HTMLTextAreaElement): number {
  const value = parseFloat(getComputedStyle(el).lineHeight);
  return Number.isFinite(value) ? value : 28;
}
