import {
  Baseline,
  Bold,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  Code,
  Ellipsis,
  FileText,
  Heading,
  Highlighter,
  Info,
  Italic,
  Lightbulb,
  Link,
  List,
  ListChecks,
  ListCollapse,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  LucideIcon,
  MessageSquareWarning,
  Minus,
  OctagonAlert,
  Plus,
  Redo2,
  RemoveFormatting,
  SquareCode,
  SquarePlay,
  Strikethrough,
  Table,
  TextQuote,
  TriangleAlert,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import { CSSProperties, Fragment, ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { CALLOUT_TYPES, CalloutType, NOTE_COLORS, NoteColor, isNoteColor } from '../../lib/noteFormat';
import { TranslationKey } from '../../locales';
import { Icon } from '../Icon';
import { Portal } from '../ui';
import { ToolPanel } from './ToolPanel';

/* ---- What the bar can ask the editor to do ---- */

export type FormatAction =
  | 'undo'
  | 'redo'
  | 'heading'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'underline'
  | 'code'
  | 'clear'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'indent'
  | 'outdent'
  | 'quote'
  | 'toggle'
  | 'divider'
  | 'codeBlock'
  | 'link'
  | 'embed'
  | 'noteLink'
  | 'date'
  | 'dateTime';

export type FormatCommand =
  | { action: FormatAction }
  | { action: 'color' | 'highlight'; color: NoteColor | null }
  | { action: 'callout'; type: CalloutType }
  | { action: 'table'; rows: number; cols: number };

type ColorTool = 'color' | 'highlight';
type ToolId = FormatAction | ColorTool | 'callout' | 'table';

type Tool = { icon: LucideIcon; labelKey: TranslationKey; shortcut?: string; text?: string };

const TOOLS: Record<ToolId, Tool> = {
  undo: { icon: Undo2, labelKey: 'notes.fmtUndo', shortcut: 'Z' },
  redo: { icon: Redo2, labelKey: 'notes.fmtRedo', shortcut: 'Shift+Z' },
  heading: { icon: Heading, labelKey: 'notes.fmtHeading' },
  h1: { icon: Heading, labelKey: 'notes.fmtH1', text: 'H1' },
  h2: { icon: Heading, labelKey: 'notes.fmtH2', text: 'H2' },
  h3: { icon: Heading, labelKey: 'notes.fmtH3', text: 'H3' },
  bold: { icon: Bold, labelKey: 'notes.fmtBold', shortcut: 'B' },
  italic: { icon: Italic, labelKey: 'notes.fmtItalic', shortcut: 'I' },
  strike: { icon: Strikethrough, labelKey: 'notes.fmtStrike', shortcut: 'Shift+X' },
  underline: { icon: Underline, labelKey: 'notes.fmtUnderline', shortcut: 'U' },
  code: { icon: Code, labelKey: 'notes.fmtCode', shortcut: 'E' },
  clear: { icon: RemoveFormatting, labelKey: 'notes.fmtClear' },
  color: { icon: Baseline, labelKey: 'notes.fmtTextColor' },
  highlight: { icon: Highlighter, labelKey: 'notes.fmtHighlight' },
  bullet: { icon: List, labelKey: 'notes.fmtBullet' },
  ordered: { icon: ListOrdered, labelKey: 'notes.fmtNumbered' },
  task: { icon: ListChecks, labelKey: 'notes.fmtChecklist' },
  indent: { icon: ListIndentIncrease, labelKey: 'notes.fmtIndent' },
  outdent: { icon: ListIndentDecrease, labelKey: 'notes.fmtOutdent' },
  quote: { icon: TextQuote, labelKey: 'notes.fmtQuote' },
  callout: { icon: MessageSquareWarning, labelKey: 'notes.fmtCallout' },
  toggle: { icon: ListCollapse, labelKey: 'notes.fmtToggle' },
  table: { icon: Table, labelKey: 'notes.fmtTable' },
  divider: { icon: Minus, labelKey: 'notes.fmtDivider' },
  codeBlock: { icon: SquareCode, labelKey: 'notes.fmtCodeBlock' },
  link: { icon: Link, labelKey: 'notes.fmtLink', shortcut: 'K' },
  embed: { icon: SquarePlay, labelKey: 'notes.fmtEmbed' },
  noteLink: { icon: FileText, labelKey: 'notes.fmtNoteLink' },
  date: { icon: CalendarDays, labelKey: 'notes.fmtDate' },
  dateTime: { icon: CalendarClock, labelKey: 'notes.fmtDateTime' },
};

export const CALLOUT_ICONS: Record<CalloutType, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

export const CALLOUT_LABELS: Record<CalloutType, TranslationKey> = {
  note: 'notes.calloutNote',
  tip: 'notes.calloutTip',
  important: 'notes.calloutImportant',
  warning: 'notes.calloutWarning',
  caution: 'notes.calloutCaution',
};

export const COLOR_LABELS: Record<NoteColor, TranslationKey> = {
  red: 'notes.colorRed',
  orange: 'notes.colorOrange',
  yellow: 'notes.colorYellow',
  green: 'notes.colorGreen',
  blue: 'notes.colorBlue',
  purple: 'notes.colorPurple',
  pink: 'notes.colorPink',
  gray: 'notes.colorGray',
};

/* ---- Layouts ---- */

/**
 * Desktop: every tool inline, grouped, separators between groups. When the
 * row runs out of room the tools with the highest number here go into More
 * first; 1 never does.
 */
const DESKTOP_GROUPS: [ToolId, number][][] = [
  [
    ['undo', 3],
    ['redo', 3],
  ],
  [
    ['heading', 1],
    ['bold', 1],
    ['italic', 1],
    ['underline', 3],
    ['strike', 4],
    ['code', 4],
    ['clear', 6],
  ],
  [
    ['color', 2],
    ['highlight', 2],
  ],
  [
    ['bullet', 1],
    ['ordered', 2],
    ['task', 1],
    ['indent', 5],
    ['outdent', 5],
  ],
  [
    ['quote', 4],
    ['callout', 5],
    ['toggle', 6],
    ['table', 5],
    ['divider', 6],
    ['codeBlock', 7],
  ],
  [
    ['link', 1],
    ['noteLink', 6],
    ['embed', 5],
    ['date', 7],
    ['dateTime', 8],
  ],
];

/** Phone: always in the row, in this order, plus Aa and +. */
const PHONE_ROW: ToolId[] = ['undo', 'redo', 'bold', 'italic', 'color', 'highlight', 'bullet', 'task', 'link'];
/** What leaves the row first when the screen is narrow, and where it goes. */
const PHONE_SHED: { tools: ToolId[]; to: 'format' | 'insert' }[] = [
  { tools: ['undo', 'redo'], to: 'format' },
  { tools: ['link'], to: 'insert' },
  /* Only below ~340px: a 320px phone has room for five tools beside Aa and +. */
  { tools: ['task'], to: 'format' },
];
const PHONE_FORMAT: ToolId[] = ['h1', 'h2', 'h3', 'strike', 'underline', 'code', 'clear', 'ordered', 'indent', 'outdent', 'quote'];
const PHONE_INSERT: ToolId[] = ['callout', 'toggle', 'table', 'divider', 'codeBlock', 'embed', 'noteLink', 'date', 'dateTime'];

/** A tap target and the gap beside it. */
const BUTTON = 40;
const GAP = 2;
const SEPARATOR = 13;

/** Apple keyboards format with ⌘; Ctrl there is the text-navigation key. */
export const MOD_IS_META = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MOD_IS_META ? '⌘' : 'Ctrl';

const COLOR_KEY = 'quick-wallet.notes.lastColor';
const HIGHLIGHT_KEY = 'quick-wallet.notes.lastHighlight';

function readColor(key: string, fallback: NoteColor): NoteColor {
  try {
    const value = window.localStorage.getItem(key);
    return value && isNoteColor(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeColor(key: string, color: NoteColor) {
  try {
    window.localStorage.setItem(key, color);
  } catch {
    /* Private mode: it is remembered for this visit only. */
  }
}

export type HistoryState = 'ok' | 'empty' | 'unsupported';

/**
 * The formatting tools above the note body.
 *
 * Every button cancels `mousedown`, which is where a press would take focus
 * from the textarea (and close the phone keyboard), and does its work on
 * `click` — the event a single touch tap is guaranteed to produce — so the
 * selection the action works on is still there when it runs.
 */
export function NoteFormatBar({
  onCommand,
  headingLevel,
  editing,
  history,
  isColored,
}: {
  onCommand: (command: FormatCommand) => void;
  /** The caret line's heading level, shown on the H button. */
  headingLevel: number;
  /** The body has focus: on a phone, dock above the keyboard. */
  editing: boolean;
  /** Whether Undo and Redo can run, for greying them out. */
  history: { undo: HistoryState; redo: HistoryState };
  /** Whether the selection already has this colour kind. */
  isColored: (kind: ColorTool) => boolean;
}) {
  const { t } = useTranslation();
  const inset = useKeyboardInset(editing);
  const docked = inset !== null;
  const phone = usePhoneLayout();
  const barRef = useRef<HTMLDivElement>(null);
  const width = useWidth(barRef, docked);

  /* One open panel at a time, keyed by what opened it. */
  const [panel, setPanel] = useState<{ key: string; anchor: HTMLElement; view: PanelView; items?: ToolId[] } | null>(null);
  const [lastColor, setLastColor] = useState<NoteColor>(() => readColor(COLOR_KEY, 'red'));
  const [lastHighlight, setLastHighlight] = useState<NoteColor>(() => readColor(HIGHLIGHT_KEY, 'yellow'));

  const close = () => setPanel(null);
  const toggle = (key: string, anchor: HTMLElement, view: PanelView, items?: ToolId[]) =>
    setPanel((open) => (open?.key === key ? null : { key, anchor, view, items }));

  function run(command: FormatCommand) {
    if (command.action === 'color' && command.color) {
      setLastColor(command.color);
      writeColor(COLOR_KEY, command.color);
    }
    if (command.action === 'highlight' && command.color) {
      setLastHighlight(command.color);
      writeColor(HIGHLIGHT_KEY, command.color);
    }
    onCommand(command);
  }

  /** A colour button: one tap puts the last colour on (unless the text has
   *  one already) and opens the palette to change or remove it. */
  function colorTap(kind: ColorTool, anchor: HTMLElement) {
    if (panel?.key === kind) {
      close();
      return;
    }
    if (!isColored(kind)) run({ action: kind, color: kind === 'color' ? lastColor : lastHighlight });
    setPanel({ key: kind, anchor, view: kind });
  }

  function pick(id: ToolId, anchor: HTMLElement, from: string) {
    if (id === 'color' || id === 'highlight') return colorTap(id, anchor);
    if (id === 'callout') return toggle(from === 'bar' ? 'callout' : from, anchor, 'callout');
    if (id === 'table') return toggle(from === 'bar' ? 'table' : from, anchor, 'table');
    run({ action: id });
  }

  /* ---- The row ---- */

  let rowItems: ToolId[][];
  let moreItems: ToolId[] = [];
  let formatItems = PHONE_FORMAT;
  let insertItems = PHONE_INSERT;
  if (phone) {
    /* What is left beside Aa, + and the separator before them. */
    /* Phone buttons sit edge to edge (each is its own 40px target). */
    const room = Math.floor((width - 2 * BUTTON) / BUTTON);
    let row = PHONE_ROW;
    const shedFormat: ToolId[] = [];
    const shedInsert: ToolId[] = [];
    for (const step of PHONE_SHED) {
      if (row.length <= room) break;
      row = row.filter((id) => !step.tools.includes(id));
      (step.to === 'format' ? shedFormat : shedInsert).push(...step.tools);
    }
    formatItems = [...shedFormat, ...PHONE_FORMAT];
    insertItems = [...shedInsert, ...PHONE_INSERT];
    rowItems = [row];
  } else {
    const all = DESKTOP_GROUPS.flat();
    const fixed = BUTTON + GAP;
    const fits = (shown: Set<ToolId>, withMore: boolean) => {
      const groups = DESKTOP_GROUPS.filter((group) => group.some(([id]) => shown.has(id))).length;
      return shown.size * fixed + (groups - 1) * SEPARATOR + (withMore ? fixed + SEPARATOR : 0) <= width - 8;
    };
    const shown = new Set(all.map(([id]) => id));
    if (width > 0 && !fits(shown, false)) {
      const byDrop = [...all].sort((a, b) => b[1] - a[1]);
      for (const [id, rank] of byDrop) {
        if (fits(shown, true) || rank <= 1) break;
        shown.delete(id);
      }
    }
    rowItems = DESKTOP_GROUPS.map((group) => group.map(([id]) => id).filter((id) => shown.has(id))).filter((g) => g.length);
    moreItems = all.map(([id]) => id).filter((id) => !shown.has(id));
  }

  function toolButton(id: ToolId) {
    const tool = TOOLS[id];
    const label = t(tool.labelKey);
    const isHeading = id === 'heading';
    const historyState = id === 'undo' ? history.undo : id === 'redo' ? history.redo : 'ok';
    const disabled = historyState !== 'ok';
    const title = disabled
      ? `${label} — ${t(historyState === 'unsupported' ? 'notes.fmtUnavailable' : id === 'undo' ? 'notes.fmtNothingUndo' : 'notes.fmtNothingRedo')}`
      : tool.shortcut
        ? `${label} (${MOD}+${tool.shortcut})`
        : label;
    const swatch = id === 'color' ? lastColor : id === 'highlight' ? lastHighlight : null;
    const opens = id === 'color' || id === 'highlight' || id === 'callout' || id === 'table';
    return (
      <button
        key={id}
        type="button"
        className={cx('note-format-btn', isHeading && headingLevel > 0 && 'is-active', panel?.key === id && 'is-open')}
        aria-label={isHeading && headingLevel > 0 ? `${label}: H${headingLevel}` : label}
        aria-haspopup={opens ? 'dialog' : undefined}
        aria-expanded={opens ? panel?.key === id : undefined}
        title={title}
        /* Not `disabled`: a disabled button shows no tooltip in most browsers,
           and the tooltip is the explanation. */
        aria-disabled={disabled || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (disabled) return;
          pick(id, event.currentTarget, 'bar');
        }}
      >
        {isHeading ? (
          <span className="note-format-h" aria-hidden="true">
            {headingLevel > 0 ? `H${headingLevel}` : 'H'}
          </span>
        ) : (
          <Icon icon={tool.icon} size="sm" />
        )}
        {swatch && (
          <span
            className={cx('note-format-swatch', id === 'highlight' && 'is-highlight')}
            style={{ '--swatch': `var(--note-${id === 'color' ? 'text' : 'hl'}-${swatch})` } as CSSProperties}
            aria-hidden="true"
          />
        )}
      </button>
    );
  }

  function openerButton(key: string, icon: ReactNode, label: string, view: PanelView, items: ToolId[]) {
    return (
      <button
        key={key}
        type="button"
        className={cx('note-format-btn', 'is-opener', panel?.key === key && 'is-open')}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={panel?.key === key}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => toggle(key, event.currentTarget, view, items)}
      >
        {icon}
      </button>
    );
  }

  const bar = (
    <div
      ref={barRef}
      className={cx('note-format', docked && 'is-docked', phone && 'is-phone')}
      role="toolbar"
      aria-label={t('notes.fmtToolbar')}
      style={docked ? ({ '--note-dock-bottom': `${inset}px` } as CSSProperties) : undefined}
    >
      {phone ? (
        /* Its own scroller, so Aa and + stay put at the end however narrow
           the screen is. */
        <div className="note-format-row">{rowItems[0].map(toolButton)}</div>
      ) : (
        rowItems.map((group, index) => (
          <Fragment key={index}>
            {index > 0 && <span className="note-format-sep" aria-hidden="true" />}
            {group.map(toolButton)}
          </Fragment>
        ))
      )}
      {phone ? (
        <>
          {openerButton('format', <Icon icon={Type} size="sm" />, t('notes.fmtFormat'), 'grid', formatItems)}
          {openerButton('insert', <Icon icon={Plus} size="sm" />, t('notes.fmtInsert'), 'grid', insertItems)}
        </>
      ) : (
        moreItems.length > 0 && (
          <>
            <span className="note-format-sep" aria-hidden="true" />
            {openerButton('more', <Icon icon={Ellipsis} size="sm" />, t('notes.fmtMore'), 'list', moreItems)}
          </>
        )
      )}
    </div>
  );

  return (
    /* The slot keeps the bar's height in the page while it is docked, so the
       text under it does not jump when the keyboard opens. Docked, the bar
       goes to <body> like every overlay: a fixed element inside the sticky
       slot would be layered and positioned by the slot, not the screen. */
    <div className="note-format-slot">
      {docked ? <Portal>{bar}</Portal> : bar}
      <ToolPanel
        open={panel !== null}
        anchor={panel?.anchor ?? null}
        onClose={close}
        label={panel ? panelLabel(panel.key, t) : ''}
        wide={phone && (panel?.view === 'grid' || panel?.key === 'format' || panel?.key === 'insert')}
      >
        {panel && (
          <PanelBody
            key={panel.key}
            initial={panel.view}
            items={panel.items ?? []}
            headingLevel={headingLevel}
            history={history}
            lastColor={lastColor}
            lastHighlight={lastHighlight}
            onRun={(command) => {
              run(command);
              /* The palette stays open after a colour so it can be changed
                 again; everything else closes. */
              if (command.action !== 'color' && command.action !== 'highlight') close();
              else if (command.color === null) close();
            }}
            onColorTool={(kind) => {
              if (!isColored(kind)) run({ action: kind, color: kind === 'color' ? lastColor : lastHighlight });
            }}
          />
        )}
      </ToolPanel>
    </div>
  );
}

function panelLabel(key: string, t: (key: TranslationKey) => string): string {
  switch (key) {
    case 'format':
      return t('notes.fmtFormat');
    case 'insert':
      return t('notes.fmtInsert');
    case 'more':
      return t('notes.fmtMore');
    case 'color':
      return t('notes.fmtTextColor');
    case 'highlight':
      return t('notes.fmtHighlight');
    case 'callout':
      return t('notes.fmtCallout');
    case 'table':
      return t('notes.fmtTable');
    default:
      return t('notes.fmtToolbar');
  }
}

/* ---- Panel contents ---- */

type PanelView = 'grid' | 'list' | 'callout' | 'table' | ColorTool;

function PanelBody({
  initial,
  items,
  headingLevel,
  history,
  lastColor,
  lastHighlight,
  onRun,
  onColorTool,
}: {
  initial: PanelView;
  items: ToolId[];
  headingLevel: number;
  history: { undo: HistoryState; redo: HistoryState };
  lastColor: NoteColor;
  lastHighlight: NoteColor;
  onRun: (command: FormatCommand) => void;
  onColorTool: (kind: ColorTool) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<PanelView>(initial);
  const nested = view !== initial;
  const back = nested ? (
    <button type="button" className="tool-back" onClick={() => setView(initial)}>
      <Icon icon={ChevronLeft} size="sm" />
      {t('notes.fmtBack')}
    </button>
  ) : null;

  if (view === 'color' || view === 'highlight') {
    const current = view === 'color' ? lastColor : lastHighlight;
    const tool = t(view === 'color' ? 'notes.fmtTextColor' : 'notes.fmtHighlight');
    return (
      <div className="tool-palette">
        {back}
        <div className="tool-swatches" role="group" aria-label={t('notes.fmtPalette')}>
          {NOTE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={cx('tool-swatch', view === 'highlight' && 'is-highlight', color === current && 'is-current')}
              style={{ '--swatch': `var(--note-${view === 'color' ? 'text' : 'hl'}-${color})` } as CSSProperties}
              aria-label={t('notes.fmtColorApply', { tool, color: t(COLOR_LABELS[color]) })}
              title={t(COLOR_LABELS[color])}
              onClick={() => onRun({ action: view, color })}
            >
              <span aria-hidden="true">A</span>
            </button>
          ))}
        </div>
        <button type="button" className="tool-remove" onClick={() => onRun({ action: view, color: null })}>
          {t('notes.fmtColorRemove')}
        </button>
      </div>
    );
  }

  if (view === 'callout') {
    return (
      <div className="tool-list">
        {back}
        {CALLOUT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={cx('tool-row', `is-callout-${type}`)}
            onClick={() => onRun({ action: 'callout', type })}
          >
            <Icon icon={CALLOUT_ICONS[type]} size="sm" />
            <span>{t(CALLOUT_LABELS[type])}</span>
          </button>
        ))}
      </div>
    );
  }

  if (view === 'table') {
    return (
      <div className="tool-list">
        {back}
        <TablePicker onPick={(rows, cols) => onRun({ action: 'table', rows, cols })} />
      </div>
    );
  }

  const tile = (id: ToolId) => {
    const tool = TOOLS[id];
    const historyState = id === 'undo' ? history.undo : id === 'redo' ? history.redo : 'ok';
    const disabled = historyState !== 'ok';
    const active = (id === 'h1' && headingLevel === 1) || (id === 'h2' && headingLevel === 2) || (id === 'h3' && headingLevel === 3);
    const sub = id === 'callout' || id === 'table' || id === 'color' || id === 'highlight';
    return (
      <button
        key={id}
        type="button"
        className={cx(view === 'grid' ? 'tool-tile' : 'tool-row', active && 'is-active')}
        aria-disabled={disabled || undefined}
        title={disabled ? t(historyState === 'unsupported' ? 'notes.fmtUnavailable' : id === 'undo' ? 'notes.fmtNothingUndo' : 'notes.fmtNothingRedo') : undefined}
        onClick={() => {
          if (disabled) return;
          if (id === 'callout' || id === 'table') return setView(id);
          if (id === 'color' || id === 'highlight') {
            onColorTool(id);
            return setView(id);
          }
          onRun({ action: id });
        }}
      >
        {tool.text ? <span className="tool-tile-text">{tool.text}</span> : <Icon icon={tool.icon} size="sm" />}
        <span className="tool-tile-label">{t(tool.labelKey)}</span>
        {sub && view === 'list' && <Icon icon={ChevronDown} size="sm" className="tool-row-more" />}
      </button>
    );
  };

  return <div className={view === 'grid' ? 'tool-grid' : 'tool-list'}>{items.map(tile)}</div>;
}

