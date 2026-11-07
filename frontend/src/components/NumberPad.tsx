import { ClipboardPaste, Delete, X } from 'lucide-react';
import {
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  MONEY_MAX,
  PadKey,
  PadOptions,
  PadResult,
  applyPadKey,
  evaluatePad,
  formatPadText,
  padValueToRaw,
  pastedToPad,
  rawToPad,
} from '../lib/amountExpr';
import { cx, formatMoney, formatNumber } from '../lib/format';
import { toast } from '../lib/toast';
import { useSettings } from '../state/SettingsContext';
import { Icon } from './Icon';
import { Portal, useOverlay } from './ui';
import { scrollIntoViewMotion } from '../lib/motion';

/**
 * The in-app number pad: what amount fields open on a phone instead of the
 * system keyboard.
 *
 * `NumberPadPanel` is the pad itself — display, recent-amount chips and
 * keys — and is also embedded as-is in the drag shortcut's amount step.
 * `AmountPadField` is what DecimalInput renders on a touch phone: a field
 * that looks like the input it replaces but is a button, so tapping it can
 * never raise the system keyboard (an `<input inputmode="none">` still shows
 * iOS's form bar and scrolls the page as if a keyboard were coming), and a
 * pad that opens as a bottom panel on the overlay stack, so Back and Escape
 * close it before the sheet it sits over.
 */

export type PadKind = 'money' | 'number';

const KEY_ROWS: PadKey[][] = [
  ['1', '2', '3', 'back'],
  ['4', '5', '6', '-'],
  ['7', '8', '9', '+'],
  ['00', '0', '.'],
];

/** Hold Backspace this long to clear everything. */
const CLEAR_HOLD_MS = 450;

export function padOptions(kind: PadKind, allowNegative: boolean, decimals?: number): PadOptions {
  return {
    decimals: decimals ?? (kind === 'money' ? 2 : 8),
    allowNegative,
    max: kind === 'money' ? MONEY_MAX : 1e12,
  };
}

function vibrate(): void {
  try {
    navigator.vibrate?.(6);
  } catch {
    /* Not supported here; the pad works the same without it. */
  }
}

export type DoneAction = { label: string; disabled: boolean; run: () => void };

export function NumberPadPanel({
  expr,
  result,
  options,
  kind,
  currency,
  header,
  chips,
  done,
  onKey,
  onChip,
  onPaste,
  onClose,
  footnote,
  className,
  ...rest
}: {
  expr: string;
  result: PadResult;
  options: PadOptions;
  kind: PadKind;
  currency: string;
  /** The field's name, or the drag shortcut's "Expense · Wallet · Category". */
  header: ReactNode;
  chips?: number[];
  done: DoneAction;
  onKey: (key: PadKey) => void;
  onChip?: (amount: number) => void;
  /** Present where the field cannot be long-pressed for the system paste. */
  onPaste?: () => void;
  onClose?: () => void;
  /** Under the result: a conversion, say. */
  footnote?: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'onPaste'>) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const locale = settings.locale;

  const format = (value: number) =>
    kind === 'money' ? formatMoney(value, currency, locale) : formatNumber(value, options.decimals, locale);

  const errorText = result.error
    ? t(result.error === 'negative' ? 'pad.errorNegative' : result.error === 'tooLarge' ? 'pad.errorTooLarge' : 'pad.errorInvalid')
    : null;

  /* Long-press on Backspace clears: a timer from the press, and the click
     that ends a long press is swallowed so it does not delete once more. */
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  const startHold = () => {
    held.current = false;
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      onKey('clear');
      try {
        navigator.vibrate?.([10, 30, 10]);
      } catch {
        /* no haptics */
      }
    }, CLEAR_HOLD_MS);
  };
  const endHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => endHold, []);

  function keyLabel(key: PadKey): string {
    if (key === 'back') return t('pad.keyBackspace');
    if (key === '+') return t('pad.keyPlus');
    if (key === '-') return t('pad.keyMinus');
    if (key === '.') return t('pad.keyPoint');
    return key;
  }

  return (
    <div {...rest} className={cx('numpad', className)}>
      <div className="numpad-head">
        <div className="numpad-title">{header}</div>
        {onPaste && (
          <button type="button" className="numpad-icon-btn" onClick={onPaste} aria-label={t('pad.paste')} title={t('pad.paste')}>
            <Icon icon={ClipboardPaste} size="sm" />
          </button>
        )}
        {onClose && (
          <button type="button" className="numpad-icon-btn" onClick={onClose} aria-label={t('pad.close')} title={t('pad.close')}>
            <Icon icon={X} size="sm" />
          </button>
        )}
      </div>

      <div className="numpad-display">
        <div className={cx('numpad-expr', !expr && 'is-empty')}>
          <span className="numpad-currency">{kind === 'money' ? currency : ''}</span>
          <span className="numpad-expr-text">{expr ? formatPadText(expr, locale) : '0'}</span>
        </div>
        <div className={cx('numpad-result', errorText && 'is-error')}>
          {errorText ?? (result.isSum && result.value !== null ? t('pad.result', { value: format(result.value) }) : ' ')}
        </div>
        {footnote && <div className="numpad-footnote">{footnote}</div>}
        {/* What a screen reader hears after each key: the value, or the problem. */}
        <span className="sr-only" aria-live="polite">
          {errorText ?? (result.value !== null ? format(result.value) : t('pad.emptyValue'))}
        </span>
      </div>

      {chips && chips.length > 0 && onChip && (
        <div className="numpad-chips" role="group" aria-label={t('pad.recent')}>
          {chips.map((amount) => (
            <button
              key={amount}
              type="button"
              className="numpad-chip"
              aria-label={t('pad.useAmount', { amount: format(amount) })}
              onClick={() => {
                vibrate();
                onChip(amount);
              }}
            >
              {formatNumber(amount, options.decimals, locale)}
            </button>
          ))}
        </div>
      )}

      <div className="numpad-keys">
        {KEY_ROWS.flat().map((key) => {
          const disabled =
            (key === '.' && options.decimals <= 0) ||
            (key === '-' && !expr && !options.allowNegative);
          return (
            <button
              key={key}
              type="button"
              className={cx('numpad-key', /[+\-]|back/.test(key) && 'is-op')}
              aria-label={keyLabel(key)}
              disabled={disabled}
              onClick={() => {
                if (key === 'back' && held.current) {
                  held.current = false;
                  return;
                }
                vibrate();
                onKey(key);
              }}
              {...(key === 'back'
                ? { onPointerDown: startHold, onPointerUp: endHold, onPointerLeave: endHold, onPointerCancel: endHold, onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault() }
                : {})}
            >
              {key === 'back' ? <Icon icon={Delete} size="md" /> : key === '-' ? '−' : key}
            </button>
          );
        })}
        <button
          type="button"
          className="numpad-key numpad-done"
          disabled={done.disabled}
          onClick={() => {
            vibrate();
            done.run();
          }}
        >
          {done.label}
        </button>
      </div>
    </div>
  );
}

