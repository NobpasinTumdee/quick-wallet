import { CalendarCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { currentPeriod, formatPeriod, shiftPeriod } from '../lib/format';
import { openReview } from '../lib/router';
import { Icon } from './Icon';
import { Button } from './ui';

/** Days of a new month on which last month's review is offered. */
const BANNER_DAYS = 5;
const STORAGE_PREFIX = 'qw.reviewBanner.';

function readDismissed(userId: string | undefined): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + (userId ?? 'anon'));
  } catch {
    return null;
  }
}

/**
 * "October review is ready" on Home during the first days of a new month.
 * Dismissing it hides it for that month on this device. Outside those days,
 * once dismissed, or while Home shows another month, it renders nothing, so
 * Home is exactly as before.
 */
export function MonthReviewBanner({ userId, period, locale }: { userId: string | undefined; period: string; locale: string }) {
  const { t } = useTranslation();
  const now = currentPeriod();
  const month = shiftPeriod(now, -1);
  const [dismissed, setDismissed] = useState(() => readDismissed(userId));

  if (period !== now || new Date().getDate() > BANNER_DAYS || dismissed === month) return null;

  const dismiss = () => {
    setDismissed(month);
    try {
      window.localStorage.setItem(STORAGE_PREFIX + (userId ?? 'anon'), month);
    } catch {
      /* Private mode: hidden for this visit only. */
    }
  };
  const name = formatPeriod(month, locale);

  return (
    <section className="mrb" aria-label={t('review.bannerTitle', { month: name })}>
      <span className="mrb-mark" aria-hidden="true">
        <Icon icon={CalendarCheck} />
      </span>
      <span className="mrb-text">
        <strong>{t('review.bannerTitle', { month: name })}</strong>
        <span>{t('review.bannerHint')}</span>
      </span>
      <Button size="sm" variant="primary" className="mrb-open" onClick={() => openReview(month)}>
        {t('review.bannerOpen')}
      </Button>
      <button type="button" className="mrb-close" aria-label={t('review.bannerDismiss')} onClick={dismiss}>
        <Icon icon={X} size="sm" />
      </button>
    </section>
  );
}
