import { ArrowDownLeft, ArrowUpRight, Delete, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useExcelDB } from '../hooks/useExcelDB';
import { cx, formatMoney, todayKey } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction, TransactionType, WalletBalance } from '../types';
import { Icon } from './Icon';

/**
 * Hold-and-drag quick add.
 *
 * ---------------------------------------------------------------------------
 * THE INTERACTION
 * ---------------------------------------------------------------------------
 *   press and hold the + button      → the menu arms
 *   slide onto "Expense"             → the wallet column appears
 *   slide onto a wallet              → the category column appears
 *   release on a category            → the keypad opens, asking only the amount
 *
 * One continuous gesture picks type, wallet and category. The thumb never
 * lifts, nothing is confirmed, and the only thing left to type is the number
 * that actually differs between one coffee and the next.
 *
 * ---------------------------------------------------------------------------
 * WHY POINTER EVENTS, AND WHY CAPTURE
 * ---------------------------------------------------------------------------
 * `onPointerDown/Move/Up` is one code path for touch, pen and mouse — a
 * mouse-down drag behaves identically to a thumb drag, so the desktop story
 * costs nothing extra.
 *
 * The button captures the pointer on press, so every subsequent move and the
 * release are delivered here even though the finger is now over a menu item
 * somewhere else. Hit-testing is then done explicitly with
 * `document.elementFromPoint`, which ignores capture and reports what is
 * genuinely under the finger. The alternative — per-item `onPointerEnter` —
 * does not fire during a captured drag on touch at all, which is exactly the
 * case that matters.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DOES NOT REQUIRE THE GESTURE
 * ---------------------------------------------------------------------------
 * A drag is unusable with a keyboard, a screen reader, or a shaky hand. So:
 *
 *   - a plain tap (released before the hold fires) opens the full form, which
 *     is also the only route to transfers, notes and back-dating
 *   - releasing mid-gesture leaves the menu open and tappable ("sticky"), so a
 *     mistimed release continues rather than starting over
 *   - every option is a real <button> with a click handler
 *
 * The gesture is the fast path, never the only path.
 */

/** How long the button must be held before the menu arms. */
const HOLD_MS = 280;
/** Movement beyond this before the hold fires reads as a scroll, not a hold. */
const SLOP_PX = 12;
/** Auto-scroll a column when the pointer comes this close to its edge. */
const EDGE_PX = 32;

type Step = 'type' | 'wallet' | 'category';

/** What the gesture has picked so far. Deeper fields clear when a shallower
 *  one changes — sliding back to "Income" must not keep an expense category. */
interface Draft {
  type?: Extract<TransactionType, 'expense' | 'income'>;
  walletId?: string;
  category?: string;
}

type Phase =
  /** Nothing open. */
  | 'idle'
  /** Held down, hold timer running — not yet committed to a gesture. */
  | 'pressing'
  /** Menu open, finger still down. */
  | 'dragging'
  /** Menu open, finger lifted without landing on a leaf. Tappable. */
  | 'sticky'
  /** A category was chosen; only the amount is left. */
  | 'amount';

const TYPE_OPTIONS: { value: 'expense' | 'income'; label: string; icon: typeof ArrowUpRight }[] = [
  { value: 'expense', label: 'Expense', icon: ArrowUpRight },
  { value: 'income', label: 'Income', icon: ArrowDownLeft },
];

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

