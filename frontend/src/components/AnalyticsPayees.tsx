import { useTranslation } from 'react-i18next';

import { topPayees } from '../lib/analyticsMath';
import { formatDate, formatPercent } from '../lib/format';
import { MoneyFormatter } from '../state/SettingsContext';
import { Transaction } from '../types';

/**
 * Where the money goes most often.
 *
 * The share bar sits behind the payee name rather than in its own column: at
 * eight rows the proportions are the point, and a separate column of bars would
 * push the three figures that people actually read off the right edge on a
 * phone.
 */
export function AnalyticsPayees({
  transactions,
  money,
  locale,
}: {
  transactions: Transaction[];
  money: MoneyFormatter;
  locale: string;
}) {
  const { t } = useTranslation();
  const { rows } = topPayees(transactions, 8, t('analytics.merchantsUnlabelled'));

  if (!rows.length) return null;

  return (
    <div className="table-wrap">
      <table className="data data--nested payees">
        <thead>
          <tr>
            <th>{t('analytics.merchantsColumnPayee')}</th>
            <th className="num">{t('analytics.merchantsColumnCount')}</th>
            <th className="num">{t('analytics.merchantsColumnAverage')}</th>
            <th className="num">{t('analytics.merchantsColumnTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.payee}>
              <td>
                {/* The bar is decorative reinforcement of the share; the number
                    beside it is the accessible version. */}
                <span
                  className="payee-bar"
                  style={{ '--share': `${Math.min(100, row.share)}%` } as React.CSSProperties}
                  aria-hidden="true"
                />
                <span className="payee-name">{row.payee}</span>
                <div className="list-item-sub">
                  {formatPercent(row.share, 1)} · {formatDate(row.lastPaid, locale)}
                </div>
              </td>
              <td className="num">{row.count}</td>
              <td className="num">{money(row.average)}</td>
              <td className="num">
                <strong>{money(row.total)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
