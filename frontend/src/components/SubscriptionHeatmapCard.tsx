import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HeatmapRange, useHeatmapData } from '../hooks/useHeatmapData';
import { formatPeriod } from '../lib/format';
import { resolvePaydays } from '../lib/mobileNav';
import { Route } from '../lib/router';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Button, Card, Segmented, Skeleton } from './ui';
import { SubscriptionHeatmap } from './SubscriptionHeatmap';

/**
 * The heatmap, wired up: data, paydays, and the card around it.
 *
 * Both screens that show this widget want exactly the same thing, so the wiring
 * lives here once rather than being copied into each. The bare
 * `<SubscriptionHeatmap />` stays presentational and takes its data as a prop,
 * which is what makes it renderable from a test or a story.
 *
 * ---------------------------------------------------------------------------
 * PAYDAYS MOVED OUT OF localStorage
 * ---------------------------------------------------------------------------
 * This used to keep a single payday in `localStorage` — a deliberate shortcut,
 * taken because putting it in Settings meant a sheet column, a migration and a
 * control on the Settings screen. That is now done, and the setting is an array
 * rather than one day, so the anchor follows the account to every device and
 * handles being paid twice a month.
 *
 * The old key is read once and migrated, so nobody who set a payday under the
 * previous build has to set it again. See `useMigratedPaydays`.
 */
/** The retired single-payday key, read once so an existing choice carries over. */
const LEGACY_PAYDAY_KEY = 'quick-wallet.payday';

/**
 * The account's paydays, adopting a legacy local one the first time.
 *
 * The migration is one-shot and self-clearing: once the value is in Settings
 * the local key is removed, so a later deliberate "no paydays" cannot be
 * undone by this running again.
 */
function useMigratedPaydays(): number[] {
  const { settings, save } = useSettings();
  const paydays = useMemo(() => resolvePaydays(settings.paydays), [settings.paydays]);
  const migrated = useRef(false);

  useEffect(() => {
    if (migrated.current || paydays.length > 0 || !settings.userId) return;
    migrated.current = true;

    let legacy: number | null = null;
    try {
      const raw = localStorage.getItem(LEGACY_PAYDAY_KEY);
      const day = raw === null || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(day) && day >= 1 && day <= 31) legacy = Math.round(day);
      if (raw !== null) localStorage.removeItem(LEGACY_PAYDAY_KEY);
    } catch {
      /* Blocked storage. Nothing to migrate, which is a fine outcome. */
    }

    if (legacy !== null) void save({ paydays: [legacy] }).catch(() => undefined);
  }, [paydays.length, settings.userId, save]);

  return paydays;
}

export function SubscriptionHeatmapCard({
  period,
  className,
  onNavigate,
}: {
  period: string;
  className?: string;
  /** Supplied where the shell can route; the picker link is hidden without it. */
  onNavigate?: (route: Route) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;

  const paydays = useMigratedPaydays();

  /* A month by default on every screen.

     The year is the more informative view and the more expensive one to read:
     it is 365 cells in a horizontally scrolling band, which on a phone is a
     thing you swipe rather than a thing you glance at. Defaulting to the month
     keeps the first render of both host pages cheap and immediately legible,
     and the toggle is one tap away — no fetch behind it, since every source is
     already cached (see useHeatmapData). */
  const [months, setMonths] = useState<HeatmapRange>(1);
  const data = useHeatmapData(period, { paydays, months });

  return (
    <Card
      className={className}
      title={t('liability.title')}
      subtitle={
        months === 12
          ? t('liability.yearTotal', { amount: money(data.year?.total ?? 0) })
          : `${t('liability.subtitle')} · ${formatPeriod(period, locale)}`
      }
      actions={
        /* A link rather than a picker. One payday fitted in a <select>; a
           configurable set of up to eight does not belong in a card header, and
           duplicating the editor here would give the same setting two homes. */
        <div className="cluster">
          <Segmented
            value={String(months)}
            ariaLabel={t('liability.rangeAria')}
            onChange={(next) => setMonths(Number(next) as HeatmapRange)}
            options={[
              { value: '1', label: t('liability.rangeMonth') },
              { value: '12', label: t('liability.rangeYear') },
            ]}
          />
          {onNavigate && (
            <Button size="sm" variant="ghost" onClick={() => onNavigate('settings')}>
              {paydays.length
                ? t('liability.paydayCount', { count: paydays.length })
                : t('liability.paydaySet')}
            </Button>
          )}
        </div>
      }
    >
      {data.initialLoading ? (
        <Skeleton rows={4} />
      ) : (
        <SubscriptionHeatmap data={data} money={money} locale={locale} />
      )}
    </Card>
  );
}
