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
import { Trans, useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
      setLocalError(t('forms.enterPurchasePrice'));
      return;
    }
    if (!(months >= 1 && months <= MAX_MONTHS)) {
      setLocalError(t('forms.chooseTerm', { max: MAX_MONTHS }));
      return;
    }
    if (!category.trim()) {
      setLocalError(t('forms.pickInstallmentCategory'));
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
      title={t('forms.installmentTitle')}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {t('forms.createCharges', { count: months })}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="span-2">
          <Alert tone="info">
            {/* `Trans`, not `t()`: the sentence wraps the card name in <strong>,
                and where that emphasis falls inside the sentence differs by
                language. Splitting it into three concatenated pieces would
                hard-code English word order; `<1>` lets the translator move it. */}
            <Trans
              i18nKey="forms.installmentIntro"
              values={{ name: card.wallet.name, count: months }}
              components={{ 1: <strong /> }}
            />
          </Alert>
        </div>

        <Field label={t('forms.purchasePrice')} hint={t('forms.purchasePriceHint')}>
          <DecimalInput value={amount} onChange={setAmount} placeholder="0.00" />
        </Field>

        <Field label={t('forms.firstCharge')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <div className="span-2">
          <Field label={t('forms.term')}>
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
              ariaLabel={t('forms.numberOfMonths')}
              options={[
                ...COMMON_TERMS.map((term) => ({ value: String(term), label: t('forms.termMonths', { count: term }) })),
                { value: 'other', label: t('forms.termOther') },
              ]}
            />
          </Field>
          {!COMMON_TERMS.includes(months) || customMonths ? (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Field label={t('forms.months')} hint={t('forms.monthsHint', { max: MAX_MONTHS })}>
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

        <Field label={t('common.category')} hint={t('forms.categoryFiledUnder')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {settings.categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('forms.whatIsIt')} hint={t('forms.whatIsItHint')}>
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
                <span className="section-label">{t('forms.perMonth')}</span>
                <span className="metric-value">{money(chunks.rest)}</span>
                <span className="metric-hint">
                  {chunks.first !== chunks.rest
                    ? t('forms.firstChunkNote', { amount: money(chunks.first) })
                    : t('forms.evenSplit')}
                </span>
              </div>
              <div className="metric">
                <span className="section-label">{t('common.thisMonth')}</span>
                <span className="metric-value">{money(chunks.first)}</span>
                <span className="metric-hint">{t('forms.hitsThisMonth')}</span>
              </div>
              <div className="metric metric--negative">
                <span className="section-label">{t('forms.cardBalance')}</span>
                <span className="metric-value text-negative">+{money(total)}</span>
                <span className="metric-hint">{t('forms.owedFromToday')}</span>
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
                    {t('forms.moreThrough', {
                      count: months - preview.length,
                      date: formatDate(addMonths(date, months - 1), settings.locale),
                    })}
                  </span>
                  <span className="installment-amount">{money(chunks.rest)}</span>
                </li>
              )}
            </ol>
          </div>
        )}

        {wouldExceed && (
          <div className="span-2">
            <Alert tone="warning" title={t('forms.overLimitTitle')}>
              {t('forms.overLimitBody', {
                amount: money(card.availableCredit),
                name: card.wallet.name,
              })}
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
