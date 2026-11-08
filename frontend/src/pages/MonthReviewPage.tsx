import { ChevronLeft, ChevronRight, NotebookPen, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import { ReviewSkeleton } from '../components/skeleton/ReviewSkeleton';
import { Alert, Badge, Button, Card } from '../components/ui';
import { useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { useNotes } from '../hooks/useNotes';
import { currentPeriod, cx, formatPeriod, shiftPeriod, todayKey } from '../lib/format';
import { buildMonthReview, reviewMarkdown, type Highlight, type MonthFigures, type MonthReview, type ReviewWords } from '../lib/monthReview';
import { noteHash } from '../lib/notes';
import { Route } from '../lib/router';
import { toast } from '../lib/toast';
import { registerReviewStrings } from '../locales/review';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import type { DashboardSummary, Goal, Subscription, Transaction } from '../types';
import '../styles/review.css';

/* Before anything here renders: the page's strings travel with its chunk. */
registerReviewStrings();

const cap = <S extends string>(value: S) => (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<S>;
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value)}%`);

/**
 * #/review?period=YYYY-MM — a finished month in one page: highlights written
 * from the numbers, income and spending against last month and the 3-month
 * average, categories, budgets, goals, the biggest purchases, new recurring
 * items, no-spend days and what was left at month end. "Save as note" turns
 * it into a Markdown note the reader can add to.
 *
 * Same cache keys as Home/Analytics (dashboard by period, the month's
 * transactions) and the Recurring and Goals screens, so a month already seen
 * costs nothing more.
 */
export default function MonthReviewPage({ period }: { period: string; onNavigate?: (route: Route) => void }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const locale = settings.locale;
  const previousPeriod = shiftPeriod(period, -1);
  const now = currentPeriod();
  const future = period > now;

  const dashboard = useExcelQuery<DashboardSummary>('/api/dashboard', { period }, { enabled: !future });
  const previous = useExcelQuery<DashboardSummary>('/api/dashboard', { period: previousPeriod }, { enabled: !future });
  const transactions = useExcelDB<Transaction>('transactions', { period }, { enabled: !future });
  const subscriptions = useExcelDB<Subscription>('subscriptions', undefined, { enabled: !future });
  const goals = useExcelDB<Goal>('goals', undefined, { enabled: !future });

  /* Print shows the review alone (see review.css). */
  useEffect(() => {
    document.documentElement.classList.add('has-mr-open');
    return () => document.documentElement.classList.remove('has-mr-open');
  }, []);

  const loading =
    dashboard.initialLoading || previous.initialLoading || transactions.initialLoading || subscriptions.initialLoading || goals.initialLoading;

  const review = useMemo(
    () =>
      dashboard.data && !future
        ? buildMonthReview({
            period,
            today: todayKey(),
            summary: dashboard.data,
            previousSummary: previous.data ?? null,
            transactions: transactions.items,
            subscriptions: subscriptions.items,
            goals: goals.items,
          })
        : null,
    [dashboard.data, previous.data, transactions.items, subscriptions.items, goals.items, period, future],
  );

  const step = (delta: number) => window.location.replace(`#/review?period=${shiftPeriod(period, delta)}`);
  const month = formatPeriod(period, locale);

  return (
    <div className="mr">
      <header className="page-head mr-head">
        <div className="mr-title-row">
          <button type="button" className="mr-step" aria-label={t('common.previousMonth')} onClick={() => step(-1)}>
            <Icon icon={ChevronLeft} size="sm" />
          </button>
          <h1 className="page-title" aria-live="polite">
            {month}
          </h1>
          <button
            type="button"
            className="mr-step"
            aria-label={t('common.nextMonth')}
            onClick={() => step(1)}
            disabled={period >= now}
          >
            <Icon icon={ChevronRight} size="sm" />
          </button>
        </div>
        {review && <ReviewActions review={review} wallets={dashboard.data?.wallets ?? []} />}
      </header>

      {future ? (
        <Alert tone="info">{t('review.futureHint', { month })}</Alert>
      ) : loading ? (
        <ReviewSkeleton head={false} />
      ) : !review ? (
        <Alert tone="error">{dashboard.error ?? t('review.loadFailed')}</Alert>
      ) : (
        <ReviewBody review={review} wallets={dashboard.data?.wallets ?? []} />
      )}
    </div>
  );
}

