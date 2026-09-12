import { FormEvent, useEffect, useMemo, useState } from 'react';

import { formatPeriod } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Budget, BudgetMode, BudgetScope, WalletBalance } from '../types';
import {
  Alert,
  Button,
  DecimalInput,
  Field,
  Modal,
  Segmented,
  Select,
  Textarea,
  decimalToInput,
  parseDecimal,
} from './ui';

export interface BudgetPayload {
  period: string;
  scope: BudgetScope;
  targetId: string;
  mode: BudgetMode;
  value: number;
  baseIncome: number;
  note: string;
}

/** `value` and `baseIncome` stay raw strings while typing; see DecimalInput. */
type FormState = Omit<BudgetPayload, 'value' | 'baseIncome'> & { value: string; baseIncome: string };

function initialState(period: string, budget?: Budget): FormState {
  return {
    period: budget?.period ?? period,
    scope: budget?.scope ?? 'category',
    targetId: budget?.targetId ?? '',
    mode: budget?.mode ?? 'percent',
    value: decimalToInput(budget?.value),
    baseIncome: decimalToInput(budget?.baseIncome),
    note: budget?.note ?? '',
  };
}

/**
 * Configure one budget line for a month.
 *
 * Percent budgets ("Invest 40%") resolve against a base income, which is taken
 * from — in order — this form's override, Settings → monthly income, or the
 * income actually recorded that month. The preview shows exactly what the
 * dashboard will use.
 */
export function BudgetForm({
  open,
  period,
  budget,
  wallets,
  percentAllocated = 0,
  derivedBase = 0,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  period: string;
  budget?: Budget;
  wallets: WalletBalance[];
  /** Percent already committed by other budgets this month, for the guard rail. */
  percentAllocated?: number;
  /** Income the server derived for this month — used when Settings has none. */
  derivedBase?: number;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: BudgetPayload) => Promise<void>;
}) {
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const [form, setForm] = useState<FormState>(() => initialState(period, budget));
  const [localError, setLocalError] = useState<string | null>(null);

  /* Only on open / a different record — see the note in InvestmentForm. */
  useEffect(() => {
    if (open) {
      setForm(initialState(period, budget));
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, period, budget?.id]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const value = parseDecimal(form.value);
  const baseIncome = parseDecimal(form.baseIncome);

  // Same precedence the backend uses: explicit override → Settings → recorded income.
  const base = baseIncome > 0 ? baseIncome : settings.monthlyIncome || derivedBase;
  const resolvedLimit = form.mode === 'percent' ? (base * value) / 100 : value;

  // Only counts *other* budgets, so editing one doesn't double-count itself.
  const otherPercent = useMemo(
    () => Math.max(0, percentAllocated - (budget?.mode === 'percent' ? budget.value : 0)),
    [percentAllocated, budget],
  );
  const overAllocated = form.mode === 'percent' && otherPercent + value > 100;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.scope !== 'global' && !form.targetId.trim()) {
      setLocalError(form.scope === 'category' ? 'Pick a category' : 'Pick a wallet');
      return;
    }
    if (value <= 0) {
      setLocalError('Enter an amount above zero');
      return;
    }
    if (form.mode === 'percent' && value > 100) {
      setLocalError('A percentage budget cannot exceed 100%');
      return;
    }
    setLocalError(null);
    try {
      await onSubmit({ ...form, targetId: form.targetId.trim(), value, baseIncome });
    } catch {
      /* parent shows `error` */
    }
  }

  return (
    <Modal
      open={open}
      title={budget ? 'Edit budget' : `New budget · ${formatPeriod(form.period, settings.locale)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {budget ? 'Save budget' : 'Add budget'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="span-2">
          <Field label="Applies to">
            <Segmented<BudgetScope>
              value={form.scope}
              ariaLabel="Budget scope"
              onChange={(scope) => setForm((prev) => ({ ...prev, scope, targetId: '' }))}
              options={[
                { value: 'category', label: 'Category' },
                { value: 'wallet', label: 'Wallet' },
                { value: 'global', label: 'All spending' },
              ]}
            />
          </Field>
        </div>

        {form.scope === 'category' && (
          <Field label="Category" className="span-2" hint="Manage the list in Settings.">
            <Select value={form.targetId} onChange={(e) => patch('targetId', e.target.value)}>
              <option value="">Select a category…</option>
              {settings.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {form.scope === 'wallet' && (
          <Field label="Wallet" className="span-2">
            <Select value={form.targetId} onChange={(e) => patch('targetId', e.target.value)}>
              <option value="">Select a wallet…</option>
              {wallets
                .filter((w) => w.mode === 'expense')
                .map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.icon} {wallet.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}

        <div className="span-2">
          <Field label="Limit type">
            <Segmented<BudgetMode>
              value={form.mode}
              ariaLabel="Limit type"
              onChange={(mode) => patch('mode', mode)}
              options={[
                { value: 'percent', label: '% of income' },
                { value: 'amount', label: 'Fixed amount' },
              ]}
            />
          </Field>
        </div>

        <Field
          label={form.mode === 'percent' ? 'Percentage' : `Amount (${money.base})`}
          hint={form.mode === 'percent' ? 'e.g. Invest 40, Save 10, Needs 20' : undefined}
        >
          <DecimalInput
            value={form.value}
            onChange={(raw) => patch('value', raw)}
            placeholder={form.mode === 'percent' ? '40' : '0.00'}
            required
          />
        </Field>

        {form.mode === 'percent' && (
          <Field
            label="Base income override"
            hint={
              settings.monthlyIncome > 0
                ? `Blank uses ${money.formatBase(settings.monthlyIncome)} from Settings.`
                : derivedBase > 0
                  ? `Blank uses ${money.formatBase(derivedBase)} recorded this month.`
                  : 'Blank uses the income recorded this month.'
            }
          >
            <DecimalInput
              value={form.baseIncome}
              onChange={(raw) => patch('baseIncome', raw)}
              placeholder="Auto"
            />
          </Field>
        )}

        <Field label="Note" className="span-2">
          <Textarea value={form.note} onChange={(e) => patch('note', e.target.value)} maxLength={300} />
        </Field>

        <div className="span-2">
          <Alert tone={overAllocated ? 'warning' : 'info'} title="This month's limit">
            {form.mode === 'percent' ? (
              base > 0 ? (
                <>
                  {value}% of {money.formatBase(base)} = <strong>{money.formatBase(resolvedLimit)}</strong>
                  {money.converting && <> ({money(resolvedLimit)})</>}
                  {overAllocated && ` · ${otherPercent + value}% of income allocated in total`}
                </>
              ) : (
                <>
                  No base income yet — the limit will be {value}% of whatever income you record this month.
                  Set a monthly income in Settings for a fixed target.
                </>
              )
            ) : (
              <>
                <strong>{money.formatBase(value)}</strong>
                {money.converting && <> ({money(value)})</>}
              </>
            )}
          </Alert>
        </div>

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
