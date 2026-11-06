import { CopyPlus, Download, EllipsisVertical, FileText, LucideIcon, Maximize2, Printer, Type } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { NotePrefs, NoteTextSize, NoteWidth } from '../../lib/notePrefs';
import { TranslationKey } from '../../locales';
import { Icon } from '../Icon';
import { Button } from '../ui';
import { ToolPanel } from './ToolPanel';

export type NoteMenuAction = 'copyMarkdown' | 'copyPlain' | 'download' | 'print' | 'duplicate';

const ACTIONS: { action: NoteMenuAction; icon: LucideIcon; labelKey: TranslationKey }[] = [
  { action: 'copyMarkdown', icon: FileText, labelKey: 'notes.copyMarkdown' },
  { action: 'copyPlain', icon: Type, labelKey: 'notes.copyPlain' },
  { action: 'download', icon: Download, labelKey: 'notes.downloadMd' },
  { action: 'print', icon: Printer, labelKey: 'notes.print' },
  { action: 'duplicate', icon: CopyPlus, labelKey: 'notes.duplicate' },
];

const SIZES: { value: NoteTextSize; short: string; labelKey: TranslationKey }[] = [
  { value: 's', short: 'S', labelKey: 'notes.sizeSmall' },
  { value: 'm', short: 'M', labelKey: 'notes.sizeMedium' },
  { value: 'l', short: 'L', labelKey: 'notes.sizeLarge' },
];

const WIDTHS: { value: NoteWidth; labelKey: TranslationKey }[] = [
  { value: 'normal', labelKey: 'notes.widthNormal' },
  { value: 'wide', labelKey: 'notes.widthWide' },
];

/**
 * The note's ⋯ menu: copy, download, print, duplicate, and how the note is
 * shown on this device. Width only matters where there is room to widen,
 * so the phone does not offer it.
 */
export function NoteMoreMenu({
  prefs,
  onPrefs,
  onAction,
  canDuplicate,
}: {
  prefs: NotePrefs;
  onPrefs: (patch: Partial<NotePrefs>) => void;
  onAction: (action: NoteMenuAction) => void;
  canDuplicate: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('notes.menu')}
        title={t('notes.menu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          setOpen((value) => !value);
        }}
      >
        <Icon icon={EllipsisVertical} size="sm" />
      </Button>
      <ToolPanel open={open} anchor={anchor} onClose={() => setOpen(false)} label={t('notes.menu')}>
        <div className="tool-list note-menu">
          {ACTIONS.map((item) => {
            const disabled = item.action === 'duplicate' && !canDuplicate;
            return (
              <button
                key={item.action}
                type="button"
                className="tool-row"
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (disabled) return;
                  setOpen(false);
                  onAction(item.action);
                }}
              >
                <Icon icon={item.icon} size="sm" />
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}

          <p className="tool-heading">{t('notes.comfort')}</p>
          <div className="tool-field">
            <span>{t('notes.textSize')}</span>
            <div className="tool-seg" role="group" aria-label={t('notes.textSize')}>
              {SIZES.map((size) => (
                <button
                  key={size.value}
                  type="button"
                  className={cx('tool-seg-btn', prefs.size === size.value && 'is-active')}
                  aria-pressed={prefs.size === size.value}
                  aria-label={t(size.labelKey)}
                  title={t(size.labelKey)}
                  onClick={() => onPrefs({ size: size.value })}
                >
                  {size.short}
                </button>
              ))}
            </div>
          </div>
          <div className="tool-field note-menu-width">
            <span>{t('notes.width')}</span>
            <div className="tool-seg" role="group" aria-label={t('notes.width')}>
              {WIDTHS.map((width) => (
                <button
                  key={width.value}
                  type="button"
                  className={cx('tool-seg-btn', prefs.width === width.value && 'is-active')}
                  aria-pressed={prefs.width === width.value}
                  onClick={() => onPrefs({ width: width.value })}
                >
                  {t(width.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.focus}
            className={cx('tool-row', 'tool-switch', prefs.focus && 'is-on')}
            onClick={() => onPrefs({ focus: !prefs.focus })}
          >
            <Icon icon={Maximize2} size="sm" />
            <span>
              {t('notes.focusMode')}
              <small>{t('notes.focusModeHint')}</small>
            </span>
            <span className="tool-switch-track" aria-hidden="true" />
          </button>
        </div>
      </ToolPanel>
    </>
  );
}
