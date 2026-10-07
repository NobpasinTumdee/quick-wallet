import { useTranslation } from 'react-i18next';

import { Plus } from 'lucide-react';

import { Icon } from './Icon';
import { Badge, Button, Modal } from './ui';
import { cx, formatDate, formatNumber, formatPercent } from '../lib/format';
import { MoneyFormatter, useSettings } from '../state/SettingsContext';
import { ValuedHolding } from '../lib/positions';

/**
 * Everything about one holding that the mobile tile deliberately leaves out.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE SURFACE RATHER THAN AN EXPANDING ROW
 * ---------------------------------------------------------------------------
 * The desktop table expands in place, which works because the columns around
 * it stay visible and give the detail context. On a phone there are no columns
 * — the tile is already a summary — so expanding it would push the rest of the
 * list off-screen to show figures that have nothing to sit beside.
 *
 * A sheet also solves the real problem with the table on a phone: these are
 * eleven numbers, and eleven numbers in a 375px row is either a horizontal
 * scrollbar or a font nobody can read. Here they get a column each.
 */
export function HoldingDetailSheet({
  holding,
  brokerRate,
  brokerCurrency,
  money,
  onClose,
  onAddPurchase,
  onSell,
}: {
  holding: ValuedHolding | null;
  /** Multiplier from the bookkeeping currency to the broker's. 0 when unknown. */
  brokerRate: number;
  brokerCurrency: string;
  /* Passed in rather than taken from the hook: the Invest screen can be
     showing USD, and a sheet that formatted in THB while the list behind it
     said USD would read as two different portfolios. */
  money: MoneyFormatter;
  onClose: () => void;
  /** Recording another buy — the DCA path, and the sheet's primary action. */
  onAddPurchase?: () => void;
  onSell?: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();

  if (!holding) return null;

  const up = holding.unrealizedPnl >= 0;
  const averaged = holding.lots.length > 1;

  return (
    <Modal open onClose={onClose} title={holding.symbol} width={460}>
      <div className="holding-sheet">
        {/* The headline, repeated from the tile on purpose: a sheet that opens
            without restating what you tapped makes you check you tapped the
            right thing. */}
        <div className="holding-sheet-hero">
          <span className="holding-sheet-price">{money(holding.marketPrice)}</span>
          <span className={cx('holding-sheet-delta', up ? 'is-up' : 'is-down')}>
            {formatPercent(holding.unrealizedPnlPercent, 2, true)}
            <small>{money(holding.unrealizedPnl, { signed: true })}</small>
          </span>
        </div>

        <dl className="holding-stats">
          <Stat label={t('invest.quantity')} value={formatNumber(holding.quantity, 8, settings.locale)} />
          <Stat
            label={t('invest.avgCost')}
            value={money(holding.avgCost)}
            /* The broker's own number, so it can be checked against their app
               without the reader doing currency maths in their head. */
            sub={brokerRate > 0 ? `${formatNumber(holding.avgCost / brokerRate, 2, settings.locale)} ${brokerCurrency}` : undefined}
          />
          <Stat label={t('invest.costBasis')} value={money(holding.costBasis)} />
          <Stat label={t('invest.value')} value={money(holding.marketValue)} />
          {holding.fees > 0 && <Stat label={t('invest.fees')} value={money(holding.fees)} />}
          <Stat
            label={t('invest.lots')}
            value={String(holding.lots.length)}
            sub={
              averaged
                ? t('invest.dateRange', {
                    from: formatDate(holding.firstBuyDate, settings.locale),
                    to: formatDate(holding.lastBuyDate, settings.locale),
                  })
                : formatDate(holding.firstBuyDate, settings.locale)
            }
          />
          {/* Only meaningful once there is more than one purchase — the spread
              between them is what the averaging actually smoothed. */}
          {averaged && (
            <Stat
              label={t('invest.buyRange')}
              value={`${money(holding.lowestBuyPrice)} – ${money(holding.highestBuyPrice)}`}
            />
          )}
        </dl>

        {holding.tagList.length > 0 && (
          <div className="tag-row">
            {holding.tagList.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}

        {holding.quote?.source === 'simulated' && (
          <p className="holding-sheet-note">{t('invest.simulatedNote')}</p>
        )}
      </div>

      {(onSell || onAddPurchase) && (
        <div className="holding-sheet-actions">
          {onSell && (
            <Button variant="ghost" onClick={onSell}>
              {t('invest.sell')}
            </Button>
          )}
          {/* Primary, and the reason this sheet needed actions at all: adding
              to a position is the thing people do repeatedly, and after the
              mobile rewrite there was no way to reach it from a phone. */}
          {onAddPurchase && (
            <Button variant="primary" onClick={onAddPurchase}>
              <Icon icon={Plus} size="sm" />
              {t('invest.addPurchase')}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="holding-stat">
      <dt>{label}</dt>
      <dd>
        {value}
        {sub && <small>{sub}</small>}
      </dd>
    </div>
  );
}
