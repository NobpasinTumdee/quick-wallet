import { Check, Copy, Eye, Palette, Pencil, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
            <strong>{t('theme.previewing', { name: draft.name.trim() || t('theme.yourNewTheme') })}</strong>
            <span className="text-muted">
              {dirty
                ? t('theme.unsavedHint')
                : t('theme.adjustHint')}
            </span>
          </div>
          <div className="preview-bar-actions">
            <Button size="sm" variant="ghost" onClick={discardDraft} disabled={busy}>
              <Icon icon={X} size="sm" />
              {t('theme.discard')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void saveDraft()} loading={busy}>
              <Icon icon={Check} size="sm" />
              {t('theme.saveTheme')}
            </Button>
          </div>
        </div>
      )}

      <Card
        title={t('theme.library')}
        subtitle={t('theme.librarySubtitle')}
        actions={
          <Button size="sm" variant="primary" onClick={createDraft}>
            <Icon icon={Plus} size="sm" />
            {t('theme.newTheme')}
          </Button>
        }
      >
        <div className="theme-grid" role="radiogroup" aria-label={t('theme.themeGroup')}>
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
                <span className="theme-card-name">{t('theme.makeFirstTheme')}</span>
                <span className="theme-card-blurb">
                  {t('theme.makeFirstThemeBody')}
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
                        title={t('theme.useTheme', { name: saved.name })}
                      >
                        <ThemeChip swatches={customSwatches(saved.colors)} />
                        <span className="theme-card-name">
                          <Icon icon={Palette} size="sm" />
                          <span className="truncate">{saved.name}</span>
                        </span>
                        <span className="theme-card-blurb truncate">
                          {t(editing ? 'theme.editingNow' : active ? 'theme.inUse' : 'theme.savedTheme')}
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
                          aria-label={t('theme.editNamed', { name: saved.name })}
                          title={t('common.edit')}
                        >
                          <Icon icon={Pencil} size="sm" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => duplicateDraft(saved)}
                          aria-label={t('theme.duplicateNamed', { name: saved.name })}
                          title={t('theme.duplicate')}
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
                              ? t('theme.confirmDeleting', { name: saved.name })
                              : t('theme.deleteNamed', { name: saved.name })
                          }
                          title={t(confirmingDelete === saved.id ? 'theme.clickAgainToDelete' : 'common.delete')}
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
              <legend className="section-label">{t(scheme === 'light' ? 'theme.schemeLight' : 'theme.schemeDark')}</legend>
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
          label={t('theme.accentColour')}
          className="span-2"
          hint={t('theme.accentHint')}
        >
          <div className="swatches" style={{ marginTop: 4 }}>
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                className={cx('swatch', settings.accent === color && 'is-active')}
                style={{ background: color }}
                onClick={() => void setAccent(color)}
                aria-label={t('theme.accentNamed', { colour: color })}
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
              aria-label={t('theme.customAccentColour')}
            />
            <Button size="sm" variant="ghost" onClick={() => void setAccent(activePreset.accent)}>
              <Icon icon={RotateCcw} size="sm" />
              {t('theme.matchTheme')}
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
          title={t(draft.id ? 'theme.editTheme' : 'theme.createTheme')}
          subtitle={t('theme.editorSubtitle')}
          actions={
            <span className="preview-tag">
              <Icon icon={Eye} size="sm" />
              {t('theme.livePreview')}
            </span>
          }
        >
          <div className="creator">
            <div className="creator-head">
              <Field
                label={t('theme.themeName')}
                hint={t('theme.themeNameHint')}
                className="creator-name"
              >
                <Input
                  value={draft.name}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder={t('theme.untitledTheme')}
                  maxLength={40}
                  autoFocus
                />
              </Field>

              <div className="creator-chip">
                <ThemeChip swatches={customSwatches(draftColors)} />
                <span className="creator-chip-text">
                  <span className="text-muted">{draft.id ? t('theme.editingSaved') : t('theme.newTheme')}</span>
                  <span style={{ fontFamily: fontOption(draft.font).stack }}>
                    {fontOption(draft.font).label}
                  </span>
                </span>
              </div>
            </div>

            <div className="creator-section">
              <h3 className="section-label">{t('theme.palette')}</h3>
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
              <h3 className="section-label">{t('theme.typography')}</h3>
              <p className="creator-section-hint">
                Sets the body and heading faces. Figures and tickers stay monospaced so
                columns keep lining up. Thai-capable faces are marked with a Thai sample.
              </p>
              <div className="font-grid" role="radiogroup" aria-label={t('theme.typefaceGroup')}>
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
                {t('theme.revertChanges')}
              </Button>
              <Button variant="ghost" onClick={() => handleReset('default')} disabled={busy}>
                <Icon icon={RotateCcw} size="sm" />
                {t('theme.resetToDefault')}
              </Button>
              <span className="spacer" />
              <Button variant="ghost" onClick={discardDraft} disabled={busy}>
                {t('theme.discard')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void saveDraft()}
                loading={busy}
                disabled={!draft.name.trim()}
              >
                <Icon icon={Check} size="sm" />
                {t(draft.id ? 'common.saveChanges' : 'theme.saveTheme')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
