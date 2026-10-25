import { FileText, RefreshCw, X } from 'lucide-react';
import {
  ButtonHTMLAttributes,
  CSSProperties,
  forwardRef,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cx } from '../lib/format';
import { OverlayHandle, pushOverlay, updateOverlayClose } from '../lib/overlayStack';
import { Icon } from './Icon';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={cx(padded ? 'card-body' : 'card-body card-body--flush')}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  icon?: ReactNode;
}) {
  return (
    <div className={cx('stat', `stat--${tone}`)}>
      <div className="stat-label">
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('field', className)}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/**
 * `forwardRef` so a caller can keep focus where it wants it — the bill splitter
 * refocuses the name box after each chip is added, so four names are four
 * keystrokes rather than four round trips to the mouse.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input {...props} ref={ref} className={cx('control', props.className)} />;
  },
);

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('control', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('control', 'control--area', props.className)} />;
}

/**
 * Free-form decimal entry.
 *
 * `<input type="number">` is the wrong tool here: the browser blanks `.value`
 * while a number is half-typed ("0." or "1.2e"), and a `step` attribute makes
 * anything with more decimal places than the step fail validation. Both make
 * long decimals — fractional shares, 8-decimal crypto, satang — impossible to
 * type. So this keeps the user's raw text as-is and only parses it on submit.
 */
export function DecimalInput({
  value,
  onChange,
  allowNegative = false,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** The raw string the user typed. */
  value: string;
  onChange: (raw: string) => void;
  allowNegative?: boolean;
}) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      className={cx('control', 'control--numeric', className)}
      onChange={(event) => {
        let next = event.target.value;
        // Accept a comma as the decimal separator — many keyboards default to it.
        next = next.replace(/,/g, '.');
        // Keep digits, at most one dot, and a single leading minus.
        next = allowNegative ? next.replace(/[^0-9.-]/g, '') : next.replace(/[^0-9.]/g, '');
        const negative = allowNegative && next.startsWith('-');
        next = next.replace(/-/g, '');
        const firstDot = next.indexOf('.');
        if (firstDot !== -1) {
          next = next.slice(0, firstDot + 1) + next.slice(firstDot + 1).replace(/\./g, '');
        }
        onChange(negative ? `-${next}` : next);
      }}
    />
  );
}

