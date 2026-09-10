import {
  ChartColumn,
  ChevronDown,
  Eye,
  Flag,
  Maximize2,
  Minimize2,
  Plus,
  Receipt,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import type { ChartReadout } from '../components/StockCandlestickChart';
import { useCandles } from '../hooks/useCandles';
import { candleProviderName } from '../services/candleApi';
import { InvestmentForm, InvestmentPayload } from '../components/InvestmentForm';
import { WatchlistForm, WatchlistPayload } from '../components/WatchlistForm';
import {
  Alert,
  Badge,
  Button,
  Card,
  DecimalInput,
  EmptyState,
  Field,
  Modal,
  RefreshButton,
  Segmented,
  Select,
  Skeleton,
  StatCard,
  parseDecimal,
} from '../components/ui';
import { useExcelDB } from '../hooks/useExcelDB';
import { useFullscreen } from '../hooks/useFullscreen';
import { PositionValuation, useStockQuotes } from '../hooks/useStockQuotes';
import { useSymbolQuotes } from '../hooks/useSymbolQuotes';
import { targetProximity, useWatchlist } from '../hooks/useWatchlist';
import {
  cx,
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  todayKey,
} from '../lib/format';
import { ValuedHolding, groupValuedHoldings } from '../lib/positions';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Investment, WalletBalance, WatchlistItem } from '../types';

/* lightweight-charts is ~180kB and only this one card uses it, so it loads
   alongside the positions request rather than blocking every other route. */
const StockCandlestickChart = lazy(() =>
  import('../components/StockCandlestickChart').then((m) => ({ default: m.StockCandlestickChart })),
);

/** A holding, priced. Spelled out once so the handlers below can name it. */
type Position = ValuedHolding<PositionValuation>;

/**
 * What the sell modal is about to close.
 *
 * A holding is many lots, and each lot is sold independently — so selling has
 * to say *which*. `lotId: 'all'` closes the whole position at one price, which
 * is what "I sold my Apple" almost always means.
 */
interface SellTarget {
  holding: Position;
  lotId: string | 'all';
}

