import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type EditResult,
  type Favourite,
  type FavouriteColor,
  type FavouriteDraft,
  type FavouriteType,
  FAV_COLORS,
  FAV_EMOJI_MAX,
  FAV_GROUP_MAX,
  FAV_NAME_MAX,
  FAV_NOTE_MAX,
  MAX_FAVOURITES,
} from '../../lib/favourites';
import { cx } from '../../lib/format';
import type { TranslationKey } from '../../locales/en';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import type { WalletBalance } from '../../types';
import { ConfirmDialog } from '../ConfirmDialog';
import { Alert, Button, DecimalInput, Field, Input, Modal, Segmented, Select, decimalToInput, parseDecimal } from '../ui';
import { WalletPicker } from '../WalletPicker';

const EMOJI_IDEAS = ['☕', '🍜', '🚇', '🛒', '⛽', '💡', '🏠', '💰', '🎁', '🐶'];
export const COLOR_LABEL: Record<FavouriteColor, TranslationKey> = {
  accent: 'favourites.colorAccent',
  positive: 'favourites.colorPositive',
  negative: 'favourites.colorNegative',
  warning: 'favourites.colorWarning',
  neutral: 'favourites.colorNeutral',
};

type FormState = Omit<FavouriteDraft, 'amount'> & { amount: string };

function initial(target: Favourite | FavouriteDraft | undefined, wallets: WalletBalance[]): FormState {
  const firstSpendable = wallets.find((w) => w.mode === 'expense')?.id ?? '';
  return {
    id: target?.id,
    name: target?.name ?? '',
    emoji: target?.emoji ?? '',
    color: target?.color ?? 'accent',
    type: target?.type ?? 'expense',
    walletId: target?.walletId || firstSpendable,
    toWalletId: target?.toWalletId ?? '',
    category: target?.category ?? '',
    note: target?.note ?? '',
    amount: decimalToInput(target?.amount ?? undefined),
    ask: target?.ask ?? false,
    hideAmount: target?.hideAmount ?? false,
    group: target?.group ?? '',
  };
}

/**
 * Add or edit one favourite. A target with an id is an edit; one without is
 * a new favourite filled in from a transaction ("Make favourite", "Save as
 * favourite"); none is a blank one. The amount is optional: without it, a
 * tap opens the number pad.
 */
