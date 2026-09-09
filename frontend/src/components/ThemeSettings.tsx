import { Check, Copy, Eye, Palette, Pencil, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { FONTS, FontOption, fontOption } from '../lib/fonts';
import { cx } from '../lib/format';
import { THEME_PRESETS, THEME_VARS, customSwatches, themePreset } from '../lib/themes';
import { useTheme } from '../state/ThemeContext';
import { CustomTheme } from '../types';
import { Icon } from './Icon';
import { Alert, Button, Card, Field, Input } from './ui';

/**
 * The Appearance screen: a library of themes, and a creator for making more.
 *
 * The performance-critical rule lives one layer down in `hooks/useTheme.ts` —
 * colour pickers never touch the network, only the DOM. This file's job is to
 * keep React out of the drag path too:
 *
 *   - each `<input type="color">` is *uncontrolled* (`defaultValue` + a `key`
 *     that only changes when the draft is opened or reset), so dragging one
 *     re-renders nothing at all
 *   - `ColorField` is memoised, so a frame that repaints the dragged swatch's
 *     hex readout leaves the other ten fields alone
 *
 * The consequence worth remembering: after `resetDraft` the inputs must be
 * re-seeded, which is what `seed` below is for. React will not move an
 * uncontrolled input on its own.
 */

const ACCENTS = ['#3b6fff', '#5b8cff', '#46c2a4', '#0f9d6b', '#d98324', '#dc3a56', '#8b5cf6', '#ec4899'];

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** The four-swatch miniature every theme card shows. */
function ThemeChip({ swatches }: { swatches: readonly [string, string, string, string] }) {
  return (
    <span
      className="theme-card-preview"
      style={{ background: swatches[0], borderColor: swatches[1] }}
      aria-hidden="true"
    >
      <span className="theme-card-dot" style={{ background: swatches[2] }} />
      <span className="theme-card-surface" style={{ background: swatches[1] }}>
        <span className="theme-card-bar" style={{ background: swatches[3] }} />
        <span className="theme-card-bar theme-card-bar--short" style={{ background: swatches[3] }} />
      </span>
    </span>
  );
}

const ColorField = memo(function ColorField({
  varKey,
  label,
  hint,
  initial,
  current,
  onPick,
}: {
  varKey: string;
  label: string;
  hint: string;
  /** Seeds the uncontrolled input. Only read on mount — see the note above. */
  initial: string;
  /** The live value, for the readout. Changes every frame while dragging. */
  current: string;
  onPick: (key: string, value: string) => void;
}) {
  return (
    <label className="color-field">
      <input
        type="color"
        className="color-field-input"
        defaultValue={initial}
        onChange={(event) => onPick(varKey, event.target.value)}
        aria-label={`${label} (${varKey})`}
      />
      <span className="color-field-text">
        <span className="color-field-label">{label}</span>
        <span className="color-field-hint">{hint}</span>
        <code className="color-field-value">{current}</code>
      </span>
    </label>
  );
});

/**
 * One typeface, set in itself.
 *
 * The sample is the point: a list of font *names* in the UI font tells you
 * nothing, so each card renders its own stack and Thai-capable faces show a
 * Thai line as well. `useTheme` preloads the whole catalogue when the creator
 * opens so these are honest immediately rather than reflowing as each arrives.
 */
const FontCard = memo(function FontCard({
  font,
  active,
  onPick,
}: {
  font: FontOption;
  active: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={cx('font-card', active && 'is-active')}
      onClick={() => onPick(font.id)}
      title={font.blurb}
    >
      <span className="font-card-sample" style={{ fontFamily: font.stack }}>
        <span className="font-card-latin">Aa 1,240.50</span>
        {font.thai && <span className="font-card-thai">ยอดคงเหลือ</span>}
      </span>
      <span className="font-card-name" style={{ fontFamily: font.stack }}>
        {font.label}
      </span>
      <span className="font-card-blurb truncate">{font.blurb}</span>
      {active && (
        <span className="theme-card-check" aria-hidden="true">
          <Icon icon={Check} size="sm" />
        </span>
      )}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function ThemeSettings() {
  const {
    settings,
    customThemes,
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
  } = useTheme();

  /* Re-seeds the uncontrolled colour inputs. Bumped when a draft opens (the
     origin object is new each time) and explicitly on reset, which reuses the
     same origin and so would not trip the effect. */
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    setSeed((n) => n + 1);
  }, [draft?.origin]);

  /* Two-step delete rather than a confirm() dialog, which would block the page
     and is overkill for a colour scheme. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const activePreset = themePreset(settings.theme);

  /* Uncontrolled inputs will not move on their own, so every reset has to
     re-seed them — see the note at the top of this file. */
  function handleReset(target: 'origin' | 'default') {
    resetDraft(target);
    setSeed((n) => n + 1);
  }

  async function handleDelete(id: string) {
    if (confirmingDelete !== id) {
      setConfirmingDelete(id);
      return;
    }
    setConfirmingDelete(null);
    try {
      await deleteCustomTheme(id);
    } catch {
      /* `error` on the engine already carries it. */
    }
  }

  return (
    <>
      {draft && (
        <div className="preview-bar" role="status">
          <span className="preview-bar-pulse" aria-hidden="true" />
          <div className="preview-bar-text">
            <strong>Previewing {draft.name.trim() || 'your new theme'}</strong>
            <span className="text-muted">
              {dirty
                ? 'Nothing is saved yet — look around the app, then save or discard.'
                : 'Adjust the colours below. Changes stay on this device until you save.'}
            </span>
          </div>
          <div className="preview-bar-actions">
            <Button size="sm" variant="ghost" onClick={discardDraft} disabled={busy}>
              <Icon icon={X} size="sm" />
              Discard
            </Button>
            <Button size="sm" variant="primary" onClick={() => void saveDraft()} loading={busy}>
              <Icon icon={Check} size="sm" />
              Save theme
            </Button>
          </div>
        </div>
      )}

      <Card
        title="Theme library"
        subtitle="Your saved palettes and the built-in ones. Everything here is plain CSS variables."
        actions={
          <Button size="sm" variant="primary" onClick={createDraft}>
            <Icon icon={Plus} size="sm" />
            New theme
          </Button>
        }
      >
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          <fieldset className="theme-group">
            <legend className="section-label">
              Yours
              {customThemes.length > 0 && <span className="count-pill">{customThemes.length}</span>}
            </legend>

            {customThemes.length === 0 ? (
              <button type="button" className="theme-card theme-card--new" onClick={createDraft}>
                <span className="theme-card-new-icon" aria-hidden="true">
                  <Icon icon={Palette} />
                </span>
                <span className="theme-card-name">Make your first theme</span>
                <span className="theme-card-blurb">
                  Start from the palette you're wearing and change what you like.
                </span>
              </button>
            ) : (
              <div className="theme-row">
                {customThemes.map((saved: CustomTheme) => {
                  const active = activeKey === `custom:${saved.id}`;
                  const editing = draft?.id === saved.id;
                  return (
                    <div key={saved.id} className={cx('theme-card', active && 'is-active', editing && 'is-editing')}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className="theme-card-hit"
                        onClick={() => void applyCustomTheme(saved.id)}
                        disabled={busy}
                        title={`Use ${saved.name}`}
                      >
                        <ThemeChip swatches={customSwatches(saved.colors)} />
                        <span className="theme-card-name">
                          <Icon icon={Palette} size="sm" />
                          <span className="truncate">{saved.name}</span>
                        </span>
                        <span className="theme-card-blurb truncate">
                          {editing ? 'Editing now' : active ? 'In use' : 'Saved theme'}
                          {' · '}
                          {fontOption(saved.fontFamily).label}
                        </span>
                      </button>

                      {active && (
                        <span className="theme-card-check" aria-hidden="true">
                          <Icon icon={Check} size="sm" />
                        </span>
                      )}

                      <div className="theme-card-tools">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => editDraft(saved)}
                          aria-label={`Edit ${saved.name}`}
                          title="Edit"
                        >
                          <Icon icon={Pencil} size="sm" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => duplicateDraft(saved)}
                          aria-label={`Duplicate ${saved.name}`}
                          title="Duplicate"
                        >
                          <Icon icon={Copy} size="sm" />
                        </button>
                        <button
                          type="button"
                          className={cx('icon-btn', 'icon-btn--danger', confirmingDelete === saved.id && 'is-armed')}
                          onClick={() => void handleDelete(saved.id)}
                          onBlur={() => setConfirmingDelete((id) => (id === saved.id ? null : id))}
                          aria-label={
                            confirmingDelete === saved.id
                              ? `Confirm deleting ${saved.name}`
                              : `Delete ${saved.name}`
                          }
                          title={confirmingDelete === saved.id ? 'Click again to delete' : 'Delete'}
                        >
                          <Icon icon={Trash2} size="sm" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* Grouped by scheme so a light theme is never a surprise. */}
          {(['light', 'dark'] as const).map((scheme) => (
            <fieldset key={scheme} className="theme-group">
              <legend className="section-label">{scheme === 'light' ? 'Light' : 'Dark'}</legend>
              <div className="theme-row">
                {THEME_PRESETS.filter((preset) => preset.scheme === scheme).map((preset) => {
                  const active = activeKey === `preset:${preset.value}`;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={cx('theme-card', 'theme-card--preset', active && 'is-active')}
                      onClick={() => void applyPreset(preset.value)}
                      disabled={busy}
                      title={preset.blurb}
                    >
                      <ThemeChip swatches={preset.swatches} />
                      <span className="theme-card-name">
                        <Icon icon={preset.icon} size="sm" />
                        {preset.label}
                      </span>
                      <span className="theme-card-blurb truncate">{preset.blurb}</span>
                      {active && (
                        <span className="theme-card-check" aria-hidden="true">
                          <Icon icon={Check} size="sm" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <Field
          label="Accent colour"
          className="span-2"
          hint="Applied on top of whichever theme is active. Picking a theme resets it to that theme's own accent."
        >
          <div className="swatches" style={{ marginTop: 4 }}>
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                className={cx('swatch', settings.accent === color && 'is-active')}
                style={{ background: color }}
                onClick={() => void setAccent(color)}
                aria-label={`Accent ${color}`}
              />
            ))}
            {/* `onBlur`, not `onChange`: the accent is a committed setting, so it
                writes once when the native picker closes rather than on every
                tick of the drag. The theme creator below is where live colour
                play belongs. */}
            <input
              type="color"
              className="control swatch"
              style={{ width: 44 }}
              defaultValue={settings.accent}
              key={settings.accent}
              onBlur={(e) => void setAccent(e.target.value)}
              aria-label="Custom accent colour"
            />
            <Button size="sm" variant="ghost" onClick={() => void setAccent(activePreset.accent)}>
              <Icon icon={RotateCcw} size="sm" />
              Match theme
            </Button>
          </div>
        </Field>

        {error && (
          <div style={{ marginTop: 12 }}>
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </Card>

      {draft && (
        <Card
          title={draft.id ? 'Edit theme' : 'Create theme'}
          subtitle="Every change shows instantly across the whole app. Nothing reaches the sheet until you save."
          actions={
            <span className="preview-tag">
              <Icon icon={Eye} size="sm" />
              Live preview
            </span>
          }
        >
          <div className="creator">
            <div className="creator-head">
              <Field
                label="Theme name"
                hint="What you'll see in the library — e.g. Cyberpunk, Forest, Monday morning."
                className="creator-name"
              >
                <Input
                  value={draft.name}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Untitled theme"
                  maxLength={40}
                  autoFocus
                />
              </Field>

              <div className="creator-chip">
                <ThemeChip swatches={customSwatches(draftColors)} />
                <span className="creator-chip-text">
                  <span className="text-muted">{draft.id ? 'Editing a saved theme' : 'New theme'}</span>
                  <span style={{ fontFamily: fontOption(draft.font).stack }}>
                    {fontOption(draft.font).label}
                  </span>
                </span>
              </div>
            </div>

            <div className="creator-section">
              <h3 className="section-label">Palette</h3>
              <div className="color-grid">
              {THEME_VARS.map((variable) => (
                <ColorField
                  // Uncontrolled inputs only take their value on mount, so the
                  // seed is what makes "Reset" actually move the swatches.
                  key={`${seed}:${variable.key}`}
                  varKey={variable.key}
                  label={variable.label}
                  hint={variable.hint}
                  initial={draftColors[variable.key]}
                  current={draftColors[variable.key]}
                  onPick={setDraftColor}
                />
              ))}
              </div>
            </div>

            <div className="creator-section">
              <h3 className="section-label">Typography</h3>
              <p className="creator-section-hint">
                Sets the body and heading faces. Figures and tickers stay monospaced so
                columns keep lining up. Thai-capable faces are marked with a Thai sample.
              </p>
              <div className="font-grid" role="radiogroup" aria-label="Typeface">
                {FONTS.map((font) => (
                  <FontCard
                    key={font.id}
                    font={font}
                    active={draft.font === font.id}
                    onPick={setDraftFont}
                  />
                ))}
              </div>
            </div>

            <div className="creator-actions">
              {/* Two different escapes, because they mean different things: put
                  back what I started with, versus wipe the slate. */}
              <Button variant="ghost" onClick={() => handleReset('origin')} disabled={busy || !dirty}>
                <Icon icon={Undo2} size="sm" />
                Revert changes
              </Button>
              <Button variant="ghost" onClick={() => handleReset('default')} disabled={busy}>
                <Icon icon={RotateCcw} size="sm" />
                Reset to default
              </Button>
              <span className="spacer" />
              <Button variant="ghost" onClick={discardDraft} disabled={busy}>
                Discard
              </Button>
              <Button
                variant="primary"
                onClick={() => void saveDraft()}
                loading={busy}
                disabled={!draft.name.trim()}
              >
                <Icon icon={Check} size="sm" />
                {draft.id ? 'Save changes' : 'Save theme'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
