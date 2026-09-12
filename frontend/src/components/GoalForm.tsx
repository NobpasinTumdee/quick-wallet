import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { todayKey } from '../lib/format';
import { Goal } from '../types';
import {
  Alert,
  Button,
  DecimalInput,
  Field,
  Input,
  Modal,
  Textarea,
  decimalToInput,
  parseDecimal,
} from './ui';

export interface GoalPayload {
  title: string;
  targetAmount: number;
  deadline: string;
  color: string;
  note: string;
}

/** Swatches, not a colour picker: eight good choices beat sixteen million. */
const SWATCHES = ['#3b6fff', '#0f9d6b', '#d1830f', '#e03e58', '#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'];

interface FormState {
  title: string;
  targetAmount: string;
  deadline: string;
  color: string;
  note: string;
}

function initialState(goal?: Goal): FormState {
  return {
    title: goal?.title ?? '',
    targetAmount: decimalToInput(goal?.targetAmount),
    deadline: goal?.deadline ?? '',
    color: goal?.color || SWATCHES[0],
    note: goal?.note ?? '',
  };
}

/**
 * Add or edit a goal.
 *
 * `savedAmount` is absent on purpose, on both sides. The server refuses to
 * accept it through an update, and offering it here would invite the client to
 * try — funding is the only path that touches a balance, and it goes through
 * `goals.fund` so the arithmetic happens on the stored row.
 */
export function GoalForm({
  open,
  goal,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  goal?: Goal;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: GoalPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(() => initialState(goal));
  const [localError, setLocalError] = useState<string | null>(null);

  /* Only on open, or when opened onto a different record — the same rule the
     other forms follow, so a background revalidation cannot wipe a half-typed
     field under the user. */
  useEffect(() => {
    if (open) {
      setForm(initialState(goal));
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const target = parseDecimal(form.targetAmount);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!form.title.trim()) {
      setLocalError(t('goals.fieldTitle'));
      return;
    }
    if (target <= 0) {
      setLocalError(t('goals.fieldTarget'));
      return;
    }
    setLocalError(null);

    try {
      await onSubmit({
        title: form.title.trim(),
        targetAmount: target,
        deadline: form.deadline,
        color: form.color,
        note: form.note.trim(),
      });
    } catch {
      /* parent shows `error` */
    }
  }

  return (
    <Modal
      open={open}
      title={goal ? t('goals.editGoal', { title: goal.title }) : t('goals.newGoal')}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {goal ? t('common.save') : t('goals.addGoal')}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label={t('goals.fieldTitle')} className="span-2">
          <Input
            value={form.title}
            onChange={(event) => patch('title', event.target.value)}
            placeholder={t('goals.fieldTitlePlaceholder')}
            maxLength={80}
            required
            autoFocus
          />
        </Field>

        <Field label={t('goals.fieldTarget')}>
          <DecimalInput
            value={form.targetAmount}
            onChange={(raw) => patch('targetAmount', raw)}
            placeholder="0.00"
            required
          />
        </Field>

        <Field label={t('goals.fieldDeadline')} hint={t('goals.fieldDeadlineHint')}>
          <Input
            type="date"
            value={form.deadline}
            min={todayKey()}
            onChange={(event) => patch('deadline', event.target.value)}
          />
        </Field>

        <Field label={t('goals.fieldColor')} className="span-2">
          <div className="swatches">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`swatch${form.color === swatch ? ' is-active' : ''}`}
                style={{ background: swatch }}
                aria-label={swatch}
                aria-pressed={form.color === swatch}
                onClick={() => patch('color', swatch)}
              />
            ))}
          </div>
        </Field>

        <Field label={t('goals.fieldNote')} className="span-2">
          <Textarea
            value={form.note}
            onChange={(event) => patch('note', event.target.value)}
            placeholder={t('goals.fieldNotePlaceholder')}
            maxLength={300}
          />
        </Field>

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
