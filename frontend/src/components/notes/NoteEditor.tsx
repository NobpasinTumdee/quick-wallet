import { ArrowLeft, Check, Link2, Minimize2, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import {
  ClipboardEvent,
  KeyboardEvent,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { NoteDraft, NoteSaveStatus, useNoteEditor } from '../../hooks/useNotes';
import { cx } from '../../lib/format';
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
import { useNotePrefs } from '../../lib/notePrefs';
import {
  NOTE_BODY_MAX,
  NOTE_BODY_WARN,
  NOTE_REF_ROUTE,
  NOTE_REFS_MAX,
  NOTE_TITLE_MAX,
  NOTE_TITLE_WARN,
  sameRef,
  stripMarkdown,
} from '../../lib/notes';
import { noteStats } from '../../lib/noteStats';
import { navigate } from '../../lib/router';
import { toast } from '../../lib/toast';
import { useSettings } from '../../state/SettingsContext';
import { Note, NoteRef, NoteRefType } from '../../types';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { Button, Portal } from '../ui';
import { EmbedDialog } from './EmbedDialog';
import { LinkDialog, LinkTab } from './LinkDialog';
import { FormatCommand, HistoryState, MOD_IS_META, NoteFormatBar } from './NoteFormatBar';
import { NoteMenuAction, NoteMoreMenu } from './NoteMoreMenu';
import { NoteRefChips } from './NoteRefChips';
import { NoteRefPicker } from './NoteRefPicker';
import { SlashItem, SlashMenu, filterSlashItems } from './SlashMenu';
import { RefOption, useRefLists } from './useNoteRefData';
import { NoteBodySkeleton } from '../skeleton/pageSkeletons';

/* The Markdown parser is the heavy part of a note, so it loads on its own —
   only when a note is opened to read. */
const MarkdownView = lazyWithRetry(() => import('./MarkdownView'));

type Mode = 'read' | 'edit';

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

/**
 * One note, full page: a big title, the references, and the body — read as
 * formatted Markdown, or edited as the text it is stored as, with a
 * formatting bar. A status line always says whether it is saved.
 */
export function NoteEditor({
  initial,
  seed,
  pinned,
  noteExists,
  otherNotes,
  onBack,
  onCreated,
  onTogglePin,
  onDelete,
  onDuplicate,
}: {
  initial: Note | null;
  /** What a new note starts with: a template, or a duplicate to save now. */
  seed?: (NoteDraft & { saveNow?: boolean }) | null;
  /** From the list cache, so a pin made elsewhere shows here too. */
  pinned: boolean;
  /** Whether a linked note still exists, for the reading view's note links. */
  noteExists: (id: string) => boolean;
  /** Every note, for the Link dialog's Note tab. */
  otherNotes: Note[];
  onBack: () => void;
  onCreated: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** Rejects if the delete failed; the editor then carries on. */
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (draft: NoteDraft) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const editor = useNoteEditor({ initial, seed, onCreated });
  const { draft } = editor;
  const [prefs, setPrefs] = useNotePrefs();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState(false);

  /* A note with text opens to read; a new or empty one opens to write. */
  const [mode, setMode] = useState<Mode>(() => ((initial?.body ?? seed?.body ?? '').trim() ? 'read' : 'edit'));
  const [bodyFocused, setBodyFocused] = useState(false);
  const [headingLevel, setHeadingLevel] = useState(0);
  const [link, setLink] = useState<{ start: number; end: number; text: string; tab: LinkTab } | null>(null);
  /* Where the Embed dialog's result goes, kept while the dialog has focus. */
  const [embedAt, setEmbedAt] = useState<{ start: number; end: number } | null>(null);
  const [history, setHistory] = useState<{ undo: HistoryState; redo: HistoryState }>(() => ({
    undo: historySupport('undo'),
    redo: historySupport('redo'),
  }));

  /* Chips need the lists of whatever kinds this note points at — and only those. */
  const wanted = useMemo(() => new Set<NoteRefType>(draft.refs.map((ref) => ref.type)), [draft.refs]);
  const lists = useRefLists(wanted);

  /* Stable for the reading view, which rebuilds its renderers when it changes. */
  const existsRef = useRef(noteExists);
  existsRef.current = noteExists;
  const linkedNoteExists = useCallback((id: string) => existsRef.current(id), []);

  /* The body grows with its text, so the page scrolls rather than a box
     inside it — one scroll, which is what a phone keyboard can keep the caret
     visible in. */
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.body, mode, prefs.size, prefs.width]);

  /* The formatting bar sticks just under the toolbar, whose height changes
     with the conflict state and the width. */
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    const article = articleRef.current;
    if (!bar || !article || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      article.style.setProperty('--note-toolbar-h', `${bar.offsetHeight}px`);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  /* ---- Focus mode and printing ---- */

  const focusing = prefs.focus && mode === 'edit';
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('has-note-open');
    return () => root.classList.remove('has-note-open', 'note-focus');
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('note-focus', focusing);
  }, [focusing]);
  useEffect(() => {
    if (!focusing) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      /* Anything open on top — a dialog, a menu — takes Escape first. */
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.documentElement.classList.contains('has-overlay')) return;
      setPrefs({ focus: false });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focusing, setPrefs]);

  function openRef(ref: NoteRef, option: RefOption) {
    /* No screen opens a single record by address, so the chip goes to the
       section. Goals can at least arrive searched for the one meant. */
    if (ref.type === 'goal') {
      window.location.hash = `#/goals?q=${encodeURIComponent(option.label.slice(0, 80))}`;
      return;
    }
    navigate(NOTE_REF_ROUTE[ref.type]);
  }

  async function confirmDeleteNote() {
    const id = editor.noteId;
    if (!id) return;
    setDeleting(true);
    editor.close();
    try {
      await onDelete(id);
    } catch {
      /* Toasted by the list hook. The note is still there, so keep saving it. */
      editor.reopen();
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  /* ---- Switching between reading and writing ---- */

  /**
   * Into the editor with the caret at `offset`, the start of the block that
   * was tapped. The page is scrolled so that line sits where the finger was:
   * a tap halfway down a long note stays halfway down it. The switch is
   * flushed inside the tap so `focus()` still counts as the user's own
   * gesture, which iOS needs before it will open the keyboard.
   */
  function startEditing(offset: number | null, clientY: number | null) {
    const scrollY = window.scrollY;
    flushSync(() => setMode('edit'));
    const el = bodyRef.current;
    if (!el) return;
    const pos = Math.max(0, Math.min(offset ?? el.value.length, el.value.length));
    el.focus({ preventScroll: true });
    el.setSelectionRange(pos, pos);
    window.scrollTo(0, scrollY);
    if (clientY !== null) {
      const caret = caretClientRect(el, pos).top;
      window.scrollBy(0, caret - clientY + lineHeight(el) / 2);
    }
    setHeadingLevel(headingLevelAt(el.value, pos));
  }

  /** The Edit button: the caret goes to the first block in view, not the top. */
  function editFromButton() {
    const toolbarBottom = toolbarRef.current?.getBoundingClientRect().bottom ?? 0;
    const blocks = readRef.current?.querySelectorAll<HTMLElement>('.md > [data-src], .md li[data-src]') ?? [];
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (rect.bottom > toolbarBottom) {
        startEditing(Number(block.dataset.src), Math.max(rect.top, toolbarBottom));
        return;
      }
    }
    startEditing(null, null);
  }

  function stopEditing() {
    bodyRef.current?.blur();
    setSlash(null);
    setMode('read');
  }

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
    if (el.value.length - (edit.to - edit.from) + edit.text.length > NOTE_BODY_MAX) {
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
    const placeholder = t('notes.fmtPlaceholder');
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
        return toggleInline(state, command.action, placeholder);
      case 'code':
        return codeAction(state, placeholder, t('notes.fmtPlaceholderCode'));
      case 'codeBlock':
        return codeBlockAction(state, t('notes.fmtPlaceholderCode'));
      case 'clear':
        return clearFormatting(state);
      case 'color':
      case 'highlight':
        return applyColor(state, command.action, command.color, placeholder);
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
        return insertCallout(state, command.type, placeholder);
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

  /* Scrolling moves the caret on screen; the menu follows it. */
  useEffect(() => {
    if (!slash) return undefined;
    const onMove = () => syncSlash();
    window.addEventListener('scroll', onMove, { passive: true });
    window.visualViewport?.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove);
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
   * keep the caret above the keyboard — not above the bar. Nudge the page
   * when the caret line slips behind it.
   */
  const keepCaretAboveDock = useCallback(() => {
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      const dock = document.querySelector<HTMLElement>('.note-format.is-docked');
      if (!el || !dock || document.activeElement !== el) return;
      const limit = dock.getBoundingClientRect().top - 8;
      const bottom = caretClientRect(el, el.selectionEnd).top + lineHeight(el);
      if (bottom > limit) window.scrollBy(0, bottom - limit);
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

  /* While a conflict is open, autosave is paused and the next save decides
     which version wins — a tick must not quietly join that. */
  const conflict = editor.status === 'conflict';
  const toggleTask = useCallback(
    (offset: number) => {
      const next = toggleTaskAt(draft.body, offset);
      if (next !== null) editor.update({ body: next });
    },
    [draft.body, editor],
  );

  /* ---- The ⋯ menu ---- */

  function markdownExport(): string {
    const title = draft.title.trim();
    return title ? `# ${title}\n\n${draft.body}` : draft.body;
  }

  function plainExport(): string {
    const body = stripMarkdown(draft.body, { youtube: 'YouTube', picture: t('notes.embedPreviewPicture') });
    const title = draft.title.trim();
    return title ? `${title}\n\n${body}` : body;
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('notes.copied'));
    } catch {
      toast.error(t('notes.copyFailed'));
    }
  }

  function download() {
    const name =
      draft.title
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, '')
        .slice(0, 80) || t('notes.untitled');
    const blob = new Blob([markdownExport()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Prints the reading view, waiting for it to load if the note was being edited. */
  function print() {
    if (mode === 'edit') stopEditing();
    let tries = 0;
    const ready = () => {
      tries += 1;
      if (readRef.current?.querySelector('.md') || tries > 40) window.print();
      else window.setTimeout(ready, 50);
    };
    window.setTimeout(ready, 0);
  }

  function onMenu(action: NoteMenuAction) {
    switch (action) {
      case 'copyMarkdown':
        return void copy(markdownExport());
      case 'copyPlain':
        return void copy(plainExport());
      case 'download':
        return download();
      case 'print':
        return print();
      case 'duplicate':
        return onDuplicate(draft);
    }
  }

  const titleNear = draft.title.length >= NOTE_TITLE_WARN;
  const bodyNear = draft.body.length >= NOTE_BODY_WARN;
  const locale = settings.locale;
  const stats = useMemo(() => noteStats(draft.body, locale), [draft.body, locale]);

  return (
    <article
      ref={articleRef}
      className={cx('note-editor', `note-size-${prefs.size}`, prefs.width === 'wide' && 'is-wide', focusing && 'is-focus')}
    >
      <div ref={toolbarRef} className="note-toolbar">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <Icon icon={ArrowLeft} size="sm" />
          <span className="note-toolbar-label">{t('notes.back')}</span>
        </Button>

        <SaveStatus status={editor.status} onRetry={editor.retry} />

        <div className="note-toolbar-actions">
          {mode === 'read' ? (
            <Button size="sm" variant="ghost" aria-label={t('notes.edit')} title={t('notes.edit')} onClick={editFromButton}>
              <Icon icon={Pencil} size="sm" />
              <span className="note-toolbar-label">{t('notes.edit')}</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="note-done"
              aria-label={t('notes.done')}
              title={t('notes.doneHint')}
              /* Keep the keyboard's focus until the click itself, as the format buttons do. */
              onMouseDown={(event) => event.preventDefault()}
              onClick={stopEditing}
            >
              <Icon icon={Check} size="sm" />
              <span className="note-toolbar-label">{t('notes.done')}</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!editor.noteId}
            aria-pressed={pinned}
            aria-label={pinned ? t('notes.unpin') : t('notes.pin')}
            title={pinned ? t('notes.unpin') : t('notes.pin')}
            onClick={() => editor.noteId && onTogglePin(editor.noteId, !pinned)}
          >
            <Icon icon={pinned ? PinOff : Pin} size="sm" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!editor.noteId}
            aria-label={t('common.delete')}
            title={t('common.delete')}
            onClick={() => setConfirmDelete(true)}
          >
            <Icon icon={Trash2} size="sm" />
          </Button>
          <NoteMoreMenu prefs={prefs} onPrefs={setPrefs} onAction={onMenu} canDuplicate={Boolean(editor.noteId)} />
        </div>
      </div>

      {conflict && (
        <div className="note-conflict" role="alert">
          <div className="note-conflict-text">
            <strong>{t('notes.conflictTitle')}</strong>
            <p>{t('notes.conflictBody')}</p>
          </div>
          <div className="note-conflict-actions">
            <Button
              size="sm"
              loading={reloading}
              onClick={() => {
                setReloading(true);
                void editor.reload().finally(() => setReloading(false));
              }}
            >
              {t('notes.conflictReload')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void editor.overwrite()}>
              {t('notes.conflictOverwrite')}
            </Button>
          </div>
        </div>
      )}

      <input
        className="note-title"
        value={draft.title}
        maxLength={NOTE_TITLE_MAX}
        placeholder={t('notes.titlePlaceholder')}
        aria-label={t('notes.titleLabel')}
        enterKeyHint="next"
        onChange={(event) => editor.update({ title: event.target.value.replace(/[\r\n]+/g, ' ') })}
        onKeyDown={(event) => {
          /* Enter in the title moves on to writing, as in a document. */
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (mode === 'read') startEditing(0, null);
            else bodyRef.current?.focus();
          }
        }}
      />
      {titleNear && <Counter count={draft.title.length} max={NOTE_TITLE_MAX} locale={locale} />}

      <section className="note-refs-block" aria-label={t('notes.references')}>
        {draft.refs.length > 0 ? (
          <NoteRefChips
            refs={draft.refs}
            lists={lists}
            onOpen={openRef}
            onRemove={(ref) => editor.update({ refs: draft.refs.filter((item) => !sameRef(item, ref)) })}
          />
        ) : (
          <span className="note-refs-empty">{t('notes.noReferences')}</span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="note-add-ref"
          disabled={draft.refs.length >= NOTE_REFS_MAX && !pickerOpen}
          onClick={() => setPickerOpen(true)}
        >
          <Icon icon={Link2} size="sm" />
          {t('notes.addReference')}
        </Button>
      </section>

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
            className="note-body"
            value={draft.body}
            maxLength={NOTE_BODY_MAX}
            placeholder={t('notes.bodyPlaceholder')}
            aria-label={t('notes.bodyLabel')}
            aria-controls={slash ? slashId : undefined}
            aria-expanded={slash ? true : undefined}
            aria-activedescendant={slash && slashItems.length ? `${slashId}-${slashActive}` : undefined}
            rows={12}
            onChange={(event) => {
              editor.update({ body: event.target.value });
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
        <div ref={readRef} className="note-read" aria-label={t('notes.bodyLabel')}>
          <Suspense fallback={<NoteBodySkeleton page="note-editor" remember={false} />}>
            <MarkdownView
              source={draft.body}
              noteExists={linkedNoteExists}
              onToggleTask={conflict ? undefined : toggleTask}
              onEdit={(offset, clientY) => startEditing(offset, clientY)}
            />
          </Suspense>
        </div>
      )}
      <div className="note-meta">
        {stats.words > 0 && (
          <p className="note-stats" title={stats.approximate ? t('notes.statsApproxHint') : undefined}>
            {t(stats.approximate ? 'notes.statsApprox' : 'notes.statsLine', {
              words: stats.words.toLocaleString(locale),
              minutes: stats.minutes.toLocaleString(locale),
            })}
          </p>
        )}
        {bodyNear && <Counter count={draft.body.length} max={NOTE_BODY_MAX} locale={locale} />}
      </div>

      {focusing && (
        <Portal>
          <button
            type="button"
            className="note-focus-exit"
            aria-label={t('notes.focusExit')}
            title={t('notes.focusExit')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPrefs({ focus: false })}
          >
            <Icon icon={Minimize2} size="sm" />
            <span>{t('notes.focusExit')}</span>
          </button>
        </Portal>
      )}

      <NoteRefPicker
        open={pickerOpen}
        refs={draft.refs}
        onChange={(refs) => editor.update({ refs })}
        onClose={() => setPickerOpen(false)}
      />

      <LinkDialog
        open={link !== null}
        initialText={link?.text ?? ''}
        initialTab={link?.tab ?? 'web'}
        notes={otherNotes}
        currentId={editor.noteId}
        onInsert={insertLinkNow}
        onClose={() => setLink(null)}
      />

      <EmbedDialog open={embedAt !== null} onInsert={insertEmbedNow} onClose={() => setEmbedAt(null)} />

      <ConfirmDialog
        open={confirmDelete}
        title={t('notes.deleteTitle')}
        body={
          <>
            {draft.title.trim() && <strong className="confirm-subject">{draft.title}</strong>}
            {t('notes.deleteWarning')}
          </>
        }
        confirmLabel={t('notes.deleteConfirm')}
        busy={deleting}
        onConfirm={() => void confirmDeleteNote()}
        onClose={() => setConfirmDelete(false)}
      />
    </article>
  );
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

function SaveStatus({ status, onRetry }: { status: NoteSaveStatus; onRetry: () => void }) {
  const { t } = useTranslation();
  const text =
    status === 'new'
      ? t('notes.statusNew')
      : status === 'dirty'
        ? t('notes.statusUnsaved')
        : status === 'saving'
          ? t('notes.statusSaving')
          : status === 'error'
            ? t('notes.statusError')
            : status === 'conflict'
              ? t('notes.conflictTitle')
              : t('notes.statusSaved');

  return (
    <div className={cx('note-status', `is-${status}`)} role="status" aria-live="polite">
      <span className="note-status-dot" aria-hidden="true" />
      <span className="note-status-text">{text}</span>
      {status === 'error' && (
        <button type="button" className="note-status-retry" onClick={onRetry}>
          {t('notes.retry')}
        </button>
      )}
    </div>
  );
}

function Counter({ count, max, locale }: { count: number; max: number; locale: string }) {
  const { t } = useTranslation();
  const full = count >= max;
  return (
    <p className={cx('note-counter', full && 'is-full')} aria-live="polite">
      {t('notes.charCount', { used: count.toLocaleString(locale), max: max.toLocaleString(locale) })}
      {full && ` · ${t('notes.limitReached')}`}
    </p>
  );
}
