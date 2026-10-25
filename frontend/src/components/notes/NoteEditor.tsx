import { ArrowLeft, Link2, Pin, PinOff, Trash2 } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NoteSaveStatus, useNoteEditor } from '../../hooks/useNotes';
import { cx } from '../../lib/format';
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
import { useSettings } from '../../state/SettingsContext';
import { Note, NoteRef, NoteRefType } from '../../types';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { Button } from '../ui';
import { NoteRefChips } from './NoteRefChips';
import { NoteRefPicker } from './NoteRefPicker';
import { RefOption, useRefLists } from './useNoteRefData';

/**
 * One note, full page: a big title, a body that grows with its text, the
 * references, and a status line that always says whether it is saved.
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

  /* Chips need the lists of whatever kinds this note points at — and only those. */
  const wanted = useMemo(() => new Set<NoteRefType>(draft.refs.map((ref) => ref.type)), [draft.refs]);
  const lists = useRefLists(wanted);

  /* The body grows with its text, so the page scrolls rather than a box
     inside it — one scroll, which is what a phone keyboard can keep the caret
     visible in. */
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.body]);

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

  const titleNear = draft.title.length >= NOTE_TITLE_WARN;
  const bodyNear = draft.body.length >= NOTE_BODY_WARN;
  const locale = settings.locale;

  return (
    <article className="note-editor">
      <div className="note-toolbar">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <Icon icon={ArrowLeft} size="sm" />
          <span className="note-toolbar-label">{t('notes.back')}</span>
        </Button>

        <SaveStatus status={editor.status} onRetry={editor.retry} />

        <div className="note-toolbar-actions">
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

      {editor.status === 'conflict' && (
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
            bodyRef.current?.focus();
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

      <textarea
        ref={bodyRef}
        className="note-body"
        value={draft.body}
        maxLength={NOTE_BODY_MAX}
        placeholder={t('notes.bodyPlaceholder')}
        aria-label={t('notes.bodyLabel')}
        rows={12}
        onChange={(event) => editor.update({ body: event.target.value })}
      />
      {bodyNear && <Counter count={draft.body.length} max={NOTE_BODY_MAX} locale={locale} />}

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
