import { Plus, SlidersHorizontal } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { Button, DecimalInput, parseDecimal } from '../ui';
import { GoalPayload } from '../GoalForm';

/**
 * Add a goal without opening a dialog: a name, a figure, Enter.
 *
 * Those are the only two fields a goal needs — the deadline, colour and note
 * all have sensible empties. "More options" carries whatever was typed into
 * the full form, so starting here never means typing the name twice.
 *
 * `busy` is held locally as well as by the parent: a second Enter while the
 * first request is in flight would otherwise create the goal twice.
 */
export function GoalQuickAdd({
  color,
  onCreate,
  onMore,
}: {
  /** The swatch a new goal gets, rotated by the page so neighbours differ. */
  color: string;
  onCreate: (payload: GoalPayload) => Promise<void>;
  onMore: (draft: Partial<GoalPayload>) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const target = parseDecimal(amount);
  const valid = title.trim().length > 0 && target > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onCreate({ title: title.trim(), targetAmount: target, deadline: '', color, note: '' });
      setTitle('');
      setAmount('');
    } catch {
      /* The page shows the mutation error; the typed values stay for a retry. */
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="goal-quick" onSubmit={submit} aria-label={t('goals.quickAddLabel')}>
      <input
        className="control goal-quick-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t('goals.quickAddPlaceholder')}
        aria-label={t('goals.fieldTitle')}
        maxLength={80}
        enterKeyHint="next"
      />
      <DecimalInput
        className="goal-quick-amount"
        value={amount}
        onChange={setAmount}
        placeholder={t('goals.quickAddAmount')}
        aria-label={t('goals.fieldTarget')}
        enterKeyHint="done"
      />
      <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
        <Icon icon={Plus} size="sm" />
        {t('goals.quickAdd')}
      </Button>
      <Button
        variant="ghost"
        onClick={() => onMore({ title: title.trim(), targetAmount: target > 0 ? target : undefined })}
        aria-label={t('goals.moreOptions')}
        title={t('goals.moreOptions')}
      >
        <Icon icon={SlidersHorizontal} size="sm" />
      </Button>
    </form>
  );
}