/** Parse what DecimalInput produced. Half-typed values read as 0. */
export function parseDecimal(raw: string): number {
  const parsed = Number(String(raw).trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Number → string for prefilling a DecimalInput, without trailing ".0". */
export function decimalToInput(value: number | undefined | null): string {
  if (value === undefined || value === null || value === 0) return '';
  if (!Number.isFinite(value)) return '';
  return String(value);
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx('segmented-item', value === option.value && 'is-active')}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  percent,
  tone = 'ok',
  label,
}: {
  percent: number;
  tone?: 'ok' | 'warning' | 'over';
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div
      className={cx('progress', `progress--${tone}`)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      title={label}
    >
      <div className="progress-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'accent';
}) {
  return <span className={cx('badge', `badge--${tone}`)}>{children}</span>;
}

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={cx('alert', `alert--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="alert-body">
        {title && <strong>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
      {onDismiss && (
        <button type="button" className="alert-close" onClick={onDismiss} aria-label="Dismiss">
          <Icon icon={X} size="sm" />
        </button>
      )}
    </div>
  );
}

/**
 * Manual refresh, used in every page header and in the topbar.
 *
 * Icon-only on purpose: it sits beside labelled actions ("New wallet", "Show
 * archived") and a second word there would compete with them. The glyph spins
 * while a fetch is in flight, so the button doubles as the progress indicator
 * instead of needing a separate one.
 *
 * `onRefresh` is awaited, so the spin lasts exactly as long as the request.
 */
export function RefreshButton({
  onRefresh,
  busy = false,
  label = 'Refresh',
  size = 'sm',
}: {
  onRefresh: () => void | Promise<unknown>;
  /** Also spin for refreshes this button did not start (polling, focus). */
  busy?: boolean;
  label?: string;
  size?: 'sm' | 'md';
}) {
  const [running, setRunning] = useState(false);
  const spinning = running || busy;

  async function run() {
    if (running) return;
    setRunning(true);
    try {
      await onRefresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button
      size={size}
      variant="ghost"
      onClick={() => void run()}
      disabled={running}
      aria-label={label}
      title={label}
    >
      <Icon icon={RefreshCw} size="sm" className={spinning ? 'icon-spin' : undefined} />
    </Button>
  );
}

export function EmptyState({
  icon = <Icon icon={FileText} size="xl" />,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

/**
 * Renders straight into `<body>`.
 *
 * Every overlay goes through here because `position: fixed` is only fixed to
 * the screen while no ancestor has a `transform`, `filter`, `backdrop-filter`,
 * `will-change` or `contain`. The glass panels have `backdrop-filter`, and
 * every direct child of `.page` runs a transform animation on entry — so a
 * sheet rendered inside either was positioned against the card, clipped by
 * its `overflow: hidden`, and stacked inside its z-index context, under the
 * tab bar. Outside the tree, none of that can reach it.
 */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Registers an open overlay on the shared stack for as long as `open` holds.
 *
 * The close handler is kept in a ref so callers can pass an inline arrow
 * without re-registering — which used to re-run the Escape listener and the
 * scroll lock on every render.
 */
export function useOverlay(open: boolean, onClose: () => void): OverlayHandle | null {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [handle, setHandle] = useState<OverlayHandle | null>(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const next = pushOverlay(() => closeRef.current());
    setHandle(next);
    return () => {
      next.release();
      setHandle(null);
    };
  }, [open]);

  useEffect(() => {
    if (handle) updateOverlayClose(handle.id, () => closeRef.current());
  }, [handle]);

  return handle;
}

/** Inputs scrolled into view above the on-screen keyboard. */
function revealFocusedField(event: FocusEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target || !target.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (!window.matchMedia?.('(max-width: 767px)').matches) return;
  /* After the keyboard has finished opening, which is when the visual
     viewport has its final size. */
  window.setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  const handle = useOverlay(open, onClose);

  /* Focus in on open, back to whatever opened it on close. */
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const wanted = dialog.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      (wanted ?? dialog).focus({ preventScroll: true });
    }
    dialog?.addEventListener('focusin', revealFocusedField);
    return () => {
      dialog?.removeEventListener('focusin', revealFocusedField);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    /* Only the top overlay answers: Escape on a confirm opened from a sheet
       closes the confirm, not both. */
    if (!handle?.isTop()) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    /* Keep Tab inside the dialog — the page behind it is inert. */
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => item.offsetParent !== null,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const depth = handle?.depth ?? 0;

  return (
    <Portal>
      <div
        className={cx('modal-backdrop', depth > 0 && 'is-stacked')}
        style={{ zIndex: `calc(var(--z-sheet) + ${depth})` } as CSSProperties}
        /* Closes only on a press that both started and ended on the backdrop.
           A tap that *opened* the sheet (on pointerup) is followed on touch by
           the browser's compatibility mousedown/click at the same spot — which
           now lands on this backdrop and used to close the sheet at once. That
           tap's pointerdown happened before the backdrop existed, so it never
           counts. It also stops a text selection dragged out of the sheet from
           closing it. */
        onPointerDown={(e) => {
          pressedBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
          pressedBackdrop.current = false;
        }}
        onKeyDown={onKeyDown}
      >
        <div
          ref={dialogRef}
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          style={{ maxWidth: width }}
        >
          <header className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>
              ×
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      </div>
    </Portal>
  );
}

/**
 * A small explanation behind a tap, for the "≈" marks and anything like them.
 *
 * Not a `title` attribute: a phone has no hover, so a `title` is a tooltip
 * nobody can open there. This is a button that toggles a popover rendered in
 * a portal and placed against the screen edges — above the trigger when there
 * is room, below when there is not, shifted sideways so it never runs off
 * either edge, and never wider than the screen minus a margin.
 */
export function InfoTip({
  label,
  text,
  className,
}: {
  /** What the trigger shows, e.g. "≈". */
  label: ReactNode;
  /** The explanation, also the trigger's accessible name. */
  text: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean; arrow: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const margin = 8;
    const gap = 6;
    const anchor = trigger.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const viewW = document.documentElement.clientWidth;
    const viewH = window.visualViewport?.height ?? window.innerHeight;
    const roomAbove = anchor.top - margin;
    /* Flip below when it does not fit above and there is more room below. */
    const below = roomAbove < box.height + gap && viewH - anchor.bottom > roomAbove;
    const top = below ? anchor.bottom + gap : anchor.top - gap - box.height;
    const centre = anchor.left + anchor.width / 2;
    /* Shift sideways to stay inside both edges. */
    const left = Math.min(Math.max(margin, centre - box.width / 2), viewW - margin - box.width);
    setPlace({
      left,
      top: Math.max(margin, top),
      below,
      arrow: Math.min(Math.max(12, centre - left), box.width - 12),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        /* Captured first, so Escape closes the tip and not the sheet under it. */
        event.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    /* A popover pinned to a spot that has scrolled away is worse than none. */
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cx('info-tip', className)}
        aria-label={text}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={(event) => {
          /* Inside a clickable row or card, a tap here is only about the tip. */
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {label}
      </button>
      {open && (
        <Portal>
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={cx('info-tip-pop', place?.below && 'is-below')}
            style={
              {
                left: place?.left ?? 0,
                top: place?.top ?? 0,
                visibility: place ? 'visible' : 'hidden',
                '--arrow-x': `${place?.arrow ?? 12}px`,
              } as CSSProperties
            }
          >
            {text}
          </div>
        </Portal>
      )}
    </>
  );
}
