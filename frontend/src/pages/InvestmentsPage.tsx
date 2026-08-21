import { ChartColumn, Flag, Receipt, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Icon } from '../components/Icon';
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
  Segmented,
  Skeleton,
  StatCard,
  parseDecimal,
} from '../components/ui';
import { useExcelDB } from '../hooks/useExcelDB';
import { useStockQuotes } from '../hooks/useStockQuotes';
import {
  cx,
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  todayKey,
} from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Investment, WalletBalance } from '../types';

export function InvestmentsPage() {
  const { settings } = useSettings();
  const [view, setView] = useState<'hold' | 'sold'>('hold');
  const [tagFilter, setTagFilter] = useState('');

  const wallets = useExcelDB<WalletBalance>('wallets');
  const investments = useExcelDB<Investment>('investments');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Investment | undefined>();
  const [selling, setSelling] = useState<Investment | undefined>();
  /** Raw string so long decimals survive typing; parsed on confirm. */
  const [sellPrice, setSellPrice] = useState('');
  /** Which currency the sell price is being typed in. */
  const [sellCurrency, setSellCurrency] = useState<'quote' | 'base'>('base');

  const portfolio = useStockQuotes(investments.items);
  const money = useMoneyFormatter();

  const investmentWallets = wallets.items.filter((w) => w.mode === 'investment' && !w.archived);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const inv of investments.items) inv.tagList?.forEach((tag) => tags.add(tag));
    return [...tags].sort();
  }, [investments.items]);

  const soldPositions = investments.items.filter((i) => i.status === 'sold');
  const rows = (view === 'hold' ? portfolio.positions : soldPositions).filter(
    (row) => !tagFilter || row.tagList?.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase()),
  );

  const realizedTotal = soldPositions.reduce((sum, i) => sum + i.realizedPnl, 0);

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
   */
  function looksMisEntered(position: (typeof portfolio.positions)[number]): boolean {
    if (brokerRate < 2 || !position.quote || position.avgCost <= 0) return false;
    const ratio = position.marketPrice / position.avgCost;
    return ratio > brokerRate * 0.6 && ratio < brokerRate * 1.8;
  }

  const misEnteredCount = portfolio.positions.filter(looksMisEntered).length;

  /** The rate actually in use, for the banner. Null when nothing needs converting. */
  const convertedRate = useMemo(() => {
    const entry = Object.entries(portfolio.fx.rates).find(
      ([currency, lookup]) => currency !== portfolio.baseCurrency && lookup.source !== 'none',
    );
    if (!entry) return null;
    return { currency: entry[0], rate: entry[1].rate, fetchedAt: entry[1].fetchedAt };
  }, [portfolio.fx.rates, portfolio.baseCurrency]);

  async function save(payload: InvestmentPayload) {
    if (editing) await investments.update(editing.id, payload);
    else await investments.create(payload);
    setFormOpen(false);
    setEditing(undefined);
  }

  const sellInQuote = sellCurrency === 'quote' && brokerRate > 0;
  /** Always submitted in the bookkeeping currency, whatever was typed. */
  const sellPriceValue = sellInQuote
    ? parseDecimal(sellPrice) * brokerRate
    : parseDecimal(sellPrice);

  async function confirmSell() {
    if (!selling || sellPriceValue <= 0) return;
    await investments.action(selling.id, 'sell', { sellPrice: sellPriceValue, sellDate: todayKey() });
    setSelling(undefined);
  }

  async function remove(investment: Investment) {
    if (!window.confirm(`Delete the ${investment.symbol} position?`)) return;
    await investments.remove(investment.id);
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
        <StatCard label="Cost basis" icon={<Icon icon={Receipt} size="sm" />} value={money(portfolio.totalCost, { compact: true })} hint="Open positions" />
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
          hint={`${soldPositions.length} closed position${soldPositions.length === 1 ? '' : 's'}`}
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
          {brokerCurrency} price saved into a {portfolio.baseCurrency} field looks like. Open each one,
          switch the buy price to <strong>{brokerCurrency}</strong>, re-enter the broker's figure, and it
          will be converted and saved correctly.
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

      <Card
        title="Positions"
        actions={
          <>
            <Button size="sm" onClick={() => void portfolio.refresh()} loading={portfolio.loading}>
              Refresh prices
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
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
                { value: 'hold', label: `Holding (${portfolio.positions.length})` },
                { value: 'sold', label: `Sold (${soldPositions.length})` },
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

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon icon={TrendingUp} size="xl" />}
            title={view === 'hold' ? 'No open positions' : 'Nothing sold yet'}
            description={
              view === 'hold'
                ? 'Add a position with its symbol, buy price and quantity to start tracking P&L.'
                : 'Positions you mark as sold appear here with their realised P&L.'
            }
            action={
              view === 'hold' ? (
                <Button variant="primary" onClick={() => setFormOpen(true)}>
                  Add a position
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">Qty</th>
                  <th className="num">Avg cost</th>
                  <th className="num">{view === 'hold' ? 'Price' : 'Sell price'}</th>
                  <th className="num">{view === 'hold' ? 'Value' : 'Proceeds'}</th>
                  <th className="num">P&L</th>
                  <th>Tags</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isOpen = row.status === 'hold';
                  const valuation = isOpen ? portfolio.positions.find((p) => p.id === row.id) : undefined;
                  const pnl = isOpen ? (valuation?.unrealizedPnl ?? 0) : row.realizedPnl;
                  const pnlPercent = isOpen ? (valuation?.unrealizedPnlPercent ?? 0) : row.realizedPnlPercent;

                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.symbol}</strong>
                        {isOpen && valuation && looksMisEntered(valuation) && (
                          <>
                            {' '}
                            <Badge tone="warning">
                              <span
                                title={`The cost per share is about ${brokerRate.toFixed(0)}× below the live price — the sign of a ${brokerCurrency} figure saved as ${portfolio.baseCurrency}. Edit the position and re-enter the price with the ${brokerCurrency} toggle.`}
                              >
                                check price
                              </span>
                            </Badge>
                          </>
                        )}
                        <div className="list-item-sub">
                          {isOpen ? formatDate(row.buyDate, settings.locale) : `sold ${formatDate(row.sellDate, settings.locale)}`}
                        </div>
                      </td>
                      <td className="num">{formatNumber(row.quantity, 8, settings.locale)}</td>
                      {/* Shown in the broker's currency so it matches their app,
                          with the authoritative base-currency total beneath. */}
                      <td className="num">
                        {brokerRate > 0 && isOpen ? (
                          <>
                            <span className="price-native" title="Converted at today's rate">
                              {formatMoney(row.avgCost / brokerRate, brokerCurrency, settings.locale)}
                            </span>
                            <div className="list-item-sub">{money(row.costBasis)} total</div>
                          </>
                        ) : (
                          money(row.avgCost)
                        )}
                      </td>
                      {/* Price stays in the market's own currency — that's the
                          number you'd see on a broker screen. */}
                      <td className="num">
                        {isOpen ? (
                          valuation?.quote ? (
                            <>
                              <span className="price-native">
                                {formatMoney(
                                  valuation.nativePrice,
                                  valuation.nativeCurrency,
                                  settings.locale,
                                )}
                              </span>
                              <div
                                className={cx(
                                  'list-item-sub',
                                  valuation.quote.changePercent >= 0 ? 'text-positive' : 'text-negative',
                                )}
                              >
                                {formatPercent(valuation.quote.changePercent, 2, true)} today
                              </div>
                            </>
                          ) : (
                            <span className="text-faint">—</span>
                          )
                        ) : (
                          money(row.sellPrice)
                        )}
                      </td>
                      {/* Value and P&L are converted, so they're comparable with
                          the cost basis and with the rest of the app. */}
                      <td className="num">
                        {isOpen ? money(valuation?.marketValue ?? row.costBasis) : money(row.quantity * row.sellPrice)}
                        {isOpen && valuation?.converted && (
                          <div className="list-item-sub" title={`Converted at ${valuation.fxRate.toFixed(4)}`}>
                            @ {valuation.fxRate.toFixed(2)} {valuation.nativeCurrency}/{money.base}
                          </div>
                        )}
                      </td>
                      <td className={cx('num', pnl >= 0 ? 'text-positive' : 'text-negative')}>
                        {formatPercent(pnlPercent, 2, true)}
                        <div className="list-item-sub">{money(pnl, { signed: true })}</div>
                      </td>
                      <td>
                        <div className="tag-row">
                          {row.tagList?.length ? (
                            row.tagList.map((tag) => <Badge key={tag}>{tag}</Badge>)
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        <div className="row-actions">
                          {isOpen && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelling(row);
                                // Prefill is the converted price, so start in base.
                                setSellCurrency('base');
                                // Round away float noise (10932.900000000001).
                                setSellPrice(
                                  String(Number((valuation?.marketPrice || row.buyPrice).toFixed(4))),
                                );
                              }}
                            >
                              Sell
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(row);
                              setFormOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void remove(row)}>
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
        )}
      </Card>

      <InvestmentForm
        open={formOpen}
        wallets={investmentWallets}
        investment={editing}
        quoteCurrency={brokerCurrency}
        fxRate={brokerRate || 1}
        // Never offer quote-currency entry without a real rate: converting at
        // 1.0 would silently recreate the bug this form exists to prevent.
        fxAvailable={brokerRate > 0 && !portfolio.fx.degraded}
        busy={investments.mutating}
        error={investments.mutationError}
        onClose={() => {
          setFormOpen(false);
          setEditing(undefined);
          investments.clearMutationError();
        }}
        onSubmit={save}
      />

      <Modal
        open={Boolean(selling)}
        title={`Sell ${selling?.symbol ?? ''}`}
        onClose={() => setSelling(undefined)}
        width={400}
        footer={
          <>
            <Button onClick={() => setSelling(undefined)}>Cancel</Button>
            <Button
              variant="primary"
              loading={investments.mutating}
              disabled={sellPriceValue <= 0}
              onClick={() => void confirmSell()}
            >
              Confirm sale
            </Button>
          </>
        }
      >
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
        {selling && (
          <p className="field-hint" style={{ marginTop: 10 }}>
            {formatNumber(selling.quantity, 8, settings.locale)} × {money(sellPriceValue)} ={' '}
            <strong>{money(selling.quantity * sellPriceValue)}</strong> · realised{' '}
            <strong
              className={
                selling.quantity * sellPriceValue - selling.costBasis >= 0 ? 'text-positive' : 'text-negative'
              }
            >
              {money(selling.quantity * sellPriceValue - selling.costBasis, { signed: true })}
            </strong>
          </p>
        )}
      </Modal>
    </>
  );
}
