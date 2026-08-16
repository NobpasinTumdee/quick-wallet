import { useMemo, useState } from 'react';

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
import { cx, formatDate, formatNumber, formatPercent, formatRelativeTime, todayKey } from '../lib/format';
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

  async function save(payload: InvestmentPayload) {
    if (editing) await investments.update(editing.id, payload);
    else await investments.create(payload);
    setFormOpen(false);
    setEditing(undefined);
  }

  const sellPriceValue = parseDecimal(sellPrice);

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
          icon="📈"
          title="No investment wallet yet"
          description="Create a wallet in Investment mode from the Wallets tab, then add positions here. Fund it with a transfer from a cash wallet."
        />
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid--stats">
        <StatCard label="Cost basis" icon="🧾" value={money(portfolio.totalCost, { compact: true })} hint="Open positions" />
        <StatCard
          label="Market value"
          tone="accent"
          icon="💹"
          value={money(portfolio.totalValue, { compact: true })}
          hint={`${portfolio.provider} · ${formatRelativeTime(portfolio.lastUpdated)}`}
        />
        <StatCard
          label="Unrealised P&L"
          tone={portfolio.totalPnl >= 0 ? 'positive' : 'negative'}
          icon="📊"
          value={formatPercent(portfolio.totalPnlPercent, 2, true)}
          hint={money(portfolio.totalPnl, { signed: true })}
        />
        <StatCard
          label="Realised P&L"
          tone={realizedTotal >= 0 ? 'positive' : 'negative'}
          icon="🏁"
          value={money(realizedTotal, { signed: true })}
          hint={`${soldPositions.length} closed position${soldPositions.length === 1 ? '' : 's'}`}
        />
      </div>

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
            icon="📈"
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
                        <div className="list-item-sub">
                          {isOpen ? formatDate(row.buyDate, settings.locale) : `sold ${formatDate(row.sellDate, settings.locale)}`}
                        </div>
                      </td>
                      <td className="num">{formatNumber(row.quantity, 8, settings.locale)}</td>
                      <td className="num">{money(row.avgCost)}</td>
                      <td className="num">
                        {isOpen ? (
                          valuation?.quote ? (
                            <>
                              {money(valuation.marketPrice)}
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
                      <td className="num">
                        {isOpen ? money(valuation?.marketValue ?? row.costBasis) : money(row.quantity * row.sellPrice)}
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
                                setSellPrice(String(valuation?.marketPrice || row.buyPrice));
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
        <Field label={`Sell price per share (${money.base})`} hint="Pre-filled with the latest quote.">
          <DecimalInput value={sellPrice} onChange={setSellPrice} placeholder="0.00" autoFocus />
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