/** The words for one review: shared by the page and the note, so both say the same thing. */
function useReviewWords(wallets: { id: string; name: string }[]): ReviewWords {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;
  return useMemo(() => {
    const loose = t as unknown as (key: string, values?: Record<string, unknown>) => string;
    const monthName = (period: string) => formatPeriod(period, locale);
    const dayName = (date: string) => {
      const [y, m, d] = date.slice(0, 10).split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    };
    const highlight = ({ key, values }: Highlight) => {
      const out: Record<string, unknown> = { ...values };
      if (typeof values.rate === 'number') out.rate = pct(values.rate);
      if (typeof values.previous === 'number') out.previous = pct(values.previous);
      if (typeof values.month === 'string') out.month = monthName(values.month);
      if (typeof values.amount === 'number') out.amount = money(values.amount);
      if (key === 'categoryUp' || key === 'categoryDown') {
        out.pct = values.pct === '' ? '' : ` (${key === 'categoryUp' ? '+' : '−'}${values.pct}%)`;
      }
      return loose(`review.hl${cap(key)}`, out);
    };
    return {
      t: (key, values) => loose(`review.${key}`, values),
      money,
      monthName,
      dayName,
      highlight,
      walletName: (id) => wallets.find((wallet) => wallet.id === id)?.name ?? '—',
    };
  }, [t, locale, money, wallets]);
}