/* ---- The field ---- */

/**
 * Where "Next" goes after this field: the first control in the same form that
 * still needs filling, or null. An amount field counts as unfilled when it
 * is required and empty.
 */
function nextNeeded(form: HTMLFormElement, self: HTMLElement): HTMLElement | null {
  const candidates = form.querySelectorAll<HTMLElement>(':invalid, [data-pad-required-empty]');
  for (const element of candidates) {
    if (element === self || element.tagName === 'FORM' || element.tagName === 'FIELDSET') continue;
    if (element.closest('[hidden]')) continue;
    return element;
  }
  return null;
}

/** Focus a control the way a tap would: an amount field opens its pad. */
function goTo(element: HTMLElement): void {
  const target = element.matches('[data-wallet-picker-value]')
    ? element.closest('.wallet-picker')?.querySelector<HTMLElement>('.wallet-picker-btn') ?? element
    : element;
  scrollIntoViewMotion(target, { block: 'center' });
  if (target.matches('[data-amount-display]')) target.click();
  else target.focus();
}

/* Reading the clipboard needs a secure page and a browser that allows it. */
export const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

export function AmountPadField({
  value,
  onChange,
  allowNegative,
  kind,
  decimals,
  recents,
  placeholder,
  disabled,
  required,
  className,
  id,
  ...aria
}: {
  value: string;
  onChange: (raw: string) => void;
  allowNegative: boolean;
  kind: PadKind;
  decimals?: number;
  recents?: number[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const options = padOptions(kind, allowNegative, decimals);
  const currency = settings.currency || 'USD';

  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState('');
  const displayRef = useRef<HTMLButtonElement>(null);
  const padRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const handle = useOverlay(open, close);

  const result = evaluatePad(expr, options);

  function openPad() {
    if (disabled) return;
    setExpr(rawToPad(value, options));
    setOpen(true);
  }

  /** Every change goes straight to the form as the plain result — or as
   *  empty while the sum is not a valid amount, so the form's own checks
   *  stop a save of a figure the pad is showing as wrong. */
  const emit = useCallback(
    (next: string) => {
      setExpr(next);
      const evaluated = evaluatePad(next, options);
      onChange(evaluated.error || evaluated.value === null ? '' : padValueToRaw(evaluated.value, options.decimals));
    },
    // options is rebuilt each render from these three
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange, kind, allowNegative, decimals],
  );

  const press = (key: PadKey) => emit(applyPadKey(expr, key, options));

  /* The panel's height is room the sheet underneath gives up, so the field
     and its Save button stay above the pad; then the field is brought into
     view in what is left. */
  useLayoutEffect(() => {
    const pad = padRef.current;
    if (!open || !pad) return undefined;
    const root = document.documentElement;
    const sync = () => root.style.setProperty('--keypad-inset', `${pad.offsetHeight}px`);
    sync();
    root.classList.add('has-keypad');
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    observer?.observe(pad);
    const reveal = window.setTimeout(() => scrollIntoViewMotion(displayRef.current, { block: 'center' }), 60);
    return () => {
      observer?.disconnect();
      window.clearTimeout(reveal);
      root.style.removeProperty('--keypad-inset');
      root.classList.remove('has-keypad');
    };
  }, [open]);

  /* Another field taking focus — Note, a name — closes the pad, and that
     field's own keyboard takes over. */
  useEffect(() => {
    if (!open) return undefined;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target || padRef.current?.contains(target) || displayRef.current?.contains(target)) return;
      setOpen(false);
    };
    /* Escape with nothing focused (iOS does not focus a tapped button): the
       pad closes when it is the top overlay, and only the pad. */
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !handle?.isTop()) return;
      event.preventDefault();
      setOpen(false);
    };
    /* A tap anywhere else — another amount field, the sheet's Save — closes
       it too; iOS does not move focus for a tapped button, so focusin alone
       would miss it. On click rather than pointerdown, so the sheet only
       grows back after the click has landed on what was tapped. */
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || padRef.current?.contains(target) || displayRef.current?.contains(target)) return;
      if (!handle?.isTop()) return;
      setOpen(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('click', onClickOutside, true);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('click', onClickOutside, true);
      window.removeEventListener('keydown', onEscape);
    };
  }, [open, handle]);

  /* A physical keyboard still types into the field. */
  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    let padKey: PadKey | null = null;
    if (/^\d$/.test(key)) padKey = key as PadKey;
    else if (key === '.' || key === ',') padKey = '.';
    else if (key === '+') padKey = '+';
    else if (key === '-' || key === '−') padKey = '-';
    else if (key === 'Backspace') padKey = 'back';
    else if (key === 'Delete') padKey = 'clear';
    if (padKey) {
      event.preventDefault();
      const base = open ? expr : rawToPad(value, options);
      if (!open && !disabled) setOpen(true);
      emit(applyPadKey(base, padKey, options));
      return;
    }
    /* Enter on a focused key presses that key; anywhere else it is Done. */
    const onPadButton = (event.target as HTMLElement).closest?.('.numpad button');
    if (key === 'Enter' && open && !onPadButton) {
      event.preventDefault();
      if (!doneAction.disabled) doneAction.run();
    } else if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      const next = pastedToPad(text, options);
      if (next !== null) emit(next);
      else throw new Error('not a number');
    } catch {
      /* Denied, empty, or not a number. */
      toast.error(t('pad.pasteFailed'));
    }
  }

  /* ---- The last key: Save, Next or Done ---- */
  const form = displayRef.current?.closest('form') ?? null;
  const needed = open && form && displayRef.current ? nextNeeded(form, displayRef.current) : null;
  const canSubmit = Boolean(form?.querySelector('button[type="submit"], input[type="submit"]'));
  const selfMissing = Boolean(required) && result.value === null;
  const doneAction: DoneAction = result.error
    ? { label: t('pad.done'), disabled: true, run: () => undefined }
    : needed
      ? {
          label: t('pad.next'),
          disabled: false,
          run: () => {
            setOpen(false);
            window.setTimeout(() => goTo(needed), 0);
          },
        }
      : form && canSubmit && !selfMissing
        ? {
            label: t('pad.save'),
            disabled: false,
            run: () => {
              setOpen(false);
              window.setTimeout(() => form.requestSubmit(), 0);
            },
          }
        : { label: t('pad.done'), disabled: false, run: close };

  const fieldLabel =
    aria['aria-label'] ??
    displayRef.current?.closest('label')?.querySelector('.field-label')?.textContent ??
    t('pad.amount');

  const shown = value ? formatPadText(rawToPad(value, options), settings.locale) : '';

  return (
    <>
      <button
        ref={displayRef}
        id={id}
        type="button"
        className={cx('control', 'control--numeric', 'amount-display', open && 'is-editing', !shown && 'is-placeholder', className)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        data-amount-display=""
        data-pad-required-empty={required && !value ? '' : undefined}
        onClick={() => (open ? undefined : openPad())}
        onKeyDown={onKeyDown}
      >
        {shown || placeholder || ' '}
      </button>

      {open && (
        <Portal>
          {/* Above the sheet it was opened from: one step up the same scale. */}
          <div
            ref={padRef}
            className="numpad-sheet"
            role="dialog"
            aria-label={fieldLabel}
            style={{ zIndex: `calc(var(--z-sheet) + ${handle?.depth ?? 0} + 1)` } as CSSProperties}
            onKeyDown={onKeyDown}
          >
            <NumberPadPanel
              expr={expr}
              result={result}
              options={options}
              kind={kind}
              currency={currency}
              header={fieldLabel}
              chips={recents}
              onChip={(amount) => emit(rawToPad(padValueToRaw(amount, options.decimals), options))}
              done={doneAction}
              onKey={press}
              onPaste={canPaste ? () => void paste() : undefined}
              onClose={close}
            />
          </div>
        </Portal>
      )}
    </>
  );
}

