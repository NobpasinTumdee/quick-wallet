import { useTranslation } from 'react-i18next';

import { useHeatmapData } from '../hooks/useHeatmapData';
import { useStoredNumber } from '../hooks/useStoredBoolean';
import { formatPeriod } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Card, Skeleton } from './ui';
import { SubscriptionHeatmap } from './SubscriptionHeatmap';

/**
 * The heatmap, wired up: data, payday, and the card around it.
 *
 * Both screens that show this widget want exactly the same thing, so the wiring
 * lives here once rather than being copied into each. The bare
 * `<SubscriptionHeatmap />` stays presentational and takes its data as a prop,
 * which is what makes it renderable from a test or a story.
 *
 * ---------------------------------------------------------------------------
 * WHY PAYDAY IS IN localStorage AND NOT THE WORKBOOK
 * ---------------------------------------------------------------------------
 * A payday belongs in Settings, honestly — it is account data, not a device
 * preference. Putting it there means a column in the Settings sheet, a
 * migration, a field in `Settings`, and a control on the Settings screen, which
 * is a bigger change than this widget was asked for.
 *
 * localStorage buys the whole feature now at the cost of it being per-device.
 * The read is guarded and the fallback is "no payday", which the heatmap
 * already renders as a prompt rather than as a broken state — so the worst case
 * of the shortcut is a user who sets it twice.
 */
const PAYDAY_KEY = 'quick-wallet.payday';

export function SubscriptionHeatmapCard({
  period,
  className,
}: {
  period: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;

  const [payday, setPayday] = useStoredNumber(PAYDAY_KEY, null, { min: 1, max: 31 });
  const data = useHeatmapData(period, { payday });

  return (
    <Card
      className={className}
      title={t('liability.title')}
      subtitle={`${t('liability.subtitle')} · ${formatPeriod(period, locale)}`}
      actions={
        /* A bare <select> rather than a settings trip: the anchor is only
           useful if changing it is cheaper than ignoring it. */
        <label className="liab-payday-picker">
          <span className="sr-only">{t('liability.legendPayday')}</span>
          <select
            value={payday ?? ''}
            onChange={(event) =>
              setPayday(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">{t('liability.paydayNone')}</option>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {/* The day number goes through i18n rather than `ordinal()`,
                    which hard-codes English suffixes — "25th" is wrong in a
                    Thai interface. */}
                {t('liability.paydayOption', { day })}
              </option>
            ))}
          </select>
        </label>
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
