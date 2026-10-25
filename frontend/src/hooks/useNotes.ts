import { useCallback, useEffect, useRef, useState } from 'react';

import { mutateMatching } from '../api/cache';
import { ApiError, api } from '../api/client';
import { compareNotes } from '../lib/notes';
import { Note, NoteRef } from '../types';
import { CollectionState, useExcelDB } from './useExcelDB';

const PATH = '/api/notes';

/** The notes list. A thin alias, so every screen subscribes to the same key. */
export function useNotes(options: { enabled?: boolean } = {}): CollectionState<Note> {
  return useExcelDB<Note>('notes', undefined, options);
}

/** Puts the server's copy of one note into every cached list. */
function upsertCachedNote(saved: Note): void {
  mutateMatching<Note[]>(PATH, (rows) => {
    const exists = rows.some((row) => row.id === saved.id);
    const next = exists ? rows.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...rows];
    return [...next].sort(compareNotes);
  });
}

/** Changes one field in every cached copy without touching the rest. */
export function patchCachedNote(id: string, patch: Partial<Note>): void {
  mutateMatching<Note[]>(PATH, (rows) =>
    rows.map((row) => (row.id === id ? { ...row, ...patch } : row)).sort(compareNotes),
  );
}

export interface NoteDraft {
  title: string;
  body: string;
  refs: NoteRef[];
}

export type NoteSaveStatus =
  /** A new note with nothing typed yet — nothing to save. */
  | 'new'
  /** Edited, waiting for the debounce. */
  | 'dirty'
  | 'saving'
  | 'saved'
  /** The last save failed for an ordinary reason; Retry or the next edit tries again. */
  | 'error'
  /** The server has a newer version. Autosave is paused until the user chooses. */
  | 'conflict';

/** How long typing must pause before a save. */
const DEBOUNCE_MS = 800;

function snapshotOf(draft: NoteDraft): string {
  return JSON.stringify([draft.title, draft.body, draft.refs]);
}

/**
 * The editor's save engine.
 *
 * ---------------------------------------------------------------------------
 * ONE SAVE AT A TIME
 * ---------------------------------------------------------------------------
 * Autosave must never conflict with itself. Each save sends the `updatedAt`
 * it is based on, and the server refuses a save whose base is out of date —
 * so two saves in flight at once would have the second refused by the first.
 * Hence: while a save is in flight, a new one is only *queued*, and when the
 * first lands its `updatedAt` becomes the base, and the queue sends whatever
 * the draft is by then (the latest text, not each keystroke in turn).
 *
 * The same rule stops a new note being created twice: the queued save after
 * the create already knows the id and becomes an update.
 *
 * ---------------------------------------------------------------------------
 * LEAVING MID-EDIT
 * ---------------------------------------------------------------------------
 * Unmounting (Back, another screen) and hiding the tab both flush at once.
 * The request outlives the component; its result goes into the cache, so the
 * list shows the saved text when it appears. Closing the window with a save
 * outstanding asks the browser to confirm first.
 */
