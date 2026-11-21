import { ArrowLeft, Check, Link2, Minimize2, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NoteDraft, NoteSaveStatus, useNoteEditor } from '../../hooks/useNotes';
import { cx } from '../../lib/format';
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
import { MarkdownField, MarkdownFieldHandle, MarkdownMode } from './MarkdownField';
import { NoteMenuAction, NoteMoreMenu } from './NoteMoreMenu';
import { NoteRefChips } from './NoteRefChips';
import { NoteRefPicker } from './NoteRefPicker';
import { RefOption, useRefLists } from './useNoteRefData';

type Mode = MarkdownMode;

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

  /* Chips need the lists of whatever kinds this note points at — and only those. */
  const wanted = useMemo(() => new Set<NoteRefType>(draft.refs.map((ref) => ref.type)), [draft.refs]);
  const lists = useRefLists(wanted);

  /* The body (format bar, slash menu, dialogs, reading view) is MarkdownField. */
  const fieldRef = useRef<MarkdownFieldHandle>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);

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

  /** The Edit button: the caret goes to the first block in view, not the top. */
  function editFromButton() {
    fieldRef.current?.editFromTop(toolbarRef.current?.getBoundingClientRect().bottom ?? 0);
  }

  function stopEditing() {
    fieldRef.current?.stopEditing();
  }

  /* While a conflict is open, autosave is paused and the next save decides
     which version wins — a tick must not quietly join that. */
  const conflict = editor.status === 'conflict';
  const updateBody = useCallback((body: string) => editor.update({ body }), [editor]);

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
      if (fieldRef.current?.readNode()?.querySelector('.md') || tries > 40) window.print();
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
            if (mode === 'read') fieldRef.current?.startEditing(0, null);
            else fieldRef.current?.focus();
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

      <MarkdownField
        ref={fieldRef}
        value={draft.body}
        onChange={updateBody}
        mode={mode}
        onModeChange={setMode}
        max={NOTE_BODY_MAX}
        placeholder={t('notes.bodyPlaceholder')}
        ariaLabel={t('notes.bodyLabel')}
        noteExists={noteExists}
        otherNotes={otherNotes}
        currentNoteId={editor.noteId}
        tasksDisabled={conflict}
        layoutKey={`${prefs.size}-${prefs.width}`}
      />

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
