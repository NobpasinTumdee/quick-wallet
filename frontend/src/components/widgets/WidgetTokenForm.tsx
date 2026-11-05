import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WalletBalance, WidgetScope, WidgetToken, WidgetTokenAction, WidgetTokenPayload } from '../../types';
import { TranslationKey } from '../../locales';
import { Icon } from '../Icon';
import { WalletIconRenderer } from '../WalletIconRenderer';
import { WalletPicker } from '../WalletPicker';
import { Alert, Button, Field, Input, Modal, Segmented, Select } from '../ui';

const ACTIONS: WidgetTokenAction[] = ['expense', 'income', 'transfer'];
export const ACTION_LABEL: Record<WidgetTokenAction, TranslationKey> = {
  expense: 'widgets.actionExpense',
  income: 'widgets.actionIncome',
  transfer: 'widgets.actionTransfer',
};
const MAX_WALLETS = 12;
type Expiry = 'keep' | '0' | '30' | '90' | '365';

/**
 * A list of chosen wallets, in order, with the existing wallet picker to add
 * one more. Used for the wallets a widget shows (ordered) and the wallets a
 * read + write token may add to (order does not matter there).
 */
function WalletList({
  wallets,
  value,
  onChange,
  ordered,
  addLabel,
}: {
  wallets: WalletBalance[];
  value: string[];
  onChange: (next: string[]) => void;
  ordered: boolean;
  addLabel: string;
}) {
  const { t } = useTranslation();
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const chosen = value.filter((id) => byId.has(id));
  const rest = wallets.filter((w) => !chosen.includes(w.id));

  const move = (index: number, delta: number) => {
    const next = chosen.slice();
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  return (
    <div className="widget-wallets">
      {chosen.length > 0 && (
        <ol className="widget-wallet-list">
          {chosen.map((id, index) => {
            const wallet = byId.get(id)!;
            return (
              <li key={id} className="widget-wallet-row">
                <WalletIconRenderer icon={wallet.icon} color={wallet.color} size="sm" />
                <span className="widget-wallet-name">{wallet.name}</span>
                {ordered && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={t('widgets.moveUp', { name: wallet.name })}
                    >
                      <Icon icon={ChevronUp} size="sm" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={index === chosen.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={t('widgets.moveDown', { name: wallet.name })}
                    >
                      <Icon icon={ChevronDown} size="sm" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onChange(chosen.filter((x) => x !== id))}
                  aria-label={t('widgets.removeWallet', { name: wallet.name })}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {rest.length > 0 && chosen.length < MAX_WALLETS && (
        <WalletPicker
          wallets={rest}
          value=""
          placeholder={addLabel}
          label={addLabel}
          onChange={(id) => id && onChange([...chosen, id])}
        />
      )}
    </div>
  );
}

export function WidgetTokenForm({
  open,
  token,
  wallets,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Null to create a new token. */
  token: WidgetToken | null;
  wallets: WalletBalance[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: WidgetTokenPayload) => void;
}) {
  const { t } = useTranslation();
  const editing = token !== null;

  const [name, setName] = useState('');
  const [scope, setScope] = useState<WidgetScope>('read');
  const [walletIds, setWalletIds] = useState<string[]>([]);
  const [writeWalletIds, setWriteWalletIds] = useState<string[]>([]);
  const [actions, setActions] = useState<WidgetTokenAction[]>(['expense', 'income', 'transfer']);
  const [hideAmounts, setHideAmounts] = useState(false);
  const [totalMode, setTotalMode] = useState<'all' | 'selected'>('all');
  const [expiry, setExpiry] = useState<Expiry>('0');
  const [problem, setProblem] = useState<string | null>(null);

  /* Reseeded on every open, from the token being edited or the defaults. */
  useEffect(() => {
    if (!open) return;
    setName(token?.name ?? '');
    setScope(token?.scope ?? 'read');
    setWalletIds(token?.walletIds ?? []);
    setWriteWalletIds(token?.writeWalletIds ?? []);
    setActions(token?.allowedActions.length ? token.allowedActions : ['expense', 'income', 'transfer']);
    setHideAmounts(token?.hideAmounts ?? false);
    setTotalMode(token?.totalMode ?? 'all');
    setExpiry(token ? 'keep' : '0');
    setProblem(null);
  }, [open, token]);

  const writable = scope === 'readwrite';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setProblem(t('widgets.errorName'));
    if (writable && !writeWalletIds.length) return setProblem(t('widgets.errorWriteWallets'));
    if (writable && !actions.length) return setProblem(t('widgets.errorActions'));
    setProblem(null);

    const payload: WidgetTokenPayload = {
      name: name.trim(),
      walletIds,
      hideAmounts,
      totalMode,
    };
    if (!editing) payload.scope = scope;
    if (writable) {
      payload.writeWalletIds = writeWalletIds;
      payload.allowedActions = ACTIONS.filter((a) => actions.includes(a));
    }
    if (expiry !== 'keep') payload.expiresInDays = Number(expiry) as 0 | 30 | 90 | 365;
    onSubmit(payload);
  }

  const shown = problem ?? error;

  return (
    <Modal
      open={open}
      title={editing ? t('widgets.editTitle') : t('widgets.createTitle')}
      onClose={onClose}
      footer={
        <div className="form-actions">
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="widget-token-form" loading={busy}>
            {editing ? t('common.save') : t('widgets.createAction')}
          </Button>
        </div>
      }
    >
      <form id="widget-token-form" className="form-grid" onSubmit={submit} noValidate>
        {shown && <Alert tone="error">{shown}</Alert>}

        <Field label={t('widgets.name')} hint={t('widgets.nameHint')}>
          <Input
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('widgets.namePlaceholder')}
            data-autofocus
          />
        </Field>

        <div className="field">
          <span className="field-label">{t('widgets.scope')}</span>
          {editing ? (
            <p className="field-hint">
              {t(scope === 'readwrite' ? 'widgets.scopeReadWrite' : 'widgets.scopeRead')} ·{' '}
              {t('widgets.scopeFixed')}
            </p>
          ) : (
            <>
              <Segmented<WidgetScope>
                value={scope}
                onChange={setScope}
                ariaLabel={t('widgets.scope')}
                options={[
                  { value: 'read', label: t('widgets.scopeRead') },
                  { value: 'readwrite', label: t('widgets.scopeReadWrite') },
                ]}
              />
              <span className="field-hint">
                {t(scope === 'readwrite' ? 'widgets.scopeReadWriteHint' : 'widgets.scopeReadHint')}
              </span>
            </>
          )}
        </div>

        <div className="field">
          <span className="field-label">{t('widgets.showWallets')}</span>
          <WalletList
            wallets={wallets}
            value={walletIds}
            onChange={setWalletIds}
            ordered
            addLabel={t('widgets.addWallet')}
          />
          <span className="field-hint">{t('widgets.showWalletsHint')}</span>
        </div>

        {writable && (
          <>
            <div className="field">
              <span className="field-label">{t('widgets.writeWallets')}</span>
              <WalletList
                wallets={wallets}
                value={writeWalletIds}
                onChange={setWriteWalletIds}
                ordered={false}
                addLabel={t('widgets.addWallet')}
              />
              <span className="field-hint">{t('widgets.writeWalletsHint')}</span>
            </div>

            <fieldset className="field widget-checks">
              <legend className="field-label">{t('widgets.actions')}</legend>
              {ACTIONS.map((action) => (
                <label key={action} className="widget-check">
                  <input
                    type="checkbox"
                    checked={actions.includes(action)}
                    onChange={(e) =>
                      setActions((prev) =>
                        e.target.checked ? [...prev, action] : prev.filter((a) => a !== action),
                      )
                    }
                  />
                  <span>{t(ACTION_LABEL[action])}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}

        <div className="field">
          <span className="field-label">{t('widgets.totalMode')}</span>
          <Segmented<'all' | 'selected'>
            value={totalMode}
            onChange={setTotalMode}
            ariaLabel={t('widgets.totalMode')}
            options={[
              { value: 'all', label: t('widgets.totalAll') },
              { value: 'selected', label: t('widgets.totalSelected') },
            ]}
          />
          <span className="field-hint">{t('widgets.totalModeHint')}</span>
        </div>

        <label className="widget-check">
          <input type="checkbox" checked={hideAmounts} onChange={(e) => setHideAmounts(e.target.checked)} />
          <span>
            {t('widgets.hideAmounts')}
            <small className="field-hint">{t('widgets.hideAmountsHint')}</small>
          </span>
        </label>

        <Field label={t('widgets.expiry')}>
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)}>
            {editing && <option value="keep">{t('widgets.expiryKeep')}</option>}
            <option value="0">{t('widgets.expiryNever')}</option>
            <option value="30">{t('widgets.expiryDays', { count: 30 })}</option>
            <option value="90">{t('widgets.expiryDays', { count: 90 })}</option>
            <option value="365">{t('widgets.expiryDays', { count: 365 })}</option>
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