export function useNoteEditor({
  initial,
  onCreated,
}: {
  /** The saved note, or null for a new one. Read once, on mount. */
  initial: Note | null;
  /** Called once a new note has its real id. */
  onCreated: (id: string) => void;
}) {
  const [draft, setDraftState] = useState<NoteDraft>(() => ({
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    refs: initial?.refs ?? [],
  }));
  const [status, setStatus] = useState<NoteSaveStatus>(initial ? 'saved' : 'new');

  const draftRef = useRef(draft);
  const idRef = useRef<string | null>(initial?.id ?? null);
  /** The version the next save is based on. */
  const baseRef = useRef(initial?.updatedAt ?? '');
  /** What the server last confirmed, to skip saves that would change nothing. */
  const savedRef = useRef(snapshotOf(draft));
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const conflictRef = useRef(false);
  /** Set when the note is deleted, so nothing tries to save it afterwards. */
  const closedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  const report = useCallback((next: NoteSaveStatus) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const flush = useCallback(
    async (force = false): Promise<void> => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (closedRef.current || (conflictRef.current && !force)) return;
      if (inFlightRef.current) {
        queuedRef.current = true;
        return;
      }

      const sending = draftRef.current;
      const snapshot = snapshotOf(sending);
      if (snapshot === savedRef.current && !force) {
        report(idRef.current ? 'saved' : 'new');
        return;
      }
      /* An empty page is not a note: nothing is created until there is text. */
      if (!idRef.current && !sending.title.trim() && !sending.body.trim()) {
        report('new');
        return;
      }

      inFlightRef.current = true;
      report('saving');
      let ok = false;
      try {
        const payload = { title: sending.title, body: sending.body, refs: sending.refs };
        const saved = idRef.current
          ? await api.patch<Note>(`${PATH}/${idRef.current}`, {
              ...payload,
              baseUpdatedAt: baseRef.current,
              ...(force ? { force: true } : {}),
            })
          : await api.post<Note>(PATH, payload);

        const created = !idRef.current;
        idRef.current = saved.id;
        baseRef.current = saved.updatedAt;
        savedRef.current = snapshot;
        conflictRef.current = false;
        upsertCachedNote(saved);
        if (created) onCreatedRef.current(saved.id);
        ok = true;
        report(snapshotOf(draftRef.current) === snapshot ? 'saved' : 'dirty');
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          conflictRef.current = true;
          report('conflict');
        } else {
          report('error');
        }
      } finally {
        inFlightRef.current = false;
      }

      /* Typed while that save was out: send the latest text now, on the base
         the save just returned. After a failure, wait for Retry or an edit
         rather than hammering a server that just said no. */
      const pending = queuedRef.current || snapshotOf(draftRef.current) !== savedRef.current;
      queuedRef.current = false;
      if (ok && pending && !closedRef.current) void flush();
    },
    [report],
  );

  const schedule = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [flush]);

  const update = useCallback(
    (patch: Partial<NoteDraft>) => {
      const next = { ...draftRef.current, ...patch };
      draftRef.current = next;
      setDraftState(next);
      if (conflictRef.current) return;
      if (!inFlightRef.current) report(idRef.current || next.title.trim() || next.body.trim() ? 'dirty' : 'new');
      schedule();
    },
    [report, schedule],
  );

  /** The conflict's "Reload": take the server's version, drop local edits. */
  const reload = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const fresh = await api.get<Note>(`${PATH}/${id}`);
    const next = { title: fresh.title, body: fresh.body, refs: fresh.refs };
    draftRef.current = next;
    setDraftState(next);
    baseRef.current = fresh.updatedAt;
    savedRef.current = snapshotOf(next);
    conflictRef.current = false;
    upsertCachedNote(fresh);
    report('saved');
  }, [report]);

  /** The conflict's "Overwrite": save this screen's text over the newer one. */
  const overwrite = useCallback(() => flush(true), [flush]);

  /** Stops all saving — call before deleting the note. */
  const close = useCallback(() => {
    closedRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** Undoes `close` — the delete it preceded failed, so the note lives on. */
  const reopen = useCallback(() => {
    closedRef.current = false;
    if (snapshotOf(draftRef.current) !== savedRef.current) void flush();
  }, [flush]);

  /* Leave mid-edit: save now rather than after the debounce. */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const unsaved = snapshotOf(draftRef.current) !== savedRef.current || inFlightRef.current;
      if (closedRef.current || !unsaved) return;
      void flush();
      /* The browser shows its own wording; this only asks it to. */
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flush]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void flush();
    };
  }, [flush]);

  return {
    draft,
    status,
    noteId: idRef.current,
    update,
    retry: () => void flush(),
    reload,
    overwrite,
    close,
    reopen,
  };
}
