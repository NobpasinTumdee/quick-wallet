/**
 * Buy something on a 0% installment plan.
 *
 * The form's whole job is to make the trade visible before it is committed: one
 * purchase price becomes n monthly charges, the card's balance moves by the
 * full amount today, and this month's spending moves by only the first chunk.
 * That last part is the one people get wrong about installments, so the preview
 * says it in figures rather than leaving it to be discovered next month.
 *
 * 0% is assumed and stated. Modelling an interest-bearing plan would mean
 * storing a rate, an amortisation schedule and a split between principal and
 * interest per chunk, none of which the ledger has anywhere to put — and
 * quietly treating an interest-bearing plan as if it were free is the one
 * outcome worse than not supporting it.
 */

import { FormEvent, useEffect, useMemo, useState } from 'react';

import { CardState } from '../lib/creditMath';
import { formatDate, todayKey } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import {
  Alert,
  Button,
  DecimalInput,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  parseDecimal,
} from './ui';

/** The tenors banks actually offer. Anything else goes through "Other". */
const COMMON_TERMS = [3, 6, 10, 12, 24];
const MAX_MONTHS = 60;

export interface InstallmentPayload {
  amount: number;
  months: number;
  category: string;
  note: string;
  date: string;
}

/** Mirrors the split in Code.gs: the remainder rides on the first chunk. */
function splitChunks(total: number, months: number): { first: number; rest: number } {
  if (months < 1) return { first: total, rest: 0 };
  const rest = Math.floor((total * 100) / months) / 100;
  const remainder = Math.round((total - rest * months) * 100) / 100;
  return { first: Math.round((rest + remainder) * 100) / 100, rest };
}

/** `YYYY-MM-DD` plus n months, clamped — same rule as `addMonths_` server-side. */
function addMonths(dateKey: string, months: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!parts) return dateKey;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])];
  const lastDay = new Date(year, month + months + 1, 0).getDate();
  const date = new Date(year, month + months, Math.min(day, lastDay));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function InstallmentForm({
  open,
  card,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  card: CardState | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: InstallmentPayload) => Promise<void>;
}) {
  const money = useMoneyFormatter();
  const { settings } = useSettings();

  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState(10);
  const [customMonths, setCustomMonths] = useState('');
  const [category, setCategory] = useState('Shopping');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayKey());
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setMonths(10);
    setCustomMonths('');
    setCategory(settings.categories.includes('Shopping') ? 'Shopping' : settings.categories[0] ?? '');
    setNote('');
    setDate(todayKey());
    setLocalError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = parseDecimal(amount);
  const chunks = useMemo(() => splitChunks(total, months), [total, months]);

  /* Six rows is enough to show the pattern and the clamp behaviour without the
     modal turning into a scrolling ledger for a 24-month plan. */
  const preview = useMemo(() => {
    const rows: { index: string; date: string; amount: number }[] = [];
    const shown = Math.min(months, 4);
    for (let i = 0; i < shown; i += 1) {
      rows.push({
        index: `${i + 1}/${months}`,
        date: addMonths(date, i),
        amount: i === 0 ? chunks.first : chunks.rest,
      });
    }
    return rows;
  }, [months, date, chunks]);

  if (!card) return null;

  /* Only meaningful once a limit is set, and only a warning: banks routinely
     approve a plan that would put a card over its everyday limit. */
  const wouldExceed = card.hasLimit && total > card.availableCredit;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!(total > 0)) {
      setLocalError('Enter the full purchase price');
      return;
    }
    if (!(months >= 1 && months <= MAX_MONTHS)) {
      setLocalError(`Choose between 1 and ${MAX_MONTHS} months`);
      return;
    }
    if (!category.trim()) {
      setLocalError('Pick a category — each chunk is an ordinary expense and needs one');
      return;
    }
    setLocalError(null);
    try {
      await onSubmit({ amount: total, months, category, note: note.trim(), date });
    } catch {
      // The parent surfaces the API message via `error`; keep the sheet open.
    }
  }

  return (
    <Modal
      open={open}
      title="0% installment plan"
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Create {months} charge{months === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="span-2">
          <Alert tone="info">
            Charged to <strong>{card.wallet.name}</strong>. Written as {months} dated expenses, so
            each month is billed one chunk while the card shows the whole amount you still owe.
          </Alert>
        </div>

        <Field label="Purchase price" hint="The full price, not the monthly figure.">
          <DecimalInput value={amount} onChange={setAmount} placeholder="0.00" />
        </Field>

        <Field label="First charge">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <div className="span-2">
          <Field label="Term">
            <Segmented<string>
              value={COMMON_TERMS.includes(months) ? String(months) : 'other'}
              onChange={(next) => {
                if (next === 'other') {
                  setCustomMonths(String(months));
                  return;
                }
                setCustomMonths('');
                setMonths(Number(next));
              }}
              ariaLabel="Number of months"
              options={[
                ...COMMON_TERMS.map((term) => ({ value: String(term), label: `${term}m` })),
                { value: 'other', label: 'Other' },
              ]}
            />
          </Field>
          {!COMMON_TERMS.includes(months) || customMonths ? (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Field label="Months" hint={`1 to ${MAX_MONTHS}.`}>
                <Input
                  type="number"
                  min={1}
                  max={MAX_MONTHS}
                  value={customMonths || String(months)}
                  onChange={(e) => {
                    setCustomMonths(e.target.value);
                    const next = Number(e.target.value);
                    if (next >= 1 && next <= MAX_MONTHS) setMonths(Math.round(next));
                  }}
                />
              </Field>
            </div>
          ) : null}
        </div>

        <Field label="Category" hint="Every chunk is filed under this.">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {settings.categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="What is it" hint="Shown on every chunk.">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="iPhone 17 Pro"
            maxLength={300}
          />
        </Field>

        {total > 0 && (
          <div className="span-2 installment-preview">
            <div className="installment-figures">
              <div className="metric metric--accent">
                <span className="section-label">Per month</span>
                <span className="metric-value">{money(chunks.rest)}</span>
                <span className="metric-hint">
                  {chunks.first !== chunks.rest
                    ? `First ${money(chunks.first)} — rounding rides on it`
                    : 'Even split'}
                </span>
              </div>
              <div className="metric">
                <span className="section-label">This month</span>
                <span className="metric-value">{money(chunks.first)}</span>
                <span className="metric-hint">All that hits this month's spending</span>
              </div>
              <div className="metric metric--negative">
                <span className="section-label">Card balance</span>
                <span className="metric-value text-negative">+{money(total)}</span>
                <span className="metric-hint">Owed to the bank from today</span>
              </div>
            </div>

            <ol className="installment-schedule">
              {preview.map((row) => (
                <li key={row.index}>
                  <span className="installment-index">{row.index}</span>
                  <span className="installment-date">{formatDate(row.date, settings.locale)}</span>
                  <span className="installment-amount">{money(row.amount)}</span>
                </li>
              ))}
              {months > preview.length && (
                <li className="installment-more">
                  <span className="installment-index">…</span>
                  <span className="installment-date">
                    {months - preview.length} more, through{' '}
                    {formatDate(addMonths(date, months - 1), settings.locale)}
                  </span>
                  <span className="installment-amount">{money(chunks.rest)}</span>
                </li>
              )}
            </ol>
          </div>
        )}

        {wouldExceed && (
          <div className="span-2">
            <Alert tone="warning" title="Over the limit">
              This is more than the {money(card.availableCredit)} available on {card.wallet.name}.
              Banks often approve a plan anyway — recording it here is fine either way.
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
    </Modal>
  );
}
