/**
 * Record a bill somebody else owes a share of.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A FORM
 * ---------------------------------------------------------------------------
 * The first version was one: labelled fields, a row per person, an amount box
 * beside each name. It was complete and it was miserable — splitting a dinner
 * bill is a ten-second act, and ten seconds of form-filling is a minute of
 * dread the next time.
 *
 * So the shape follows the thought instead. You know the number first, so the
 * number is the whole top of the sheet. You know who was there second, so they
 * go in as chips you can rattle off. The split is one choice — equally, or not
 * — and in the common case nobody ever sees an amount input at all, because
 * there is nothing to decide. Everything else is behind "Add details".
 *
 * ---------------------------------------------------------------------------
 * "ME" IS A CHIP, NOT A CHECKBOX
 * ---------------------------------------------------------------------------
 * You were at the dinner. Modelling that as a toggle buried under the split
 * control made it look like a setting; as a chip sitting first in the same row
 * as everyone else, it looks like what it is — a person at the table, who
 * happens to be you. Tap to leave.
 *
 * Your share is never stored. The bill holds *other people's* shares and the
 * server derives `ownShare` as the remainder, so the chip drives the divisor
 * and nothing else. See `lib/splitMath.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHAT "REMAINING" MEANS
 * ---------------------------------------------------------------------------
 * One counter, three readings, because the leftover means different things:
 *
 *   in the split, leftover > 0    that is your share. Fine. Shown as such.
 *   out of it,    leftover > 0    nobody is covering it. A warning.
 *   either way,   leftover < 0    you are collecting more than you spent.
 *                                 The one state that blocks submission.
 */

import { Check, ChevronDown, Plus, Wallet as WalletIcon, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CreateBillSplitInput } from '../hooks/useBillSplitter';
import { cx, todayKey } from '../lib/format';
import {
  SplitDraft,
  SplitMode,
  duplicateNames,
  equalShare,
  summariseSplits,
  toPayload,
} from '../lib/splitMath';
import { useMoneyFormatter } from '../state/SettingsContext';
import { WalletBalance } from '../types';
import { Icon } from './Icon';
import {
  Alert,
  Button,
  DecimalInput,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
  parseDecimal,
} from './ui';

/** Ids only have to be unique within one open sheet, never persisted. */
let seq = 0;
const newPerson = (personName: string): SplitDraft => {
  seq += 1;
  return { id: `p-${seq}`, personName, amount: '' };
};