export function QuickTransactionWidget({
  wallets,
  onOpenFullForm,
}: {
  /** Passed in rather than fetched: AppShell already holds this list, and a
   *  second subscription to the same key is a second render path to keep in
   *  step for no gain. */
  wallets: WalletBalance[];
  onOpenFullForm: () => void;
}) {
  const { settings } = useSettings();
  const money = useMoneyFormatter();

  /* Write-only, so it must not subscribe: an unscoped `/api/transactions`
     would pull up to 500 rows on every app open for a list nothing renders.
     `create` still patches every cached copy — see the note in AppShell. */
  const transactions = useExcelDB<Transaction>('transactions', undefined, { enabled: false });

  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<Draft>({});
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const holdTimer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** Mirrors `phase` for the pointer handlers, which run outside React's
   *  render and would otherwise read a stale closure. */
  const phaseRef = useRef<Phase>('idle');
  const setPhaseNow = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const spendable = wallets.filter((w) => w.mode === 'expense' && !w.archived);
  const categories = settings.categories.filter(Boolean);
  /** Without both lists there is nothing to pick, so the gesture has no job. */
  const gestureUsable = spendable.length > 0 && categories.length > 0;

  const open = phase === 'dragging' || phase === 'sticky';

  const reset = useCallback(() => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    origin.current = null;
    setPhaseNow('idle');
    setDraft({});
    setAmount('');
  }, [setPhaseNow]);

  useEffect(() => () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  }, []);

  /* Escape closes whatever is open — the one keyboard affordance a pointer
     gesture still owes you. */
  useEffect(() => {
    if (phase === 'idle') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reset]);

  /** A short tick on each level change. Silent where unsupported. */
  function pulse(): void {
    navigator.vibrate?.(8);
  }

  /**
   * Records a choice and drops anything downstream of it.
   *
   * Shared by the drag (hover) and the sticky menu (click), so both paths
   * behave identically and there is one definition of "what happens when you
   * pick a wallet".
   */
  const choose = useCallback((step: Step, value: string) => {
    setDraft((current) => {
      if (step === 'type') {
        if (current.type === value) return current;
        pulse();
        return { type: value as Draft['type'] };
      }
      if (step === 'wallet') {
        if (current.walletId === value) return current;
        pulse();
        return { type: current.type, walletId: value };
      }
      if (current.category === value) return current;
      pulse();
      return { ...current, category: value };
    });
  }, []);

  /** Category is the leaf: choosing one ends the gesture and opens the keypad. */
  const commit = useCallback(
    (category: string) => {
      choose('category', category);
      setAmount('');
      setPhaseNow('amount');
      navigator.vibrate?.([6, 24, 10]);
    },
    [choose, setPhaseNow],
  );

  /* ------------------------------------------------------------------ */
  /* The gesture                                                         */
  /* ------------------------------------------------------------------ */

  /** What the finger is over right now, or null. */
  function optionAt(x: number, y: number): { step: Step; value: string } | null {
    const element = document.elementFromPoint(x, y);
    const option = element?.closest<HTMLElement>('[data-qa-step]');
    if (!option) return null;
    return { step: option.dataset.qaStep as Step, value: option.dataset.qaValue ?? '' };
  }

  /**
   * Nudges a column when the finger nears its edge.
   *
   * A long category list would otherwise have items the gesture simply cannot
   * reach: the finger is down, so the browser will not scroll, and lifting to
   * scroll ends the gesture.
   */
  function autoScroll(x: number, y: number): void {
    const element = document.elementFromPoint(x, y);
    const column = element?.closest<HTMLElement>('[data-qa-column]');
    if (!column || column.scrollHeight <= column.clientHeight) return;

    const box = column.getBoundingClientRect();
    if (y - box.top < EDGE_PX) column.scrollTop -= 10;
    else if (box.bottom - y < EDGE_PX) column.scrollTop += 10;
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    // A tap still has to work when there is nothing to pick.
    if (!gestureUsable) return;
    if (phaseRef.current === 'amount') return;

    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY };
    setPhaseNow('pressing');

    holdTimer.current = window.setTimeout(() => {
      setPhaseNow('dragging');
      setDraft({});
      pulse();
    }, HOLD_MS);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const current = phaseRef.current;

    if (current === 'pressing') {
      // Moved before the hold fired: the user is scrolling the page, not
      // opening a menu. Stand down rather than hijacking the drag.
      const start = origin.current;
      if (!start) return;
      const travelled = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (travelled > SLOP_PX) reset();
      return;
    }

    if (current !== 'dragging') return;

    autoScroll(event.clientX, event.clientY);
    const hit = optionAt(event.clientX, event.clientY);
    if (hit) choose(hit.step, hit.value);
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;

    const current = phaseRef.current;

    // Released before the hold fired — a plain tap. Full form.
    if (current === 'pressing' || !gestureUsable) {
      reset();
      onOpenFullForm();
      return;
    }

    if (current !== 'dragging') return;

    const hit = optionAt(event.clientX, event.clientY);
    if (hit?.step === 'category') {
      commit(hit.value);
      return;
    }

    // Released somewhere harmless. Keep what was picked and let them finish by
    // tapping — throwing the selection away over a mistimed lift would be the
    // most annoying possible behaviour.
    setPhaseNow('sticky');
  }

  /* ------------------------------------------------------------------ */
  /* Saving                                                              */
  /* ------------------------------------------------------------------ */

  const parsedAmount = Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  function pressKey(key: (typeof KEYPAD)[number]) {
    setAmount((current) => {
      if (key === 'back') return current.slice(0, -1);
      if (key === '.') return current.includes('.') ? current : `${current || '0'}.`;
      // Two decimal places is as fine as money gets here.
      if (current.includes('.') && current.split('.')[1].length >= 2) return current;
      if (current === '0') return key;
      return current + key;
    });
  }

  async function save() {
    if (!validAmount || !draft.type || !draft.walletId || !draft.category) return;

    setSaving(true);
    const label = `${money(parsedAmount)} · ${draft.category}`;

    try {
      /* Optimistic: the row is in the cache before this resolves, so the sheet
         closes immediately. A failure rolls it back out and toasts — the same
         contract the full form works under. */
      await transactions.create({
        walletId: draft.walletId,
        toWalletId: '',
        type: draft.type,
        amount: parsedAmount,
        category: draft.category,
        note: '',
        date: todayKey(),
      });
      toast.success(label, draft.type === 'expense' ? 'Expense added' : 'Income added');
      reset();
    } catch {
      /* useExcelDB toasted it; keep the sheet open so the amount survives. */
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  const walletLabel = spendable.find((w) => w.id === draft.walletId)?.name ?? '';
  const showAmount = phase === 'amount';

  return (
    <>
      {/* One backdrop for both sheets. Only interactive once the finger is up —
          during the drag it must not swallow the hit test. */}
      {(open || showAmount) && (
        <div
          className={cx('qa-backdrop', phase === 'dragging' && 'is-passthrough')}
          onClick={reset}
          aria-hidden="true"
        />
      )}

      <div className={cx('qa', (open || showAmount) && 'is-open')}>
        {/* ---- The cascading menu ---- */}
        {open && (
          <div
            className={cx('qa-menu', phase === 'dragging' && 'is-dragging')}
            role="menu"
            aria-label="Quick add"
          >
            <div className="qa-column" data-qa-column>
              <div className="qa-column-title">Type</div>
              {TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  className={cx('qa-option', draft.type === option.value && 'is-active')}
                  data-qa-step="type"
                  data-qa-value={option.value}
                  onClick={() => choose('type', option.value)}
                >
                  <Icon icon={option.icon} size="sm" />
                  {option.label}
                </button>
              ))}
            </div>

            {draft.type && (
              <div className="qa-column" data-qa-column>
                <div className="qa-column-title">Wallet</div>
                {spendable.map((wallet) => (
                  <button
                    key={wallet.id}
                    type="button"
                    role="menuitem"
                    className={cx('qa-option', draft.walletId === wallet.id && 'is-active')}
                    data-qa-step="wallet"
                    data-qa-value={wallet.id}
                    onClick={() => choose('wallet', wallet.id)}
                  >
                    <span className="qa-emoji" aria-hidden="true">
                      {wallet.icon}
                    </span>
                    <span className="qa-option-label">{wallet.name}</span>
                  </button>
                ))}
              </div>
            )}

            {draft.walletId && (
              <div className="qa-column" data-qa-column>
                <div className="qa-column-title">Category</div>
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    role="menuitem"
                    className={cx('qa-option', draft.category === category && 'is-active')}
                    data-qa-step="category"
                    data-qa-value={category}
                    onClick={() => commit(category)}
                  >
                    <span className="qa-option-label">{category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Amount only ---- */}
        {showAmount && (
          <div className="qa-pad" role="dialog" aria-label="Enter amount">
            <div className="qa-pad-head">
              <div className="qa-path">
                <span className={draft.type === 'income' ? 'text-positive' : 'text-negative'}>
                  {draft.type}
                </span>
                <span aria-hidden="true">·</span>
                <span>{walletLabel}</span>
                <span aria-hidden="true">·</span>
                <strong>{draft.category}</strong>
              </div>
              <button type="button" className="qa-close" onClick={reset} aria-label="Cancel">
                <Icon icon={X} size="sm" />
              </button>
            </div>

            <div className="qa-amount" aria-live="polite">
              <span className="qa-currency">{money.base}</span>
              <span className={cx('qa-amount-value', !amount && 'is-empty')}>{amount || '0'}</span>
            </div>

            {money.converting && validAmount && (
              <div className="qa-amount-converted">
                ≈ {formatMoney(money.convert(parsedAmount), money.display, settings.locale)}
              </div>
            )}

            <div className="qa-keys">
              {KEYPAD.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={cx('qa-key', key === 'back' && 'qa-key--back')}
                  onClick={() => pressKey(key)}
                  aria-label={key === 'back' ? 'Delete last digit' : key}
                >
                  {key === 'back' ? <Icon icon={Delete} size="sm" /> : key}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="qa-save"
              disabled={!validAmount || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : `Save ${draft.type}`}
            </button>
          </div>
        )}

        {/* ---- The button ---- */}
        <button
          type="button"
          className={cx('qa-fab', phase === 'pressing' && 'is-pressing', open && 'is-armed')}
          aria-label={
            gestureUsable
              ? 'Add transaction. Tap for the full form, or hold and drag to pick type, wallet and category.'
              : 'Add transaction'
          }
          aria-expanded={open}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={reset}
          // The browser's own long-press behaviours (text selection, the
          // context menu, scroll-start) all fight this gesture.
          onContextMenu={(event) => event.preventDefault()}
          // Keyboard users get the full form; there is no drag to emulate.
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpenFullForm();
            }
          }}
        >
          <Icon icon={Plus} />
        </button>
      </div>
    </>
  );
}
