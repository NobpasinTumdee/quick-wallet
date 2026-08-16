import { FormEvent, useEffect, useState } from 'react';

import { useSettings } from '../state/SettingsContext';
import { Wallet, WalletKind, WalletMode } from '../types';
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

const KINDS: { value: WalletKind; label: string; modes: WalletMode[] }[] = [
  { value: 'cash', label: 'Cash', modes: ['expense'] },
  { value: 'bank', label: 'Bank account', modes: ['expense'] },
  { value: 'ewallet', label: 'E-wallet', modes: ['expense'] },
  { value: 'credit', label: 'Credit card', modes: ['expense'] },
  { value: 'brokerage', label: 'Brokerage', modes: ['investment'] },
  { value: 'other', label: 'Other', modes: ['expense', 'investment'] },
];

const ICONS = ['💵', '🏦', '💳', '📱', '📈', '🪙', '🏠', '🎯', '✈️', '🎓'];
const COLORS = ['#3b6fff', '#0f9d6b', '#d98324', '#dc3a56', '#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'];

export interface WalletPayload {
  name: string;
  mode: WalletMode;
  kind: WalletKind;
  currency: string;
  openingBalance: number;
  color: string;
  icon: string;
  note: string;
}

/** `openingBalance` stays a raw string while typing; see DecimalInput. */
type FormState = Omit<WalletPayload, 'openingBalance'> & { openingBalance: string };

function initialState(settingsCurrency: string, wallet?: Wallet): FormState {
  return {
    name: wallet?.name ?? '',
    mode: wallet?.mode ?? 'expense',
    kind: wallet?.kind ?? 'cash',
    currency: wallet?.currency ?? settingsCurrency,
    openingBalance: decimalToInput(wallet?.openingBalance),
    color: wallet?.color ?? COLORS[0],
    icon: wallet?.icon ?? ICONS[0],
    note: wallet?.note ?? '',
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
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  wallet?: Wallet;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: WalletPayload) => Promise<void>;
}) {
  const { settings } = useSettings();
  const [form, setForm] = useState<FormState>(() => initialState(settings.currency, wallet));
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset whenever the sheet opens for a different wallet.
  useEffect(() => {
    if (open) {
      setForm(initialState(settings.currency, wallet));
      setLocalError(null);
    }
  }, [open, wallet, settings.currency]);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setLocalError('Give the wallet a name');
      return;
    }
    setLocalError(null);
    try {
      await onSubmit({
        ...form,
        name: form.name.trim(),
        openingBalance: parseDecimal(form.openingBalance),
      });
    } catch {
      // The parent surfaces the API message via `error`; keep the sheet open.
    }
  }

  const kinds = KINDS.filter((k) => k.modes.includes(form.mode));

  return (
    <Modal
      open={open}
      title={wallet ? `Edit ${wallet.name}` : 'New wallet'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {wallet ? 'Save changes' : 'Create wallet'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="span-2">
          <Field
            label="Wallet mode"
            hint={
              form.mode === 'expense'
                ? 'Tracks income, expenses and transfers.'
                : 'Holds stock positions with live P&L. Fund it with a transfer from a cash wallet.'
            }
          >
            <Segmented<WalletMode>
              value={form.mode}
              onChange={setMode}
              ariaLabel="Wallet mode"
              options={[
                { value: 'expense', label: '💳 Expense / Income' },
                { value: 'investment', label: '📈 Investment' },
              ]}
            />
          </Field>
          {wallet && (
            <p className="field-hint" style={{ marginTop: 4 }}>
              Mode can only change while the wallet has no records.
            </p>
          )}
        </div>

        <Field label="Name">
          <Input
            value={form.name}
            onChange={(e) => patch('name', e.target.value)}
            placeholder={form.mode === 'investment' ? 'Brokerage' : 'Everyday spending'}
            maxLength={60}
            required
          />
        </Field>

        <Field label="Type">
          <Select value={form.kind} onChange={(e) => patch('kind', e.target.value as WalletKind)}>
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Opening balance" hint="What's in it right now. Negative is allowed for credit cards.">
          <DecimalInput
            value={form.openingBalance}
            onChange={(raw) => patch('openingBalance', raw)}
            allowNegative
            placeholder="0.00"
          />
        </Field>

        <Field label="Currency">
          <Input
            value={form.currency}
            onChange={(e) => patch('currency', e.target.value.toUpperCase())}
            maxLength={8}
          />
        </Field>

        <Field label="Icon" className="span-2">
          <div className="swatches">
            {ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                className={`swatch${form.icon === icon ? ' is-active' : ''}`}
                style={{ background: 'var(--surface-2)' }}
                onClick={() => patch('icon', icon)}
                aria-label={`Icon ${icon}`}
              >
                {icon}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Colour" className="span-2">
          <div className="swatches">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch${form.color === color ? ' is-active' : ''}`}
                style={{ background: color }}
                onClick={() => patch('color', color)}
                aria-label={`Colour ${color}`}
              />
            ))}
          </div>
        </Field>

        <Field label="Note" className="span-2">
          <Textarea
            value={form.note}
            onChange={(e) => patch('note', e.target.value)}
            maxLength={300}
            placeholder="Optional"
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
