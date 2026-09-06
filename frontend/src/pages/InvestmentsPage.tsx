import { ChartColumn, ChevronDown, Flag, Plus, Receipt, TrendingUp } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

import { Icon } from '../components/Icon';
import type { ChartReadout } from '../components/StockCandlestickChart';
import { useCandles } from '../hooks/useCandles';
import { candleProviderName } from '../services/candleApi';
import { InvestmentForm, InvestmentPayload } from '../components/InvestmentForm';
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
import { PositionValuation, useStockQuotes } from '../hooks/useStockQuotes';
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
import { Investment, WalletBalance } from '../types';

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
  const { settings } = useSettings();
  const [view, setView] = useState<'hold' | 'sold'>('hold');
  const [tagFilter, setTagFilter] = useState('');

  const wallets = useExcelDB<WalletBalance>('wallets');
  const investments = useExcelDB<Investment>('investments');

  /** Which holding the chart is drawing. Defaults to the first open one. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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

  const selected = holdings.find((h) => h.key === selectedKey) ?? null;
  const chart = useCandles(selected?.symbol ?? null, 12);

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
    if (!window.confirm(`Delete this purchase?\n\n${label}`)) return;
    await investments.remove(lot.id);
  }

  /** Clicking a holding charts it and opens its history; clicking again closes. */
  function toggleHolding(key: string) {
    setSelectedKey(key);
    setHistoryKey((current) => (current === key ? null : key));
  }

  if (investments.initialLoading || wallets.initialLoading) {
    return (
      <Card title="Loading positions">
        <Skeleton rows={5} />
      </Card>
    );
  }

  if (investmentWallets.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Icon icon={TrendingUp} size="xl" />}
          title="No investment wallet yet"
          description="Create a wallet in Investment mode from the Wallets tab, then add positions here. Fund it with a transfer from a cash wallet."
        />
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid--stats">
        <StatCard
          label="Cost basis"
          icon={<Icon icon={Receipt} size="sm" />}
          value={money(portfolio.totalCost, { compact: true })}
          hint={`${holdings.length} position${holdings.length === 1 ? '' : 's'} · ${portfolio.positions.length} purchase${portfolio.positions.length === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Market value"
          tone="accent"
          icon={<Icon icon={TrendingUp} size="sm" />}
          value={money(portfolio.totalValue, { compact: true })}
          hint={`${portfolio.provider} · ${formatRelativeTime(portfolio.lastUpdated)}`}
        />
        <StatCard
          label="Unrealised P&L"
          tone={portfolio.totalPnl >= 0 ? 'positive' : 'negative'}
          icon={<Icon icon={ChartColumn} size="sm" />}
          value={formatPercent(portfolio.totalPnlPercent, 2, true)}
          hint={money(portfolio.totalPnl, { signed: true })}
        />
        <StatCard
          label="Realised P&L"
          tone={realizedTotal >= 0 ? 'positive' : 'negative'}
          icon={<Icon icon={Flag} size="sm" />}
          value={money(realizedTotal, { signed: true })}
          hint={`${soldLots.length} closed lot${soldLots.length === 1 ? '' : 's'}`}
        />
      </div>

      {/* Conversion is doing real work to the numbers, so it is stated openly
          rather than hidden behind the totals. */}
      {portfolio.fx.degraded ? (
        <Alert tone="error" title="Exchange rate unavailable">
          {portfolio.fx.unresolved.join(', ')} prices could not be converted to {portfolio.baseCurrency},
          so they are being compared 1:1 against your cost basis. P&amp;L for those positions is wrong
          until the rate is available — press Refresh prices to retry.
        </Alert>
      ) : (
        convertedRate && (
          <Alert tone="info" title="Currency conversion">
            Prices are quoted in {convertedRate.currency} and converted at{' '}
            <strong>
              1 {convertedRate.currency} = {convertedRate.rate.toFixed(4)} {portfolio.baseCurrency}
            </strong>{' '}
            to compare against your {portfolio.baseCurrency} cost basis.
            {convertedRate.fetchedAt && ` Rate from ${formatRelativeTime(convertedRate.fetchedAt)}.`}
          </Alert>
        )
      )}

      {misEnteredCount > 0 && (
        <Alert tone="warning" title={`${misEnteredCount} position${misEnteredCount === 1 ? '' : 's'} may be priced in ${brokerCurrency}`}>
          Their cost per share is roughly {brokerRate.toFixed(0)}× below the live price, which is what a{' '}
          {brokerCurrency} price saved into a {portfolio.baseCurrency} field looks like. Open the
          purchase history, edit the offending buy, switch its price to{' '}
          <strong>{brokerCurrency}</strong>, re-enter the broker's figure, and the average will
          correct itself.
        </Alert>
      )}

      {!portfolio.isLive && (
        <Alert tone="warning" title="Simulated prices">
          No stock API key configured, so prices are generated locally and P&L is illustrative. Add{' '}
          <code>VITE_STOCK_API_KEY</code> to <code>frontend/.env.local</code> for live quotes.
        </Alert>
      )}

      {Object.keys(portfolio.errors).length > 0 && (
        <Alert tone="warning" title="Some quotes failed">
          {Object.entries(portfolio.errors)
            .map(([symbol, message]) => `${symbol}: ${message}`)
            .join(' · ')}
        </Alert>
      )}

      {/* ---- Price history for the selected position ---- */}
      {selected && (
        <Card className="card--glass">
          <div className="candle-card-head">
            <div>
              <span className="candle-symbol">
                {selected.symbol}
                <span className="candle-symbol-meta">
                  daily · 12 months · {candleProviderName()}
                  {chart.fromCache && ' · cached'}
                </span>
              </span>
            </div>

            {shown && (
              <div className="candle-ohlc">
                <span>O<b>{shown.open.toFixed(2)}</b></span>
                <span>H<b>{shown.high.toFixed(2)}</b></span>
                <span>L<b>{shown.low.toFixed(2)}</b></span>
                <span>
                  C
                  <b className={shown.change >= 0 ? 'is-up' : 'is-down'}>{shown.close.toFixed(2)}</b>
                </span>
                <span className={shown.change >= 0 ? 'is-up' : 'is-down'}>
                  {shown.change >= 0 ? '+' : ''}
                  {shown.change.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <Suspense fallback={<div className="candle-frame" style={{ height: 340 }} />}>
          <StockCandlestickChart
            candles={chart.candles}
            height={340}
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

      <Card
        title="Positions"
        actions={
          <>
            {/* Positions come from the sheet; prices come from the quote API.
                This pulls the rows, the button beside it re-quotes them. */}
            <RefreshButton
              onRefresh={() => Promise.all([investments.refresh(), wallets.refresh()])}
              busy={investments.isValidating || wallets.isValidating}
              label="Refresh positions"
            />
            <Button size="sm" onClick={() => void portfolio.refresh()} loading={portfolio.loading}>
              Refresh prices
            </Button>
            <Button size="sm" variant="primary" onClick={openNewPosition}>
              + New position
            </Button>
          </>
        }
        padded={false}
      >
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="toolbar">
            <Segmented<'hold' | 'sold'>
              value={view}
              ariaLabel="Position view"
              onChange={setView}
              options={[
                { value: 'hold', label: `Holding (${holdings.length})` },
                { value: 'sold', label: `Sold (${soldLots.length})` },
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
                ? 'Add a position with its symbol, buy price and quantity to start tracking P&L. Buy the same ticker again later and the two purchases average together automatically.'
                : 'Positions you mark as sold appear here with their realised P&L, one row per purchase.'
            }
            action={
              view === 'hold' ? (
                <Button variant="primary" onClick={openNewPosition}>
                  Add a position
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
                  <th>Symbol</th>
                  <th className="num">Qty</th>
                  <th className="num">Avg cost</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                  <th className="num">P&L</th>
                  <th>Tags</th>
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
                      aria-label={`${holding.symbol}: chart and purchase history`}
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
                                title={`The cost per share is about ${brokerRate.toFixed(0)}× below the live price — the sign of a ${brokerCurrency} figure saved as ${portfolio.baseCurrency}. Open the purchase history and re-enter the offending buy with the ${brokerCurrency} toggle.`}
                              >
                                check price
                              </span>
                            </Badge>
                          )}
                        </span>
                        <div className="list-item-sub">
                          {averaged
                            ? `${formatDate(holding.firstBuyDate, settings.locale)} – ${formatDate(holding.lastBuyDate, settings.locale)}`
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
                            title={`Add another purchase of ${holding.symbol}`}
                            onClick={() => openBuyMore(holding)}
                          >
                            <Icon icon={Plus} size="sm" />
                            Buy
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openSell(holding, averaged ? 'all' : holding.lots[0].id)}
                          >
                            Sell
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
                              <strong>Purchase history</strong>
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
                                Add purchase
                              </Button>
                            </div>

                            <table className="data data--nested">
                              <thead>
                                <tr>
                                  <th>Bought</th>
                                  <th className="num">Qty</th>
                                  <th className="num">Price / share</th>
                                  <th className="num">Cost</th>
                                  <th className="num">Share of position</th>
                                  <th className="num">P&L</th>
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
                                            Sell
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => openEditLot(lot)}
                                          >
                                            Edit
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            aria-label="Delete this purchase"
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
                  <th>Symbol</th>
                  <th className="num">Qty</th>
                  <th className="num">Avg cost</th>
                  <th className="num">Sell price</th>
                  <th className="num">Proceeds</th>
                  <th className="num">P&L</th>
                  <th>Tags</th>
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
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Delete this purchase"
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

      <Modal
        open={Boolean(sellTarget)}
        title={`Sell ${sellTarget?.holding.symbol ?? ''}`}
        onClose={() => setSellTarget(null)}
        width={440}
        footer={
          <>
            <Button onClick={() => setSellTarget(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={investments.mutating}
              disabled={sellPriceValue <= 0 || !sellLots.length}
              onClick={() => void confirmSell()}
            >
              {sellLots.length > 1 ? `Sell ${sellLots.length} lots` : 'Confirm sale'}
            </Button>
          </>
        }
      >
        {/* Which lots. Only shown when there is a choice to make — a
            single-purchase position has nothing to pick. */}
        {sellTarget && sellTarget.holding.lots.length > 1 && (
          <Field
            label="What are you selling?"
            hint="Lots are sold whole. Pick one purchase, or close the entire position at this price."
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
          label={`Sell price per share (${sellInQuote ? brokerCurrency : money.base})`}
          hint={
            sellInQuote
              ? `Type it exactly as your broker shows it — converted at ${brokerRate.toFixed(4)} on save.`
              : 'Pre-filled with the latest quote, already converted.'
          }
        >
          <div className="field-with-unit">
            <DecimalInput value={sellPrice} onChange={setSellPrice} placeholder="0.00" autoFocus />
            {brokerRate > 0 && (
              <Segmented<'quote' | 'base'>
                value={sellCurrency}
                ariaLabel="Sell price currency"
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