function ReviewActions({ review, wallets }: { review: MonthReview; wallets: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const named = useReviewWords(wallets);
  /* Creating only: the list itself is not needed here. */
  const notes = useNotes({ enabled: false });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<{ period: string; id: string } | null>(null);
  const saved = savedId?.period === review.period ? savedId.id : null;

  const save = async () => {
    setSaving(true);
    try {
      const { title, body } = reviewMarkdown(review, named);
      const note = await notes.create({ title, body, refs: [] });
      setSavedId({ period: review.period, id: note.id });
      toast.success(t('review.savedNote'), undefined, {
        action: { label: t('review.openNote'), onClick: () => (window.location.hash = noteHash(note.id)) },
      });
    } catch {
      toast.error(t('review.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mr-actions">
      <Button size="sm" variant="ghost" className="mr-print" onClick={() => window.print()}>
        <Icon icon={Printer} size="sm" />
        <span>{t('review.print')}</span>
      </Button>
      {saved ? (
        <Button size="sm" variant="secondary" onClick={() => (window.location.hash = noteHash(saved))}>
          <Icon icon={NotebookPen} size="sm" />
          <span>{t('review.openNote')}</span>
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={() => void save()} loading={saving}>
          <Icon icon={NotebookPen} size="sm" />
          <span>{saving ? t('review.savingNote') : t('review.saveNote')}</span>
        </Button>
      )}
    </div>
  );
}

function ReviewBody({ review, wallets }: { review: MonthReview; wallets: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const words = useReviewWords(wallets);
  const month = words.monthName(review.period);
  const prevShort = words.monthName(review.previousPeriod);
  const signed = (value: number) => (value > 0 ? `▲ ${money(value)}` : value < 0 ? `▼ ${money(-value)}` : '—');

  const total = (label: string, key: 'income' | 'expense' | 'net' | 'rate') => {
    const value = (f: MonthFigures | null) => (!f ? '—' : key === 'rate' ? pct(f.savingsRate) : money(f[key]));
    return (
      <div className="mr-total">
        <span className="mr-total-label">{label}</span>
        <strong className={cx('mr-total-value', key === 'net' && review.current.net < 0 && 'text-negative')}>
          {value(review.current)}
        </strong>
        <span className="mr-total-sub">
          {prevShort}: {value(review.previous)}
        </span>
        <span className="mr-total-sub">
          {review.average ? `${t('review.avgCol', { count: review.averageMonths })}: ${value(review.average)}` : '—'}
        </span>
      </div>
    );
  };

  const topCategories = review.categories.filter((row) => row.amount > 0).slice(0, 6);

  return (
    <div className="mr-grid">
      {review.status === 'current' && (
        <p className="mr-note mr-span">{t('review.currentHint', { month })}</p>
      )}

      <Card className="mr-span mr-callout" title={t('review.highlights')}>
        {review.highlights.length === 0 ? (
          <p className="mr-empty">{t('review.empty', { month })}</p>
        ) : (
          <ul className="mr-highlights">
            {review.highlights.map((highlight) => (
              <li key={highlight.key}>{words.highlight(highlight)}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mr-span" title={t('review.totals')}>
        <div className="mr-totals">
          {total(t('review.income'), 'income')}
          {total(t('review.spent'), 'expense')}
          {total(t('review.saved'), 'net')}
          {total(t('review.rate'), 'rate')}
        </div>
        {!review.average && <p className="mr-quiet">{t('review.noAvg')}</p>}
      </Card>

      <Card title={t('review.categories')} subtitle={t('review.vsMonth', { month: prevShort })}>
        {topCategories.length === 0 ? (
          <p className="mr-empty">{t('review.catEmpty')}</p>
        ) : (
          <ul className="mr-rows">
            {topCategories.map((row) => (
              <li key={row.category} className="mr-row">
                <span className="mr-row-name">{row.category}</span>
                <span className="mr-row-value">
                  {money(row.amount)}
                  <small className={cx('mr-change', row.change > 0 && 'is-up', row.change < 0 && 'is-down')}>{signed(row.change)}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {(review.biggestUp || review.biggestDown) && (
          <p className="mr-quiet">
            {review.biggestUp && `${t('review.biggestUp')}: ${review.biggestUp.category} ${signed(review.biggestUp.change)}`}
            {review.biggestUp && review.biggestDown && ' · '}
            {review.biggestDown && `${t('review.biggestDown')}: ${review.biggestDown.category} ${signed(review.biggestDown.change)}`}
          </p>
        )}
      </Card>

      <Card
        title={t('review.budgets')}
        subtitle={review.budgets.length > 0 ? t('review.budgetsHit', { hit: review.budgetsHit, total: review.budgets.length }) : undefined}
      >
        {review.budgets.length === 0 ? (
          <p className="mr-empty">{t('review.budgetsEmpty')}</p>
        ) : (
          <ul className="mr-rows">
            {review.budgets.map((row) => (
              <li key={row.label} className="mr-row">
                <span className="mr-row-name">
                  {row.label}
                  <small>
                    {row.over
                      ? t('review.budgetOver', { spent: money(row.spent), limit: money(row.limit), over: money(row.spent - row.limit) })
                      : t('review.budgetOk', { spent: money(row.spent), limit: money(row.limit) })}
                  </small>
                </span>
                <Badge tone={row.over ? 'negative' : 'positive'}>{t(row.over ? 'review.over' : 'review.onTrack')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('review.goals')}>
        {review.goalsBought.length === 0 && review.goals.length === 0 ? (
          <p className="mr-empty">{t('review.goalsEmpty')}</p>
        ) : (
          <>
            <ul className="mr-rows">
              {review.goalsBought.map((goal) => (
                <li key={goal.id} className="mr-row">
                  <span className="mr-row-name">
                    {goal.title}
                    <small>{t('review.goalBought', { date: words.dayName(goal.date), amount: money(goal.amount) })}</small>
                  </span>
                  <span aria-hidden="true">🎉</span>
                </li>
              ))}
              {review.goals.map((goal) => (
                <li key={goal.id} className="mr-row">
                  <span className="mr-row-name">
                    {goal.title}
                    <small>
                      {goal.percent >= 100
                        ? t('review.goalFunded')
                        : goal.overdue
                          ? t('review.goalOverdue')
                          : goal.perMonth > 0
                            ? t('review.goalPace', { amount: money(goal.perMonth) })
                            : t('review.goalNoDate')}
                    </small>
                  </span>
                  <span className="mr-row-value">{goal.percent}%</span>
                </li>
              ))}
            </ul>
            <p className="mr-quiet">{t('review.goalsNoHistory')}</p>
          </>
        )}
      </Card>

      <Card title={t('review.biggest')}>
        {review.biggest.length === 0 ? (
          <p className="mr-empty">{t('review.biggestEmpty')}</p>
        ) : (
          <ol className="mr-rows">
            {review.biggest.map((tx) => (
              <li key={tx.id} className="mr-row">
                <span className="mr-row-name">
                  {tx.note?.trim() || tx.category || '—'}
                  <small>
                    {words.dayName(tx.date)} · {tx.category || '—'} · {words.walletName(tx.walletId)}
                  </small>
                </span>
                <span className="mr-row-value">{money(Number(tx.amount) || 0)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title={t('review.newRecurring')}>
        {review.newRecurring.length === 0 ? (
          <p className="mr-empty">{t('review.recurringEmpty')}</p>
        ) : (
          <ul className="mr-rows">
            {review.newRecurring.map((sub) => (
              <li key={sub.id} className="mr-row">
                <span className="mr-row-name">
                  {sub.name}
                  <small>{t(`review.freq_${sub.frequency}` as const)}</small>
                </span>
                <span className="mr-row-value">{money(Number(sub.amount) || 0)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mr-quiet">{t('review.recurringNoHistory')}</p>
      </Card>

      <Card title={t('review.glanceTitle')}>
        <div className="mr-tiles">
          <div className="metric metric--positive">
            <span className="stat-label mr-label">{t('review.noSpendTitle')}</span>
            <strong className="metric-value">{review.noSpend.days}</strong>
            <span className="mr-quiet">
              {t('review.noSpendOutOf', { count: review.noSpend.outOf })} ·{' '}
              {t('review.longestRun', { count: review.noSpend.longestRun })}
            </span>
          </div>
          <div className="metric metric--accent">
            <span className="stat-label mr-label">{t('review.leftTitle')}</span>
            <strong className={cx('metric-value', (review.leftAtMonthEnd ?? 0) < 0 && 'text-negative')}>
              {review.leftAtMonthEnd === null ? '—' : money(review.leftAtMonthEnd)}
            </strong>
            <span className="mr-quiet">
              {review.status !== 'past'
                ? t('review.leftNotYet')
                : review.leftAtMonthEnd === null
                  ? t('review.leftUnknown')
                  : t('review.leftHint')}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
