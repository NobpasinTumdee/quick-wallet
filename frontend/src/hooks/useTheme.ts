import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api/client';
import {
  THEME_VARS,
  completeThemeColors,
  defaultThemeColors,
  themePreset,
} from '../lib/themes';
import { DEFAULT_FONT_ID, preloadFontCatalogue } from '../lib/fonts';
import { applyPreview, applyPreviewFont, applyPreviewVar, endPreview } from '../lib/themeStorage';
import { useSettings } from '../state/SettingsContext';
import { CustomTheme, Settings, ThemeName } from '../types';

/**
 * The theme engine.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The Settings screen used to wire each colour picker's `onChange` straight to
 * `settings.save()`. An `<input type="color">` fires `input` continuously while
 * the pointer is down, so a two-second drag across the spectrum queued a few
 * hundred Apps Script writes: the UI stalled behind the round trips, the
 * optimistic state flickered as late responses landed out of order, and a real
 * session hit the Sheets write quota.
 *
 * The fix is to separate the two things that were conflated — *seeing* a colour
 * and *keeping* it:
 *
 *   Preview (free)      a draft palette in a ref; each tick writes one custom
 *                       property onto <html>. No network, and no React render on
 *                       the pointer path at all.
 *   Save (deliberate)   one request, when the user names the theme and clicks.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DRAFT IS A REF AND NOT STATE
 * ---------------------------------------------------------------------------
 * Custom properties cascade: setting `--bg` on <html> repaints every element
 * that derives from it without React knowing anything happened. So the draft's
 * authoritative copy lives in a ref, `setDraftColor` writes the DOM
 * synchronously, and React state is a *mirror* refreshed at most once per frame
 * for the parts of the UI that have to show the value back (the swatch grid,
 * the live theme card). Dragging therefore costs one `setProperty` per event
 * instead of a full re-render of the Settings page.
 *
 * ---------------------------------------------------------------------------
 * WHY A DRAFT SURVIVES NAVIGATION
 * ---------------------------------------------------------------------------
 * The draft lives in this hook, which is mounted once by `ThemeProvider` at the
 * root — not in the Settings screen. A theme is judged on the dashboard, not on
 * the form that made it, so leaving Settings keeps the preview up and returning
 * finds the creator exactly as it was. `discardDraft` and `saveDraft` are the
 * only ways out, and the creator always shows both.
 */

/** Which library entry, if any, the open draft is editing. */
export interface ThemeDraft {
  /** An existing theme's id, or null for one that has never been saved. */
  id: string | null;
  name: string;
  /**
   * The chosen typeface, as a `FONTS` id.
   *
   * Lives in state rather than in the colours ref because picking a font is a
   * click, not a drag — one render per choice, and the radio cards have to
   * re-render anyway to move the selection. It is still preview-only: nothing
   * here reaches the network until `saveDraft`.
   */
  font: string;
  /** Where the draft started, so `resetDraft` can go back to it. */
  origin: Record<string, string>;
  originFont: string;
}

export interface ThemeEngine {
  /* ---- what is currently saved and worn ---- */
  settings: Settings;
  customThemes: CustomTheme[];
  activeCustomThemeId: string;
  /**
   * One key for the whole picker, so the grid never highlights two cards:
   * `preset:dark` for a built-in, `custom:<id>` for a saved theme.
   */
  activeKey: string;

  /* ---- the open draft, if any ---- */
  draft: ThemeDraft | null;
  /** Frame-rate mirror of the draft palette. Read this to render, never to write. */
  draftColors: Record<string, string>;
  /** The draft differs from where it started. */
  dirty: boolean;

  busy: boolean;
  error: string | null;

  /* ---- draft lifecycle ---- */
  createDraft: () => void;
  editDraft: (theme: CustomTheme) => void;
  duplicateDraft: (theme: CustomTheme) => void;
  setDraftName: (name: string) => void;
  /** The hot path: DOM-synchronous, network-free. Safe to call on every tick. */
  setDraftColor: (key: string, value: string) => void;
  /** Swaps the previewed typeface. Loads the webfont on first use; no API call. */
  setDraftFont: (fontId: string) => void;
  /**
   * `'origin'` puts the draft back to where it opened — the saved theme for an
   * edit, the palette that was on screen for a new one. `'default'` throws that
   * away too and starts from the stock `custom` palette, which is the way out
   * when a draft has been fiddled into something unreadable.
   */
  resetDraft: (target?: 'origin' | 'default') => void;
  discardDraft: () => void;
  saveDraft: () => Promise<void>;

