import { ArrowLeft, Check, Link2, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import {
  ClipboardEvent,
  KeyboardEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { NoteSaveStatus, useNoteEditor } from '../../hooks/useNotes';
import { cx } from '../../lib/format';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import {
  TextEdit,
  TextState,
  codeAction,
  continueOnEnter,
  cycleHeading,
  headingLevelAt,
  indentLines,
  insertDivider,
  insertLink,
  outdentLines,
  pastedUrl,
  selectionIsList,
  toggleBlock,
  toggleInline,
  toggleTaskAt,
} from '../../lib/markdownEdit';
import {
  NOTE_BODY_MAX,
  NOTE_BODY_WARN,
  NOTE_REF_ROUTE,
  NOTE_REFS_MAX,
  NOTE_TITLE_MAX,
  NOTE_TITLE_WARN,
  sameRef,
} from '../../lib/notes';
import { navigate } from '../../lib/router';
import { toast } from '../../lib/toast';
import { useSettings } from '../../state/SettingsContext';
import { Note, NoteRef, NoteRefType } from '../../types';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { Button, Skeleton } from '../ui';
import { LinkDialog } from './LinkDialog';
import { FormatAction, MOD_IS_META, NoteFormatBar } from './NoteFormatBar';
import { NoteRefChips } from './NoteRefChips';
import { NoteRefPicker } from './NoteRefPicker';
import { RefOption, useRefLists } from './useNoteRefData';

/* The Markdown parser is the heavy part of a note, so it loads on its own —
   only when a note is opened to read. */
const MarkdownView = lazyWithRetry(() => import('./MarkdownView'));

type Mode = 'read' | 'edit';

/**
 * One note, full page: a big title, the references, and the body — read as
 * formatted Markdown, or edited as the text it is stored as, with a
 * formatting bar. A status line always says whether it is saved.
 */
export function NoteEditor({
  initial,
  pinned,
  onBack,
  onCreated,
  onTogglePin,
  onDelete,
}: {
  initial: Note | null;
  /** From the list cache, so a pin made elsewhere shows here too. */
  pinned: boolean;
  onBack: () => void;
  onCreated: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** Rejects if the delete failed; the editor then carries on. */
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const editor = useNoteEditor({ initial, onCreated });
  const { draft } = editor;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState(false);

  /* A note with text opens to read; a new or empty one opens to write. */
  const [mode, setMode] = useState<Mode>(() => (initial?.body.trim() ? 'read' : 'edit'));
  const [bodyFocused, setBodyFocused] = useState(false);
  const [headingLevel, setHeadingLevel] = useState(0);
  const [link, setLink] = useState<{ start: number; end: number; text: string } | null>(null);

  /* Chips need the lists of whatever kinds this note points at — and only those. */
  const wanted = useMemo(() => new Set<NoteRefType>(draft.refs.map((ref) => ref.type)), [draft.refs]);
  const lists = useRefLists(wanted);

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
  }, [draft.body, mode]);

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
      const caret = caretClientTop(el, pos);
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

  function runAction(action: FormatAction) {
    const state = currentState();
    if (!state) return;
    const placeholder = t('notes.fmtPlaceholder');
    switch (action) {
      case 'heading':
        return applyEdit(cycleHeading(state));
      case 'bold':
      case 'italic':
      case 'strike':
        return applyEdit(toggleInline(state, action, placeholder));
      case 'code':
        return applyEdit(codeAction(state, placeholder, t('notes.fmtPlaceholderCode')));
      case 'bullet':
      case 'ordered':
      case 'task':
      case 'quote':
        return applyEdit(toggleBlock(state, action));
      case 'indent':
        return applyEdit(indentLines(state));
      case 'outdent':
        return applyEdit(outdentLines(state));
      case 'divider':
        return applyEdit(insertDivider(state));
      case 'link': {
        const selected = state.value.slice(state.start, state.end);
        setLink({ start: state.start, end: state.end, text: selected.includes('\n') ? '' : selected.trim() });
        return undefined;
      }
    }
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

  function onBodyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    /* Thai, Japanese, any IME: Enter and Tab belong to the composition. */
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const state = currentState();
    if (!state) return;
    const mod = MOD_IS_META ? event.metaKey : event.ctrlKey;

    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      const action: FormatAction | null = event.shiftKey
        ? key === 'x'
          ? 'strike'
          : null
        : key === 'b'
          ? 'bold'
          : key === 'i'
            ? 'italic'
            : key === 'k'
              ? 'link'
              : key === 'e'
                ? 'code'
                : null;
      if (action) {
        event.preventDefault();
        runAction(action);
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
    /* Tab indents list items only; anywhere else it moves focus as usual,
       so the page stays usable from the keyboard. */
    if (event.key === 'Tab' && selectionIsList(state)) {
      event.preventDefault();
      applyEdit(event.shiftKey ? outdentLines(state) : indentLines(state));
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
      const bottom = caretClientTop(el, el.selectionEnd) + lineHeight(el);
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

  const titleNear = draft.title.length >= NOTE_TITLE_WARN;
  const bodyNear = draft.body.length >= NOTE_BODY_WARN;
  const locale = settings.locale;

  return (
    <article ref={articleRef} className="note-editor">
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
      {titleNear && (
        <Counter count={draft.title.length} max={NOTE_TITLE_MAX} locale={locale} />
      )}

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
          <NoteFormatBar onAction={runAction} headingLevel={headingLevel} editing={bodyFocused} />
          <textarea
            ref={bodyRef}
            className="note-body"
            value={draft.body}
            maxLength={NOTE_BODY_MAX}
            placeholder={t('notes.bodyPlaceholder')}
            aria-label={t('notes.bodyLabel')}
            rows={12}
            onChange={(event) => {
              editor.update({ body: event.target.value });
              keepCaretAboveDock();
            }}
            onKeyDown={onBodyKeyDown}
            onPaste={onBodyPaste}
            onSelect={syncHeading}
            onFocus={() => setBodyFocused(true)}
            onBlur={() => setBodyFocused(false)}
          />
        </>
      ) : (
        <div ref={readRef} className="note-read" aria-label={t('notes.bodyLabel')}>
          <Suspense fallback={<Skeleton rows={4} />}>
            <MarkdownView
              source={draft.body}
              onToggleTask={conflict ? undefined : toggleTask}
              onEdit={(offset, clientY) => startEditing(offset, clientY)}
            />
          </Suspense>
        </div>
      )}
      {bodyNear && <Counter count={draft.body.length} max={NOTE_BODY_MAX} locale={locale} />}

      <NoteRefPicker
        open={pickerOpen}
        refs={draft.refs}
        onChange={(refs) => editor.update({ refs })}
        onClose={() => setPickerOpen(false)}
      />

      <LinkDialog
        open={link !== null}
        initialText={link?.text ?? ''}
        onInsert={insertLinkNow}
        onClose={() => setLink(null)}
      />

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

function caretClientTop(el: HTMLTextAreaElement, pos: number): number {
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
  mirror.remove();
  return el.getBoundingClientRect().top + top - el.scrollTop;
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
