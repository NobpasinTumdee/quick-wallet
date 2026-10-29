import {
  Bold,
  Code,
  Heading,
  Italic,
  Link,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  LucideIcon,
  Minus,
  Strikethrough,
  TextQuote,
} from 'lucide-react';
import { CSSProperties, Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { TranslationKey } from '../../locales';
import { Icon } from '../Icon';
import { Portal } from '../ui';

export type FormatAction =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'indent'
  | 'outdent'
  | 'quote'
  | 'divider'
  | 'link';

type Item = { action: FormatAction; icon: LucideIcon; labelKey: TranslationKey; shortcut?: string };

/* Three groups, in the order people reach for them: how text looks, lists,
   then whole blocks. */
const GROUPS: Item[][] = [
  [
    { action: 'heading', icon: Heading, labelKey: 'notes.fmtHeading' },
    { action: 'bold', icon: Bold, labelKey: 'notes.fmtBold', shortcut: 'B' },
    { action: 'italic', icon: Italic, labelKey: 'notes.fmtItalic', shortcut: 'I' },
    { action: 'strike', icon: Strikethrough, labelKey: 'notes.fmtStrike', shortcut: 'Shift+X' },
    { action: 'code', icon: Code, labelKey: 'notes.fmtCode', shortcut: 'E' },
  ],
  [
    { action: 'bullet', icon: List, labelKey: 'notes.fmtBullet' },
    { action: 'ordered', icon: ListOrdered, labelKey: 'notes.fmtNumbered' },
    { action: 'task', icon: ListChecks, labelKey: 'notes.fmtChecklist' },
    { action: 'indent', icon: ListIndentIncrease, labelKey: 'notes.fmtIndent' },
    { action: 'outdent', icon: ListIndentDecrease, labelKey: 'notes.fmtOutdent' },
  ],
  [
    { action: 'quote', icon: TextQuote, labelKey: 'notes.fmtQuote' },
    { action: 'divider', icon: Minus, labelKey: 'notes.fmtDivider' },
    { action: 'link', icon: Link, labelKey: 'notes.fmtLink', shortcut: 'K' },
  ],
];

/** Apple keyboards format with ⌘; Ctrl there is the text-navigation key. */
export const MOD_IS_META = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MOD_IS_META ? '⌘' : 'Ctrl';

/**
 * The formatting buttons above the note body.
 *
 * Every button cancels `mousedown`, which is where a press would take focus
 * from the textarea (and close the phone keyboard), and does its work on
 * `click` — the event a single touch tap is guaranteed to produce — so the
 * selection the action works on is still there when it runs.
 */
export function NoteFormatBar({
  onAction,
  headingLevel,
  editing,
}: {
  onAction: (action: FormatAction) => void;
  /** The caret line's heading level, shown on the H button. */
  headingLevel: number;
  /** The body has focus: on a phone, dock above the keyboard. */
  editing: boolean;
}) {
  const { t } = useTranslation();
  const inset = useKeyboardInset(editing);
  const docked = inset !== null;

  const bar = (
    <div
      className={cx('note-format', docked && 'is-docked')}
      role="toolbar"
      aria-label={t('notes.fmtToolbar')}
      style={docked ? ({ '--note-dock-bottom': `${inset}px` } as CSSProperties) : undefined}
    >
      {GROUPS.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="note-format-sep" aria-hidden="true" />}
          {group.map((item) => {
            const label = t(item.labelKey);
            const title = item.shortcut ? `${label} (${MOD}+${item.shortcut})` : label;
            const isHeading = item.action === 'heading';
            return (
              <button
                key={item.action}
                type="button"
                className={cx('note-format-btn', isHeading && headingLevel > 0 && 'is-active')}
                aria-label={isHeading && headingLevel > 0 ? `${label}: H${headingLevel}` : label}
                title={title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAction(item.action)}
              >
                {isHeading ? (
                  <span className="note-format-h" aria-hidden="true">
                    {headingLevel > 0 ? `H${headingLevel}` : 'H'}
                  </span>
                ) : (
                  <Icon icon={item.icon} size="sm" />
                )}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );

  return (
    /* The slot keeps the bar's height in the page while it is docked, so the
       text under it does not jump when the keyboard opens. Docked, the bar
       goes to <body> like every overlay: a fixed element inside the sticky
       slot would be layered and positioned by the slot, not the screen. */
    <div className="note-format-slot">{docked ? <Portal>{bar}</Portal> : bar}</div>
  );
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
