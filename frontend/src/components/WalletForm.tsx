import { FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ordinal } from '../lib/format';
import { TranslationKey } from '../locales';
import { useSettings } from '../state/SettingsContext';
import { Wallet, WalletKind, WalletMode, WalletType } from '../types';
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
  decimalToInput,
  parseDecimal,
} from './ui';

/* `labelKey` rather than `label`: this array is built once at import time, so a
   translated string here would freeze in whatever language was active then. */
const KINDS: { value: WalletKind; labelKey: TranslationKey; modes: WalletMode[] }[] = [
  { value: 'cash', labelKey: 'forms.kindCash', modes: ['expense'] },
  { value: 'bank', labelKey: 'forms.kindBank', modes: ['expense'] },
  { value: 'ewallet', labelKey: 'forms.kindEwallet', modes: ['expense'] },
  { value: 'credit', labelKey: 'forms.kindCredit', modes: ['expense'] },
  { value: 'brokerage', labelKey: 'forms.kindBrokerage', modes: ['investment'] },
  { value: 'other', labelKey: 'forms.kindOther', modes: ['expense', 'investment'] },
];

const ICONS = ['💵', '🏦', '💳', '📱', '📈', '🪙', '🏠', '🎯', '✈️', '🎓'];
const COLORS = ['#3b6fff', '#0f9d6b', '#d98324', '#dc3a56', '#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'];

export interface WalletPayload {
  name: string;
  mode: WalletMode;
  kind: WalletKind;
  /** Derived from `kind`, never picked separately — see the note below. */
  type: WalletType;
  currency: string;
  openingBalance: number;
  color: string;
  icon: string;
  note: string;
  creditLimit: number;
  statementDate: number;
  dueDate: number;
  cashbackRate: number;
}

/**
 * Numeric fields stay raw strings while typing; see DecimalInput.
 *
 * `type` is absent on purpose: it is a function of `kind`, and offering both
 * would be two controls for one decision, with the obvious failure mode of a
 * wallet whose kind says "Credit card" and whose type says CASH. Code.gs
 * applies the same rule from the other side, so neither client nor server can
 * write a row where the two disagree.
 */
type FormState = Omit<
  WalletPayload,
  'openingBalance' | 'type' | 'creditLimit' | 'statementDate' | 'dueDate' | 'cashbackRate'
> & {
  openingBalance: string;
  /** For a card this is the debt, entered positive. See `submit`. */
  creditLimit: string;
  statementDate: string;
  dueDate: string;
  cashbackRate: string;
};

/** Day-of-month selects only ever offer 1-31. */
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function initialState(
  settingsCurrency: string,
  wallet?: Wallet,
  defaultKind: WalletKind = 'cash',
): FormState {
  const isCredit = wallet ? wallet.kind === 'credit' || wallet.type === 'CREDIT' : defaultKind === 'credit';

  return {
    name: wallet?.name ?? '',
    mode: wallet?.mode ?? 'expense',
    kind: wallet?.kind ?? defaultKind,
    currency: wallet?.currency ?? settingsCurrency,
    /* A card's opening balance is stored negative, like every other debt in the
       ledger, but is edited as a positive "already owed" figure. Nobody thinks
       of their card as minus five thousand baht. The flip happens here and in
       `submit`, and nowhere else. */
    openingBalance: isCredit
      ? decimalToInput(Math.max(0, -(wallet?.openingBalance ?? 0)))
      : decimalToInput(wallet?.openingBalance),
    color: wallet?.color ?? COLORS[0],
    icon: wallet?.icon ?? (defaultKind === 'credit' ? '💳' : ICONS[0]),
    note: wallet?.note ?? '',
    // 0 means unset, and an empty field says that far better than a literal 0.
    creditLimit: wallet?.creditLimit ? decimalToInput(wallet.creditLimit) : '',
    statementDate: wallet?.statementDate ? String(wallet.statementDate) : '',
    dueDate: wallet?.dueDate ? String(wallet.dueDate) : '',
    cashbackRate: wallet?.cashbackRate ? String(wallet.cashbackRate) : '',
  };
}