export function BillSplitterForm({
  open,
  wallets,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Spending wallets only — a bill cannot be paid from a brokerage. */
  wallets: WalletBalance[];
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: CreateBillSplitInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  const [total, setTotal] = useState('');
  const [title, setTitle] = useState('');
  const [walletId, setWalletId] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayKey());
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [mode, setMode] = useState<SplitMode>('equal');
  const [includeSelf, setIncludeSelf] = useState(true);
  /** Other people only. "Me" is `includeSelf`, never a row. */
  const [people, setPeople] = useState<SplitDraft[]>([]);
  const [pending, setPending] = useState('');

  const [localError, setLocalError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  /* Reset per opening, not per render: a background wallet refresh must not
     wipe a half-entered bill. Same rule every other sheet here follows. */
  useEffect(() => {
    if (!open) return;
    setTotal('');
    setTitle('');
    setNote('');
    setDate(todayKey());
    setDetailsOpen(false);
    setMode('equal');
    setIncludeSelf(true);
    setPeople([]);
    setPending('');
    setLocalError(null);
    setWalletId([...wallets].sort((a, b) => b.balance - a.balance)[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalValue = parseDecimal(total);
  const dupes = useMemo(() => duplicateNames(people), [people]);

  /** Heads at the table: everyone named, plus you when you are in. */
  const heads = people.length + (includeSelf ? 1 : 0);
  const evenShare = equalShare(totalValue, people.length, includeSelf);

  /**
   * What each person owes right now.
   *
   * In equal mode this is computed, never stored — there are no amount inputs
   * to hold, which is the point. In custom mode it is whatever was typed.
   */
  const resolved: SplitDraft[] = useMemo(
    () =>
      mode === 'equal'
        ? people.map((p) => ({ ...p, amount: evenShare > 0 ? String(evenShare) : '' }))
        : people,
    [mode, people, evenShare],
  );

  const summary = useMemo(() => summariseSplits(resolved, totalValue), [resolved, totalValue]);

  /* The leftover, and what it means. `ownShare` is already
     `total - sum(shares)`; all that changes is how it should read. */
  const leftover = summary.ownShare;
  const leftoverTone: 'own' | 'unassigned' | 'over' =
    summary.exceedsTotal ? 'over' : includeSelf ? 'own' : leftover > 0.005 ? 'unassigned' : 'own';

  function addPerson() {
    const name = pending.trim();
    if (!name) return;
    setPeople((current) => [...current, newPerson(name)]);
    setPending('');
    // Keep the caret where it was so names can be typed one after another.
    nameInput.current?.focus();
  }

  const removePerson = (id: string) =>
    setPeople((current) => current.filter((p) => p.id !== id));

  const setAmount = (id: string, amount: string) =>
    setPeople((current) => current.map((p) => (p.id === id ? { ...p, amount } : p)));

  /** Everything that must be true before the server is worth asking. */
  function blocker(): string | null {
    if (!(totalValue > 0)) return t('split.needTotal');
    if (!title.trim()) return t('split.billName');
    if (!walletId) return t('split.needWallet');
    if (people.length === 0) return t('split.needPeople');
    if (dupes.length) return t('split.duplicateName', { name: dupes[0] });
    if (summary.exceedsTotal) return t('split.overBy', { amount: money(summary.excess) });
    if (toPayload(resolved).length === 0) return t('split.needPeople');
    if (summary.incompleteCount > 0) {
      return t('split.needAmount', { count: summary.incompleteCount });
    }
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = blocker();
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    try {
      await onSubmit({
        title: title.trim(),
        totalAmount: totalValue,
        walletId,
        note: note.trim(),
        date,
        splits: toPayload(resolved),
      });
    } catch {
      // The parent surfaces the API message via `error`; keep the sheet open.
    }
  }

  const ready = blocker() === null;

  return (
    <Modal
      open={open}
      title={t('split.formTitle')}
      onClose={onClose}
      width={560}
      footer={
        <>
          {/* The counter lives with the submit button, because that is where
              the eye goes when deciding whether it is done. */}
          <span className={cx('split-remaining', `is-${leftoverTone}`)} aria-live="polite">
            {leftoverTone === 'over'
              ? t('split.overBy', { amount: money(summary.excess) })
              : leftoverTone === 'unassigned'
                ? t('split.unassigned', { amount: money(leftover) })
                : leftover > 0.005
                  ? t('split.yourShareIs', { amount: money(leftover) })
                  : t('split.allAssigned')}
          </span>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!ready && !busy}>
            {busy ? t('split.creating') : t('split.createBill')}
          </Button>
        </>
      }
    >
      {wallets.length === 0 ? (
        <Alert tone="warning" title={t('split.needWallet')}>
          {t('activity.createWalletFirst')}
        </Alert>
      ) : (
        <form className="split-sheet" onSubmit={submit}>
          {/* ---- Hero: the number, then what it was ---- */}
          <section className="split-hero-input">
            <DecimalInput
              value={total}
              onChange={setTotal}
              className="split-amount-xl"
              placeholder={t('split.amountPlaceholder')}
              aria-label={t('split.totalPrice')}
              autoFocus
            />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="split-title-input"
              placeholder={t('split.titlePlaceholder')}
              aria-label={t('split.billName')}
              maxLength={120}
            />

            <label className="split-wallet-pill">
              <Icon icon={WalletIcon} size="sm" />
              <Select
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                aria-label={t('split.payFromWallet')}
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.icon} {w.name}
                  </option>
                ))}
              </Select>
              <Icon icon={ChevronDown} size="sm" />
            </label>
          </section>

          {/* ---- Who ---- */}
          <section className="split-section">
            <span className="section-label">{t('split.whoSharing')}</span>

            <div className="split-add-row">
              <Input
                ref={nameInput}
                value={pending}
                onChange={(e) => setPending(e.target.value)}
                onKeyDown={(e) => {
                  // Enter adds the person instead of submitting the sheet —
                  // typing four names should not need four trips to a button.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPerson();
                  }
                }}
                placeholder={t('split.addNamePlaceholder')}
                aria-label={t('split.addNamePlaceholder')}
                maxLength={60}
              />
              <Button size="sm" onClick={addPerson} disabled={!pending.trim()}>
                <Icon icon={Plus} size="sm" />
                {t('split.addName')}
              </Button>
            </div>

            <div className="split-chips">
              {/* You, first, always present. */}
              <button
                type="button"
                className={cx('split-chip', 'is-self', includeSelf && 'is-on')}
                aria-pressed={includeSelf}
                title={t(includeSelf ? 'split.meIncluded' : 'split.meExcluded')}
                onClick={() => setIncludeSelf((v) => !v)}
              >
                <span className="split-chip-mark" aria-hidden="true">
                  {includeSelf ? <Icon icon={Check} size="sm" /> : '+'}
                </span>
                {t('split.me')}
              </button>

              {people.map((person) => {
                const isDupe = dupes.includes(person.personName.trim().toLowerCase());
                return (
                  <span
                    key={person.id}
                    className={cx('split-chip', 'is-on', isDupe && 'is-duplicate')}
                  >
                    <span className="split-chip-mark" aria-hidden="true">
                      {person.personName.charAt(0)}
                    </span>
                    {person.personName}
                    <button
                      type="button"
                      className="split-chip-x"
                      aria-label={t('split.removeChip', { name: person.personName })}
                      onClick={() => removePerson(person.id)}
                    >
                      <Icon icon={X} size="sm" />
                    </button>
                  </span>
                );
              })}
            </div>

            {people.length === 0 && <p className="field-hint">{t('split.nobodyYet')}</p>}
          </section>

          {/* ---- How ---- */}
          {people.length > 0 && (
            <section className="split-section">
              <Segmented<SplitMode>
                value={mode}
                /* Moving to Custom seeds every amount from the equal split, so
                   "everyone the same except Nick" is one edit rather than a
                   blank list to retype. Moving back to Equal leaves them in
                   place — they are ignored while Equal is active, and keeping
                   them means flipping back and forth is not destructive. */
                onChange={(next) => {
                  if (next === 'custom') {
                    setPeople((current) =>
                      current.map((p) => ({
                        ...p,
                        amount: p.amount || (evenShare > 0 ? String(evenShare) : ''),
                      })),
                    );
                  }
                  setMode(next);
                }}
                ariaLabel={t('split.splitMode')}
                options={[
                  { value: 'equal', label: t('split.modeEqual') },
                  { value: 'custom', label: t('split.modeCustom') },
                ]}
              />

              {mode === 'equal' ? (
                <>
                  {evenShare > 0 && (
                    <p className="split-per-person">
                      {t('split.perPerson', { amount: money(evenShare) })}
                      {heads > 0 && ` · ${heads}`}
                    </p>
                  )}
                  {/* No inputs at all: in equal mode there is nothing to decide,
                      so showing a box per person would only invite typing into
                      it and then wondering why it snapped back. */}
                  <ul className="split-tally">
                    {includeSelf && (
                      <li className="split-tally-row is-self">
                        <span>{t('split.me')}</span>
                        <span className="split-tally-amount">{money(leftover)}</span>
                      </li>
                    )}
                    {people.map((person) => (
                      <li key={person.id} className="split-tally-row">
                        <span className="truncate">{person.personName}</span>
                        <span className="split-tally-amount">{money(evenShare)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="split-tally">
                  {includeSelf && (
                    <li className="split-tally-row is-self">
                      <span>{t('split.me')}</span>
                      {/* Derived, and deliberately not editable: your share is
                          whatever is left, so an input here would be a second
                          way to say the same thing that could disagree. */}
                      <span className="split-tally-amount">{money(Math.max(0, leftover))}</span>
                    </li>
                  )}
                  {people.map((person) => (
                    <li key={person.id} className="split-tally-row is-editable">
                      <span className="truncate">{person.personName}</span>
                      <DecimalInput
                        value={person.amount}
                        onChange={(raw) => setAmount(person.id, raw)}
                        className="split-tally-input"
                        placeholder="0.00"
                        aria-label={t('split.tapAmount', { name: person.personName })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ---- Everything else ---- */}
          <button
            type="button"
            className="split-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            <Icon icon={ChevronDown} size="sm" className={cx(detailsOpen && 'is-open')} />
            {t(detailsOpen ? 'split.hideDetails' : 'split.addDetails')}
          </button>

          {detailsOpen && (
            <section className="split-section split-details">
              <Field label={t('common.date')}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={t('common.note')} hint={t('split.noteHint')}>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                  placeholder={t('common.optional')}
                />
              </Field>
            </section>
          )}

          {summary.exceedsTotal && (
            <Alert tone="error" title={t('split.overBy', { amount: money(summary.excess) })}>
              {t('split.exceedsTotalHint')}
            </Alert>
          )}
          {dupes.length > 0 && (
            <Alert tone="warning">{t('split.duplicateName', { name: dupes[0] })}</Alert>
          )}
          {(localError || error) && <Alert tone="error">{localError || error}</Alert>}

          {totalValue > 0 && people.length > 0 && (
            <p className="split-explainer">{t('split.ledgerExplainer', { total: money(totalValue) })}</p>
          )}

          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}
