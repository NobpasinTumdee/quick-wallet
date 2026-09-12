import { useTranslation } from 'react-i18next';

import { formatRecordedTime } from '../lib/recordedTime';

/**
 * The clock time a transaction was recorded, as a quiet second line.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A COMPONENT AND NOT A STRING
 * ---------------------------------------------------------------------------
 * Two things have to happen every time this is shown, and both are easy to
 * forget at a call site:
 *
 *   - render *nothing* when there is no timestamp. Rows written before
 *     `createdAt` existed have none, and a column of "—" down a list of older
 *     transactions is noise pretending to be data.
 *   - say what the time means. "14:32" on its own reads as the time of the
 *     purchase; it is the time the row was *written*, which on a back-dated
 *     entry is a different day entirely. The accessible name and the tooltip
 *     both carry "Recorded at", so it is never bare.
 *
 * Returning `null` for the empty case is what keeps the two call sites honest —
 * neither has to remember the check.
 */
export function RecordedAt({
  createdAt,
  locale,
  /** `inline` sits inside an existing sub-line; `block` makes its own. */
  variant = 'block',
}: {
  createdAt: string | undefined;
  locale: string;
  variant?: 'block' | 'inline';
}) {
  const { t } = useTranslation();
  const time = formatRecordedTime(createdAt, locale);

  if (!time) return null;

  const label = t('activity.recordedAt', { time });

  return (
    <time
      className={variant === 'inline' ? 'recorded-at recorded-at--inline' : 'recorded-at'}
      dateTime={createdAt}
      title={label}
    >
      {/* The visible text is just the clock — the label is what a screen reader
          and a hover get, so the row stays uncluttered without losing meaning. */}
      <span aria-hidden="true">{time}</span>
      <span className="sr-only">{label}</span>
    </time>
  );
}
