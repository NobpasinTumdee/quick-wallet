import { useCallback, useState } from 'react';

/**
 * How notes are shown on this device: body text size, column width on a
 * desktop, and focus mode. Kept in this browser only — a phone and a laptop
 * reasonably want different sizes — and never sent anywhere.
 */
export type NoteTextSize = 's' | 'm' | 'l';
export type NoteWidth = 'normal' | 'wide';
export type NotePrefs = { size: NoteTextSize; width: NoteWidth; focus: boolean };

const KEY = 'quick-wallet.notes.display';
const DEFAULTS: NotePrefs = { size: 'm', width: 'normal', focus: false };

export function readNotePrefs(): NotePrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<NotePrefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    return {
      size: raw.size === 's' || raw.size === 'l' ? raw.size : 'm',
      width: raw.width === 'wide' ? 'wide' : 'normal',
      focus: raw.focus === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useNotePrefs(): [NotePrefs, (patch: Partial<NotePrefs>) => void] {
  const [prefs, setPrefs] = useState<NotePrefs>(readNotePrefs);
  const update = useCallback((patch: Partial<NotePrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* Private mode or storage off: it holds until the page closes. */
      }
      return next;
    });
  }, []);
  return [prefs, update];
}