export function FavouriteEditor({
  target,
  wallets,
  groups,
  count,
  onSave,
  onDelete,
  onClose,
}: {
  target?: Favourite | FavouriteDraft;
  wallets: WalletBalance[];
  groups: string[];
  count: number;
  onSave: (draft: FavouriteDraft) => EditResult;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const groupListId = useId();
  const [form, setForm] = useState<FormState>(() => initial(target, wallets));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = Boolean(target?.id);

  useEffect(() => setError(null), [form]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  /* The same lists the New transaction form offers. */
  const sourceOptions = form.type === 'transfer' ? wallets : wallets.filter((w) => w.mode === 'expense');
  const targetOptions = wallets.filter((w) => w.id !== form.walletId);

  function setType(type: FavouriteType) {
    setForm((prev) => {
      const stillValid = type === 'transfer' || wallets.find((w) => w.id === prev.walletId)?.mode === 'expense';
      return {
        ...prev,
        type,
        walletId: stillValid ? prev.walletId : (wallets.find((w) => w.mode === 'expense')?.id ?? prev.walletId),
        toWalletId: type === 'transfer' ? prev.toWalletId : '',
      };
    });
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!form.name.trim()) return setError(t('favourites.needName'));
    if (!form.walletId) return setError(t('forms.pickWallet'));
    if (form.type === 'transfer' && !form.toWalletId) return setError(t('forms.pickDestination'));
    if (form.type !== 'transfer' && !form.category) return setError(t('forms.pickCategory'));
    const raw = form.amount.trim();
    const amount = raw ? parseDecimal(raw) : null;
    if (raw && !(amount !== null && amount > 0)) return setError(t('forms.amountPositive'));
    const result = onSave({ ...form, name: form.name.trim(), amount });
    if (!result.ok) {
      return setError(result.reason === 'full' ? t('favourites.full', { max: MAX_FAVOURITES }) : t('favourites.saveFailed'));
    }
    onClose();
  }

  const full = !editing && count >= MAX_FAVOURITES;

  return (
    <>
      <Modal
        open
        title={editing ? t('favourites.editTitle') : t('favourites.newTitle')}
        onClose={onClose}
        footer={
          <>
            {editing && (
              <Button variant="ghost" className="fav-editor-delete" onClick={() => setConfirmDelete(true)}>
                {t('common.delete')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => submit()} disabled={full}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form className="form-grid fav-editor" onSubmit={submit}>
          {full && (
            <div className="span-2">
              <Alert tone="warning">{t('favourites.full', { max: MAX_FAVOURITES })}</Alert>
            </div>
          )}

          <div className="span-2">
            <Segmented<FavouriteType>
              value={form.type}
              ariaLabel={t('forms.transactionType')}
              onChange={setType}
              options={[
                { value: 'expense', label: `↓ ${t('forms.typeExpense')}` },
                { value: 'income', label: `↑ ${t('forms.typeIncome')}` },
                { value: 'transfer', label: `⇄ ${t('forms.typeTransfer')}` },
              ]}
            />
          </div>

          <Field label={t('favourites.name')}>
            <Input
              value={form.name}
              maxLength={FAV_NAME_MAX}
              onChange={(e) => patch('name', e.target.value)}
              placeholder={t('favourites.namePlaceholder')}
              data-autofocus
              required
            />
          </Field>

          <Field label={t('favourites.icon')} hint={t('favourites.iconHint')}>
            <Input
              value={form.emoji}
              maxLength={FAV_EMOJI_MAX}
              onChange={(e) => patch('emoji', [...e.target.value].slice(-2).join(''))}
              placeholder="☕"
              aria-describedby={undefined}
            />
          </Field>

          <div className="span-2 fav-emoji-ideas" role="group" aria-label={t('favourites.iconIdeas')}>
            {EMOJI_IDEAS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={cx('fav-emoji-idea', form.emoji === emoji && 'is-active')}
                aria-pressed={form.emoji === emoji}
                onClick={() => patch('emoji', emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>

          <fieldset className="span-2 fav-colors">
            <legend className="field-label">{t('favourites.color')}</legend>
            {FAV_COLORS.map((color) => (
              <label key={color} className={cx('fav-color', `fav-c-${color}`, form.color === color && 'is-active')}>
                <input
                  type="radio"
                  name="fav-color"
                  value={color}
                  checked={form.color === color}
                  onChange={() => patch('color', color)}
                />
                <span className="fav-color-dot" aria-hidden="true" />
                <span>{t(COLOR_LABEL[color])}</span>
              </label>
            ))}
          </fieldset>

          <Field label={form.type === 'transfer' ? t('forms.fromWallet') : t('common.wallet')}>
            <WalletPicker
              wallets={sourceOptions}
              value={form.walletId}
              onChange={(id) => setForm((prev) => ({ ...prev, walletId: id, toWalletId: prev.toWalletId === id ? '' : prev.toWalletId }))}
              placeholder={t('forms.noEligibleWallet')}
              required
            />
          </Field>

          {form.type === 'transfer' ? (
            <Field label={t('forms.toWallet')}>
              <WalletPicker
                wallets={targetOptions}
                value={form.toWalletId}
                onChange={(id) => patch('toWalletId', id)}
                placeholder={t('forms.selectPlaceholder')}
                required
              />
            </Field>
          ) : (
            <Field label={t('common.category')}>
              <Select value={form.category} onChange={(e) => patch('category', e.target.value)} required>
                <option value="">{t('forms.selectPlaceholder')}</option>
                {[...new Set([...settings.categories, ...(form.category ? [form.category] : [])])].map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label={t('favourites.amount', { currency: money.base })} hint={t('favourites.amountHint')}>
            <DecimalInput value={form.amount} onChange={(raw) => patch('amount', raw)} placeholder={t('common.optional')} />
          </Field>

          <Field label={t('favourites.group')} hint={t('favourites.groupHint')}>
            <Input
              value={form.group}
              maxLength={FAV_GROUP_MAX}
              list={groupListId}
              onChange={(e) => patch('group', e.target.value)}
              placeholder={t('common.optional')}
            />
            <datalist id={groupListId}>
              {groups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
          </Field>

          <Field label={t('common.note')} className="span-2">
            <Input
              value={form.note}
              maxLength={FAV_NOTE_MAX}
              onChange={(e) => patch('note', e.target.value)}
              placeholder={t('common.optional')}
            />
          </Field>

          <label className="span-2 fav-check">
            <input type="checkbox" checked={form.ask} onChange={(e) => patch('ask', e.target.checked)} />
            <span>
              <strong>{t('favourites.ask')}</strong>
              <small>{t('favourites.askHint')}</small>
            </span>
          </label>
          <label className="span-2 fav-check">
            <input type="checkbox" checked={form.hideAmount} onChange={(e) => patch('hideAmount', e.target.checked)} />
            <span>
              <strong>{t('favourites.hideAmount')}</strong>
            </span>
          </label>

          {error && (
            <div className="span-2">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title={t('favourites.deleteTitle', { name: form.name })}
        body={t('favourites.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          setConfirmDelete(false);
          if (form.id) onDelete(form.id);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