export function InvestmentsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [view, setView] = useState<'hold' | 'sold'>('hold');
  const [tagFilter, setTagFilter] = useState('');

  const wallets = useExcelDB<WalletBalance>('wallets');
  const investments = useExcelDB<Investment>('investments');

  /** Holdings vs Watchlist. The chart below is shared by both. */
  const [tab, setTab] = useState<'holdings' | 'watchlist'>('holdings');

  /** Which holding is selected. Drives the row highlight and the history row. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  /**
   * The symbol the candle chart is drawing.
   *
   * Split out from `selectedKey` so a watched symbol — which has no holding and
   * therefore no key — can drive the same chart. Holdings selection still sets
   * it, so the existing behaviour is unchanged; the watchlist simply becomes a
   * second thing that can point it somewhere.
   */
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  /** Which holding has its purchase history open. Usually the selected one. */
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  /** O/H/L/C under the crosshair; null falls back to the latest bar. */
  const [readout, setReadout] = useState<ChartReadout | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Investment | undefined>();
  /** Set when the form was opened as "buy more of this", not "new position". */
  const [addTo, setAddTo] = useState<Position | null>(null);
  const [sellTarget, setSellTarget] = useState<SellTarget | null>(null);
  /** Raw string so long decimals survive typing; parsed on confirm. */
  const [sellPrice, setSellPrice] = useState('');
  /** Which currency the sell price is being typed in. */
  const [sellCurrency, setSellCurrency] = useState<'quote' | 'base'>('base');

  const portfolio = useStockQuotes(investments.items);
  const watchlist = useWatchlist();
  /* Watched names re-price every three minutes rather than every minute, and
     share stockApi's cache, rate limiter and per-symbol de-duplication with the
     holdings hook — so a symbol that is both owned and watched costs exactly
     one request. See hooks/useSymbolQuotes.ts. */
  const watchQuotes = useSymbolQuotes(watchlist.symbols);
  const money = useMoneyFormatter();

  const investmentWallets = wallets.items.filter((w) => w.mode === 'investment' && !w.archived);

  /* ---- Lots → holdings -------------------------------------------------
     `portfolio.positions` is one entry per *purchase*. Buying the same ticker
     every month makes that list grow without the position changing, so the
     table groups them: one row per holding, blended average cost, purchase
     history one click away. See lib/positions.ts for the arithmetic. */
  const holdings = useMemo(
    () => groupValuedHoldings(portfolio.positions),
    [portfolio.positions],
  );

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const inv of investments.items) inv.tagList?.forEach((tag) => tags.add(tag));
    return [...tags].sort();
  }, [investments.items]);

  const matchesTag = (tags: string[] | undefined) =>
    !tagFilter || Boolean(tags?.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase()));

  const visibleHoldings = holdings.filter((holding) => matchesTag(holding.tagList));

  /* Sold lots stay ungrouped. A closed lot has its own realised P&L against its
     own cost basis, and averaging those together would erase the very thing the
     Sold tab exists to show. */
  const soldLots = investments.items.filter((i) => i.status === 'sold');
  const visibleSoldLots = soldLots.filter((row) => matchesTag(row.tagList));

  const realizedTotal = soldLots.reduce((sum, i) => sum + i.realizedPnl, 0);

  /* Pick the first open holding once data arrives, and re-pick if the charted
     one is sold or deleted — otherwise the chart would keep drawing a position
     that is no longer in the table. */
  const holdingKeys = useMemo(() => holdings.map((h) => h.key), [holdings]);

  useEffect(() => {
    if (!holdingKeys.length) {
      setSelectedKey(null);
      setHistoryKey(null);
      return;
    }
    setSelectedKey((current) => (current && holdingKeys.includes(current) ? current : holdingKeys[0]));
    setHistoryKey((current) => (current && holdingKeys.includes(current) ? current : null));
  }, [holdingKeys]);

  /* Everything the chart is allowed to draw: owned or watched. Kept as a sorted
     string so a background quote refresh — which rebuilds `holdings` — does not
     restart the effect below on identity alone. */
  const firstHoldingSymbol = holdings[0]?.symbol ?? null;
  const chartableKey = useMemo(
    () => [...new Set([...holdings.map((h) => h.symbol), ...watchlist.symbols])].sort().join(','),
    [holdings, watchlist.symbols],
  );

  /**
   * Keeps the chart pointed at something real.
   *
   * Only fills a blank or repairs a stale pick — it never tracks the holding
   * selection, because that would yank the chart back off a watched symbol on
   * the next background revalidation.
   */
  useEffect(() => {
    const available = chartableKey ? chartableKey.split(',') : [];
    setChartSymbol((current) =>
      current && available.includes(current)
        ? current
        : firstHoldingSymbol ?? available[0] ?? null,
    );
  }, [chartableKey, firstHoldingSymbol]);

  const chart = useCandles(chartSymbol, 12);
  /** True when the charted symbol is watched but not owned. */
  const chartedIsWatched = Boolean(
    chartSymbol && !holdings.some((h) => h.symbol === chartSymbol),
  );

  /* The crosshair bar when hovering, else the most recent one, so the readout
     always shows real numbers instead of blanking when the pointer leaves. */
  const latest = chart.candles.length ? chart.candles[chart.candles.length - 1] : null;
  const shown = readout ?? (latest ? { ...latest, change: latest.close - latest.open } : null);

  /* The broker's currency and today's rate into the books. Used to show avg cost
     the way the brokerage app shows it. */
  const brokerCurrency =
    Object.keys(portfolio.fx.rates).find((c) => c !== portfolio.baseCurrency) ?? 'USD';
  const brokerRate =
    brokerCurrency === portfolio.baseCurrency ? 0 : (portfolio.fx.rateFor(brokerCurrency) || 0);

  /**
   * Spots positions whose buy price was typed in the broker's currency but saved
   * as base currency — the bug that produced +3000% P&L. The tell is a cost per
   * share that is smaller than the live converted price by roughly the FX rate.
   *
   * Checked per holding rather than per lot: one mis-entered lot drags the
   * blended average down, so the holding is the thing that reads wrong.
   */
  function looksMisEntered(position: { quote: unknown; marketPrice: number; avgCost: number }): boolean {
    if (brokerRate < 2 || !position.quote || position.avgCost <= 0) return false;
    const ratio = position.marketPrice / position.avgCost;
    return ratio > brokerRate * 0.6 && ratio < brokerRate * 1.8;
  }

  const misEnteredCount = holdings.filter(looksMisEntered).length;

  /** The rate actually in use, for the banner. Null when nothing needs converting. */
  const convertedRate = useMemo(() => {
    const entry = Object.entries(portfolio.fx.rates).find(
      ([currency, lookup]) => currency !== portfolio.baseCurrency && lookup.source !== 'none',
    );
    if (!entry) return null;
    return { currency: entry[0], rate: entry[1].rate, fetchedAt: entry[1].fetchedAt };
  }, [portfolio.fx.rates, portfolio.baseCurrency]);

  async function save(payload: InvestmentPayload) {
    // Adding to a holding is a plain create: a new lot, never a merge. Merging
    // would rewrite the cost basis of shares bought months ago.
    if (editing) await investments.update(editing.id, payload);
    else await investments.create(payload);
    closeForm();
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(undefined);
    setAddTo(null);
    investments.clearMutationError();
  }

  function openNewPosition() {
    setEditing(undefined);
    setAddTo(null);
    setFormOpen(true);
  }

  function openBuyMore(holding: Position) {
    setEditing(undefined);
    setAddTo(holding);
    setFormOpen(true);
  }

  function openEditLot(lot: Investment) {
    setAddTo(null);
    setEditing(lot);
    setFormOpen(true);
  }

  /** Opens the sell sheet, prefilled with the live price already converted. */
  function openSell(holding: Position, lotId: string | 'all') {
    setSellTarget({ holding, lotId });
    setSellCurrency('base');
    // Round away float noise (10932.900000000001).
    const prefill = holding.marketPrice || holding.avgCost;
    setSellPrice(String(Number(prefill.toFixed(4))));
  }

  /** The lots the current sell will close. */
  const sellLots: PositionValuation[] = sellTarget
    ? sellTarget.lotId === 'all'
      ? sellTarget.holding.lots
      : sellTarget.holding.lots.filter((lot) => lot.id === sellTarget.lotId)
    : [];

  const sellInQuote = sellCurrency === 'quote' && brokerRate > 0;
  /** Always submitted in the bookkeeping currency, whatever was typed. */
  const sellPriceValue = sellInQuote
    ? parseDecimal(sellPrice) * brokerRate
    : parseDecimal(sellPrice);

  const sellQuantity = sellLots.reduce((sum, lot) => sum + lot.quantity, 0);
  const sellCost = sellLots.reduce((sum, lot) => sum + lot.costBasis, 0);
  const sellProceeds = sellQuantity * sellPriceValue;

  async function confirmSell() {
    if (!sellTarget || sellPriceValue <= 0 || !sellLots.length) return;

    try {
      /* Sequential, not Promise.all: each sell is an optimistic write that
         patches the same cached list, and Apps Script serialises writes anyway.
         Firing them in parallel would just race the cache patches.

         A failure part-way through leaves the earlier lots genuinely sold —
         which is correct, they were. The modal stays open on the remainder and
         `action` has already toasted the reason. */
      for (const lot of sellLots) {
        await investments.action(lot.id, 'sell', {
          sellPrice: sellPriceValue,
          sellDate: todayKey(),
        });
      }
      setSellTarget(null);
    } catch {
      /* useExcelDB toasted it; leave the sheet open so the rest can be retried. */
    }
  }

  async function removeLot(lot: Investment) {
    const label = `${lot.symbol} — ${formatNumber(lot.quantity, 8, settings.locale)} bought ${formatDate(lot.buyDate, settings.locale)}`;
    if (!window.confirm(t('invest.deletePurchaseConfirm', { label }))) return;
    await investments.remove(lot.id);
  }

  /* ---- Watchlist ---- */

  const [watchFormOpen, setWatchFormOpen] = useState(false);
  const [editingWatch, setEditingWatch] = useState<WatchlistItem | undefined>();
  /** Pre-fills the category when adding from inside a section header. */
  const [watchCategory, setWatchCategory] = useState('');
  /** Category names the user has folded away. Empty = everything open. */
  const [collapsedCategories, setCollapsedCategories] = useState<string[]>([]);

  /* A watchlist is a scanning surface — the longer it gets, the more it wants
     the whole screen. The card itself does the expanding; the hook adds the
     browser-chrome removal and the ways back out. */
  const watchFullscreen = useFullscreen();

  /* The chart gets its own, because the two are never expanded together and
     each needs its own collapse target. */
  const chartFullscreen = useFullscreen();

  /**
   * lightweight-charts is sized in pixels, not by CSS, so a full-screen chart
   * has to be told how tall to be. Entering native fullscreen removes the
   * browser chrome and therefore changes `innerHeight`, which is why this
   * listens rather than measuring once.
   */
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );

  useEffect(() => {
    if (!chartFullscreen.expanded) return undefined;
    const measure = () => setViewportHeight(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    // Mobile browsers move their toolbars without firing a window resize.
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [chartFullscreen.expanded]);

  /** Viewport less the card padding and the symbol/OHLC row above the canvas. */
  const chartHeight = chartFullscreen.expanded
    ? Math.max(320, viewportHeight - 150)
    : 340;

  /* The expanded card covers the tab bar, so this is not reachable by mouse —
     but a keyboard user can still tab to it behind the overlay. Without this,
     switching tabs would unmount the card and leave the browser in fullscreen
     with the page scroll locked and nothing on screen explaining why. */
  const collapseWatchFullscreen = watchFullscreen.collapse;
  useEffect(() => {
    if (tab !== 'watchlist') collapseWatchFullscreen();
  }, [tab, collapseWatchFullscreen]);

  /* Same guard for the chart. `chartSymbol` can go null underneath an expanded
     card — every position sold on another device, say — and the card would
     unmount while the browser was still in fullscreen with the scroll locked. */
  const collapseChartFullscreen = chartFullscreen.collapse;
  useEffect(() => {
    if (!chartSymbol) collapseChartFullscreen();
  }, [chartSymbol, collapseChartFullscreen]);

  function openWatchForm(item?: WatchlistItem, category = '') {
    setEditingWatch(item);
    setWatchCategory(category);
    setWatchFormOpen(true);
  }

  function closeWatchForm() {
    setWatchFormOpen(false);
    setEditingWatch(undefined);
    setWatchCategory('');
    watchlist.clearMutationError();
  }

  async function saveWatch(payload: WatchlistPayload) {
    if (editingWatch) await watchlist.update(editingWatch.id, payload);
    else await watchlist.create(payload);
    closeWatchForm();
  }

  async function removeWatch(item: WatchlistItem) {
    if (!window.confirm(t('invest.removeFromWatchlistConfirm', { symbol: item.symbol }))) return;
    await watchlist.remove(item.id);
  }

  function toggleCategory(category: string) {
    setCollapsedCategories((current) =>
      current.includes(category)
        ? current.filter((name) => name !== category)
        : [...current, category],
    );
  }

  /** Clicking a holding charts it and opens its history; clicking again closes. */
  function toggleHolding(key: string) {
    setSelectedKey(key);
    setChartSymbol(holdings.find((holding) => holding.key === key)?.symbol ?? null);
    setHistoryKey((current) => (current === key ? null : key));
  }

  if (investments.initialLoading || wallets.initialLoading) {
    return (
      <Card title={t('invest.loadingPositions')}>
        <Skeleton rows={5} />
      </Card>
    );
  }

  if (investmentWallets.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Icon icon={TrendingUp} size="xl" />}
          title={t('invest.noWalletTitle')}
          description={t('invest.noWalletBody')}
        />
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid--stats">
        <StatCard
          label={t('invest.costBasis')}
          icon={<Icon icon={Receipt} size="sm" />}
          value={money(portfolio.totalCost, { compact: true })}
          hint={`${t('invest.positionCount', { count: holdings.length })} · ${t('invest.purchaseCount', { count: portfolio.positions.length })}`}
        />
        <StatCard
          label={t('invest.marketValue')}
          tone="accent"
          icon={<Icon icon={TrendingUp} size="sm" />}
          value={money(portfolio.totalValue, { compact: true })}
          hint={t('invest.quoteMeta', { provider: portfolio.provider, time: formatRelativeTime(portfolio.lastUpdated) })}
        />
        <StatCard
          label={t('invest.unrealisedPnl')}
          tone={portfolio.totalPnl >= 0 ? 'positive' : 'negative'}
          icon={<Icon icon={ChartColumn} size="sm" />}
          value={formatPercent(portfolio.totalPnlPercent, 2, true)}
          hint={money(portfolio.totalPnl, { signed: true })}
        />
        <StatCard
          label={t('invest.realisedPnl')}
          tone={realizedTotal >= 0 ? 'positive' : 'negative'}
          icon={<Icon icon={Flag} size="sm" />}
          value={money(realizedTotal, { signed: true })}
          hint={t('invest.closedLots', { count: soldLots.length })}
        />
      </div>

      {/* Conversion is doing real work to the numbers, so it is stated openly
          rather than hidden behind the totals. */}
      {portfolio.fx.degraded ? (
        <Alert tone="error" title={t('invest.rateUnavailable')}>
          {portfolio.fx.unresolved.join(', ')} prices could not be converted to {portfolio.baseCurrency},
          so they are being compared 1:1 against your cost basis. P&amp;L for those positions is wrong
          until the rate is available — press Refresh prices to retry.
        </Alert>
      ) : (
        convertedRate && (
          <Alert tone="info" title={t('invest.currencyConversion')}>
            Prices are quoted in {convertedRate.currency} and converted at{' '}
            <strong>
              1 {convertedRate.currency} = {convertedRate.rate.toFixed(4)} {portfolio.baseCurrency}
            </strong>{' '}
            to compare against your {portfolio.baseCurrency} cost basis.
            {convertedRate.fetchedAt && ` ${t('invest.rateFrom', { time: formatRelativeTime(convertedRate.fetchedAt) })}`}
          </Alert>
        )
      )}

      {misEnteredCount > 0 && (
        <Alert tone="warning" title={t('invest.misEntered', { count: misEnteredCount, currency: brokerCurrency })}>
          Their cost per share is roughly {brokerRate.toFixed(0)}× below the live price, which is what a{' '}
          {brokerCurrency} price saved into a {portfolio.baseCurrency} field looks like. Open the
          purchase history, edit the offending buy, switch its price to{' '}
          <strong>{brokerCurrency}</strong>, re-enter the broker's figure, and the average will
          correct itself.
        </Alert>
      )}

      {!portfolio.isLive && (
        <Alert tone="warning" title={t('invest.simulatedPrices')}>
          No stock API key configured, so prices are generated locally and P&L is illustrative. Add{' '}
          <code>VITE_STOCK_API_KEY</code> to <code>frontend/.env.local</code> for live quotes.
        </Alert>
      )}

      {Object.keys(portfolio.errors).length > 0 && (
        <Alert tone="warning" title={t('invest.someQuotesFailed')}>
          {Object.entries(portfolio.errors)
            .map(([symbol, message]) => t('invest.quoteError', { symbol, message }))
            .join(' · ')}
        </Alert>
      )}

      {/* ---- Price history for whatever is charted ----
          Fed by `chartSymbol`, which either tab can set. The candle provider
          and its 8/min cooldown are untouched by the watchlist: switching to a
          watched symbol is the same single request switching holdings was. */}
      {chartSymbol && !watchFullscreen.expanded && (
        <Card className={cx('card--glass', chartFullscreen.expanded && 'card--fullscreen')}>
          <div className="candle-card-head">
            <div>
              <span className="candle-symbol">
                {chartSymbol}
                {chartedIsWatched && (
                  <Badge tone="accent">
                    <span className="watch-badge">
                      <Icon icon={Eye} size="sm" />
                      watching
                    </span>
                  </Badge>
                )}
                <span className="candle-symbol-meta">
                  daily · 12 months · {candleProviderName()}
                  {chart.fromCache && ' · cached'}
                </span>
              </span>
            </div>

            <div className="candle-head-tools">
              {shown && (
                <div className="candle-ohlc">
                  <span>O<b>{shown.open.toFixed(2)}</b></span>
                  <span>H<b>{shown.high.toFixed(2)}</b></span>
                  <span>L<b>{shown.low.toFixed(2)}</b></span>
                  <span>
                    C
                    <b className={shown.change >= 0 ? 'is-up' : 'is-down'}>
                      {shown.close.toFixed(2)}
                    </b>
                  </span>
                  <span className={shown.change >= 0 ? 'is-up' : 'is-down'}>
                    {shown.change >= 0 ? '+' : ''}
                    {shown.change.toFixed(2)}
                  </span>
                </div>
              )}

              <Button
                size="sm"
                variant="ghost"
                className="card-expand"
                onClick={chartFullscreen.toggle}
                aria-pressed={chartFullscreen.expanded}
                title={
                  chartFullscreen.expanded
                    ? t('invest.exitFullscreenHint')
                    : t('invest.expandChart', { symbol: chartSymbol })
                }
                aria-label={chartFullscreen.expanded ? t('invest.exitFullscreen') : t('invest.fullscreen')}
              >
                <Icon icon={chartFullscreen.expanded ? Minimize2 : Maximize2} size="sm" />
              </Button>
            </div>
          </div>

          <Suspense fallback={<div className="candle-frame" style={{ height: chartHeight }} />}>
          <StockCandlestickChart
            candles={chart.candles}
            height={chartHeight}
            loading={chart.loading}
            refreshing={chart.refreshing}
            error={chart.error}
            cooldown={chart.cooldown}
            onRetry={chart.reload}
            onReadout={setReadout}
          />
          </Suspense>
        </Card>
      )}

      {/* ---- Holdings / Watchlist ----
          One tab bar over two lists that share the chart above. The holdings
          side below is unchanged. */}
      <div className="invest-tabs" role="tablist" aria-label="Investment view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'holdings'}
          className={cx('invest-tab', tab === 'holdings' && 'is-active')}
          onClick={() => setTab('holdings')}
        >
          <Icon icon={TrendingUp} size="sm" />
          {t('invest.holdings')}
          <span className="invest-tab-count">{holdings.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'watchlist'}
          className={cx('invest-tab', tab === 'watchlist' && 'is-active')}
          onClick={() => setTab('watchlist')}
        >
          <Icon icon={Eye} size="sm" />
          {t('invest.watchlist')}
          <span className="invest-tab-count">{watchlist.items.length}</span>
        </button>
      </div>

      {tab === 'holdings' && (
      <Card
        title={t('invest.positions')}
        actions={
          <>
            {/* Positions come from the sheet; prices come from the quote API.
                This pulls the rows, the button beside it re-quotes them. */}
            <RefreshButton
              onRefresh={() => Promise.all([investments.refresh(), wallets.refresh()])}
              busy={investments.isValidating || wallets.isValidating}
              label={t('invest.refreshPositions')}
            />
            <Button size="sm" onClick={() => void portfolio.refresh()} loading={portfolio.loading}>
              {t('invest.refreshPrices')}
            </Button>
            <Button size="sm" variant="primary" onClick={openNewPosition}>
              {t('invest.newPosition')}
            </Button>
          </>
        }
        padded={false}
      >
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="toolbar">
            <Segmented<'hold' | 'sold'>
              value={view}
              ariaLabel={t('invest.positionView')}
              onChange={setView}
              options={[
                { value: 'hold', label: t('invest.holdingCount', { count: holdings.length }) },
                { value: 'sold', label: t('invest.soldCount', { count: soldLots.length }) },
              ]}
            />
            <div className="spacer" />
            {allTags.length > 0 && (
              <div className="tag-row">
                <button
                  type="button"
                  className={cx('user-chip', !tagFilter && 'is-active')}
                  onClick={() => setTagFilter('')}
                >
                  all
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={cx('user-chip', tagFilter === tag && 'is-active')}
                    onClick={() => setTagFilter(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {investments.mutationError && (
          <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
            <Alert tone="error" onDismiss={investments.clearMutationError}>
              {investments.mutationError}
            </Alert>
          </div>
        )}

        {(view === 'hold' ? visibleHoldings.length : visibleSoldLots.length) === 0 ? (
          <EmptyState
            icon={<Icon icon={TrendingUp} size="xl" />}
            title={view === 'hold' ? 'No open positions' : 'Nothing sold yet'}
            description={
              view === 'hold'
                ? t('invest.emptyHoldingsBody')
                : t('invest.emptySoldBody')
            }
            action={
              view === 'hold' ? (
                <Button variant="primary" onClick={openNewPosition}>
                  {t('invest.addPosition')}
                </Button>
              ) : undefined
            }
          />
        ) : view === 'hold' ? (
          /* ---------------- Open holdings ---------------- */
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('invest.symbol')}</th>
                  <th className="num">{t('invest.quantity')}</th>
                  <th className="num">{t('invest.avgCost')}</th>
                  <th className="num">{t('invest.price')}</th>
                  <th className="num">{t('invest.value')}</th>
                  <th className="num">{t('invest.pnl')}</th>
                  <th>{t('invest.tags')}</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {visibleHoldings.map((holding) => {
                  const charted = holding.key === selectedKey;
                  const expanded = holding.key === historyKey;
                  const averaged = holding.lots.length > 1;

                  return [
                    <tr
                      key={holding.key}
                      className={cx('is-selectable', charted && 'is-charted')}
                      onClick={() => toggleHolding(holding.key)}
                      tabIndex={0}
                      role="button"
                      aria-expanded={expanded}
                      aria-label={t('invest.chartAndHistory', { symbol: holding.symbol })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleHolding(holding.key);
                        }
                      }}
                    >
                      <td>
                        <span className="holding-symbol">
                          <Icon
                            icon={ChevronDown}
                            size="sm"
                            className={cx('holding-caret', expanded && 'is-open')}
                          />
                          <strong>{holding.symbol}</strong>
                          {/* The lot count is the whole DCA story in one glyph:
                              it says "this average was built, not paid". */}
                          {averaged && <Badge>{holding.lots.length} buys</Badge>}
                          {looksMisEntered(holding) && (
                            <Badge tone="warning">
                              <span
                                title={t('invest.checkPriceHint', { factor: brokerRate.toFixed(0), quote: brokerCurrency, base: portfolio.baseCurrency })}
                              >
                                check price
                              </span>
                            </Badge>
                          )}
                        </span>
                        <div className="list-item-sub">
                          {averaged
                            ? t('invest.dateRange', { from: formatDate(holding.firstBuyDate, settings.locale), to: formatDate(holding.lastBuyDate, settings.locale) })
                            : formatDate(holding.firstBuyDate, settings.locale)}
                        </div>
                      </td>
                      <td className="num">{formatNumber(holding.quantity, 8, settings.locale)}</td>
                      {/* Shown in the broker's currency so it matches their app,
                          with the authoritative base-currency total beneath. */}
                      <td className="num">
                        {brokerRate > 0 ? (
                          <>
                            <span className="price-native" title="Converted at today's rate">
                              {formatMoney(holding.avgCost / brokerRate, brokerCurrency, settings.locale)}
                            </span>
                            <div className="list-item-sub">{money(holding.costBasis)} total</div>
                          </>
                        ) : (
                          <>
                            {money(holding.avgCost)}
                            <div className="list-item-sub">{money(holding.costBasis)} total</div>
                          </>
                        )}
                      </td>
                      {/* Price stays in the market's own currency — that's the
                          number you'd see on a broker screen. */}
                      <td className="num">
                        {holding.quote ? (
                          <>
                            <span className="price-native">
                              {formatMoney(holding.nativePrice, holding.nativeCurrency, settings.locale)}
                            </span>
                            <div
                              className={cx(
                                'list-item-sub',
                                holding.quote.changePercent >= 0 ? 'text-positive' : 'text-negative',
                              )}
                            >
                              {formatPercent(holding.quote.changePercent, 2, true)} today
                            </div>
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      {/* Value and P&L are converted, so they're comparable with
                          the cost basis and with the rest of the app. */}
                      <td className="num">
                        {money(holding.marketValue)}
                        {holding.converted && (
                          <div className="list-item-sub" title={`Converted at ${holding.fxRate.toFixed(4)}`}>
                            @ {holding.fxRate.toFixed(2)} {holding.nativeCurrency}/{money.base}
                          </div>
                        )}
                      </td>
                      <td
                        className={cx('num', holding.unrealizedPnl >= 0 ? 'text-positive' : 'text-negative')}
                      >
                        {formatPercent(holding.unrealizedPnlPercent, 2, true)}
                        <div className="list-item-sub">{money(holding.unrealizedPnl, { signed: true })}</div>
                      </td>
                      <td>
                        <div className="tag-row">
                          {holding.tagList.length ? (
                            holding.tagList.map((tag) => <Badge key={tag}>{tag}</Badge>)
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        {/* stopPropagation: the row itself is a button. */}
                        <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            title={t('invest.addAnotherPurchase', { symbol: holding.symbol })}
                            onClick={() => openBuyMore(holding)}
                          >
                            <Icon icon={Plus} size="sm" />
                            {t('invest.buy')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openSell(holding, averaged ? 'all' : holding.lots[0].id)}
                          >
                            {t('invest.sell')}
                          </Button>
                        </div>
                      </td>
                    </tr>,

                    /* ---- Purchase history ----
                       A sibling row rather than a nested table inside the cell,
                       so the parent row's columns stay aligned with every other
                       row while the history spans the full width. */
                    expanded && (
                      <tr key={`${holding.key}:history`} className="lot-row">
                        <td colSpan={8}>
                          <div className="lot-history">
                            <div className="lot-history-head">
                              <strong>{t('invest.purchaseHistory')}</strong>
                              <span className="text-faint">
                                {holding.lots.length} {holding.lots.length === 1 ? 'buy' : 'buys'} ·
                                averaged to {money(holding.avgCost)}/share
                                {holding.highestBuyPrice > holding.lowestBuyPrice && (
                                  <>
                                    {' '}
                                    from a range of {money(holding.lowestBuyPrice)}–
                                    {money(holding.highestBuyPrice)}
                                  </>
                                )}
                              </span>
                              <div className="spacer" />
                              <Button size="sm" onClick={() => openBuyMore(holding)}>
                                <Icon icon={Plus} size="sm" />
                                {t('invest.addPurchase')}
                              </Button>
                            </div>

                            <table className="data data--nested">
                              <thead>
                                <tr>
                                  <th>{t('invest.bought')}</th>
                                  <th className="num">{t('invest.quantity')}</th>
                                  <th className="num">{t('invest.pricePerShare')}</th>
                                  <th className="num">{t('invest.cost')}</th>
                                  <th className="num">{t('invest.shareOfPosition')}</th>
                                  <th className="num">{t('invest.pnl')}</th>
                                  <th className="num" />
                                </tr>
                              </thead>
                              <tbody>
                                {holding.lots.map((lot) => {
                                  // Per-share cost including this lot's own fees,
                                  // so it is comparable with the blended average.
                                  const lotCost = lot.quantity > 0 ? lot.costBasis / lot.quantity : 0;
                                  const vsAverage = holding.avgCost > 0
                                    ? ((lotCost - holding.avgCost) / holding.avgCost) * 100
                                    : 0;
                                  const weight = holding.costBasis > 0
                                    ? (lot.costBasis / holding.costBasis) * 100
                                    : 0;

                                  return (
                                    <tr key={lot.id}>
                                      <td>
                                        <strong>{formatDate(lot.buyDate, settings.locale)}</strong>
                                        {lot.note && <div className="list-item-sub">{lot.note}</div>}
                                      </td>
                                      <td className="num">
                                        {formatNumber(lot.quantity, 8, settings.locale)}
                                      </td>
                                      <td className="num">
                                        {money(lotCost)}
                                        {/* The reason this row is worth seeing:
                                            which buys pulled the average which way. */}
                                        {holding.lots.length > 1 && Math.abs(vsAverage) >= 0.01 && (
                                          <div
                                            className={cx(
                                              'list-item-sub',
                                              vsAverage <= 0 ? 'text-positive' : 'text-negative',
                                            )}
                                          >
                                            {formatPercent(vsAverage, 1, true)} vs avg
                                          </div>
                                        )}
                                      </td>
                                      <td className="num">
                                        {money(lot.costBasis)}
                                        {lot.fees > 0 && (
                                          <div className="list-item-sub">
                                            incl. {money(lot.fees)} fees
                                          </div>
                                        )}
                                      </td>
                                      <td className="num">{formatPercent(weight, 1)}</td>
                                      <td
                                        className={cx(
                                          'num',
                                          lot.unrealizedPnl >= 0 ? 'text-positive' : 'text-negative',
                                        )}
                                      >
                                        {lot.quote ? (
                                          <>
                                            {formatPercent(lot.unrealizedPnlPercent, 2, true)}
                                            <div className="list-item-sub">
                                              {money(lot.unrealizedPnl, { signed: true })}
                                            </div>
                                          </>
                                        ) : (
                                          <span className="text-faint">—</span>
                                        )}
                                      </td>
                                      <td className="num">
                                        <div className="row-actions">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => openSell(holding, lot.id)}
                                          >
                                            {t('invest.sell')}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => openEditLot(lot)}
                                          >
                                            {t('common.edit')}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            aria-label={t('invest.deletePurchase')}
                                            onClick={() => void removeLot(lot)}
                                          >
                                            ✕
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* ---------------- Closed lots ---------------- */
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('invest.symbol')}</th>
                  <th className="num">{t('invest.quantity')}</th>
                  <th className="num">{t('invest.avgCost')}</th>
                  <th className="num">{t('invest.sellPrice')}</th>
                  <th className="num">{t('invest.proceeds')}</th>
                  <th className="num">{t('invest.pnl')}</th>
                  <th>{t('invest.tags')}</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {visibleSoldLots.map((lot) => (
                  <tr key={lot.id}>
                    <td>
                      <strong>{lot.symbol}</strong>
                      <div className="list-item-sub">
                        bought {formatDate(lot.buyDate, settings.locale)} · sold{' '}
                        {formatDate(lot.sellDate, settings.locale)}
                      </div>
                    </td>
                    <td className="num">{formatNumber(lot.quantity, 8, settings.locale)}</td>
                    <td className="num">{money(lot.avgCost)}</td>
                    <td className="num">{money(lot.sellPrice)}</td>
                    <td className="num">{money(lot.quantity * lot.sellPrice)}</td>
                    <td className={cx('num', lot.realizedPnl >= 0 ? 'text-positive' : 'text-negative')}>
                      {formatPercent(lot.realizedPnlPercent, 2, true)}
                      <div className="list-item-sub">{money(lot.realizedPnl, { signed: true })}</div>
                    </td>
                    <td>
                      <div className="tag-row">
                        {lot.tagList?.length ? (
                          lot.tagList.map((tag) => <Badge key={tag}>{tag}</Badge>)
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </div>
                    </td>
                    <td className="num">
                      <div className="row-actions">
                        <Button size="sm" variant="ghost" onClick={() => openEditLot(lot)}>
                          {t('common.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('invest.deletePurchase')}
                          onClick={() => void removeLot(lot)}
                        >
                          ✕
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}

      {/* Only one card is ever expanded. Unmounting the other is what makes
          that true rather than merely likely: a control hidden behind a
          full-screen overlay is still keyboard-reachable, and two panels each
          holding a native-fullscreen request would fight over it. */}
      {tab === 'watchlist' && !chartFullscreen.expanded && (
        <Card
          className={cx(watchFullscreen.expanded && 'card--fullscreen')}
          title={
            <span className="watch-card-title">
              {t('invest.watchlist')}
              {watchFullscreen.expanded && (
                <span className="watch-card-count">
                  {watchlist.items.length} symbol{watchlist.items.length === 1 ? '' : 's'} ·{' '}
                  {watchlist.groups.length} categor
                  {watchlist.groups.length === 1 ? 'y' : 'ies'}
                </span>
              )}
            </span>
          }
          actions={
            <>
              <RefreshButton
                onRefresh={() => Promise.all([watchlist.refresh(), watchQuotes.refresh()])}
                busy={watchlist.isValidating || watchQuotes.loading}
                label={t('invest.refreshWatchlist')}
              />
              <Button size="sm" variant="primary" onClick={() => openWatchForm()}>
                + Add to watchlist
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="card-expand"
                onClick={watchFullscreen.toggle}
                aria-pressed={watchFullscreen.expanded}
                title={
                  watchFullscreen.expanded
                    ? t('invest.exitFullscreenHint')
                    : t('invest.expandWatchlist')
                }
                aria-label={watchFullscreen.expanded ? t('invest.exitFullscreen') : t('invest.fullscreen')}
              >
                <Icon icon={watchFullscreen.expanded ? Minimize2 : Maximize2} size="sm" />
              </Button>
            </>
          }
          padded={false}
        >
          {watchlist.mutationError && (
            <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
              <Alert tone="error" onDismiss={watchlist.clearMutationError}>
                {watchlist.mutationError}
              </Alert>
            </div>
          )}

          {watchlist.initialLoading ? (
            <div className="card-body">
              <Skeleton rows={4} />
            </div>
          ) : watchlist.items.length === 0 ? (
            <EmptyState
              icon={<Icon icon={Eye} size="xl" />}
              title={t('invest.emptyWatchlistTitle')}
              description={t('invest.emptyWatchlistBody')}
              action={
                <Button variant="primary" onClick={() => openWatchForm()}>
                  {t('invest.addSymbol')}
                </Button>
              }
            />
          ) : (
            <div className="watch-groups">
              {watchlist.groups.map((group) => {
                const collapsed = collapsedCategories.includes(group.category);

                return (
                  <section key={group.category} className="watch-group">
                    <header className="watch-group-head">
                      <button
                        type="button"
                        className="watch-group-toggle"
                        aria-expanded={!collapsed}
                        onClick={() => toggleCategory(group.category)}
                      >
                        <Icon
                          icon={ChevronDown}
                          size="sm"
                          className={cx('watch-caret', !collapsed && 'is-open')}
                        />
                        {group.category}
                        <Badge>{group.items.length}</Badge>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={t('invest.addSymbolTo', { group: group.category })}
                        onClick={() => openWatchForm(undefined, group.category)}
                      >
                        <Icon icon={Plus} size="sm" />
                      </Button>
                    </header>

                    {!collapsed && (
                      <ul className="watch-rows">
                        {group.items.map((item) => {
                          const quote = watchQuotes.quotes[item.symbol.toUpperCase()] ?? null;
                          const proximity = targetProximity(quote?.price ?? 0, item.targetPrice);
                          const charted = chartSymbol === item.symbol;

                          return (
                            <li key={item.id}>
                              {/* The whole row is the chart trigger — that is
                                  the primary thing you do with a watched name,
                                  so it gets the whole hit area rather than a
                                  small link inside it. */}
                              <div
                                className={cx('watch-row', charted && 'is-charted')}
                                role="button"
                                tabIndex={0}
                                aria-pressed={charted}
                                aria-label={t('invest.chartSymbol', { symbol: item.symbol })}
                                onClick={() => setChartSymbol(item.symbol)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setChartSymbol(item.symbol);
                                  }
                                }}
                              >
                                <div className="watch-main">
                                  <span className="watch-symbol">{item.symbol}</span>
                                  {item.note && <span className="watch-note">{item.note}</span>}
                                </div>

                                {/* Target, and how far the market is from it. */}
                                <div className="watch-target">
                                  {item.targetPrice > 0 ? (
                                    <>
                                      <span className="watch-target-price">
                                        <Icon icon={Target} size="sm" />
                                        {formatMoney(item.targetPrice, 'USD', settings.locale)}
                                      </span>
                                      {proximity.state !== 'none' && (
                                        <span
                                          className={cx(
                                            'watch-proximity',
                                            `is-${proximity.state}`,
                                          )}
                                        >
                                          {proximity.state === 'near'
                                            ? 'at target'
                                            : `${formatPercent(proximity.distancePercent, 1, true)}`}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-faint">no target</span>
                                  )}
                                </div>

                                {/* Live price, in the market's own currency —
                                    the same convention the holdings table uses. */}
                                <div className="watch-price">
                                  {quote ? (
                                    <>
                                      <span className="price-native">
                                        {formatMoney(quote.price, quote.currency, settings.locale)}
                                      </span>
                                      <span
                                        className={cx(
                                          'watch-change',
                                          quote.changePercent >= 0
                                            ? 'text-positive'
                                            : 'text-negative',
                                        )}
                                      >
                                        {formatPercent(quote.changePercent, 2, true)}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-faint">
                                      {watchQuotes.loading ? '…' : '—'}
                                    </span>
                                  )}
                                </div>

                                {/* stopPropagation: the row itself is a button. */}
                                <div
                                  className="row-actions"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openWatchForm(item)}
                                  >
                                    {t('common.edit')}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={t('invest.removeFromWatchlist', { symbol: item.symbol })}
                                    onClick={() => void removeWatch(item)}
                                  >
                                    ✕
                                  </Button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <InvestmentForm
        open={formOpen}
        wallets={investmentWallets}
        investment={editing}
        addTo={addTo}
        quoteCurrency={brokerCurrency}
        fxRate={brokerRate || 1}
        // Never offer quote-currency entry without a real rate: converting at
        // 1.0 would silently recreate the bug this form exists to prevent.
        fxAvailable={brokerRate > 0 && !portfolio.fx.degraded}
        busy={investments.mutating}
        error={investments.mutationError}
        onClose={closeForm}
        onSubmit={save}
      />

      <WatchlistForm
        open={watchFormOpen}
        entry={editingWatch}
        categories={watchlist.categories}
        defaultCategory={watchCategory}
        findBySymbol={watchlist.findBySymbol}
        busy={watchlist.mutating}
        error={watchlist.mutationError}
        onClose={closeWatchForm}
        onSubmit={saveWatch}
      />

      <Modal
        open={Boolean(sellTarget)}
        title={t('invest.sellSymbol', { symbol: sellTarget?.holding.symbol ?? '' })}
        onClose={() => setSellTarget(null)}
        width={440}
        footer={
          <>
            <Button onClick={() => setSellTarget(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={investments.mutating}
              disabled={sellPriceValue <= 0 || !sellLots.length}
              onClick={() => void confirmSell()}
            >
              {sellLots.length > 1 ? t('invest.sellLots', { count: sellLots.length }) : t('invest.confirmSale')}
            </Button>
          </>
        }
      >
        {/* Which lots. Only shown when there is a choice to make — a
            single-purchase position has nothing to pick. */}
        {sellTarget && sellTarget.holding.lots.length > 1 && (
          <Field
            label={t('invest.whatSelling')}
            hint={t('invest.whatSellingHint')}
          >
            <Select
              value={sellTarget.lotId}
              onChange={(event) =>
                setSellTarget((current) =>
                  current ? { ...current, lotId: event.target.value } : current,
                )
              }
            >
              <option value="all">
                Entire position — {formatNumber(sellTarget.holding.quantity, 8, settings.locale)}{' '}
                shares across {sellTarget.holding.lots.length} buys
              </option>
              {sellTarget.holding.lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {formatDate(lot.buyDate, settings.locale)} —{' '}
                  {formatNumber(lot.quantity, 8, settings.locale)} at{' '}
                  {money(lot.quantity > 0 ? lot.costBasis / lot.quantity : 0)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label={t('invest.sellPricePerShare', { currency: sellInQuote ? brokerCurrency : money.base })}
          hint={
            sellInQuote
              ? t('invest.brokerRateHint', { rate: brokerRate.toFixed(4) })
              : t('invest.sellPricePrefilled')
          }
        >
          <div className="field-with-unit">
            <DecimalInput value={sellPrice} onChange={setSellPrice} placeholder="0.00" autoFocus />
            {brokerRate > 0 && (
              <Segmented<'quote' | 'base'>
                value={sellCurrency}
                ariaLabel={t('invest.sellPriceCurrency')}
                onChange={(next) => {
                  if (next === sellCurrency) return;
                  const value = parseDecimal(sellPrice);
                  if (value) {
                    const converted = next === 'quote' ? value / brokerRate : value * brokerRate;
                    setSellPrice(String(Number(converted.toFixed(6))));
                  }
                  setSellCurrency(next);
                }}
                options={[
                  { value: 'quote', label: brokerCurrency },
                  { value: 'base', label: money.base },
                ]}
              />
            )}
          </div>
        </Field>

        {sellLots.length > 0 && (
          <p className="field-hint" style={{ marginTop: 10 }}>
            {formatNumber(sellQuantity, 8, settings.locale)} × {money(sellPriceValue)} ={' '}
            <strong>{money(sellProceeds)}</strong> · realised{' '}
            <strong className={sellProceeds - sellCost >= 0 ? 'text-positive' : 'text-negative'}>
              {money(sellProceeds - sellCost, { signed: true })}
            </strong>{' '}
            against a cost basis of {money(sellCost)}.
          </p>
        )}
      </Modal>
    </>
  );
}
