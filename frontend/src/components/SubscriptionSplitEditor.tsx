import { Plus, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Button, DecimalInput, Input } from './ui';
import {
  SplitDraft,
  duplicateNames,
  splitEqually,
  summariseSplits,
} from '../lib/splitMath';
import { cx } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';

/**
 * Who owes what on a shared subscription.
 *
 * ---------------------------------------------------------------------------
 * A TEMPLATE, NOT A BILL
 * ---------------------------------------------------------------------------
 * Nothing here is owed by anyone yet. This is the shape the bill will take
 * *when the subscription is next paid*, which is why there are no paid
 * checkboxes and no repayment controls: those belong to the real bill, and it
 * does not exist until the money has left the wallet.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SHARES ARE AMOUNTS AND NOT PERCENTAGES
 * ---------------------------------------------------------------------------
 * Percentages read as the more "correct" model — the price changes, everyone's
 * share follows. In practice a shared plan is agreed in money: "the three of
 * you send me ฿100 each". When Netflix puts its price up, what people agreed
 * to pay does not change; the payer absorbs the rise, which is what the
 * server's own fitting rule does. The one case percentages would handle better
 * — a price *cut* below the agreed shares — is handled by scaling them down.
 *
 * The same summary line as the bill form, so "others owe / your share" means
 * the same thing in both places.
 */
export function SubscriptionSplitEditor({
  people,
  onChange,
  total,
  disabled,
}: {
  people: SplitDraft[];
  onChange: (next: SplitDraft[]) => void;
  /** The subscription's amount, which the shares are measured against. */
  total: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  const summary = summariseSplits(people, total);
  const dupes = duplicateNames(people);

  const setPerson = (id: string, patch: Partial<SplitDraft>) =>
    onChange(people.map((person) => (person.id === id ? { ...person, ...patch } : person)));

  return (
    <div className="sub-split">
      <div className="sub-split-head">
        <span className="section-label">
          <Icon icon={Users} size="sm" />
          {t('recurring.splitDetails')}
        </span>
        <div className="cluster" style={{ gap: 6 }}>
          {/* Fills every row at once. Floors to the satang so the shares can
              never add up to more than the subscription — the remainder is the
              payer's own share, which is the normal case. */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || people.length === 0 || !(total > 0)}
            onClick={() => onChange(splitEqually(people, total, true))}
          >
            {t('recurring.splitEvenly')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => onChange([...people, { id: `s-${Date.now()}-${people.length}`, personName: '', amount: '' }])}
          >
            <Icon icon={Plus} size="sm" />
            {t('recurring.addPerson')}
          </Button>
        </div>
      </div>

      {people.length === 0 ? (
        <p className="sub-split-empty">{t('recurring.splitEmpty')}</p>
      ) : (
        <ul className="sub-split-list">
          {people.map((person) => {
            const duplicate = dupes.includes(person.personName.trim().toLowerCase());
            return (
              <li key={person.id} className={cx('sub-split-row', duplicate && 'is-invalid')}>
                <Input
                  value={person.personName}
                  disabled={disabled}
                  placeholder={t('recurring.personName')}
                  aria-label={t('recurring.personName')}
                  aria-invalid={duplicate}
                  maxLength={60}
                  onChange={(event) => setPerson(person.id, { personName: event.target.value })}
                />
                <DecimalInput
                  value={person.amount}
                  disabled={disabled}
                  placeholder="0.00"
                  onChange={(raw) => setPerson(person.id, { amount: raw })}
                />
                <button
                  type="button"
                  className="sub-split-remove"
                  disabled={disabled}
                  aria-label={t('recurring.removePerson', { name: person.personName || '—' })}
                  onClick={() => onChange(people.filter((row) => row.id !== person.id))}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* The arithmetic, stated while it can still be changed. */}
      <p className={cx('sub-split-summary', summary.exceedsTotal && 'is-error')}>
        {summary.exceedsTotal
          ? t('recurring.splitOverBy', { amount: money(summary.excess) })
          : t('recurring.splitSummary', {
              owed: money(summary.owedTotal),
              own: money(Math.max(0, summary.ownShare)),
            })}
      </p>
      {dupes.length > 0 && (
        <p className="sub-split-summary is-error">
          {t('recurring.splitDuplicate', { name: dupes[0] })}
        </p>
      )}
    </div>
  );
}
