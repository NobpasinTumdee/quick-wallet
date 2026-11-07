import { ChevronDown, FilePlus2, LayoutTemplate, NotebookPen, Plus, Search, SearchX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import { NoteEditor } from '../components/notes/NoteEditor';
import { NoteList } from '../components/notes/NoteList';
import { ToolPanel } from '../components/notes/ToolPanel';
import '../components/notes/notes.css';
import { Alert, Button, EmptyState, RefreshButton } from '../components/ui';
import { api } from '../api/client';
import { patchCachedNote, useNotes } from '../hooks/useNotes';
import { NEW_NOTE_ID, compareNotes, matchesNoteSearch, noteHash, noteIdFromHash } from '../lib/notes';
import { NOTE_TEMPLATES, NoteTemplate, fillTemplate, templateName } from '../lib/noteTemplates';
import { useSettings } from '../state/SettingsContext';
import { toast } from '../lib/toast';
import { Note, NoteRef } from '../types';
import { NoteBodySkeleton, NotesListSkeleton } from '../components/skeleton/pageSkeletons';

/** What a new note starts with, when it is not blank. */
type NoteSeed = { title: string; body: string; refs: NoteRef[]; saveNow?: boolean };

/**
 * Notes: the list at `#/notes`, one note at `#/notes?id=…`.
 *
 * One page with two views rather than two routes, so the list stays cached
 * and Back from a note returns to it without a reload. The id lives in the
 * hash, so a note can be bookmarked and the phone's Back button works.
 */
export function NotesPage() {
  const { t, i18n } = useTranslation();
  const { settings } = useSettings();
  const notes = useNotes();
  /**
   * The template or duplicate the next "new" note opens with. Read when its
   * editor mounts; a reload of `?id=new` finds nothing here and starts blank.
   */
  const seedRef = useRef<NoteSeed | null>(null);
  /* A fresh editor for every new note, even when one new note follows another. */
  const [newKey, setNewKey] = useState(0);
  const [openId, setOpenId] = useState<string | null>(() => noteIdFromHash());
  const [search, setSearch] = useState('');
  /* The list drops a deleted row before the server answers, so without this
     the open note would flash "not found" while its own delete is running. */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /**
   * The id a note opened as "new" was given once saved. The address is
   * rewritten to it in place, but history can still hold the `?id=new` entry
   * — a sheet opened on a phone pushes one — and returning to it must show
   * this note, not a fresh blank one.
   */
  const createdRef = useRef<string | null>(null);
  /** True when the open note was reached from this list, so Back can pop. */
  const fromListRef = useRef(false);

  useEffect(() => {
    const onChange = () => {
      const id = noteIdFromHash();
      if (id === NEW_NOTE_ID && createdRef.current) {
        window.history.replaceState(window.history.state, '', noteHash(createdRef.current));
        return;
      }
      createdRef.current = null;
      if (id === null) fromListRef.current = false;
      setOpenId(id);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const openNote = useCallback((id: string) => {
    fromListRef.current = true;
    window.location.hash = noteHash(id);
  }, []);

  const openNew = useCallback(
    (seed: NoteSeed | null) => {
      seedRef.current = seed;
      createdRef.current = null;
      setNewKey((key) => key + 1);
      openNote(NEW_NOTE_ID);
    },
    [openNote],
  );

  const openTemplate = useCallback(
    (template: NoteTemplate | null) => {
      if (!template) return openNew(null);
      const filled = fillTemplate(template, i18n.language, settings.locale);
      openNew({ ...filled, refs: [] });
    },
    [i18n.language, settings.locale, openNew],
  );

  const backToList = useCallback(() => {
    if (fromListRef.current) window.history.back();
    else window.location.hash = noteHash(null);
  }, []);

  const onCreated = useCallback((id: string) => {
    createdRef.current = id;
    window.history.replaceState(window.history.state, '', noteHash(id));
  }, []);

  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    patchCachedNote(id, { pinned });
    try {
      /* Pinned only: no `baseUpdatedAt`, and the server leaves the version
         alone, so this never trips the stale check of an open editor. */
      await api.patch<Note>(`/api/notes/${id}`, { pinned });
    } catch (err) {
      patchCachedNote(id, { pinned: !pinned });
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteNote = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await notes.remove(id);
      } catch (err) {
        setDeletingId(null);
        throw err;
      }
      setDeletingId(null);
      toast.success(t('notes.deleted'));
      createdRef.current = null;
      fromListRef.current = false;
      /* Replace, so Back does not lead to the note just deleted. */
      window.location.replace(noteHash(null));
    },
    [notes, t],
  );

  const visible = useMemo(
    () => notes.items.filter((note) => matchesNoteSearch(note, search)).sort(compareNotes),
    [notes.items, search],
  );

  /* ---- One note ---- */
  if (openId) {
    const isNew = openId === NEW_NOTE_ID;
    const note = isNew ? null : notes.items.find((item) => item.id === openId) ?? null;
    const pinned = note?.pinned ?? Boolean(createdRef.current && notes.items.find((n) => n.id === createdRef.current)?.pinned);

    if (!isNew && !note) {
      if (notes.initialLoading || deletingId === openId) return <NoteBodySkeleton />;
      return (
        <EmptyState
          icon={<Icon icon={SearchX} size="xl" />}
          title={t('notes.notFoundTitle')}
          description={t('notes.notFoundBody')}
          action={<Button onClick={backToList}>{t('notes.back')}</Button>}
        />
      );
    }

    return (
      <NoteEditor
        key={isNew ? `${NEW_NOTE_ID}-${newKey}` : openId}
        initial={note}
        seed={isNew ? seedRef.current : null}
        noteExists={(id) => notes.items.some((item) => item.id === id)}
        otherNotes={notes.items}
        onDuplicate={(draft) =>
          openNew({
            title: t('notes.copyOf', { title: draft.title.trim() || t('notes.untitled') }).slice(0, 200),
            body: draft.body,
            refs: draft.refs,
            saveNow: true,
          })
        }
        pinned={pinned}
        onBack={backToList}
        onCreated={onCreated}
        onTogglePin={(id, next) => void togglePin(id, next)}
        onDelete={deleteNote}
      />
    );
  }

  /* ---- The list ---- */
  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="page-title">{t('notes.title')}</h1>
          <p className="page-lede">{t('notes.lede')}</p>
        </div>
        <div className="cluster">
          <RefreshButton onRefresh={notes.refresh} busy={notes.isValidating} label={t('common.refresh')} />
          <NewNoteButton size="sm" onPick={openTemplate} />
        </div>
      </div>

      {notes.initialLoading ? (
        <NotesListSkeleton />
      ) : notes.error && notes.items.length === 0 ? (
        /* Not the empty state: "no notes yet" would be a lie when the list
           simply did not load — an old deployment without notes.* answers
           UNKNOWN_ACTION here. */
        <Alert tone="error" title={t('notes.loadError')}>
          {notes.error}
        </Alert>
      ) : notes.items.length === 0 ? (
        <EmptyState
          icon={<Icon icon={NotebookPen} size="xl" />}
          title={t('notes.emptyTitle')}
          description={t('notes.emptyBody')}
          action={
            <NewNoteButton onPick={openTemplate} />
          }
        />
      ) : (
        <div className="notes-main">
          <label className="notes-search">
            <Icon icon={Search} size="sm" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('notes.searchPlaceholder')}
              aria-label={t('notes.searchLabel')}
              enterKeyHint="search"
            />
            {search && (
              <button
                type="button"
                className="notes-search-clear"
                aria-label={t('notes.clearSearch')}
                onClick={() => setSearch('')}
              >
                <Icon icon={X} size="sm" />
              </button>
            )}
          </label>

          {visible.length === 0 ? (
            <EmptyState
              icon={<Icon icon={SearchX} size="xl" />}
              title={t('notes.noMatchTitle')}
              description={t('notes.noMatchBody')}
              action={<Button onClick={() => setSearch('')}>{t('notes.clearSearch')}</Button>}
            />
          ) : (
            <NoteList
              notes={visible}
              onOpen={(note) => openNote(note.id)}
              onTogglePin={(note) => void togglePin(note.id, !note.pinned)}
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * "New note", with a small menu: a blank note or one of the built-in
 * templates, in the language the app is shown in.
 */
function NewNoteButton({ size, onPick }: { size?: 'sm'; onPick: (template: NoteTemplate | null) => void }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const pick = (template: NoteTemplate | null) => {
    setOpen(false);
    onPick(template);
  };
  return (
    <>
      <Button
        size={size}
        variant="primary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          setOpen((value) => !value);
        }}
      >
        <Icon icon={Plus} size="sm" />
        {t('notes.newNote')}
        <Icon icon={ChevronDown} size="sm" />
      </Button>
      <ToolPanel open={open} anchor={anchor} onClose={() => setOpen(false)} label={t('notes.newMenu')}>
        <div className="tool-list">
          <button type="button" className="tool-row" onClick={() => pick(null)}>
            <Icon icon={FilePlus2} size="sm" />
            <span>{t('notes.newBlank')}</span>
          </button>
          <p className="tool-heading">{t('notes.newTemplates')}</p>
          {NOTE_TEMPLATES.map((template) => (
            <button key={template.id} type="button" className="tool-row" onClick={() => pick(template)}>
              <Icon icon={LayoutTemplate} size="sm" />
              <span>{templateName(template, i18n.language)}</span>
            </button>
          ))}
        </div>
      </ToolPanel>
    </>
  );
}
