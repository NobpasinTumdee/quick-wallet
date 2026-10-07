import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, Button, Modal } from './ui';
import { ListSkeleton } from './Skeletons';
import { cx, formatPercent } from '../lib/format';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { useCandles } from '../hooks/useCandles';
import { useSettings } from '../state/SettingsContext';
import { formatMoney } from '../lib/format';
import { Quote } from '../types';

/* The chart is the heaviest thing on this screen and most quick looks never
   scroll to it, so it stays behind its own dynamic import — the same one the
   portfolio's terminal uses, so opening both costs one download. */
const TAChartTerminal = lazyWithRetry(() =>
  import('./TAChartTerminal').then((m) => ({ default: m.TAChartTerminal })),
);

/**
 * A ticker, looked at but not kept.
 *
 * ---------------------------------------------------------------------------
 * WHY NOTHING IS SAVED
 * ---------------------------------------------------------------------------
 * "What's Apple doing today" is a question people ask several times a week and
 * almost never want recorded. A watchlist that silently accumulates every
 * symbol anyone ever glanced at stops being a watchlist — it becomes a history
 * nobody curated and everybody has to prune.
 *
 * So this writes nothing. The quote comes from `useQuickQuote`, lives in
 * component state, and is gone when the modal closes. Keeping it is a separate
 * button, pressed on purpose.
 */
export function StockQuickView({
  open,
  symbol,
  quote,
  loading,
  error,
  alreadyWatched,
  onAddToWatchlist,
  onClose,
}: {
  open: boolean;
  symbol: string;
  quote: Quote | null;
  loading: boolean;
  error: string | null;
  /** Hides the save button for a symbol the watchlist already has. */
  alreadyWatched: boolean;
  onAddToWatchlist: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();

  /* Only fetched while the modal is open and a symbol resolved: passing null
     keeps the hook idle, so merely having this component mounted costs no
     request. Same cache and rate limiter as the portfolio's own chart. */
  const chart = useCandles(open && quote ? symbol : null, 12);

  const up = (quote?.changePercent ?? 0) >= 0;
  const absoluteChange = quote ? quote.price - quote.previousClose : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={symbol || t('invest.quickViewTitle')}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          {/* Offered only once there is something to keep, and never for a
              symbol already on the list — a button that silently does nothing
              is worse than no button. */}
          {quote && !alreadyWatched && (
            <Button variant="primary" onClick={onAddToWatchlist}>
              {t('invest.addToWatchlist')}
            </Button>
          )}
        </>
      }
    >
      {loading && <ListSkeleton rows={3} />}

      {!loading && error && <Alert tone="error">{error}</Alert>}

      {!loading && quote && (
        <div className="quick-view">
          <div className="quick-view-hero">
            {/* The market's own currency, not the bookkeeping one: this is a
                price on an exchange, not a position in the portfolio, so
                converting it would invent a number nobody quoted. */}
            <span className="quick-view-price">
              {formatMoney(quote.price, quote.currency, settings.locale)}
            </span>
            <span className={cx('quick-view-delta', up ? 'is-up' : 'is-down')}>
              {formatPercent(quote.changePercent, 2, true)}
              <small>
                {absoluteChange >= 0 ? '+' : '−'}
                {formatMoney(Math.abs(absoluteChange), quote.currency, settings.locale)}
                {' · '}
                {t('invest.prevClose')} {formatMoney(quote.previousClose, quote.currency, settings.locale)}
              </small>
            </span>
          </div>

          {quote.source === 'simulated' && (
            <Alert tone="warning">{t('invest.simulatedNote')}</Alert>
          )}

          <Suspense fallback={<div className="candle-frame" style={{ height: 260 }} />}>
            <TAChartTerminal
              candles={chart.candles}
              height={260}
              loading={chart.loading}
              refreshing={chart.refreshing}
              error={chart.error}
              cooldown={chart.cooldown}
              onRetry={chart.reload}
            />
          </Suspense>

          {/* Deliberately absent: shares, average cost, P/L. There is no
              position here, and showing zeroes for them would read as "you own
              none of this" rather than "this is not that kind of screen". */}
          <p className="quick-view-note">{t('invest.quickViewEphemeral')}</p>
        </div>
      )}
    </Modal>
  );
}
