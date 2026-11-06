import {
  CalendarClock,
  CalendarDays,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Link,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  LucideIcon,
  Minus,
  SquareCode,
  SquarePlay,
  Table,
  TextQuote,
} from 'lucide-react';
import { CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { CALLOUT_TYPES } from '../../lib/noteFormat';
import { TranslationKey } from '../../locales';
import { en } from '../../locales/en';
import { th } from '../../locales/th';
import { Icon } from '../Icon';
import { Portal } from '../ui';
import { CALLOUT_ICONS, CALLOUT_LABELS, FormatCommand } from './NoteFormatBar';

export type SlashItem = {
  id: string;
  labelKey: TranslationKey;
  /** For a callout: its type's name after "Callout: ". */
  subKey?: TranslationKey;
  icon: LucideIcon;
  /** Extra words that find it, beyond its label in both languages. */
  keywords: string;
  command: FormatCommand;
};

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'h1', labelKey: 'notes.fmtH1', icon: Heading1, keywords: 'h1 title #', command: { action: 'h1' } },
  { id: 'h2', labelKey: 'notes.fmtH2', icon: Heading2, keywords: 'h2 ##', command: { action: 'h2' } },
  { id: 'h3', labelKey: 'notes.fmtH3', icon: Heading3, keywords: 'h3 ###', command: { action: 'h3' } },
  { id: 'bullet', labelKey: 'notes.fmtBullet', icon: List, keywords: 'ul list -', command: { action: 'bullet' } },
  { id: 'ordered', labelKey: 'notes.fmtNumbered', icon: ListOrdered, keywords: 'ol 1.', command: { action: 'ordered' } },
  { id: 'task', labelKey: 'notes.fmtChecklist', icon: ListChecks, keywords: 'todo task check [ ]', command: { action: 'task' } },
  { id: 'quote', labelKey: 'notes.fmtQuote', icon: TextQuote, keywords: 'blockquote >', command: { action: 'quote' } },
  ...CALLOUT_TYPES.map<SlashItem>((type) => ({
    id: `callout-${type}`,
    labelKey: 'notes.fmtCallout',
    subKey: CALLOUT_LABELS[type],
    icon: CALLOUT_ICONS[type],
    keywords: `callout alert box ${type}`,
    command: { action: 'callout', type },
  })),
  { id: 'toggle', labelKey: 'notes.fmtToggle', icon: ListCollapse, keywords: 'toggle collapse details fold', command: { action: 'toggle' } },
  { id: 'table', labelKey: 'notes.fmtTable', icon: Table, keywords: 'table grid', command: { action: 'table', rows: 3, cols: 3 } },
  { id: 'divider', labelKey: 'notes.fmtDivider', icon: Minus, keywords: 'divider hr line ---', command: { action: 'divider' } },
  { id: 'codeBlock', labelKey: 'notes.fmtCodeBlock', icon: SquareCode, keywords: 'code block ```', command: { action: 'codeBlock' } },
  { id: 'link', labelKey: 'notes.fmtLink', icon: Link, keywords: 'link url web', command: { action: 'link' } },
  { id: 'embed', labelKey: 'notes.fmtEmbed', icon: SquarePlay, keywords: 'embed video youtube image picture', command: { action: 'embed' } },
  { id: 'noteLink', labelKey: 'notes.fmtNoteLink', icon: FileText, keywords: 'note page link', command: { action: 'noteLink' } },
  { id: 'date', labelKey: 'notes.fmtDate', icon: CalendarDays, keywords: 'date today', command: { action: 'date' } },
  { id: 'dateTime', labelKey: 'notes.fmtDateTime', icon: CalendarClock, keywords: 'time now datetime', command: { action: 'dateTime' } },
];

/** A dictionary lookup by `notes.key`, in a language other than the current one. */
function inDictionary(dictionary: object, key: TranslationKey): string {
  const [section, name] = key.split('.');
  const group = (dictionary as Record<string, Record<string, unknown> | undefined>)[section];
  return String(group?.[name] ?? '');
}

/** Each item's words in both languages, lower-cased, worked out once. */
const HAYSTACKS = SLASH_ITEMS.map((item) =>
  [
    inDictionary(en, item.labelKey),
    inDictionary(th, item.labelKey),
    item.subKey ? inDictionary(en, item.subKey) : '',
    item.subKey ? inDictionary(th, item.subKey) : '',
    item.keywords,
  ]
    .join(' ')
    .toLocaleLowerCase(),
);

/** Items whose English or Thai label, or keywords, contain every typed word. */
export function filterSlashItems(query: string): SlashItem[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((_, index) => words.every((word) => HAYSTACKS[index].includes(word)));
}

/**
 * The menu itself: below the caret's line, or above it when the keyboard
 * (and the formatting bar docked on it) leaves no room below. Never wider
 * than the screen. It takes no focus — the keys stay in the note.
 */
export function SlashMenu({
  items,
  active,
  caret,
  listId,
  onPick,
  onHover,
}: {
  items: SlashItem[];
  active: number;
  /** The caret line on screen. */
  caret: { top: number; bottom: number; left: number };
  listId: string;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    let viewBottom = viewTop + (vv?.height ?? window.innerHeight);
    /* The docked formatting bar covers the bottom of what is visible. */
    const dock = document.querySelector<HTMLElement>('.note-format.is-docked');
    if (dock) viewBottom = Math.min(viewBottom, dock.getBoundingClientRect().top);
    const viewW = document.documentElement.clientWidth;
    const margin = 8;
    const width = Math.min(300, viewW - margin * 2);
    const natural = ref.current?.scrollHeight ?? 240;
    /* A caret scrolled out of sight still gets a menu on screen, at the edge
       it went past. */
    const clamp = (y: number) => Math.min(Math.max(y, viewTop + margin), viewBottom - margin);
    const top = clamp(caret.top);
    const bottom = clamp(caret.bottom);
    const below = viewBottom - bottom - margin;
    const above = top - viewTop - margin;
    const putBelow = below >= Math.min(natural, 200) || below >= above;
    const room = Math.max(96, putBelow ? below : above);
    setStyle({
      left: Math.min(Math.max(margin, caret.left), viewW - margin - width),
      width,
      maxHeight: Math.min(room, 320),
      ...(putBelow ? { top: bottom + 4 } : { bottom: window.innerHeight - top + 4 }),
    });
  }, [caret.top, caret.bottom, caret.left, items.length]);

  /* The highlighted row stays in view while the arrows move it. */
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(`#${CSS.escape(`${listId}-${active}`)}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  return (
    <Portal>
      <div
        ref={ref}
        id={listId}
        role="listbox"
        aria-label={t('notes.slashLabel')}
        className="slash-menu"
        style={{ ...(style ?? { left: 0, top: 0 }), visibility: style ? 'visible' : 'hidden' }}
        onMouseDown={(event) => event.preventDefault()}
      >
        {items.length === 0 ? (
          <p className="slash-empty">{t('notes.slashEmpty')}</p>
        ) : (
          items.map((item, index) => (
            <button
              key={item.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={cx('slash-item', index === active && 'is-active')}
              onMouseMove={() => index !== active && onHover(index)}
              onClick={() => onPick(item)}
            >
              <Icon icon={item.icon} size="sm" />
              <span>
                {t(item.labelKey)}
                {item.subKey && <span className="slash-sub"> · {t(item.subKey)}</span>}
              </span>
            </button>
          ))
        )}
      </div>
    </Portal>
  );
}