  /* ---- library ---- */
  applyPreset: (theme: ThemeName) => Promise<void>;
  applyCustomTheme: (id: string) => Promise<void>;
  deleteCustomTheme: (id: string) => Promise<void>;
  setAccent: (color: string) => Promise<void>;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The palette actually on screen right now, read back off <html>.
 *
 * Lets "New theme" start from whichever preset the user is wearing rather than
 * from a fixed midnight teal, which is the difference between "tweak this" and
 * "start over". Computed values that are not plain six-digit hex fall back to
 * the custom theme's own default, because `<input type="color">` silently
 * renders anything it cannot parse as black.
 */
function readLivePalette(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const out = defaultThemeColors();

  for (const variable of THEME_VARS) {
    const value = computed.getPropertyValue(variable.key).trim();
    if (HEX.test(value)) out[variable.key] = value.toLowerCase();
  }
  return out;
}

function sameColors(a: Record<string, string>, b: Record<string, string>): boolean {
  return THEME_VARS.every((variable) => a[variable.key] === b[variable.key]);
}

export function useThemeEngine(): ThemeEngine {
  const { settings, save, replace } = useSettings();

  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [draftColors, setDraftColors] = useState<Record<string, string>>(defaultThemeColors);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The authoritative draft palette. State above is a lagging copy of this. */
  const colorsRef = useRef<Record<string, string>>(defaultThemeColors());
  const frameRef = useRef<number | null>(null);

  /* Read inside async callbacks that must not re-create themselves whenever
     settings change — otherwise every handler below churns on each keystroke. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* Same reason, for `commit`: it has to know whether a draft is still open
     *after* its request lands, which is not what `draft` said when it was
     created. */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** Pushes the ref into state, coalesced to one commit per frame. */
  const scheduleMirror = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setDraftColors({ ...colorsRef.current });
    });
  }, []);

  const cancelMirror = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(() => cancelMirror, [cancelMirror]);

  /* ---------------- draft lifecycle ---------------- */

  const openDraft = useCallback(
    (id: string | null, name: string, colors: Record<string, string>, font: string) => {
      const complete = completeThemeColors(colors);
      const fontId = font || DEFAULT_FONT_ID;
      colorsRef.current = complete;
      cancelMirror();
      setDraftColors(complete);
      setDraft({ id, name, font: fontId, origin: complete, originFont: fontId });
      setError(null);
      // Paint immediately and take the preview lock, so the creator opens
      // showing exactly what it is about to let you edit.
      applyPreview(complete, fontId);
      /* Every face in the catalogue, so each card in the picker renders in its
         own type rather than lying until you click it. Idempotent, and scoped
         to the creator so a user who never opens Settings downloads none. */
      preloadFontCatalogue();
    },
    [cancelMirror],
  );

  const createDraft = useCallback(() => {
    // Starts from the look currently on screen — palette and typeface both.
    openDraft(null, '', readLivePalette(), settingsRef.current.fontFamily);
  }, [openDraft]);

  const editDraft = useCallback(
    (theme: CustomTheme) => openDraft(theme.id, theme.name, theme.colors, theme.fontFamily),
    [openDraft],
  );

  const duplicateDraft = useCallback(
    (theme: CustomTheme) =>
      openDraft(null, `${theme.name} copy`.slice(0, 40), theme.colors, theme.fontFamily),
    [openDraft],
  );

  const setDraftName = useCallback((name: string) => {
    setDraft((current) => (current ? { ...current, name } : current));
  }, []);

  /**
   * One colour, one repaint.
   *
   * Everything expensive is deliberately absent: no `save`, no `setState` on the
   * caller's path, no dependency on `settings`. The identity of this callback is
   * stable for the life of the provider, so the pickers never re-bind either.
   */
  const setDraftColor = useCallback(
    (key: string, value: string) => {
      colorsRef.current = { ...colorsRef.current, [key]: value };
      applyPreviewVar(key, value);
      scheduleMirror();
    },
    [scheduleMirror],
  );

  const setDraftFont = useCallback((fontId: string) => {
    setDraft((current) => (current ? { ...current, font: fontId } : current));
    applyPreviewFont(fontId);
  }, []);

  const resetDraft = useCallback(
    (target: 'origin' | 'default' = 'origin') => {
      if (!draft) return;
      /* 'origin' is the everyday undo: a reset that always jumped to a fixed
         teal would throw away a deliberate starting point, and on an edit it
         would silently discard the saved theme's identity. 'default' is the
         escape hatch, and the UI labels the two differently for that reason. */
      const next = target === 'default' ? defaultThemeColors() : { ...draft.origin };
      const nextFont = target === 'default' ? DEFAULT_FONT_ID : draft.originFont;
      colorsRef.current = next;
      cancelMirror();
      setDraftColors(next);
      setDraft((current) => (current ? { ...current, font: nextFont } : current));
      applyPreview(next, nextFont);
    },
    [draft, cancelMirror],
  );

  const discardDraft = useCallback(() => {
    cancelMirror();
    setDraft(null);
    setError(null);
    endPreview(settingsRef.current);
  }, [cancelMirror]);

  /* ---------------- writes ---------------- */

  /** Runs a themes.* call, which answers with the whole Settings row. */
  const commit = useCallback(
    async (request: () => Promise<Settings>, closeDraft: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const saved = await request();
        replace(saved);
        if (closeDraft) {
          cancelMirror();
          setDraft(null);
        }
        /* Release the lock and repaint from what the server actually stored, so
           a value it sanitised away shows up now rather than on the next load.

           Only when nothing is left previewing, though: deleting theme B while
           theme A is open in the creator must not tear down A's preview. */
        if (closeDraft || !draftRef.current) endPreview(saved);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the theme');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [replace, cancelMirror],
  );

  const saveDraft = useCallback(async () => {
    if (!draft) return;

    const name = draft.name.trim();
    if (!name) {
      setError('Give the theme a name first.');
      return;
    }

    const colors = colorsRef.current;
    const body = { name, colors, fontFamily: draft.font, activate: true };
    await commit(
      () =>
        draft.id
          ? api.patch<Settings>(`/api/themes/${draft.id}`, body)
          : api.post<Settings>('/api/themes', body),
      true,
    );
  }, [draft, commit]);

  const applyCustomTheme = useCallback(
    async (id: string) => {
      await commit(() => api.post<Settings>(`/api/themes/${id}/activate`), true);
    },
    [commit],
  );

  const deleteCustomTheme = useCallback(
    async (id: string) => {
      // Closes the creator only when it was editing the theme that just went.
      await commit(() => api.delete<Settings>(`/api/themes/${id}`), draft?.id === id);
    },
    [commit, draft],
  );

  const applyPreset = useCallback(
    async (theme: ThemeName) => {
      /* A preset overrides whatever is being previewed, so drop the draft
         first — otherwise the lock would swallow the repaint and the grid would
         highlight a card the screen is not showing. */
      if (draft) {
        cancelMirror();
        setDraft(null);
        endPreview(settingsRef.current);
      }
      setError(null);
      /* The preset's own accent rides along: SettingsContext writes
         settings.accent inline as --accent, which would otherwise leave every
         palette wearing the previous theme's colour.

         'custom' is the odd one out — it is the bare `:root[data-theme='custom']`
         base rather than a saved theme, so choosing it also clears the
         materialised palette. Without that it would keep painting whichever
         library theme was last worn while the picker claimed otherwise. */
      await save({
        theme,
        accent: themePreset(theme).accent,
        activeCustomThemeId: '',
        /* The typeface travels with the theme, so a built-in preset returns to
           the system face. A font you want everywhere belongs in a saved theme,
           which is the thing that can carry it. */
        fontFamily: '',
        ...(theme === 'custom' ? { customVars: {} } : null),
      });
    },
    [draft, cancelMirror, save],
  );

  const setAccent = useCallback(
    async (color: string) => {
      await save({ accent: color });
    },
    [save],
  );

  /* ---------------- derived ---------------- */

  /**
   * The library, guarded and stabilised.
   *
   * Deliberately not `settings.customThemes ?? []`. `??` only catches null and
   * undefined, and the shape that actually arrives from a backend that predates
   * this feature is `{}` — an object, which sails past the nullish check, whose
   * `.length` is undefined so the empty-state branch is not taken either, and
   * which then throws on `.map()` and unmounts the app. Wire data gets checked,
   * not assumed.
   *
   * Memoised for a second reason: a fresh `[]` per render would change the
   * identity of the context value below on every single render, re-rendering
   * every consumer for nothing.
   */
  const customThemes = useMemo(
    () => (Array.isArray(settings.customThemes) ? settings.customThemes : []),
    [settings.customThemes],
  );
  const activeCustomThemeId = settings.activeCustomThemeId ?? '';
  const activeKey =
    settings.theme === 'custom' && activeCustomThemeId
      ? `custom:${activeCustomThemeId}`
      : `preset:${settings.theme}`;

  const dirty = draft
    ? !sameColors(draftColors, draft.origin) || draft.font !== draft.originFont
    : false;

  return useMemo(
    () => ({
      settings,
      customThemes,
      activeCustomThemeId,
      activeKey,
      draft,
      draftColors,
      dirty,
      busy,
      error,
      createDraft,
      editDraft,
      duplicateDraft,
      setDraftName,
      setDraftColor,
      setDraftFont,
      resetDraft,
      discardDraft,
      saveDraft,
      applyPreset,
      applyCustomTheme,
      deleteCustomTheme,
      setAccent,
    }),
    [
      settings,
      customThemes,
      activeCustomThemeId,
      activeKey,
      draft,
      draftColors,
      dirty,
      busy,
      error,
      createDraft,
      editDraft,
      duplicateDraft,
      setDraftName,
      setDraftColor,
      setDraftFont,
      resetDraft,
      discardDraft,
      saveDraft,
      applyPreset,
      applyCustomTheme,
      deleteCustomTheme,
      setAccent,
    ],
  );
}
