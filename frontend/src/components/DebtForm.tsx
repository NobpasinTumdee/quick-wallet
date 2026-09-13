import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Debt } from '../types';
import { Alert, Button, DecimalInput, Field, Input, Modal, Select, parseDecimal } from './ui';

export interface DebtPayload {
  title: string;
  principalAmount: number;
  currentBalance: number;
  interestRateApr: number;
  minimumPayment: number;
  dueDate: number;
  note: string;
}

/**
 * Create or edit a debt's terms.
 *
 * Editing `currentBalance` is allowed here, which is the one place this differs
 * from the Goals form. A goal's balance has exactly one legitimate source — the
 * money the user put in — so letting it be typed would only ever lose an
 * update. A debt's has two: payments made through this app, and the lender's
 * own statement, which includes interest this app does not model. Refusing the
 * correction would leave someone staring at a figure they can see is wrong.
 *
 * It is still not how you pay. Saving here writes no Transaction and moves no
 * wallet — that is `DebtPaymentModal`, and the copy says so.
 */
export function DebtForm({
  open,
  debt,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Undefined for a new debt. */
  debt?: Debt;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: DebtPayload, id?: string) => void;
}) {
  const { t } = useTranslation();

  const [title, setTitle] = useState('');
  const [principal, setPrincipal] = useState('');
  const [balance, setBalance] = useState('');
  const [apr, setApr] = useState('');
  const [minimum, setMinimum] = useState('');
  const [dueDay, setDueDay] = useState('0');
  const [note, setNote] = useState('');

  /* Seeded on the identity of what is being edited, not in an effect — the same
     pattern the payment modal uses, and for the same reason: no stale value
     from the last row survives, and no extra render clears it. */
  const identity = open ? (debt?.id ?? 'new') : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (identity && seededFor !== identity) {
    setSeededFor(identity);
    setTitle(debt?.title ?? '');
    setPrincipal(debt ? String(debt.principalAmount) : '');
    setBalance(debt ? String(debt.currentBalance) : '');
    setApr(debt ? String(debt.interestRateApr) : '');
    setMinimum(debt ? String(debt.minimumPayment) : '');
    setDueDay(String(debt?.dueDate ?? 0));
    setNote(debt?.note ?? '');
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const principalValue = parseDecimal(principal);
  const balanceValue = balance.trim() === '' ? principalValue : parseDecimal(balance);
  /* Caught here as well as server-side. The server clamps silently, which is
     right for an API and wrong for a form — someone who types 200,000 against a
     100,000 principal has made a mistake worth telling them about. */
  const balanceTooHigh = balanceValue > principalValue;

  const canSubmit = title.trim().length > 0 && principalValue > 0 && !balanceTooHigh && !busy;

  return (
    <Modal open={open} onClose={onClose} title={t(debt ? 'debt.editDebt' : 'debt.newDebt')}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit(
            {
              title: title.trim(),
              principalAmount: principalValue,
              currentBalance: balanceValue,
              interestRateApr: parseDecimal(apr),
              minimumPayment: parseDecimal(minimum),
              dueDate: Number(dueDay) || 0,
              note: note.trim(),
            },
            debt?.id,
          );
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}

        <Field label={t('debt.formTitle')}>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('debt.formTitlePlaceholder')}
            maxLength={120}
            autoFocus
          />
        </Field>

        <Field label={t('debt.formPrincipal')} hint={t('debt.formPrincipalHint')}>
          <DecimalInput value={principal} onChange={setPrincipal} />
        </Field>

        <Field
          label={t('debt.formBalance')}
          hint={balanceTooHigh ? undefined : t('debt.formBalanceHint')}
          error={balanceTooHigh ? t('debt.formBalanceOverPrincipal') : undefined}
        >
          <DecimalInput value={balance} onChange={setBalance} />
        </Field>

        <Field label={t('debt.formApr')} hint={t('debt.formAprHint')}>
          <DecimalInput value={apr} onChange={setApr} />
        </Field>

        <Field label={t('debt.formMinimum')}>
          <DecimalInput value={minimum} onChange={setMinimum} />
        </Field>

        <Field label={t('debt.formDueDay')}>
          <Select value={dueDay} onChange={(event) => setDueDay(event.target.value)}>
            <option value="0">{t('debt.dueDayNone')}</option>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {t('debt.dueDayValue', { day })}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('debt.formNote')} hint={t('common.optional')}>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
          />
        </Field>

        <div className="cluster" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
