import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useExcelDB } from '../hooks/useExcelDB';
import { PadKey, applyPadKey, evaluatePad, padValueToRaw, pastedToPad, rawToPad } from '../lib/amountExpr';
import { cx, formatCompactAmount, formatMoney, todayKey } from '../lib/format';
import { getRecentAmounts, recentKey, rememberAmount } from '../lib/numberPad';
import { checkOverdraft } from '../lib/overdraft';
import { toast } from '../lib/toast';
import type { TranslationKey } from '../locales/en';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction, TransactionType, WalletBalance } from '../types';
import { Icon } from './Icon';
import { NumberPadPanel, canPaste, padOptions } from './NumberPad';
import { OverdraftWarningModal } from './OverdraftWarningModal';
import { useOverlay } from './ui';
import { WalletIconRenderer } from './WalletIconRenderer';

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
 *   …or slide onto "Transfer"        → From, then To (never the same wallet)
 *   release on a To wallet           → the keypad opens for the transfer
 *
 * One continuous gesture picks type, wallet and category. The thumb never
 * lifts, nothing is confirmed, and the only thing left to type is the number
 * that actually differs between one coffee and the next.
 *
 * Once the third column is up, the type column folds to its icons on a narrow
 * phone, so From and To (or Wallet and Category) keep room for their names
 * and balances at 320px without the text getting smaller.
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
 *     is also the route to notes and back-dating
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

/** `wallet` is the second column for every type — a transfer's From — and
 *  `category` / `to` the third, which is also where the gesture ends. */
type Step = 'type' | 'wallet' | 'category' | 'to';

/** What the gesture has picked so far. Deeper fields clear when a shallower
 *  one changes — sliding back to "Income" must not keep an expense category. */
interface Draft {
  type?: TransactionType;
  walletId?: string;
  category?: string;
  toWalletId?: string;
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
  /** A category (or a transfer's To) was chosen; only the amount is left. */
  | 'amount';

const TYPE_OPTIONS: { value: TransactionType; label: TranslationKey; icon: typeof ArrowUpRight }[] = [
  { value: 'expense', label: 'quick.expense', icon: ArrowUpRight },
  { value: 'income', label: 'quick.income', icon: ArrowDownLeft },
  { value: 'transfer', label: 'quick.transfer', icon: ArrowLeftRight },
];

const SAVE_LABEL: Record<TransactionType, TranslationKey> = {
  expense: 'quick.saveExpense',
  income: 'quick.saveIncome',
  transfer: 'quick.saveTransfer',
};

const ADDED_LABEL: Record<TransactionType, TranslationKey> = {
  expense: 'quick.addedExpense',
  income: 'quick.addedIncome',
  transfer: 'quick.addedTransfer',
};

/** Money on the pad: two decimals, never negative. */
const PAD_OPTIONS = padOptions('money', false);

function padKeyFor(key: string): PadKey | null {
  if (/^\d$/.test(key)) return key as PadKey;
  if (key === '.' || key === ',') return '.';
  if (key === '+') return '+';
  if (key === '-') return '-';
  if (key === 'Backspace') return 'back';
  return null;
}

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
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();

  /* Write-only, so it must not subscribe: an unscoped `/api/transactions`
     would pull up to 500 rows on every app open for a list nothing renders.
     `create` still patches every cached copy — see the note in AppShell. */
  const transactions = useExcelDB<Transaction>('transactions', undefined, { enabled: false });