/**
 * Rows × columns, header row counted. Tapping a cell inserts that size;
 * on a desktop, hovering previews it.
 */
function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const { t } = useTranslation();
  const [size, setSize] = useState({ rows: 3, cols: 3 });
  const max = 6;
  return (
    <div className="tool-table">
      <div className="tool-table-grid" role="grid" aria-label={t('notes.tableTitle')}>
        {Array.from({ length: max }, (_, r) => (
          <div key={r} role="row" className="tool-table-row">
            {Array.from({ length: max }, (_, c) => (
              <button
                key={c}
                type="button"
                role="gridcell"
                className={cx('tool-table-cell', r < size.rows && c < size.cols && 'is-on')}
                aria-label={t('notes.tableSize', { rows: r + 1, cols: c + 1 })}
                onMouseEnter={() => setSize({ rows: r + 1, cols: c + 1 })}
                onFocus={() => setSize({ rows: r + 1, cols: c + 1 })}
                onClick={() => onPick(Math.max(2, r + 1), c + 1)}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="tool-table-size">{t('notes.tableSize', { rows: Math.max(2, size.rows), cols: size.cols })}</p>
      <p className="tool-table-hint">{t('notes.tableHint')}</p>
    </div>
  );
}

/* ---- Measuring ---- */

function usePhoneLayout(): boolean {
  const query = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const sync = () => setPhone(list.matches);
    list.addEventListener('change', sync);
    return () => list.removeEventListener('change', sync);
  }, []);
  return phone;
}

/** The bar's own width, so the row can decide what fits in it. Measured
 *  again when the bar moves between its slot and the docked position. */
function useWidth(ref: RefObject<HTMLElement>, placement: boolean): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const style = getComputedStyle(el);
      setWidth(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, placement]);
  return width;
}

/* The tallest the window has been: when it shrinks a lot while editing, the
   keyboard is up on a browser that resizes the page for it (Android Chrome
   with `resizes-content`), where nothing is hidden behind it. */
let tallest = typeof window === 'undefined' ? 0 : window.innerHeight;

/**
 * How far above the bottom of the page the keyboard reaches, while it is
 * open and the body is being edited on a touch screen — null otherwise, which
 * leaves the bar sticky at the top. The same measurement `overlayStack` uses
 * for `--kb-inset`: on iOS the page does not shrink for the keyboard, so the
 * hidden strip is the page height minus the visible viewport.
 */
function useKeyboardInset(editing: boolean): number | null {
  const [inset, setInset] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (!editing || !vv || !touch) {
      setInset(null);
      return undefined;
    }
    const sync = () => {
      tallest = Math.max(tallest, window.innerHeight);
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const shrunk = tallest - window.innerHeight;
      setInset(hidden > 120 || shrunk > 120 ? Math.round(hidden) : null);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [editing]);

  return inset;
}
