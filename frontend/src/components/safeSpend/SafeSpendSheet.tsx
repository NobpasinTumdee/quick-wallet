import { useTranslation } from 'react-i18next';
import { Modal } from '../ui';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import { cx, formatPeriod } from '../../lib/format';
import type { SafeSpendLineKey, SafeSpendNote, SafeSpendNoteKey, SafeSpendResult, SafeSpendSettings } from '../../lib/safeSpend';
import type { WalletBalance } from '../../types';

export interface SafeSpendSheetProps {
  result: SafeSpendResult;
  period: string;
  wallets: WalletBalance[];
  settings: SafeSpendSettings;
  onSettings: (next: SafeSpendSettings) => void;
  onClose: () => void;
}

const cap = <S extends string>(value: S) => (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<S>;
const lineKey = (key: SafeSpendLineKey) => `safeSpend.line${cap(key)}` as const;
const noteKey = (key: SafeSpendNoteKey) => `safeSpend.note${cap(key)}` as const;

/** The breakdown: every line of the sum, each bill with its date, the rules behind them, and the settings. */
export function SafeSpendSheet({ result, period, wallets, settings, onSettings, onClose }: SafeSpendSheetProps) {
  const { t } = useTranslation();
  const { settings: appSettings } = useSettings();
  const money = useMoneyFormatter();
  const signed = (value: number) => (value < 0 ? `−${money(-value)}` : `+${money(value)}`);
  const dayLabel = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(appSettings.locale, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const spending = wallets.filter((wallet) => wallet.mode === 'expense' && !wallet.archived);
  const excluded = new Set(settings.excluded);
  const set = (patch: Partial<SafeSpendSettings>) => onSettings({ ...settings, ...patch });
  const toggleWallet = (id: string, on: boolean) =>
    set({ excluded: on ? settings.excluded.filter((each) => each !== id) : [...settings.excluded, id] });

  const noteText = (note: SafeSpendNote) =>
    t(noteKey(note.key), {
      count: note.count ?? 0,
      amount: note.amount !== undefined ? money(note.amount) : '',
    });

  const { left, mode } = result;

  return (
    <Modal open title={`${t('safeSpend.title')} · ${formatPeriod(period, appSettings.locale)}`} onClose={onClose} width={520}>
      <div className="ss-sheet">
        <section aria-labelledby="ss-sum">
          <h3 id="ss-sum" className="section-label">
            {t('safeSpend.sheetSum')}
          </h3>
          <dl className="ss-lines">
            {result.lines.map((line) => (
              <div key={line.key} className="ss-line">
                <dt>
                  {t(lineKey(line.key), { count: line.count ?? 0 })}
                  {line.estimate && <span className="ss-tag">{t('safeSpend.estimate')}</span>}
                  {line.key === 'goalPlan' && <small className="ss-line-hint">{t('safeSpend.lineGoalPlanHint')}</small>}
                </dt>
                <dd className={cx(line.amount < 0 && 'ss-minus')}>{signed(line.amount)}</dd>
              </div>
            ))}
            <div className="ss-line ss-line--total">
              <dt>{t(mode === 'past' ? 'safeSpend.pastLeft' : 'safeSpend.sheetLeft')}</dt>
              <dd className={cx(left !== null && left < 0 && 'text-negative')}>{left === null ? '—' : money(left)}</dd>
            </div>
            {mode === 'live' && result.perDay !== null && (
              <div className="ss-line ss-line--sub">
                <dt>{t('safeSpend.sheetPerDay', { count: result.daysLeft })}</dt>
                <dd>{result.perDay > 0 ? money(result.perDay) : '—'}</dd>
              </div>
            )}
            {mode === 'live' && result.todayLeft !== null && left !== null && left >= 0 && (
              <div className="ss-line ss-line--sub">
                <dt>{t('safeSpend.sheetToday', { spent: money(result.spentToday) })}</dt>
                <dd className={cx(result.todayLeft < 0 && 'text-negative')}>{money(result.todayLeft)}</dd>
              </div>
            )}
            {mode === 'future' && result.perDay !== null && (
              <div className="ss-line ss-line--sub">
                <dt>{t('safeSpend.sheetPerDay', { count: result.daysInMonth })}</dt>
                <dd>{result.perDay > 0 ? money(result.perDay) : '—'}</dd>
              </div>
            )}
            {mode === 'past' && result.pastPerDay !== null && (
              <div className="ss-line ss-line--sub">
                <dt>{t('safeSpend.sheetAvgPerDay')}</dt>
                <dd>{money(result.pastPerDay)}</dd>
              </div>
            )}
          </dl>
          {mode === 'live' && (
            <p className="ss-meta">
              {t('safeSpend.sheetSpentSoFar', { amount: money(result.spentSoFar) })}
              {result.budgetCount > 0 && (
                <> · {t('safeSpend.sheetBudgets', { amount: money(result.budgetsUnspent), count: result.budgetCount })}</>
              )}
            </p>
          )}
        </section>

        {mode !== 'past' && (
          <section aria-labelledby="ss-bills">
            <h3 id="ss-bills" className="section-label">
              {t(mode === 'live' ? 'safeSpend.sheetBillsLive' : 'safeSpend.sheetBillsMonth')}
            </h3>
            {result.bills.length === 0 ? (
              <p className="ss-none">{t('safeSpend.noBills')}</p>
            ) : (
              <ul className="ss-bills ss-bills--full">
                {result.bills.map((bill) => (
                  <li key={bill.key}>
                    <span className="ss-bill-date">{dayLabel(bill.date)}</span>
                    <span className="ss-bill-name">
                      {bill.name}
                      <small>
                        {t(bill.kind === 'debt' ? 'safeSpend.kindDebt' : 'safeSpend.kindSubscription')}
                        {bill.overdue && <> · {t('safeSpend.overdue')}</>}
                      </small>
                    </span>
                    <span className="ss-bill-amount">{money(bill.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {result.notes.length > 0 && (
          <section aria-labelledby="ss-notes">
            <h3 id="ss-notes" className="section-label">
              {t('safeSpend.sheetNotes')}
            </h3>
            <ul className="ss-notes">
              {result.notes.map((note) => (
                <li key={note.key}>{noteText(note)}</li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="ss-settings">
          <h3 id="ss-settings" className="section-label">
            {t('safeSpend.sheetSettings')}
          </h3>
          <p className="ss-meta">{t('safeSpend.sheetSettingsHint')}</p>
          <fieldset className="ss-fieldset">
            <legend>{t('safeSpend.sheetWallets')}</legend>
            {spending.length === 0 && <p className="ss-none">{t('safeSpend.sheetNoWallets')}</p>}
            {spending.map((wallet) => (
              <label key={wallet.id} className="fav-check">
                <input type="checkbox" checked={!excluded.has(wallet.id)} onChange={(e) => toggleWallet(wallet.id, e.target.checked)} />
                <span>
                  <strong>{wallet.name}</strong>
                  {wallet.type === 'CREDIT' && <small>{t('safeSpend.sheetCardHint')}</small>}
                </span>
              </label>
            ))}
            <small className="ss-meta">{t('safeSpend.sheetInvestingHint')}</small>
          </fieldset>
          <label className="fav-check">
            <input type="checkbox" checked={settings.goals} onChange={(e) => set({ goals: e.target.checked })} />
            <span>
              <strong>{t('safeSpend.setGoals')}</strong>
              <small>{t('safeSpend.setGoalsHint')}</small>
            </span>
          </label>
          <label className={cx('fav-check', !settings.goals && 'is-disabled')}>
            <input
              type="checkbox"
              checked={settings.goals && settings.goalPlan}
              disabled={!settings.goals}
              onChange={(e) => set({ goalPlan: e.target.checked })}
            />
            <span>
              <strong>{t('safeSpend.setGoalPlan')}</strong>
              <small>{t('safeSpend.setGoalPlanHint')}</small>
            </span>
          </label>
          <label className="fav-check">
            <input type="checkbox" checked={settings.expectedIncome} onChange={(e) => set({ expectedIncome: e.target.checked })} />
            <span>
              <strong>{t('safeSpend.setIncome')}</strong>
              <small>{t('safeSpend.setIncomeHint')}</small>
            </span>
          </label>
          <label className="fav-check">
            <input type="checkbox" checked={settings.budgets} onChange={(e) => set({ budgets: e.target.checked })} />
            <span>
              <strong>{t('safeSpend.setBudgets')}</strong>
              <small>{t('safeSpend.setBudgetsHint')}</small>
            </span>
          </label>
        </section>
      </div>
    </Modal>
  );
}
