/**
 * Record a bill somebody else owes a share of.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FORM IS ACTUALLY FOR
 * ---------------------------------------------------------------------------
 * The arithmetic is trivial; the misunderstanding is not. People expect
 * "split ฿1,200 three ways" to record ฿400 leaving their wallet, and are
 * startled when the whole ฿1,200 goes out. So the running summary at the
 * bottom states all three numbers at once — what they owe, what you cover,
 * what leaves now — and `ledgerExplainer` says in words why the full amount is
 * expensed. Getting that across before the write is cheaper than explaining it
 * afterwards to someone who thinks their balance is wrong.
 *
 * ---------------------------------------------------------------------------
 * WHY UNDERSHOOTING IS NOT AN ERROR
 * ---------------------------------------------------------------------------
 * The shares are *other people's* shares. They are supposed to add up to less
 * than the bill, because you were at the dinner too — the difference is your
 * own share. Only overshooting is blocked, because collecting more than you
 * spent is the one thing that cannot be true. See `lib/splitMath.ts`.
 */

import { Plus, Trash2, Users } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  SplitDraft,
  SplitMode,
  duplicateNames,
  splitEqually,
  summariseSplits,
  toPayload,
} from '../lib/splitMath';
import { todayKey } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';
import { WalletBalance } from '../types';
import { CreateBillSplitInput } from '../hooks/useBillSplitter';
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
  Toggle,
  parseDecimal,
} from './ui';