/**
 * Create / edit a wallet. `mode` is the important field: expense wallets track
 * income & spending, investment wallets hold stock positions. It's locked once
 * the wallet has records, which the backend also enforces.
 */
export function WalletForm({
  open,
  wallet,
  defaultKind = 'cash',
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  wallet?: Wallet;
  /**
   * What a *new* wallet starts as. Ignored when editing, where the row decides.
   *
   * Exists so "New card" on the Cards page opens a card rather than a cash
   * wallet the user has to convert — the button already said what it meant, and
   * making them repeat it in a dropdown is the kind of small friction that
   * makes a feature feel bolted on.
   */
  defaultKind?: WalletKind;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: WalletPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [form, setForm] = useState<FormState>(() =>
    initialState(settings.currency, wallet, defaultKind),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  /* Reset when the sheet opens for a different wallet — not when the cached
     wallet object is rebuilt by a background refresh mid-edit. */
  const currencyRef = useRef(settings.currency);
  currencyRef.current = settings.currency;

  useEffect(() => {
    if (open) {
      setForm(initialState(currencyRef.current, wallet, defaultKind));
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wallet?.id, defaultKind]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function setMode(mode: WalletMode) {
    const kindAllowed = KINDS.find((k) => k.value === form.kind)?.modes.includes(mode);
    setForm((prev) => ({
      ...prev,
      mode,
      kind: kindAllowed ? prev.kind : mode === 'investment' ? 'brokerage' : 'cash',
      icon: prev.icon === '📈' || prev.icon === '💵' ? (mode === 'investment' ? '📈' : '💵') : prev.icon,
    }));
  }

  const isCredit = form.mode === 'expense' && form.kind === 'credit';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setLocalError(t('forms.walletNameRequired'));
      return;
    }

    const owed = parseDecimal(form.openingBalance);
    const limit = parseDecimal(form.creditLimit);

    /* Caught here rather than left to the server because it is a mistake about
       what the fields mean, not a validation failure — a limit lower than the
       balance is legal on a real card, but entering a limit of 5,000 and a
       balance of 50,000 is almost always the two fields the wrong way round. */
    if (isCredit && limit > 0 && owed > limit * 10) {
      setLocalError(
        t('forms.limitLooksSwapped'),
      );
      return;
    }

    setLocalError(null);
    try {
      await onSubmit({
        ...form,
        name: form.name.trim(),
        type: isCredit ? 'CREDIT' : 'CASH',
        // Back to the ledger's sign convention: debt is negative.
        openingBalance: isCredit ? -owed : owed,
        creditLimit: isCredit ? limit : 0,
        statementDate: isCredit ? Number(form.statementDate) || 0 : 0,
        dueDate: isCredit ? Number(form.dueDate) || 0 : 0,
        cashbackRate: isCredit ? parseDecimal(form.cashbackRate) : 0,
      });
    } catch {
      // The parent surfaces the API message via `error`; keep the sheet open.
    }
  }

  const kinds = KINDS.filter((k) => k.modes.includes(form.mode));

  return (
    <Modal
      open={open}
      title={wallet ? t('forms.editWallet', { name: wallet.name }) : t('forms.newWallet')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {wallet ? t('common.saveChanges') : t('forms.createWallet')}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="span-2">
          <Field
            label={t('forms.walletModeLabel')}
            hint={
              form.mode === 'expense'
                ? t('forms.walletModeExpenseHint')
                : t('forms.walletModeInvestmentHint')
            }
          >
            <Segmented<WalletMode>
              value={form.mode}
              onChange={setMode}
              ariaLabel={t('forms.walletModeLabel')}
              options={[
                { value: 'expense', label: t('forms.walletModeExpense') },
                { value: 'investment', label: t('forms.walletModeInvestment') },
              ]}
            />
          </Field>
          {wallet && (
            <p className="field-hint" style={{ marginTop: 4 }}>
              {t('forms.walletModeLocked')}
            </p>
          )}
        </div>

        <Field label={t('common.name')}>
          <Input
            value={form.name}
            onChange={(e) => patch('name', e.target.value)}
            placeholder={t(form.mode === 'investment' ? 'forms.walletNamePlaceholderInvestment' : 'forms.walletNamePlaceholderExpense')}
            maxLength={60}
            required
          />
        </Field>

        <Field
          label={t('common.type')}
          hint={isCredit ? t('forms.creditKindHint') : undefined}
        >
          <Select
            value={form.kind}
            onChange={(e) => {
              const kind = e.target.value as WalletKind;
              setForm((prev) => ({
                ...prev,
                kind,
                // The card icon is the obvious default for a card, but only
                // when the user has not chosen something themselves.
                icon: kind === 'credit' && prev.icon === ICONS[0] ? '💳' : prev.icon,
              }));
            }}
          >
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {t(kind.labelKey)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t(isCredit ? 'forms.balanceOwed' : 'forms.openingBalance')}
          hint={t(isCredit ? 'forms.balanceOwedHint' : 'forms.openingBalanceHint')}
        >
          <DecimalInput
            value={form.openingBalance}
            onChange={(raw) => patch('openingBalance', raw)}
            /* A card's debt is entered positive and negated on submit, so a
               minus sign here would mean the opposite of what the label says. */
            allowNegative={!isCredit}
            placeholder="0.00"
          />
        </Field>

        {isCredit && (
          <>
            <div className="span-2 form-section-head">
              <span className="section-label">{t('forms.billingCycle')}</span>
              <p className="field-hint">
                {t('forms.billingCycleHint')}
              </p>
            </div>

            <Field label={t('forms.creditLimit')} hint={t('forms.creditLimitHint')}>
              <DecimalInput
                value={form.creditLimit}
                onChange={(raw) => patch('creditLimit', raw)}
                placeholder="0.00"
              />
            </Field>

            <Field label={t('forms.cashbackRate')} hint={t('forms.cashbackRateHint')}>
              <DecimalInput
                value={form.cashbackRate}
                onChange={(raw) => patch('cashbackRate', raw)}
                placeholder="0"
              />
            </Field>

            <Field label={t('forms.statementCloses')} hint={t('forms.statementClosesHint')}>
              <Select
                value={form.statementDate}
                onChange={(e) => patch('statementDate', e.target.value)}
              >
                <option value="">{t('common.notSet')}</option>
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {ordinal(day)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('forms.paymentDue')} hint={t('forms.paymentDueHint')}>
              <Select value={form.dueDate} onChange={(e) => patch('dueDate', e.target.value)}>
                <option value="">{t('common.notSet')}</option>
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {ordinal(day)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <Field label={t('settings.currency')}>
          <Input
            value={form.currency}
            onChange={(e) => patch('currency', e.target.value.toUpperCase())}
            maxLength={8}
          />
        </Field>

        <Field label={t('forms.icon')} className="span-2">
          <div className="swatches">
            {ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                className={`swatch${form.icon === icon ? ' is-active' : ''}`}
                style={{ background: 'var(--surface-2)' }}
                onClick={() => patch('icon', icon)}
                aria-label={t('forms.iconNamed', { icon })}
              >
                {icon}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('forms.colour')} className="span-2">
          <div className="swatches">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${form.color === color ? ' is-active' : ''}`}
                style={{ background: color }}
                onClick={() => patch('color', color)}
                aria-label={t('forms.colourNamed', { colour: color })}
              />
            ))}
          </div>
        </Field>

        <Field label={t('common.note')} className="span-2">
          <Textarea
            value={form.note}
            onChange={(e) => patch('note', e.target.value)}
            maxLength={300}
            placeholder={t('common.optional')}
          />
        </Field>

        {(localError || error) && (
          <div className="span-2">
            <Alert tone="error">{localError || error}</Alert>
          </div>
        )}

        {/* Lets Enter submit the form even though the real buttons are in the footer. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