  const [phase, setPhase] = useState<Phase>('idle');
  const [draft, setDraft] = useState<Draft>({});
  /** What has been keyed on the pad — "120+45" — not yet the amount. */
  const [expr, setExpr] = useState('');
  const [saving, setSaving] = useState(false);
  /** Held while the overdraft warning asks: the amount it is asking about. */
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);

  const holdTimer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** Set on a pointerup that was a plain tap; the click after it opens the
   *  full form. A click after a hold-and-drag finds it false and does nothing. */
  const tapped = useRef(false);
  /** Mirrors `phase` for the pointer handlers, which run outside React's
   *  render and would otherwise read a stale closure. */
  const phaseRef = useRef<Phase>('idle');
  const setPhaseNow = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  /** The same, for what has been picked. */
  const draftRef = useRef<Draft>({});
  draftRef.current = draft;

  const active = wallets.filter((w) => !w.archived);
  /* The same lists the New transaction form offers: income and expense only
     touch expense-mode wallets; a transfer can leave from any wallet and go
     to any other. */
  const spendable = active.filter((w) => w.mode === 'expense');
  const categories = settings.categories.filter(Boolean);
  const canLog = spendable.length > 0 && categories.length > 0;
  const canTransfer = active.length >= 2;
  const typeOptions = TYPE_OPTIONS.filter((option) => (option.value === 'transfer' ? canTransfer : canLog));
  /** With nothing to pick, the gesture has no job. */
  const gestureUsable = typeOptions.length > 0;

  const open = phase === 'dragging' || phase === 'sticky';
  const showAmount = phase === 'amount';
  const isTransfer = draft.type === 'transfer';
  const sourceWallets = isTransfer ? active : spendable;
  const targetWallets = active.filter((w) => w.id !== draft.walletId);

  const reset = useCallback(() => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    origin.current = null;
    setPhaseNow('idle');
    setDraft({});
    setExpr('');
    setPendingAmount(null);
  }, [setPhaseNow]);

  useEffect(() => () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  }, []);

  /* On the shared overlay stack once the menu or the pad is up, so Back
     closes it like any sheet — and a sheet opened over it (the overdraft
     warning) closes first. */
  const handle = useOverlay(open || showAmount, reset);

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
        return { type: value as TransactionType };
      }
      if (step === 'wallet') {
        if (current.walletId === value) return current;
        pulse();
        return { type: current.type, walletId: value };
      }
      if (step === 'to') {
        /* Never the wallet it leaves from — that column does not list it, and
           this keeps a stale hit from slipping one through. */
        if (current.toWalletId === value || current.walletId === value) return current;
        pulse();
        return { ...current, toWalletId: value };
      }
      if (current.category === value) return current;
      pulse();
      return { ...current, category: value };
    });
  }, []);

  /** The third column is the leaf: choosing ends the gesture and opens the pad. */
  const commit = useCallback(
    (step: 'category' | 'to', value: string) => {
      choose(step, value);
      setExpr('');
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
    tapped.current = false;
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

    /* Released before the hold fired — a plain tap. The full form opens from
       the click that follows, not here: on touch the browser still has a
       compatibility mousedown and click to deliver for this tap, and a sheet
       mounted now would receive them. */
    if (current === 'pressing' || !gestureUsable) {
      reset();
      tapped.current = true;
      return;
    }

    if (current !== 'dragging') return;

    const hit = optionAt(event.clientX, event.clientY);
    if (hit?.step === 'category' || (hit?.step === 'to' && hit.value !== draftRef.current.walletId)) {
      commit(hit.step, hit.value);
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

  const result = evaluatePad(expr, PAD_OPTIONS);
  const parsedAmount = result.value ?? 0;
  const validAmount = !result.error && parsedAmount > 0;
  const complete = Boolean(draft.type && draft.walletId && (isTransfer ? draft.toWalletId : draft.category));

  const sourceWallet = wallets.find((w) => w.id === draft.walletId) ?? null;
  const targetWallet = wallets.find((w) => w.id === draft.toWalletId) ?? null;
  /* The same check, against the same wallet, as the New transaction form: an
     expense or a transfer that takes its source below zero (or a card past
     its limit) asks first. Income never does. */
  const overdraft = checkOverdraft({
    wallet: sourceWallet,
    type: draft.type ?? 'income',
    amount: pendingAmount ?? parsedAmount,
  });

  const recentFor = draft.type ? recentKey(draft.type, draft) : null;
  const recents = useMemo(() => (showAmount ? getRecentAmounts(recentFor) : []), [showAmount, recentFor]);

  const press = useCallback((key: PadKey) => setExpr((current) => applyPadKey(current, key, PAD_OPTIONS)), []);

  function requestSave() {
    if (!validAmount || !complete || saving) return;
    if (overdraft.warn) {
      setPendingAmount(parsedAmount);
      return;
    }
    void save(parsedAmount);
  }

  async function save(value: number) {
    if (!draft.type || !draft.walletId) return;
    const type = draft.type;

    setSaving(true);
    const label =
      type === 'transfer'
        ? `${money(value)} · ${sourceWallet?.name ?? ''} → ${targetWallet?.name ?? ''}`
        : `${money(value)} · ${draft.category}`;

    try {
      /* Optimistic: the row is in the cache before this resolves, so the sheet
         closes immediately. A failure rolls it back out and toasts — the same
         contract the full form works under. The payload has the form's shape
         exactly: a transfer carries its To and no category. */
      await transactions.create({
        walletId: draft.walletId,
        toWalletId: type === 'transfer' ? (draft.toWalletId ?? '') : '',
        type,
        amount: value,
        category: type === 'transfer' ? '' : (draft.category ?? ''),
        note: '',
        date: todayKey(),
      });
      rememberAmount(recentFor, value);
      toast.success(label, t(ADDED_LABEL[type]));
      reset();
    } catch {
      /* useExcelDB toasted it; keep the sheet open so the amount survives. */
      setPendingAmount(null);
    } finally {
      setSaving(false);
    }
  }

  async function paste() {
    try {
      const next = pastedToPad(await navigator.clipboard.readText(), PAD_OPTIONS);
      if (next === null) throw new Error('not a number');
      setExpr(next);
    } catch {
      toast.error(t('pad.pasteFailed'));
    }
  }

  /* Escape closes whatever is open — the one keyboard affordance a pointer
     gesture still owes you — and on the pad a physical keyboard types. Only
     while this is the top overlay, so the warning above it keeps its keys. */
  const requestSaveRef = useRef(requestSave);
  requestSaveRef.current = requestSave;
  useEffect(() => {
    if (phase === 'idle') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (handle && !handle.isTop()) return;
      if (event.key === 'Escape') {
        reset();
        return;
      }
      if (phaseRef.current !== 'amount' || event.ctrlKey || event.metaKey || event.altKey) return;
      const padKey = padKeyFor(event.key);
      if (padKey) {
        event.preventDefault();
        press(padKey);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        requestSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reset, handle, press]);

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  /** The third column is up, so the type column folds to its icons. */
  const typeCompact = Boolean(draft.walletId);

  function walletOption(wallet: WalletBalance, step: 'wallet' | 'to', selected: boolean) {
    const balance = Number(wallet.balance) || 0;
    return (
      <button
        key={wallet.id}
        type="button"
        role="menuitem"
        className={cx('qa-option', 'qa-option--wallet', selected && 'is-active')}
        data-qa-step={step}
        data-qa-value={wallet.id}
        aria-label={t('quick.walletBalance', { name: wallet.name, amount: money(balance) })}
        onClick={() => (step === 'to' ? commit('to', wallet.id) : choose('wallet', wallet.id))}
      >
        <WalletIconRenderer icon={wallet.icon} size="sm" className="qa-emoji" />
        <span className="qa-option-text">
          <span className="qa-option-label">{wallet.name}</span>
          {/* The Wallets page's balance, shortened: 1.2k, -3.4k. */}
          <span className={cx('qa-balance', balance < 0 && 'is-negative')}>
            {formatCompactAmount(money.convert(balance), settings.locale)}
          </span>
        </span>
      </button>
    );
  }

  const typeLabel = TYPE_OPTIONS.find((option) => option.value === draft.type)?.label;

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
            aria-label={t('quick.menuLabel')}
          >
            <div className={cx('qa-column', 'qa-column--type', typeCompact && 'is-compact')} data-qa-column>
              <div className="qa-column-title">{t('quick.colType')}</div>
              {typeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitem"
                  className={cx('qa-option', draft.type === option.value && 'is-active')}
                  data-qa-step="type"
                  data-qa-value={option.value}
                  aria-label={t(option.label)}
                  onClick={() => choose('type', option.value)}
                >
                  <Icon icon={option.icon} size="sm" />
                  <span className="qa-type-label">{t(option.label)}</span>
                </button>
              ))}
            </div>

            {draft.type && (
              <div className="qa-column" data-qa-column>
                <div className="qa-column-title">{t(isTransfer ? 'quick.colFrom' : 'quick.colWallet')}</div>
                {sourceWallets.map((wallet) => walletOption(wallet, 'wallet', draft.walletId === wallet.id))}
              </div>
            )}

            {draft.walletId && isTransfer && (
              <div className="qa-column" data-qa-column>
                <div className="qa-column-title">{t('quick.colTo')}</div>
                {targetWallets.map((wallet) => walletOption(wallet, 'to', draft.toWalletId === wallet.id))}
              </div>
            )}

            {draft.walletId && !isTransfer && (
              <div className="qa-column" data-qa-column>
                <div className="qa-column-title">{t('quick.colCategory')}</div>
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    role="menuitem"
                    className={cx('qa-option', draft.category === category && 'is-active')}
                    data-qa-step="category"
                    data-qa-value={category}
                    onClick={() => commit('category', category)}
                  >
                    <span className="qa-option-label">{category}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- Amount only: the shared number pad, up at once ---- */}
        {showAmount && draft.type && (
          <NumberPadPanel
            role="dialog"
            aria-label={t('quick.enterAmount')}
            className="qa-pad"
            expr={expr}
            result={result}
            options={PAD_OPTIONS}
            kind="money"
            currency={money.base}
            header={
              <div className="qa-path">
                <span
                  className={
                    draft.type === 'income' ? 'text-positive' : draft.type === 'expense' ? 'text-negative' : 'qa-path-transfer'
                  }
                >
                  {typeLabel ? t(typeLabel) : ''}
                </span>
                <span aria-hidden="true">·</span>
                <span className="qa-path-name">{sourceWallet?.name}</span>
                <span aria-hidden="true">{isTransfer ? '→' : '·'}</span>
                <strong className="qa-path-name">{isTransfer ? targetWallet?.name : draft.category}</strong>
              </div>
            }
            footnote={
              money.converting && validAmount
                ? `≈ ${formatMoney(money.convert(parsedAmount), money.display, settings.locale)}`
                : undefined
            }
            chips={recents}
            onChip={(value) => setExpr(rawToPad(padValueToRaw(value, PAD_OPTIONS.decimals), PAD_OPTIONS))}
            onKey={press}
            onPaste={canPaste ? () => void paste() : undefined}
            onClose={reset}
            done={{
              label: saving ? t('quick.saving') : t(SAVE_LABEL[draft.type]),
              disabled: !validAmount || !complete || saving,
              run: requestSave,
            }}
          />
        )}

        {/* ---- The button ---- */}
        <button
          type="button"
          className={cx('qa-fab', phase === 'pressing' && 'is-pressing', open && 'is-armed')}
          aria-label={gestureUsable ? t('quick.fabGesture') : t('quick.fab')}
          aria-expanded={open}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={reset}
          onClick={() => {
            if (!tapped.current) return;
            tapped.current = false;
            onOpenFullForm();
          }}
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

      {/* Over the pad: cancelling returns to it with the amount as keyed. */}
      <OverdraftWarningModal
        open={pendingAmount !== null}
        wallet={sourceWallet}
        amount={pendingAmount ?? parsedAmount}
        check={overdraft}
        busy={saving}
        onConfirm={() => {
          if (pendingAmount !== null) void save(pendingAmount);
        }}
        onCancel={() => setPendingAmount(null)}
      />
    </>
  );
}
