/**
 * Shared expenses — every bill somebody still owes you a share of.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SCREEN IS FOR
 * ---------------------------------------------------------------------------
 * Chasing people. So the layout is ordered by that job rather than by date:
 * the roll-up says how much is out and how many people have it, open bills come
 * first, and settled ones are collapsed behind a toggle because a bill everyone
 * has paid is history, not a task.
 *
 * Every unpaid share is one tap from being settled, because that tap is the
 * only thing anyone comes here to do.
 */

import { Check, HandCoins, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BillSplitterForm } from '../components/BillSplitterForm';
import { Icon } from '../components/Icon';
import { ListSkeleton } from '../components/Skeletons';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  RefreshButton,
} from '../components/ui';
import { CreateBillSplitInput, useBillSplitter } from '../hooks/useBillSplitter';
import { cx, formatDate } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { BillSplit } from '../types';

export function SharedExpensesPage() {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const splitter = useBillSplitter();

  const [formOpen, setFormOpen] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const [busyShare, setBusyShare] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { open, settled, totalOutstanding, totalRecovered, peopleOwing, payableFrom } = splitter;

  async function createBill(input: CreateBillSplitInput) {
    setActionError(null);
    try {
      const result = await splitter.create(input);
      toast.success(
        t('split.createdToast', {
          amount: money(result.billSplit.totalAmount),
          owed: money(result.billSplit.owedTotal),
        }),
        t('split.createdToastTitle'),
      );
      setFormOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('split.recordFailed'));
      throw err;
    }
  }

  async function pay(bill: BillSplit, index: number) {
    const share = bill.splits[index];
    // Keyed per share, not per page: two people on the same bill can be marked
    // off in sequence without the second button going dead while the first
    // settles.
    setBusyShare(`${bill.id}:${index}`);
    setActionError(null);
    try {
      const result = await splitter.markPaid(bill, index);
      const wallet = payableFrom.find((w) => w.id === bill.walletId);
      toast.success(
        result.alreadyPaid
          ? t('split.alreadyPaid', { name: share.personName })
          : t('split.paidToast', {
              name: share.personName,
              amount: money(share.amount),
              wallet: wallet?.name ?? '',
            }),
        t('split.paidToastTitle'),
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('split.recordFailed'));
    } finally {
      setBusyShare(null);
    }
  }

  async function undo(bill: BillSplit, index: number) {
    setBusyShare(`${bill.id}:${index}`);
    setActionError(null);
    try {
      await splitter.markUnpaid(bill, index);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('split.recordFailed'));
    } finally {
      setBusyShare(null);
    }
  }

  async function remove(bill: BillSplit) {
    if (!window.confirm(t('split.deleteConfirm', { title: bill.title }))) return;
    setActionError(null);
    try {
      await splitter.remove(bill);
      toast.success(t('split.deleted', { title: bill.title }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('common.somethingWentWrong'));
    }
  }

  /* ---------------------------------------------------------------- */
  /* One bill                                                          */
  /* ---------------------------------------------------------------- */

  const billCard = (bill: BillSplit) => {
    const wallet = payableFrom.find((w) => w.id === bill.walletId);
    const isSettled = bill.status === 'settled';
    /* Defensive, not decorative: one malformed row in the cache used to take
       the entire page down rather than just itself. */
    const shares = bill.splits ?? [];

    return (
      <article key={bill.id} className={cx('split-card', isSettled && 'is-settled')}>
        <header className="split-card-head">
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="split-card-title truncate">{bill.title}</span>
            <span className="list-item-sub">
              {formatDate(bill.createdAt, settings.locale)}
              {wallet && ` · ${t('split.paidFrom', { wallet: wallet.name })}`}
            </span>
          </div>
          <Badge tone={isSettled ? 'positive' : 'warning'}>
            {t(isSettled ? 'split.statusSettled' : 'split.statusOpen')}
          </Badge>
        </header>

        <div className="split-card-figures">
          <div className="metric">
            <span className="section-label">{t('split.leavesNowLabel')}</span>
            <span className="metric-value">{money(bill.totalAmount)}</span>
          </div>
          <div className="metric metric--accent">
            <span className="section-label">{t('split.youCoverLabel')}</span>
            <span className="metric-value">{money(bill.ownShare)}</span>
          </div>
          <div className={cx('metric', bill.outstanding > 0 && 'metric--negative')}>
            <span className="section-label">{t('split.owedToYou')}</span>
            <span className={cx('metric-value', bill.outstanding > 0 && 'text-negative')}>
              {money(bill.outstanding)}
            </span>
          </div>
        </div>

        {/* Progress is against what is *owed*, not the bill total: your own
            share was never going to come back, and counting it would leave a
            fully-settled bill stuck short of 100%. */}
        <div className="split-progress">
          <ProgressBar
            percent={bill.recoveredPercent}
            tone={isSettled ? 'ok' : 'warning'}
            label={t('split.recoveredOf', {
              recovered: money(bill.recovered),
              owed: money(bill.owedTotal),
            })}
          />
          <span className="split-progress-legend">
            {t('split.recoveredOf', {
              recovered: money(bill.recovered),
              owed: money(bill.owedTotal),
            })}
          </span>
        </div>

        <ul className="split-people">
          {shares.map((share, index) => {
            const key = `${bill.id}:${index}`;
            const busy = busyShare === key;
            return (
              <li key={key} className={cx('split-person', share.isPaid && 'is-paid')}>
                <span className="split-person-mark" aria-hidden="true">
                  {share.isPaid ? <Icon icon={Check} size="sm" /> : share.personName.charAt(0)}
                </span>
                <span className="split-person-name truncate">{share.personName}</span>
                <span className="split-person-amount">
                  {share.isPaid ? t('split.paid') : t('split.owesAmount', { amount: money(share.amount) })}
                </span>
                {share.isPaid ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy}
                    title={t('split.undoFor', { name: share.personName })}
                    aria-label={t('split.undoFor', { name: share.personName })}
                    onClick={() => void undo(bill, index)}
                  >
                    <Icon icon={RotateCcw} size="sm" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy}
                    aria-label={t('split.markPaidFor', { name: share.personName })}
                    onClick={() => void pay(bill, index)}
                  >
                    {t('split.markPaid')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {bill.note && <p className="split-card-note">{bill.note}</p>}

        <footer className="split-card-foot">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void remove(bill)}
            aria-label={t('split.deleteBill')}
          >
            <Icon icon={Trash2} size="sm" />
            {t('split.deleteBill')}
          </Button>
        </footer>
      </article>
    );
  };

  /* ---------------------------------------------------------------- */

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">{t('split.navLabel')}</span>
          <h1 className="page-title">{t('split.title')}</h1>
          <p className="page-lede">{t('split.lede')}</p>
        </div>
        <div className="cluster">
          <RefreshButton
            onRefresh={splitter.refresh}
            busy={splitter.isValidating}
            label={t('split.refresh')}
          />
          {settled.length > 0 && (
            <Button size="sm" onClick={() => setShowSettled((v) => !v)}>
              {t(showSettled ? 'split.hideSettled' : 'split.showSettled')}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => setFormOpen(true)}>
            <Icon icon={Plus} size="sm" />
            {t('split.newBill')}
          </Button>
        </div>
      </div>

      {actionError && (
        <Alert tone="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {splitter.initialLoading ? (
        <Card padded>
          <ListSkeleton rows={4} />
        </Card>
      ) : splitter.error && !splitter.bills.length ? (
        <Card padded>
          <Alert tone="error">{splitter.error}</Alert>
        </Card>
      ) : splitter.bills.length === 0 ? (
        <Card padded>
          <EmptyState
            icon={<Icon icon={HandCoins} size="xl" />}
            title={t('split.emptyTitle')}
            description={t('split.emptyBody')}
            action={
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                {t('split.splitFirstBill')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* ---- Roll-up across every bill ---- */}
          <section className={cx('split-hero', totalOutstanding <= 0 && 'is-clear')}>
            <div className="split-hero-primary">
              <span className="section-label">{t('split.owedToYou')}</span>
              <span className="hero-value">{money(totalOutstanding)}</span>
              <div className="hero-meta">
                <Badge tone={peopleOwing > 0 ? 'warning' : 'positive'}>
                  {peopleOwing > 0
                    ? t('split.peopleOwing', { count: peopleOwing })
                    : t('split.nobodyOwes')}
                </Badge>
                <span>{t('split.openBills', { count: open.length })}</span>
              </div>
            </div>

            <div className="hero-metrics">
              <div className="metric metric--positive">
                <span className="section-label">{t('split.recoveredTotal')}</span>
                <span className="metric-value text-positive">{money(totalRecovered)}</span>
              </div>
              <div className="metric">
                <span className="section-label">{t('split.settledBills')}</span>
                <span className="metric-value">{settled.length}</span>
              </div>
            </div>
          </section>

          <div className="split-grid">{open.filter(Boolean).map(billCard)}</div>

          {showSettled && settled.length > 0 && (
            <div className="split-grid">{settled.filter(Boolean).map(billCard)}</div>
          )}

          {/* The accounting note, kept at the bottom where it answers the
              question rather than pre-empting it. */}
          <Alert tone="info">{t('split.ledgerExplainer', { total: money(totalRecovered + totalOutstanding) })}</Alert>
        </>
      )}

      <BillSplitterForm
        open={formOpen}
        wallets={payableFrom}
        busy={splitter.mutating}
        error={actionError}
        onClose={() => {
          setFormOpen(false);
          setActionError(null);
        }}
        onSubmit={createBill}
      />
    </>
  );
}