/** Ids only have to be unique within one open form, never persisted. */
let rowSeq = 0;
function newRow(): SplitDraft {
  rowSeq += 1;
  return { id: `row-${rowSeq}`, personName: '', amount: '' };
}

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

  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [walletId, setWalletId] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayKey());
  const [mode, setMode] = useState<SplitMode>('equal');
  const [includeSelf, setIncludeSelf] = useState(true);
  const [rows, setRows] = useState<SplitDraft[]>([newRow()]);
  const [localError, setLocalError] = useState<string | null>(null);

  /* Reset per opening, not per render: a background wallet refresh must not
     wipe a half-typed bill. Same rule every other form here follows. */
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setTotal('');
    setNote('');
    setDate(todayKey());
    setMode('equal');
    setIncludeSelf(true);
    setRows([newRow()]);
    setLocalError(null);
    // Biggest balance first — the account that could actually cover a group
    // bill is the one it was most likely paid from.
    setWalletId([...wallets].sort((a, b) => b.balance - a.balance)[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalValue = parseDecimal(total);
  const summary = useMemo(() => summariseSplits(rows, totalValue), [rows, totalValue]);
  const dupes = useMemo(() => duplicateNames(rows), [rows]);

  /**
   * Re-divides whenever anything the division depends on changes.
   *
   * Runs on the row *count* rather than the rows themselves, so typing a name
   * does not re-run the split and clobber an amount the user is mid-edit. In
   * custom mode it never runs at all — that is the whole point of the mode.
   */
  useEffect(() => {
    if (!open || mode !== 'equal') return;
    setRows((current) => splitEqually(current, parseDecimal(total), includeSelf));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, includeSelf, total, rows.length]);

  const patchRow = (id: string, patch: Partial<SplitDraft>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addRow = () => setRows((current) => [...current, newRow()]);

  const removeRow = (id: string) =>
    // Never drop to zero rows: an empty list gives the user nothing to type
    // into and no obvious way back.
    setRows((current) => (current.length <= 1 ? [newRow()] : current.filter((r) => r.id !== id)));

  const wallet = wallets.find((w) => w.id === walletId);
  const namedCount = rows.filter((r) => r.personName.trim()).length;

  /** Everything that must be true before the server is worth asking. */
  const blocker = (): string | null => {
    if (!title.trim()) return t('split.billName');
    if (!(totalValue > 0)) return t('split.needTotal');
    if (!walletId) return t('split.needWallet');
    if (dupes.length) return t('split.duplicateName', { name: dupes[0] });
    if (summary.exceedsTotal) return t('split.exceedsTotal', { amount: money(summary.excess) });
    if (toPayload(rows).length === 0) return t('split.needPeople');
    if (summary.incompleteCount > 0) {
      return t('split.needAmount', { count: summary.incompleteCount });
    }
    return null;
  };

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
        splits: toPayload(rows),
      });
    } catch {
      // The parent surfaces the API message via `error`; keep the sheet open.
    }
  }

  return (
    <Modal
      open={open}
      title={t('split.formTitle')}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
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
        <form className="form-grid" onSubmit={submit}>
          <Field label={t('split.billName')} hint={t('split.billNameHint')} className="span-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('split.billNamePlaceholder')}
              maxLength={120}
              autoFocus
            />
          </Field>

          <Field label={t('split.totalPrice')} hint={t('split.totalPriceHint')}>
            <DecimalInput value={total} onChange={setTotal} placeholder="0.00" />
          </Field>

          <Field label={t('common.date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label={t('split.payFromWallet')} hint={t('split.payFromWalletHint')} className="span-2">
            <Select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {t('forms.walletOption', {
                    icon: w.icon,
                    name: w.name,
                    amount: money(w.balance),
                  })}
                </option>
              ))}
            </Select>
          </Field>

          {/* ---- The split engine ---- */}
          <div className="span-2 split-engine">
            <header className="split-engine-head">
              <span className="section-label">
                <Icon icon={Users} size="sm" /> {t('split.whoOwes')}
              </span>
              <Segmented<SplitMode>
                value={mode}
                onChange={setMode}
                ariaLabel={t('split.splitMode')}
                options={[
                  { value: 'equal', label: t('split.modeEqual') },
                  { value: 'custom', label: t('split.modeCustom') },
                ]}
              />
            </header>

            {mode === 'equal' && (
              <Toggle
                checked={includeSelf}
                onChange={setIncludeSelf}
                label={t('split.includeSelf')}
                hint={t('split.includeSelfHint', {
                  total: money(totalValue),
                  count: namedCount || rows.length,
                })}
              />
            )}

            <ul className="split-rows">
              {rows.map((row) => {
                const isDupe =
                  row.personName.trim().length > 0 &&
                  dupes.includes(row.personName.trim().toLowerCase());
                return (
                  <li key={row.id} className={cxRow(isDupe)}>
                    <Input
                      value={row.personName}
                      onChange={(e) => patchRow(row.id, { personName: e.target.value })}
                      placeholder={t('split.personNamePlaceholder')}
                      aria-label={t('split.personName')}
                      maxLength={60}
                    />
                    <DecimalInput
                      value={row.amount}
                      onChange={(raw) => {
                        // Typing an amount is an explicit override, so it flips
                        // the mode rather than being silently overwritten on
                        // the next equal-split pass.
                        if (mode === 'equal') setMode('custom');
                        patchRow(row.id, { amount: raw });
                      }}
                      placeholder="0.00"
                      aria-label={t('split.shareAmount')}
                      className="split-amount"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="split-remove"
                      aria-label={
                        row.personName.trim()
                          ? t('split.removePerson', { name: row.personName.trim() })
                          : t('split.removeRow')
                      }
                      onClick={() => removeRow(row.id)}
                    >
                      <Icon icon={Trash2} size="sm" />
                    </Button>
                  </li>
                );
              })}
            </ul>

            <Button size="sm" onClick={addRow} className="split-add">
              <Icon icon={Plus} size="sm" />
              {t('split.addPerson')}
            </Button>

            {/* ---- Running summary: all three numbers, always visible ---- */}
            <div className="split-summary">
              <div className="metric">
                <span className="section-label">{t('split.owedLabel')}</span>
                <span className="metric-value">{money(summary.owedTotal)}</span>
                {mode === 'equal' && summary.owedTotal > 0 && namedCount > 0 && (
                  <span className="metric-hint">
                    {t('split.eachOwes', { amount: money(summary.owedTotal / rows.length) })}
                  </span>
                )}
              </div>
              <div className={metricTone(summary.ownShare)}>
                <span className="section-label">{t('split.youCoverLabel')}</span>
                <span className="metric-value">{money(Math.max(0, summary.ownShare))}</span>
              </div>
              <div className="metric metric--negative">
                <span className="section-label">{t('split.leavesNowLabel')}</span>
                <span className="metric-value text-negative">{money(totalValue)}</span>
              </div>
            </div>

            {summary.exceedsTotal && (
              <Alert tone="error" title={t('split.exceedsTotal', { amount: money(summary.excess) })}>
                {t('split.exceedsTotalHint')}
              </Alert>
            )}
            {dupes.length > 0 && (
              <Alert tone="warning">{t('split.duplicateName', { name: dupes[0] })}</Alert>
            )}
          </div>

          <Field label={t('common.note')} hint={t('split.noteHint')} className="span-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder={t('common.optional')}
            />
          </Field>

          {totalValue > 0 && (
            <div className="span-2">
              <Alert tone="info">
                {t('split.ledgerExplainer', { total: money(totalValue) })}
                {wallet && ` · ${t('split.paidFrom', { wallet: wallet.name })}`}
              </Alert>
            </div>
          )}

          {(localError || error) && (
            <div className="span-2">
              <Alert tone="error">{localError || error}</Alert>
            </div>
          )}

          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Modal>
  );

  /* Local helpers — kept below the return so the JSX reads first. */
  function cxRow(isDupe: boolean): string {
    return isDupe ? 'split-row is-duplicate' : 'split-row';
  }
  function metricTone(ownShare: number): string {
    return ownShare < 0 ? 'metric metric--negative' : 'metric metric--accent';
  }
}

export type { CreateBillSplitInput };
